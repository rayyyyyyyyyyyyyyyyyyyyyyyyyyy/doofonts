import OcrImage from './OcrImage';
import SpecimenText from './SpecimenText';
import { MODEL_DISPLAY_NAMES } from '../constants/models';
import ConfidenceValue from './ConfidenceValue';
import './Panel.css';
import './ResultsPanel.css';


function ResultsPanel({
  results,
  isLoading,
  uploadedImage,
  onBack,
  model,
  error,
  timingInfo,
  ocrResult,
  recognizedText,
  onRecognizedTextChange,
}) {
  return (
    <div className="panel results-container">
      {/* 1. ปุ่มย้อนกลับ */}
      <div className="panel-topbar">
        <button className="back-btn" onClick={onBack}>
          ← Upload another image
        </button>
        <span className="badge">{MODEL_DISPLAY_NAMES[model] || model}</span>
      </div>

      <div className="results-content">
        <div className="left-panel">
          <OcrImage src={uploadedImage} bbox={ocrResult?.item?.bbox} />
        </div>

        <div className="right-panel">
          {isLoading ? (
            <div className="loading-state"><div className="spinner" />Running inference...</div>
          ) : error ? (
            <div className="error-state">
              <p className="error-message">{error.message}</p>
              {error.serverUnreachable && (
                <p className="error-hint">Check that the backend server is running:<br /><code>cd backend && uvicorn main:app --reload --port 8000</code></p>
              )}
            </div>
          ) : results && results.length > 0 ? (
            <>
              {/* The model predicts one style for the whole image (every
                  prediction carries the same value), so show it once. */}
              {results[0].style && (
                <div className="font-style-info results-style">
                  <span className="style-label">Style:</span>
                  <span className="style-value">{results[0].style}</span>
                  <ConfidenceValue percent={results[0].style_confidence} className="style-confidence" />
                </div>
              )}
              <div className="font-list">
                {results.map((font, index) => (
                  <div key={font.name} className="font-item">
                    <div className="font-header">
                      <span className="font-rank">#{index + 1}</span>
                      <span className="font-name">{font.name}</span>
                      <ConfidenceValue percent={font.confidence} className="font-confidence" />
                    </div>
                    <SpecimenText
                      font={font}
                      value={recognizedText}
                      onChange={onRecognizedTextChange}
                      size="large"
                    />
                  </div>
                ))}
              </div>
            </>
          ) : <div className="empty-state">No font results found</div>}
        </div>
      </div>

      {timingInfo && (
        <div className="timing-info">
          <span className="timing-label">OCR:</span>
          <span className="timing-value">{timingInfo.ocr_time_ms} ms</span>
          <span className="timing-separator">|</span>
          <span className="timing-label">Model inference:</span>
          <span className="timing-value">{timingInfo.inference_time_ms} ms</span>
          <span className="timing-separator">|</span>
          <span className="timing-label">Total:</span>
          <span className="timing-value">{timingInfo.total_time_ms} ms</span>
        </div>
      )}
    </div>
  );
}

export default ResultsPanel;
