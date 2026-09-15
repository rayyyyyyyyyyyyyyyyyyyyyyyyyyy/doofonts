import './ModelSelector.css';

const MODELS = [
  { id: 'convnext-v2', name: 'ConvNeXt V2'},
  { id: 'efficientnet-v2', name: 'EfficientNet V2'},
  { id: 'maxvit', name: 'MaxViT'},
  { id: 'swin', name: 'Swin'},
  { id: 'vit', name: 'ViT'}
];

function ModelSelector({ selectedModel, onModelChange }) {
  return (
    <div className="model-selector">
      <label className="model-label">AI Model</label>
      <select
        className="model-select"
        value={selectedModel}
        onChange={(e) => onModelChange(e.target.value)}
      >
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default ModelSelector;
