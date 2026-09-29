import { MODELS } from '../constants/models';
import './ModelSelector.css';

/**
 * @param availableModels IDs the backend loaded, or null when unknown
 *   (all models stay selectable then; the prediction reports any error).
 */
function ModelSelector({ selectedModel, onModelChange, availableModels }) {
  return (
    <div className="model-selector">
      <label className="model-label" htmlFor="model-select">AI Model</label>
      <select
        id="model-select"
        className="model-select"
        value={selectedModel}
        onChange={(e) => onModelChange(e.target.value)}
      >
        {MODELS.map((m) => {
          const unavailable = availableModels != null && !availableModels.includes(m.id);
          return (
            <option key={m.id} value={m.id} disabled={unavailable}>
              {m.name}{unavailable ? ' (unavailable)' : ''}
            </option>
          );
        })}
      </select>
    </div>
  );
}

export default ModelSelector;
