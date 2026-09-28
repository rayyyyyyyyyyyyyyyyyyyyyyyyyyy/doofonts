import { useCallback, useEffect, useRef, useState } from 'react';
import './ResultsPanel.css';

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

// ตรวจจับระดับความสูงของสระและวรรณยุกต์ไทย
function getThaiToneClass(text) {
  if (!text) return '';
  // สระบน + วรรณยุกต์ ซ้อนกัน 2 ชั้น (เช่น พื้, ตั้, ปิ๊)
  if (/[\u0E31\u0E34-\u0E37\u0E47\u0E4D][\u0E48-\u0E4C]/.test(text)) {
    return 'has-stacked-tone';
  }
  // สระบน หรือ วรรณยุกต์เดี่ยว 1 ชั้น (เช่น กิน, บ้าน, รู้)
  if (/[\u0E31\u0E34-\u0E37\u0E47-\u0E4E]/.test(text)) {
    return 'has-upper-tone';
  }
  return '';
}


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
  const specimenText = recognizedText;

  return (
    <div className="results-container">
      {/* 1. ปุ่มย้อนกลับ */}
      <div className="results-topbar">
        <button className="back-btn" onClick={onBack}>
          ← Upload another image
        </button>
        <span className="model-badge">{model}</span>
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
              <p className="error-message">{error}</p>
              <p className="error-hint">Check that the backend server is running:<br /><code>cd backend && uvicorn main:app --reload --port 8000</code></p>
            </div>
          ) : results && results.length > 0 ? (
            <>
              <div className="font-list">
                {results.map((font, index) => (
                  <div key={font.name} className="font-item">
                    <div className="font-header">
                      <span className="font-rank">#{index + 1}</span>
                      <span className="font-name">{font.name}</span>
                      <span className="font-confidence">{font.confidence}%</span>
                    </div>
                    {font.style && (
                      <div className="font-style-info">
                        <span className="style-label">Style:</span>
                        <span className="style-value">{font.style}</span>
                        <span className="style-confidence">{font.style_confidence}%</span>
                      </div>
                    )}
                    <textarea
                      className={`specimen-text ${getThaiToneClass(specimenText)}`}
                      style={{
                         fontFamily: font.name,
                         fontWeight: font.style?.includes('bold') ? 700 : 400,
                         fontStyle: font.style?.includes('italic') ? 'italic' : 'normal',
                      }}
                      value={specimenText}
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
                  </div>
                ))}
              </div>
            </>
          ) : <div className="empty-state">No font results found</div>}
        </div>
      </div>

      {timingInfo && (
        <div className="timing-info">
          <span className="timing-label">Processing time:</span>
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
