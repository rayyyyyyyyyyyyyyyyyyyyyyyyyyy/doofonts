"""
main.py — API สำหรับอ่าน OCR และทำนายฟอนต์ของ DooFonts

เส้นทาง API:
    GET  /health           — ตรวจสถานะ server
    GET  /api/models       — ดูรายชื่อโมเดลที่โหลดแล้ว
    POST /api/predict      — ทำนายฟอนต์และรูปแบบตัวอักษรด้วยโมเดลเดียว
    POST /api/predict-all  — ทำนายด้วยทุกโมเดลเพื่อเปรียบเทียบผล
"""

import asyncio
import json
import math
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
# ตำแหน่งไฟล์โมเดลและรายชื่อฟอนต์
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"

FONT_MAPPING_PATH = BASE_DIR / "font_mapping.json"
STYLE_MAPPING_PATH = BASE_DIR / "style_mapping.json"

# ---------------------------------------------------------------------------
# ตัวแปรที่ใช้ร่วมกัน และเตรียมตอนเริ่มเซิร์ฟเวอร์
# ---------------------------------------------------------------------------
model_manager: ModelManager | None = None
model_load_errors: dict[str, str] = {}  # รหัสโมเดลและสาเหตุที่เตรียมโมเดลไม่สำเร็จ
ocr_reader_th: easyocr.Reader | None = None
ocr_reader_en: easyocr.Reader | None = None
# ให้คำขอรอใช้ OCR ทีละคำขอ เพื่อไม่ให้ใช้ตัวอ่านเดียวกันพร้อมกัน
ocr_lock = threading.Lock()

# ขยายภาพที่สูงน้อยกว่า 400 px เพื่อช่วยให้ OCR อ่านสระและวรรณยุกต์ไทย
OCR_TARGET_HEIGHT = 400


def bbox_area(bbox: list[list[float]]) -> float:
    """คำนวณพื้นที่จากมุมของกรอบ OCR รองรับกรอบที่เอียงด้วย"""
    corners = list(zip(bbox, bbox[1:] + bbox[:1]))
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in corners)) / 2


def run_ocr(image: Image.Image) -> dict:
    """
    เลือกข้อความจากกรอบที่มีพื้นที่ใหญ่ที่สุด ถ้าพื้นที่เท่ากันเลือกค่าความมั่นใจสูงกว่า
    คืน text, item (ข้อความ ความมั่นใจ และพิกัดกรอบ), crop_box (ซ้าย บน ขวา ล่าง) และ status
    status แยกเป็น success, no_text หรือ error โดยไม่ตัดข้อความที่อ่านได้
    """
    try:
        with ocr_lock:
            if ocr_reader_th is None:
                raise RuntimeError("OCR reader is not ready")
            ocr_items = _run_ocr_unlocked(image)
    except Exception as exc:
        print(f"  OCR error: {exc}")
        return {"text": "", "item": None, "crop_box": None, "status": "error"}

    largest = max(
        ocr_items,
        key=lambda item: (bbox_area(item["bbox"]), item["confidence"]),
        default=None,
    )
    if largest is None:
        return {"text": "", "item": None, "crop_box": None, "status": "no_text"}

    # กรอบที่เลือกใช้พิกัดภาพต้นฉบับแล้ว เตรียม crop_box สำหรับโมเดลฟอนต์
    # ปัดขอบออกเพื่อไม่ตัดตัวอักษร และจำกัดขอบให้ไม่เกินภาพต้นฉบับ
    box = largest["bbox"]
    x_min = max(0, math.floor(min(x for x, y in box)))
    x_max = min(image.width, math.ceil(max(x for x, y in box)))
    y_min = max(0, math.floor(min(y for x, y in box)))
    y_max = min(image.height, math.ceil(max(y for x, y in box)))
    return {
        "text": largest["text"],
        "item": largest,
        "crop_box": [x_min, y_min, x_max, y_max],
        "status": "success",
    }


