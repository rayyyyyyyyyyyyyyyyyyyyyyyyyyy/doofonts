/**
 * Shared model constants used by ModelSelector, CompareResultsPanel, etc.
 */

export const MODELS = [
  { id: 'convnext-v2', name: 'ConvNeXt V2' },
  { id: 'efficientnet-v2', name: 'EfficientNet V2' },
  { id: 'maxvit', name: 'MaxViT' },
  { id: 'swin', name: 'Swin' },
  { id: 'vit', name: 'ViT' },
];

/** Ordered list of model IDs (for compare grid rendering). */
export const MODEL_ORDER = MODELS.map((m) => m.id);

/** Mapping from model ID to display name. */
export const MODEL_DISPLAY_NAMES = Object.fromEntries(
  MODELS.map((m) => [m.id, m.name])
);
