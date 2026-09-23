"""
main.py — FastAPI server for DooFonts font classification inference.

Endpoints:
    GET  /health           — Health check
    GET  /api/models       — List available models
    POST /api/predict      — Predict font + style from uploaded image
"""

import json
import time
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import io

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load mappings and initialise ModelManager at startup."""
    global model_manager

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
    return result


# ---------------------------------------------------------------------------
# Run with: uvicorn main:app --reload --port 8000
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