def _run_ocr_unlocked(image: Image.Image) -> list[dict]:
    """อ่านทุกกรอบ แล้วคืนข้อความ ค่าความมั่นใจ และพิกัดบนภาพต้นฉบับ"""
    ocr_items: list[dict] = []
    if ocr_reader_th is not None:
        try:
            # 1. เตรียมภาพสี ขยายภาพเล็ก และเพิ่มความต่างของสีเล็กน้อย
            img_rgb = image.convert("RGB")
            scale_factor = 1.0
            if img_rgb.height < OCR_TARGET_HEIGHT:
                scale_factor = OCR_TARGET_HEIGHT / img_rgb.height
                new_size = (int(img_rgb.width * scale_factor), int(img_rgb.height * scale_factor))
                img_rgb = img_rgb.resize(new_size, Image.Resampling.LANCZOS)
            enhancer = ImageEnhance.Contrast(img_rgb)
            img_rgb = enhancer.enhance(1.05)

            # 2. อ่านข้อความไทยและอังกฤษจากภาพที่เตรียมไว้
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
                # ไม่รวมกรอบคำที่อยู่ข้างกันเป็นข้อความทั้งบรรทัด
                width_ths=0.0,
            )

            # 3. ตรวจข้อความทีละกรอบ โดยข้ามข้อความว่าง
            for box, text, confidence in raw_ocr_results:
                cleaned_text = text.strip()
                if not cleaned_text:
                    continue

                # ตรวจว่ามีตัวอักษรในช่วงรหัสภาษาไทยหรือไม่
                has_thai = any('\u0e00' <= ch <= '\u0e7f' for ch in cleaned_text)

                # 4. ถ้าไม่มีภาษาไทย ให้ตัดเฉพาะส่วนในกรอบมาอ่านอังกฤษซ้ำ
                if not has_thai and ocr_reader_en is not None:
                    # พิกัดบน img_rgb ที่อาจขยายแล้ว ใช้เฉพาะอ่านอังกฤษซ้ำ
                    # ยังไม่ใช่ crop_box บนภาพต้นฉบับสำหรับโมเดลฟอนต์
                    ocr_x_min = max(0, int(min(pt[0] for pt in box)))
                    ocr_x_max = min(img_rgb.width, int(max(pt[0] for pt in box)))
                    ocr_y_min = max(0, int(min(pt[1] for pt in box)))
                    ocr_y_max = min(img_rgb.height, int(max(pt[1] for pt in box)))

                    if ocr_x_max > ocr_x_min and ocr_y_max > ocr_y_min:
                        crop = img_rgb.crop((ocr_x_min, ocr_y_min, ocr_x_max, ocr_y_max))
                        # แยกกรอบคำ เพื่อไม่ให้รวมเศษตัวอักษรจากคำข้างเคียง
                        en_res = ocr_reader_en.readtext(np.array(crop), detail=1, width_ths=0.0)
                        # ใช้ผลอังกฤษแทนรอบแรก เฉพาะเมื่อมีข้อความที่ไม่ว่าง
                        en_res = [result for result in en_res if result[1].strip()]
                        if en_res:
                            # บวกตำแหน่งที่ตัดภาพ แล้วหารอัตราขยาย เพื่อคืนตำแหน่งบนภาพต้นฉบับ
                            for en_box, en_text, en_confidence in en_res:
                                en_text = en_text.strip()
                                ocr_items.append({
                                    "text": en_text,
                                    "confidence": round(float(en_confidence) * 100, 1),
                                    "bbox": [
                                        [
                                            (float(x) + ocr_x_min) / scale_factor,
                                            (float(y) + ocr_y_min) / scale_factor,
                                        ]
                                        for x, y in en_box
                                    ],
                                })
                            # ใช้ผลรอบอังกฤษแทนผลรอบแรก แล้วไปกรอบถัดไป
                            continue

                # 5. ถ้าไม่ได้อ่านข้อความอังกฤษใหม่ ให้เก็บผลรอบแรกแทน
                ocr_items.append({
                    "text": cleaned_text,
                    "confidence": round(float(confidence) * 100, 1),
                    "bbox": [[float(x) / scale_factor, float(y) / scale_factor] for x, y in box],
                })

        except Exception as e:
            raise RuntimeError("OCR recognition failed") from e

    return ocr_items


