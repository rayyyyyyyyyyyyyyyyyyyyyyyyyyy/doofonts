"""
model_loader.py — เตรียมภาพ โหลดโมเดล และทำนายฟอนต์กับรูปแบบตัวอักษร

"""

import threading
import time
import torch
import torch.nn as nn
from torchvision import transforms
from PIL import Image
import timm
from pathlib import Path


# ---------------------------------------------------------------------------
# ย่อภาพโดยคงสัดส่วน แล้วเติมพื้นที่ว่างให้ครบ 224 × 224
# ---------------------------------------------------------------------------
class LetterboxResize:
    def __init__(self, target_size=(224, 224), fill_color=(255, 255, 255)):
        self.target_size = target_size
        self.fill_color = fill_color

    def __call__(self, img: Image.Image) -> Image.Image:
        img_copy = img.copy()
        img_copy.thumbnail(self.target_size, Image.Resampling.LANCZOS)

        padded_img = Image.new("RGB", self.target_size, self.fill_color)
        paste_x = (self.target_size[0] - img_copy.width) // 2
        paste_y = (self.target_size[1] - img_copy.height) // 2
        padded_img.paste(img_copy, (paste_x, paste_y))

        return padded_img


# ---------------------------------------------------------------------------
# โมเดลที่ทำนายสองอย่าง: ชื่อฟอนต์และรูปแบบตัวอักษร
# ---------------------------------------------------------------------------
class DualHeadClassifier(nn.Module):
    SUPPORTED_MODELS = {
        'convnext': 'convnextv2_tiny.fcmae_ft_in22k_in1k',
        'swin': 'swin_tiny_patch4_window7_224',
        'vit': 'vit_small_patch16_224',
        'efficientnet': 'efficientnetv2_rw_s',
        'maxvit': 'maxvit_tiny_tf_224',
    }

    def __init__(self, model_key='convnext', num_font_classes=31, num_style_classes=4,
                 pretrained=False):
        super(DualHeadClassifier, self).__init__()

        if model_key not in self.SUPPORTED_MODELS:
            raise ValueError(f"Invalid model_key. Choose from: {list(self.SUPPORTED_MODELS.keys())}")

        self.model_name = self.SUPPORTED_MODELS[model_key]

        # ให้โมเดลหลักหาลักษณะของภาพ แล้วส่งต่อไปทำนายฟอนต์และรูปแบบตัวอักษร
        self.backbone = timm.create_model(
            self.model_name,
            pretrained=pretrained,
            num_classes=0,
        )
        in_features = self.backbone.num_features

        # ส่วนทำนายชื่อฟอนต์
        self.font_head = nn.Sequential(
            nn.Linear(in_features, 512),
            nn.LayerNorm(512),
            nn.GELU(),
            nn.Dropout(p=0.4),
            nn.Linear(512, num_font_classes),
        )

        # ส่วนทำนายรูปแบบตัวอักษร เช่น ตัวหนาหรือตัวเอียง
        self.style_head = nn.Sequential(
            nn.Linear(in_features, 256),
            nn.LayerNorm(256),
            nn.GELU(),
            nn.Dropout(p=0.3),
            nn.Linear(256, num_style_classes),
        )

    def forward(self, x):
        features = self.backbone(x)
        return self.font_head(features), self.style_head(features)


