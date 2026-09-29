"""
main.py — FastAPI server for DooFonts font classification inference.

Endpoints:
    GET  /health           — Health check
    GET  /api/models       — List available models
    POST /api/predict      — Predict font + style from uploaded image (single model)
    POST /api/predict-all  — Predict font + style using ALL available models
"""

import asyncio
import json
import threading
import time
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageEnhance
import io
import easyocr
import numpy as np
import torch

from model_loader import ModelManager

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"

FONT_MAPPING_PATH = BASE_DIR.parent / "font_mapping.json"
STYLE_MAPPING_PATH = BASE_DIR.parent / "style_mapping.json"

# ---------------------------------------------------------------------------
# Globals (initialised in lifespan)
# ---------------------------------------------------------------------------
model_manager: ModelManager | None = None
model_load_errors: dict[str, str] = {}  # model_id -> reason it failed to preload
ocr_reader_th: easyocr.Reader | None = None
ocr_reader_en: easyocr.Reader | None = None
# OCR now runs in worker threads; serialise access to the shared EasyOCR readers.
ocr_lock = threading.Lock()

# Small images are upscaled to this height before OCR so thin Thai vowel and
# tone-mark strokes survive detection/recognition. Chosen on 46 images (a real
# user screenshot, the 3 samples, and rendered bold words on light/dark
# backgrounds): 400px read the most words correctly (tied with 800px capped
# at 4x) and is ~3.5x faster than the original 800px (avg 1.44s vs 4.97s).
# 200-300px is faster but misreads the user screenshot "ขั้นพื้นฐาน" -- keep that
# image as a regression check when changing this value.
OCR_TARGET_HEIGHT = 400


def run_ocr(image: Image.Image) -> dict:
    """
    Run EasyOCR on the given PIL image and return every text box it read.

    Returns:
        {"candidates": [{"text", "confidence", "bbox"}, ...]}
    Thai is written without spaces, so a candidate is often a whole line. The
    frontend (src/utils/ocrPreview.js) segments lines into words with the
    browser's Intl.Segmenter and picks the preview word; Python has no built-in
    Thai word segmentation and the project avoids an extra dependency for it.
    """
    with ocr_lock:
        return _run_ocr_unlocked(image)


def _run_ocr_unlocked(image: Image.Image) -> dict:
    ocr_items: list[dict] = []
    if ocr_reader_th is not None:
        try:
            # 1. ปรับขนาดภาพ & Contrast เพื่อให้อ่านสระไทยได้คมชัดขึ้น
            img_rgb = image.convert("RGB")
            scale_factor = 1.0
            if img_rgb.height < OCR_TARGET_HEIGHT:
                scale_factor = OCR_TARGET_HEIGHT / img_rgb.height
                new_size = (int(img_rgb.width * scale_factor), int(img_rgb.height * scale_factor))
                img_rgb = img_rgb.resize(new_size, Image.Resampling.LANCZOS)
            enhancer = ImageEnhance.Contrast(img_rgb)
            img_rgb = enhancer.enhance(1.05)

            # 2. ส่งภาพที่ preprocess แล้วเข้า EasyOCR
            raw_ocr_results = ocr_reader_th.readtext(
                np.array(img_rgb),
                add_margin=0.6,
                mag_ratio=1.0,
                text_threshold=0.6,
                low_text=0.3,
                link_threshold=0.4,
                adjust_contrast=0.5,
                decoder="beamsearch",
                beamWidth=5,
                # Do not merge neighbouring word boxes into a full text line.
                width_ths=0.0,
            )

            for box, text, confidence in raw_ocr_results:
                cleaned_text = text.strip()
                if not cleaned_text:
                    continue

                # ตรวจสอบว่ามีตัวอักษรภาษาไทยหรือไม่
                has_thai = any('\u0e00' <= ch <= '\u0e7f' for ch in cleaned_text)

                # ถ้าเป็นภาษาอังกฤษล้วน ให้ใช้โมเดลอังกฤษช่วยอ่านเพื่อเก็บตัวพิมพ์ใหญ่
                if not has_thai and ocr_reader_en is not None:
                    x_min = max(0, int(min(pt[0] for pt in box)))
                    x_max = min(img_rgb.width, int(max(pt[0] for pt in box)))
                    y_min = max(0, int(min(pt[1] for pt in box)))
                    y_max = min(img_rgb.height, int(max(pt[1] for pt in box)))

                    if x_max > x_min and y_max > y_min:
                        crop = img_rgb.crop((x_min, y_min, x_max, y_max))
                        # width_ths=0.0: the Thai detector's box can spill into the
                        # next word ("Whereas t"); without it EasyOCR merges both into
                        # one multi-word result that is never picked as a single word.
                        en_res = ocr_reader_en.readtext(np.array(crop), detail=1, width_ths=0.0)
                        if en_res:
                            # Keep individual English word boxes; joining them
                            # would turn a line into one incorrect candidate.
                            for en_box, en_text, en_confidence in en_res:
                                en_text = en_text.strip()
                                if not en_text:
                                    continue
                                ocr_items.append({
                                    "text": en_text,
                                    "confidence": round(float(en_confidence) * 100, 1),
                                    "bbox": [
                                        [
                                            (float(x) + x_min) / scale_factor,
                                            (float(y) + y_min) / scale_factor,
                                        ]
                                        for x, y in en_box
                                    ],
                                })
                            continue

                ocr_items.append({
                    "text": cleaned_text,
                    "confidence": round(float(confidence) * 100, 1),
                    "bbox": [[float(x) / scale_factor, float(y) / scale_factor] for x, y in box],
                })

        except Exception as e:
            print(f"  OCR warning: {e}")

    return {"candidates": ocr_items}