def crop_for_prediction(image: Image.Image, ocr: dict) -> Image.Image:
    """ตัดภาพต้นฉบับตามกรอบ OCR ที่เลือก เพื่อส่งเข้าโมเดลฟอนต์"""
    if ocr.get("status") == "error":
        raise HTTPException(status_code=503, detail="OCR failed. Please try again before predicting the font.")
    crop_box = ocr.get("crop_box")
    if not crop_box:
        raise HTTPException(status_code=422, detail="No readable text found. Please try another image.")

    # รับพิกัดภาพต้นฉบับจาก run_ocr() ตามลำดับ ซ้าย บน ขวา ล่าง
    # ตรวจว่ากรอบมีพื้นที่ก่อนตัดภาพ โดยไม่คำนวณพิกัดซ้ำ
    x_min, y_min, x_max, y_max = crop_box
    if x_max <= x_min or y_max <= y_min:
        raise HTTPException(status_code=422, detail="Invalid detected text area. Please try another image.")
    return image.crop(tuple(crop_box))


async def read_upload_image(file: UploadFile) -> Image.Image:
    """ตรวจและอ่านไฟล์ภาพ ถ้าไฟล์ไม่ถูกต้องให้ตอบ HTTP 400"""
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"Expected an image file, got {file.content_type}")

    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        # อ่านภาพให้ครบ เพื่อพบไฟล์เสียก่อนส่งให้ OCR และโมเดล
        image.load()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read image: {str(e)}")
    return image


@asynccontextmanager
async def lifespan(app: FastAPI):
    """เตรียมรายชื่อฟอนต์ ตัวอ่าน OCR และโมเดลตอนเริ่ม server"""
    global model_manager, model_load_errors, ocr_reader_th, ocr_reader_en

    print("=" * 50)
    print("  DooFonts API — Starting up")
    print("=" * 50)

    # อ่านตารางจับคู่หมายเลขที่โมเดลทำนาย กับชื่อฟอนต์และรูปแบบตัวอักษร
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

    # สร้างตัวอ่าน OCR ครั้งเดียว แล้วใช้ซ้ำทุกคำขอ
    ocr_reader_th = easyocr.Reader(["th", "en"], gpu=torch.cuda.is_available())
    ocr_reader_en = easyocr.Reader(["en"], gpu=torch.cuda.is_available())

    print(f"  Known models: {model_manager.all_models}")

    # โหลดทุกโมเดลและลองทำนายหนึ่งครั้ง ก่อนเปิดให้ผู้ใช้ส่งภาพ
    # บันทึกข้อผิดพลาดของแต่ละโมเดล โดยยังให้โมเดลอื่นทำงานได้
    preload_start = time.time()
    model_load_errors = model_manager.preload_all()
    print(f"  Preloaded {model_manager.loaded_models} in {time.time() - preload_start:.1f}s")
    for model_id, err in model_load_errors.items():
        print(f"  WARNING: could not preload '{model_id}': {err}")
    print("=" * 50)
    print("  Ready! Waiting for requests...")
    print("=" * 50)

    yield  # เปิดให้เซิร์ฟเวอร์รับคำขอ จนกว่าจะสั่งปิด

    # ทำงานเมื่อปิด server
    print("DooFonts API — Shutting down")


# ---------------------------------------------------------------------------
# สร้าง API ด้วย FastAPI
# ---------------------------------------------------------------------------
app = FastAPI(
    title="DooFonts API",
    description="Thai font classification API powered by PyTorch",
    version="1.0.0",
    lifespan=lifespan,
)

