import { useCallback, useEffect, useRef, useState } from 'react';
import './CompareResultsPanel.css';

const MODEL_DISPLAY_NAMES = {
  'convnext-v2': 'ConvNeXt V2',
  'efficientnet-v2': 'EfficientNet V2',
  'maxvit': 'MaxViT',
  'swin': 'Swin',
  'vit': 'ViT',
};

const MODEL_ORDER = ['convnext-v2', 'efficientnet-v2', 'maxvit', 'swin', 'vit'];

// ตรวจจับระดับความสูงของสระและวรรณยุกต์ไทย
function getThaiToneClass(text) {
  if (!text) return '';
  if (/[\u0E31\u0E34-\u0E37\u0E47\u0E4D][\u0E48-\u0E4C]/.test(text)) {
    return 'has-stacked-tone';
  }
  if (/[\u0E31\u0E34-\u0E37\u0E47-\u0E4E]/.test(text)) {
    return 'has-upper-tone';
  }
  return '';
}

function OcrImage({ src, bbox }) {
  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const [boxStyle, setBoxStyle] = useState(null);

  const updateBoxPosition = useCallback(() => {
    const container = containerRef.current;
    const image = imageRef.current;
    if (!container || !image || !bbox || !image.naturalWidth || !image.naturalHeight) {
      setBoxStyle(null);
      return;
    }

    const scale = Math.min(image.clientWidth / image.naturalWidth, image.clientHeight / image.naturalHeight);
    const displayedWidth = image.naturalWidth * scale;
    const displayedHeight = image.naturalHeight * scale;
    const imageLeft = image.offsetLeft + (image.clientWidth - displayedWidth) / 2;
    const imageTop = image.offsetTop + (image.clientHeight - displayedHeight) / 2;
    const xValues = bbox.map(([x]) => x);
    const yValues = bbox.map(([, y]) => y);

    setBoxStyle({
      left: imageLeft + Math.min(...xValues) * scale,
      top: imageTop + Math.min(...yValues) * scale,
      width: (Math.max(...xValues) - Math.min(...xValues)) * scale,
      height: (Math.max(...yValues) - Math.min(...yValues)) * scale,
    });
  }, [bbox]);

  useEffect(() => {
    const observer = new ResizeObserver(updateBoxPosition);
    if (containerRef.current) observer.observe(containerRef.current);
    updateBoxPosition();
    return () => observer.disconnect();
  }, [src, updateBoxPosition]);

  return (
    <div className="image-box" ref={containerRef}>
      {src && <img ref={imageRef} src={src} alt="Uploaded font" onLoad={updateBoxPosition} />}
      {boxStyle && <div className="ocr-bounding-box" style={boxStyle} aria-label="Detected text area" />}
    </div>
  );
}

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
  const displayText = recognizedText;

  return (
    <div className="compare-container">
      {/* Top bar */}
      <div className="compare-topbar">
        <button className="compare-back-btn" onClick={onBack}>
          ← Upload another image
        </button>
        <div className="compare-badge-group">
          <span className="compare-mode-badge">Compare All Models</span>
        </div>
      </div>

      {timingInfo && (
        <div className="compare-timing-row">
          <span className="compare-timing">
            Processing: {timingInfo.inference_time_ms} ms
            <span className="compare-timing-separator">|</span>
            Total: {timingInfo.total_time_ms} ms
          </span>
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
              // <img src={uploadedImage} alt="Uploaded font" />
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
          const totalMs = result?.total_time_ms;
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
                    <div className="compare-spinner" />
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
                      <span className="compare-font-confidence">
                        {topPred.confidence}%
                      </span>
                    </div>
                    {topPred.style && (
                      <div className="compare-font-style">
                        <span className="compare-style-tag">{topPred.style}</span>
                        <span className="compare-style-conf">
                          {topPred.style_confidence}%
                        </span>
                      </div>
                    )}
                    {/* Rendered specimen using OCR text */}
                    <textarea
                      className={`compare-specimen ${getThaiToneClass(displayText)}`}
                      style={{
                        fontFamily: topPred.name,
                        fontWeight: topPred.style?.includes('bold') ? 700 : 400,
                        fontStyle: topPred.style?.includes('italic')
                          ? 'italic'
                          : 'normal',
                      }}
                      value={displayText}
                      onChange={(e) => onRecognizedTextChange(e.target.value)}
                      placeholder="Type to preview..."
                      rows={2}
                      aria-label="Font preview text, maximum 50 words"
                      title="Maximum 50 words"
                      spellCheck={false}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                    />
                    {/* Runner-ups */}
                    {predictions.length > 1 && (
                      <div className="compare-runners">
                        {predictions.slice(1).map((p, i) => (
                          <span key={i} className="compare-runner-chip">
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

              {inferenceMs != null && (
                <div className="compare-cell-footer">
                  <span className="timing-label">Model inference:</span>
                  <span className="timing-value">{inferenceMs} ms</span>
                  {totalMs != null && (
                    <>
                      <span className="timing-separator">|</span>
                      <span className="timing-label">Total:</span>
                      <span className="timing-value">{totalMs} ms</span>
                    </>
                  )}
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