# ---------------------------------------------------------------------------
# โหลดน้ำหนักที่ฝึกแล้ว และเตรียมขั้นตอนทำนาย
# ---------------------------------------------------------------------------
class FontClassifierPredictor:
    """โหลดน้ำหนักโมเดลที่ฝึกแล้ว เพื่อทำนายชื่อฟอนต์และรูปแบบตัวอักษร"""

    def __init__(self, model_key: str, checkpoint_path: str,
                 font_mapping: dict, style_mapping: dict):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

        # เปลี่ยนจากชื่อ → หมายเลข เป็นหมายเลข → ชื่อ เพื่อแปลผลทำนาย
        self.font_names = {v: k for k, v in font_mapping.items()}
        self.style_names = {v: k for k, v in style_mapping.items()}

        # สร้างโครงสร้างโมเดลก่อน แล้วโหลดน้ำหนักจากไฟล์ของเรา
        self.model = DualHeadClassifier(
            model_key=model_key,
            num_font_classes=len(self.font_names),
            num_style_classes=len(self.style_names),
        )

        # โหลดค่าที่ได้จากการฝึก รองรับทั้งไฟล์รวมข้อมูลและไฟล์น้ำหนักโดยตรง
        checkpoint = torch.load(checkpoint_path, map_location=self.device, weights_only=False)
        if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
            self.model.load_state_dict(checkpoint['model_state_dict'])
            epoch = checkpoint.get('epoch', 'N/A')
            print(f"  Loaded [{model_key}] weights from epoch {epoch}")
        else:
            self.model.load_state_dict(checkpoint)
            print(f"  Loaded [{model_key}] raw state_dict")

        self.model.to(self.device)
        self.model.eval()

        # ย่อภาพ เติมขอบ และปรับค่าพิกเซลแบบเดียวกับตอนตรวจผลระหว่างฝึก
        self.transform = transforms.Compose([
            LetterboxResize(target_size=(224, 224), fill_color=(255, 255, 255)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

    def predict(self, image: Image.Image, top_k: int = 3) -> dict:
        """
        ทำนายฟอนต์อันดับสูงสุดจำนวน top_k พร้อมรูปแบบตัวอักษรและค่าความมั่นใจ
        คืน predictions และ inference_time_ms ซึ่งรวมเวลาเตรียมภาพด้วย
        """
        start_time = time.time()

        image = image.convert('RGB')
        img_tensor = self.transform(image).unsqueeze(0).to(self.device)

        with torch.no_grad():
            font_logits, style_logits = self.model(img_tensor)

            font_probs = torch.softmax(font_logits, dim=1)
            style_probs = torch.softmax(style_logits, dim=1)

            # เลือกฟอนต์ที่ได้ค่าความมั่นใจสูงสุดตามจำนวน top_k
            top_font_probs, top_font_indices = torch.topk(font_probs, k=top_k, dim=1)

            # เลือกรูปแบบตัวอักษรที่ได้ค่าความมั่นใจสูงสุดหนึ่งแบบต่อภาพ
            style_id = torch.argmax(style_probs, dim=1).item()
            style_conf = style_probs[0][style_id].item() * 100

        predictions = []
        for i in range(top_k):
            font_idx = top_font_indices[0][i].item()
            font_conf = top_font_probs[0][i].item() * 100
            font_name = self.font_names.get(font_idx, "Unknown")

            predictions.append({
                "name": font_name.replace("_", " "),
                "confidence": round(font_conf, 1),
                "style": self.style_names.get(style_id, "unknown"),
                "style_confidence": round(style_conf, 1),
            })

        inference_time_ms = round((time.time() - start_time) * 1000, 1)

        return {
            "predictions": predictions,
            "inference_time_ms": inference_time_ms,
        }


# ---------------------------------------------------------------------------
# เก็บโมเดลที่โหลดแล้วในหน่วยความจำ เพื่อใช้ซ้ำ
# ---------------------------------------------------------------------------

# จับคู่รหัสโมเดลจากหน้าเว็บกับชื่อที่ใช้โหลดไฟล์น้ำหนัก
FRONTEND_TO_BACKEND_KEY = {
    'convnext-v2': 'convnext',
    'efficientnet-v2': 'efficientnet',
    'maxvit': 'maxvit',
    'swin': 'swin',
    'vit': 'vit',
}


class ModelManager:
    """จัดการโมเดลหลายตัว และเก็บตัวที่โหลดแล้วไว้ใช้ซ้ำ"""

    def __init__(self, models_dir: str, font_mapping: dict, style_mapping: dict):
        self.models_dir = Path(models_dir)
        self.font_mapping = font_mapping
        self.style_mapping = style_mapping
        self._cache: dict[str, FontClassifierPredictor] = {}
        # ถ้ามีคำขอพร้อมกัน ให้รอโหลดโมเดลทีละคำขอ เพื่อไม่โหลดตัวเดียวกันซ้ำ
        self._lock = threading.Lock()

    def get_predictor(self, frontend_model_id: str) -> FontClassifierPredictor:
        """ใช้โมเดลตามรหัสจากหน้าเว็บ ถ้ายังไม่มีในหน่วยความจำให้โหลดก่อน"""
        with self._lock:
            return self._get_or_load(frontend_model_id)

    def _get_or_load(self, frontend_model_id: str) -> FontClassifierPredictor:
        if frontend_model_id in self._cache:
            return self._cache[frontend_model_id]

        backend_key = FRONTEND_TO_BACKEND_KEY.get(frontend_model_id)
        if backend_key is None:
            raise ValueError(
                f"Unknown model: '{frontend_model_id}'. "
                f"Available: {list(FRONTEND_TO_BACKEND_KEY.keys())}"
            )

        checkpoint_path = self.models_dir / f"best_{backend_key}.pth"
        if not checkpoint_path.exists():
            raise FileNotFoundError(
                f"Checkpoint not found: {checkpoint_path}\n"
                f"Please place your trained model file at: {checkpoint_path}"
            )

        print(f"Loading model '{frontend_model_id}' ({backend_key})...")
        predictor = FontClassifierPredictor(
            model_key=backend_key,
            checkpoint_path=str(checkpoint_path),
            font_mapping=self.font_mapping,
            style_mapping=self.style_mapping,
        )
        self._cache[frontend_model_id] = predictor
        print(f"  Model '{frontend_model_id}' ready!")
        return predictor

    def preload_all(self) -> dict[str, str]:
        """
        โหลดทุกโมเดลและทดลองทำนายด้วยภาพว่าง เพื่อลดเวลารอคำขอแรก
        คืนรหัสโมเดลและข้อความผิดพลาด หากโหลดหรือทดลองทำนายไม่สำเร็จ
        """
        warmup_image = Image.new("RGB", (224, 224), (255, 255, 255))
        errors = {}
        for model_id in self.all_models:
            try:
                self.get_predictor(model_id).predict(warmup_image)
            except Exception as e:
                # เอาโมเดลที่ทดลองทำนายไม่สำเร็จออกจากรายชื่อที่โหลดแล้ว
                self._cache.pop(model_id, None)
                errors[model_id] = str(e)
        return errors

    @property
    def all_models(self) -> list[str]:
        """รหัสโมเดลทั้งหมดที่รู้จัก รวมตัวที่ยังโหลดไม่ได้"""
        return list(FRONTEND_TO_BACKEND_KEY.keys())

    @property
    def loaded_models(self) -> list[str]:
        """รหัสโมเดลที่เก็บในหน่วยความจำแล้ว เรียงตามรายชื่อโมเดล"""
        return [model_id for model_id in self.all_models if model_id in self._cache]