# อนุญาตให้หน้า React ที่รันบนเครื่องนี้เรียก API
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
# เส้นทางรับคำขอ API
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
    """คืนรหัสโมเดลที่อยู่ในหน่วยความจำแล้ว"""
    return {"models": model_manager.loaded_models if model_manager else []}


@app.post("/api/predict-all")
async def predict_all(
    file: UploadFile = File(...),
    top_k: int = Query(default=3, ge=1, le=10, description="Number of top predictions"),
):
    """
    ทำนายด้วยทุกโมเดล และคืนผลแยกตามรหัสโมเดล
    แต่ละผลมีรายชื่อฟอนต์ รูปแบบตัวอักษร และเวลาทำนาย หรือข้อผิดพลาด
    """
    if model_manager is None:
        raise HTTPException(status_code=503, detail="Server not ready yet")

    total_start = time.time()
    image = await read_upload_image(file)

    # อ่าน OCR ให้เสร็จก่อน เพื่อไม่ให้รบกวนการวัดเวลาทำนายโมเดล
    ocr_start = time.time()
    ocr = await asyncio.to_thread(run_ocr, image)

    ocr_time_ms = round((time.time() - ocr_start) * 1000, 1)

    # ตัดกรอบที่ใหญ่ที่สุดครั้งเดียว และใช้ภาพเดียวกันกับทุกโมเดล
    model_image = crop_for_prediction(image, ocr)

    # ทำนายทีละโมเดล เพื่อไม่ให้โมเดลในคำขอเดียวกันแย่งกำลังประมวลผล
    def run_models_sequentially() -> dict:
        results = {}
        # ลองทุกโมเดล เพื่อให้หน้าเว็บแสดงข้อผิดพลาดของโมเดลที่ไม่มีไฟล์ด้วย
        for model_id in model_manager.all_models:
            try:
                result = model_manager.get_predictor(model_id).predict(model_image, top_k)
            except Exception as e:
                result = {"error": str(e), "predictions": [], "inference_time_ms": 0}
            results[model_id] = result
        return results

    model_results = await asyncio.to_thread(run_models_sequentially)

    # เวลา OCR นับครั้งเดียว และเวลาทำนายรวมทุกโมเดล
    # Total นับตั้งแต่เริ่มอ่านไฟล์จนประมวลผลเสร็จ ไม่รวมเวลาอัปโหลดผ่านเครือข่าย
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
    ทำนายฟอนต์และรูปแบบตัวอักษรจากภาพด้วยโมเดลที่เลือก
    file คือไฟล์ภาพ, model คือรหัสโมเดล, top_k คือจำนวนฟอนต์ที่ต้องการคืน (เริ่มต้น 3)
    """
    if model_manager is None:
        raise HTTPException(status_code=503, detail="Server not ready yet")

    total_start = time.time()
    image = await read_upload_image(file)

    # ส่งงาน OCR ไปทำในเธรดแยก เพื่อไม่ขวางการรับคำขออื่นของ API
    ocr_start = time.time()
    ocr = await asyncio.to_thread(run_ocr, image)
    ocr_time_ms = round((time.time() - ocr_start) * 1000, 1)

    # ตัดจากภาพต้นฉบับตามกรอบ OCR ก่อนส่งเข้าโมเดล
    model_image = crop_for_prediction(image, ocr)

    # ใช้โมเดลที่โหลดไว้แล้ว หรือโหลดใหม่ถ้ายังไม่มี
    try:
        predictor = await asyncio.to_thread(model_manager.get_predictor, model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    try:
        result = await asyncio.to_thread(predictor.predict, model_image, top_k)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")

    result["ocr_time_ms"] = ocr_time_ms
    result["total_time_ms"] = round((time.time() - total_start) * 1000, 1)
    result["ocr"] = ocr
    return result


# ---------------------------------------------------------------------------
# เริ่ม server จากโฟลเดอร์ backend: uvicorn main:app --reload --port 8000
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