async def read_upload_image(file: UploadFile) -> Image.Image:
    """Validate the upload and fully decode it, raising HTTP 400 on bad input."""
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"Expected an image file, got {file.content_type}")

    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        # Image.open is lazy; decode now so corrupt files fail here, and so
        # OCR and model threads never race on the lazy load.
        image.load()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read image: {str(e)}")
    return image


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load mappings and initialise ModelManager at startup."""
    global model_manager, model_load_errors, ocr_reader_th, ocr_reader_en

    print("=" * 50)
    print("  DooFonts API — Starting up")
    print("=" * 50)

    # Load label mappings
    if not FONT_MAPPING_PATH.exists():
        raise RuntimeError(f"font_mapping.json not found at {FONT_MAPPING_PATH}")
    if not STYLE_MAPPING_PATH.exists():
        raise RuntimeError(f"style_mapping.json not found at {STYLE_MAPPING_PATH}")

    with open(FONT_MAPPING_PATH, "r", encoding="utf-8") as f:
        font_mapping = json.load(f)
    with open(STYLE_MAPPING_PATH, "r", encoding="utf-8") as f:
        style_mapping = json.load(f)

    print(f"  Font classes : {len(font_mapping)}")
    print(f"  Style classes: {len(style_mapping)}")
    print(f"  Models dir   : {MODELS_DIR}")

    if not MODELS_DIR.exists():
        print(f"  WARNING: Models directory not found at {MODELS_DIR}")
        print("           Place your best_*.pth files there.")

    model_manager = ModelManager(
        models_dir=str(MODELS_DIR),
        font_mapping=font_mapping,
        style_mapping=style_mapping,
    )

    # Load once because EasyOCR initialisation downloads/loads its recognition models.
    ocr_reader_th = easyocr.Reader(["th", "en"], gpu=torch.cuda.is_available())
    ocr_reader_en = easyocr.Reader(["en"], gpu=torch.cuda.is_available())

    print(f"  Known models: {model_manager.all_models}")

    # Load and warm up every model now rather than on the first request, so
    # compare-mode timings are the same for the first request and later ones.
    # A missing checkpoint only disables that model; its requests report the error.
    preload_start = time.time()
    model_load_errors = model_manager.preload_all()
    print(f"  Preloaded {model_manager.loaded_models} in {time.time() - preload_start:.1f}s")
    for model_id, err in model_load_errors.items():
        print(f"  WARNING: could not preload '{model_id}': {err}")
    print("=" * 50)
    print("  Ready! Waiting for requests...")
    print("=" * 50)

    yield  # App runs here

    # Shutdown
    print("DooFonts API — Shutting down")


# ---------------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="DooFonts API",
    description="Thai font classification API powered by PyTorch",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "models_dir": str(MODELS_DIR),
        "models_dir_exists": MODELS_DIR.exists(),
        "available_models": model_manager.loaded_models if model_manager else [],
        "failed_models": model_load_errors,
    }


@app.get("/api/models")
async def list_models():
    """Return the IDs of models that loaded successfully and can serve predictions."""
    return {"models": model_manager.loaded_models if model_manager else []}


@app.post("/api/predict-all")
async def predict_all(
    file: UploadFile = File(...),
    top_k: int = Query(default=3, ge=1, le=10, description="Number of top predictions"),
):
    """
    Predict font family and style from an uploaded image using ALL available models.

    Returns results keyed by model ID, each containing predictions and inference time.
    """
    if model_manager is None:
        raise HTTPException(status_code=503, detail="Server not ready yet")

    total_start = time.time()
    image = await read_upload_image(file)

    # OCR runs before the models, not alongside them: on CPU it barely shortens
    # the request but competes for cores and inflates each model's
    # inference_time_ms several-fold, skewing the model comparison.
    ocr_start = time.time()
    ocr = await asyncio.to_thread(run_ocr, image)
    ocr_time_ms = round((time.time() - ocr_start) * 1000, 1)

    # Models run one at a time on purpose: this endpoint exists to compare the
    # models' speed, and running them in parallel makes them compete for CPU
    # cores, inflating each inference_time_ms 2-4x (and even changing their
    # ranking) while saving only ~0.1 s of wall time.
    def run_models_sequentially() -> dict:
        results = {}
        # Iterate every known model so a missing checkpoint shows up as an error cell.
        for model_id in model_manager.all_models:
            try:
                result = model_manager.get_predictor(model_id).predict(image, top_k)
            except Exception as e:
                result = {"error": str(e), "predictions": [], "inference_time_ms": 0}
            results[model_id] = result
        return results

    model_results = await asyncio.to_thread(run_models_sequentially)

    # Timing: OCR runs once and is shared; inference_time_ms is the sum of the
    # models (they run one after another); total_time_ms is the whole request.
    total_inference_ms = round(
        sum(r.get("inference_time_ms", 0) for r in model_results.values()), 1
    )

    return {
        "model_results": model_results,
        "ocr_time_ms": ocr_time_ms,
        "inference_time_ms": total_inference_ms,
        "total_time_ms": round((time.time() - total_start) * 1000, 1),
        "ocr": ocr,
    }


@app.post("/api/predict")
async def predict(
    file: UploadFile = File(...),
    model: str = Query(default="convnext-v2", description="Model ID to use for prediction"),
    top_k: int = Query(default=3, ge=1, le=10, description="Number of top predictions"),
):
    """
    Predict font family and style from an uploaded image.

    - **file**: Image file (PNG, JPG, WEBP, etc.)
    - **model**: Model ID (convnext-v2, efficientnet-v2, maxvit, swin, vit)
    - **top_k**: Number of top font predictions to return (default: 3)
    """
    if model_manager is None:
        raise HTTPException(status_code=503, detail="Server not ready yet")

    total_start = time.time()
    image = await read_upload_image(file)

    # OCR, model loading and inference are blocking; keep them off the event loop.
    ocr_start = time.time()
    ocr = await asyncio.to_thread(run_ocr, image)
    ocr_time_ms = round((time.time() - ocr_start) * 1000, 1)

    # Load model (cached) and predict
    try:
        predictor = await asyncio.to_thread(model_manager.get_predictor, model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    try:
        result = await asyncio.to_thread(predictor.predict, image, top_k)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")

    result["ocr_time_ms"] = ocr_time_ms
    result["total_time_ms"] = round((time.time() - total_start) * 1000, 1)
    result["ocr"] = ocr
    return result


# ---------------------------------------------------------------------------
# Run with: uvicorn main:app --reload --port 8000
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
