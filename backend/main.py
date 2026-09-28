"""
main.py — FastAPI server for DooFonts font classification inference.

Endpoints:
    GET  /health           — Health check
    GET  /api/models       — List available models
    POST /api/predict      — Predict font + style from uploaded image
"""

import json
import re
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
ocr_reader_th: easyocr.Reader | None = None
ocr_reader_en: easyocr.Reader | None = None

# Keep the OCR preview short enough to remain useful as a font specimen.
MAX_OCR_TEXT_LENGTH = 15
THAI_TONE_MARKS = re.compile(r"[\u0E48-\u0E4B]")


def ocr_text_length(text: str) -> int:
    """Count preview characters, excluding spaces and Thai tone marks (่้๊๋)."""
    return sum(
        1
        for character in text
        if not character.isspace() and not THAI_TONE_MARKS.fullmatch(character)
    )


def is_single_ocr_word(text: str) -> bool:
    """Accept one whitespace-delimited OCR word, not a line or sentence."""
    return len(text.split()) == 1


def select_longest_ocr_item(ocr_items: list[dict]) -> dict | None:
    """Return the longest OCR item that fits the 15-character preview limit."""
    eligible_items = [
        item for item in ocr_items
        if (
            is_single_ocr_word(item["text"])
            and ocr_text_length(item["text"]) <= MAX_OCR_TEXT_LENGTH
        )
    ]
    return max(
        eligible_items,
        key=lambda item: (ocr_text_length(item["text"]), item["confidence"]),
        default=None,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load mappings and initialise ModelManager at startup."""
    global model_manager, ocr_reader_th, ocr_reader_en

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
        print(f"           Place your best_*.pth files there.")

    model_manager = ModelManager(
        models_dir=str(MODELS_DIR),
        font_mapping=font_mapping,
        style_mapping=style_mapping,
    )

    # Load once because EasyOCR initialisation downloads/loads its recognition models.
    ocr_reader_th = easyocr.Reader(["th", "en"], gpu=torch.cuda.is_available())
    ocr_reader_en = easyocr.Reader(["en"], gpu=torch.cuda.is_available())

    print(f"  Available models: {model_manager.available_models}")
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
        "available_models": model_manager.available_models if model_manager else [],
    }


@app.get("/api/models")
async def list_models():
    """Return list of available model IDs."""
    return {"models": model_manager.available_models if model_manager else []}


@app.post("/api/predict-all")
async def predict_all(
    file: UploadFile = File(...),
    top_k: int = Query(default=3, ge=1, le=10, description="Number of top predictions"),
):
    """
    Predict font family and style from an uploaded image using ALL available models.

    Returns results keyed by model ID, each containing predictions and inference time.
    """
    import asyncio

    if model_manager is None:
        raise HTTPException(status_code=503, detail="Server not ready yet")

    total_start = time.time()

    # Validate file type
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"Expected an image file, got {file.content_type}")

    # Read and decode image
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read image: {str(e)}")

    all_model_ids = model_manager.available_models

    # OCR is independent from font prediction. Keep only the longest detected
    # text segment so the UI has one clear word to highlight and edit.
    ocr_items = []
    if ocr_reader_th is not None:
        try:
            # 1. ปรับขนาดภาพ & Contrast เพื่อให้อ่านสระไทยได้คมชัดขึ้น
            img_rgb = image.convert("RGB")
            scale_factor = 1.0
            if img_rgb.height < 800:
                scale_factor = 800 / img_rgb.height
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

            ocr_items = []
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
                        en_res = ocr_reader_en.readtext(np.array(crop), detail=1)
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

    longest_ocr_item = select_longest_ocr_item(ocr_items)

    # Run inference for each model (use thread pool for CPU-bound PyTorch work)
    async def run_single_model(model_id: str):
        try:
            predictor = model_manager.get_predictor(model_id)
            result = await asyncio.to_thread(predictor.predict, image.copy(), top_k)
            # Per-model total starts with the request, so it includes shared OCR
            # preprocessing as well as this model's load and inference time.
            result["total_time_ms"] = round((time.time() - total_start) * 1000, 1)
            return model_id, result, None
        except Exception as e:
            return model_id, None, str(e)

    tasks = [run_single_model(mid) for mid in all_model_ids]
    task_results = await asyncio.gather(*tasks)

    model_results = {}
    for model_id, result, err in task_results:
        if err:
            model_results[model_id] = {"error": err, "predictions": [], "inference_time_ms": 0}
        else:
            model_results[model_id] = result

    # Sum individual model inference times for the aggregate display
    total_inference_ms = round(
        sum(r.get("inference_time_ms", 0) for r in model_results.values()), 1
    )

    return {
        "model_results": model_results,
        "inference_time_ms": total_inference_ms,
        "total_time_ms": round((time.time() - total_start) * 1000, 1),
        "ocr": {
            "text": longest_ocr_item["text"] if longest_ocr_item else "",
            "item": longest_ocr_item,
        },
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

    # Validate file type
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"Expected an image file, got {file.content_type}")

    # Read and decode image
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read image: {str(e)}")

    # OCR is independent from font prediction. Keep only the longest detected
    # text segment so the UI has one clear word to highlight and edit.
    ocr_items = []
    if ocr_reader_th is not None:
        try:
            # 1. ปรับขนาดภาพ & Contrast เพื่อให้อ่านสระไทยได้คมชัดขึ้น
            img_rgb = image.convert("RGB")
            scale_factor = 1.0
            if img_rgb.height < 800:
                scale_factor = 800 / img_rgb.height
                new_size = (int(img_rgb.width * scale_factor), int(img_rgb.height * scale_factor))
                img_rgb = img_rgb.resize(new_size, Image.Resampling.LANCZOS)
            enhancer = ImageEnhance.Contrast(img_rgb)
            img_rgb = enhancer.enhance(1.05)

            # 2. ส่งภาพที่ preprocess แล้วเข้า EasyOCR
            raw_ocr_results = ocr_reader_th.readtext(
                np.array(img_rgb),
                add_margin=0.6,      # เพิ่มขอบรอบกล่อง
                mag_ratio=1.0,        # ขยายภาพใน EasyOCR
                text_threshold=0.6,   # ความมั่นใจตัวอักษร
                low_text=0.3,         # ความคมชัดต่ำสุด
                link_threshold=0.4,   # ความเชื่อมโยงของตัวอักษร
                adjust_contrast=0.5,  # ปรับ contrast
                decoder="beamsearch",
                beamWidth=5,
                # Do not merge neighbouring word boxes into a full text line.
                width_ths=0.0,
            )

            ocr_items = []
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
                        en_res = ocr_reader_en.readtext(np.array(crop), detail=1)
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
            # An OCR failure should not prevent an otherwise valid font prediction.
            print(f"  OCR warning: {e}")

    longest_ocr_item = select_longest_ocr_item(ocr_items)

    # Load model (cached) and predict
    try:
        predictor = model_manager.get_predictor(model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    try:
        result = predictor.predict(image, top_k=top_k)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")

    result["total_time_ms"] = round((time.time() - total_start) * 1000, 1)
    result["ocr"] = {
        "text": longest_ocr_item["text"] if longest_ocr_item else "",
        "item": longest_ocr_item,
    }
    return result


# ---------------------------------------------------------------------------
# Run with: uvicorn main:app --reload --port 8000
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
