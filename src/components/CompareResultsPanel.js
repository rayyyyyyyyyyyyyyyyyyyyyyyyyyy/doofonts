import OcrImage from './OcrImage';
import SpecimenText from './SpecimenText';
import ConfidenceValue from './ConfidenceValue';
import { MODEL_ORDER, MODEL_DISPLAY_NAMES } from '../constants/models';
import './Panel.css';
import './CompareResultsPanel.css';

function CompareResultsPanel({
  modelResults,
  isLoading,
  uploadedImage,
  onBack,
  error,
  timingInfo,
  ocrResult,
  recognizedText,
  onRecognizedTextChange,
}) {
  return (
    <div className="panel compare-container">
      {/* Top bar */}
      <div className="panel-topbar compare-topbar">
        <button className="back-btn" onClick={onBack}>
          ← Upload another image
        </button>
        <div className="compare-badge-group">
          <span className="badge">Compare All Models</span>
        </div>
      </div>

      {timingInfo && (
        <div className="compare-timing-row">
          <span className="compare-timing">
            OCR: {timingInfo.ocr_time_ms} ms
            <span className="compare-timing-separator">|</span>
            {MODEL_ORDER.length} models: {timingInfo.inference_time_ms} ms
            <span className="compare-timing-separator">|</span>
            Total: {timingInfo.total_time_ms} ms
          </span>
        </div>
      )}

      {error && (
        <div className="error-state compare-error" role="alert">
          <p className="error-message">{error.message}</p>
        </div>
      )}

      {/* 3×2 grid */}
      <div className="compare-grid">
        {/* Cell 1: Uploaded image */}
        <div className="compare-cell compare-cell--uploaded">
          <div className="compare-cell-header">
            <span className="compare-cell-label">Uploaded Image</span>
          </div>
          <div className="compare-cell-body compare-cell-body--image">
            {uploadedImage ? (
              <OcrImage src={uploadedImage} bbox={ocrResult?.item?.bbox} />
            ) : (
              <div className="compare-cell-placeholder">No image</div>
            )}
          </div>
        </div>

        {/* Cells 2–6: Model results */}
        {MODEL_ORDER.map((modelId) => {
          const result = modelResults?.[modelId];
          const predictions = result?.predictions || [];
          const topPred = predictions[0];
          const inferenceMs = result?.inference_time_ms;
          const modelError = result?.error;

          return (
            <div key={modelId} className="compare-cell">
              <div className="compare-cell-header">
                <span className="compare-cell-label">
                  {MODEL_DISPLAY_NAMES[modelId] || modelId}
                </span>
              </div>

              <div className="compare-cell-body">
                {isLoading ? (
                  <div className="compare-cell-loading">
                    <div className="spinner spinner--sm" />
                    <span>Analyzing…</span>
                  </div>
                ) : modelError ? (
                  <div className="compare-cell-error">
                    <span className="compare-error-icon">⚠</span>
                    <span className="compare-error-text">{modelError}</span>
                  </div>
                ) : topPred ? (
                  <div className="compare-cell-result">
                    {/* Font name + confidence */}
                    <div className="compare-font-header">
                      <span className="compare-font-name">{topPred.name}</span>
                      <ConfidenceValue
                        percent={topPred.confidence}
                        className="compare-font-confidence"
                      />
                    </div>
                    {topPred.style && (
                      <div className="compare-font-style">
                        <span className="compare-style-tag">{topPred.style}</span>
                        <ConfidenceValue
                          percent={topPred.style_confidence}
                          className="compare-style-conf"
                        />
                      </div>
                    )}
                    {/* Rendered specimen using OCR text */}
                    <SpecimenText
                      font={topPred}
                      value={recognizedText}
                      onChange={onRecognizedTextChange}
                      size="compact"
                    />
                    {/* Runner-ups */}
                    {predictions.length > 1 && (
                      <div className="compare-runners">
                        {predictions.slice(1).map((p) => (
                          <span key={p.name} className="compare-runner-chip">
                            {p.name} <small>{p.confidence}%</small>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="compare-cell-empty">No result</div>
                )}
              </div>

              {/* Only this model's own time; OCR is shared and shown once above. */}
              {inferenceMs != null && !modelError && (
                <div className="compare-cell-footer">
                  <span className="timing-label">Model inference:</span>
                  <span className="timing-value">{inferenceMs} ms</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}

export default CompareResultsPanel;
