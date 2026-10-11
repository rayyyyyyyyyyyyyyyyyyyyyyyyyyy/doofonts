/**
 * รายชื่อโมเดลที่ใช้ร่วมกันในตัวเลือกโมเดลและหน้าผลลัพธ์
 */

export const MODELS = [
  { id: 'convnext-v2', name: 'ConvNeXt V2' },
  { id: 'efficientnet-v2', name: 'EfficientNet V2' },
  { id: 'maxvit', name: 'MaxViT' },
  { id: 'swin', name: 'Swin' },
  { id: 'vit', name: 'ViT' },
];

/** ลำดับโมเดลที่ใช้แสดงในกริดเปรียบเทียบ */
export const MODEL_ORDER = MODELS.map((m) => m.id);

/** จับคู่รหัสโมเดลกับชื่อที่แสดงบนหน้าเว็บ */
export const MODEL_DISPLAY_NAMES = Object.fromEntries(
  MODELS.map((m) => [m.id, m.name])
);
