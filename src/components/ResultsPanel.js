import './ResultsPanel.css';

function ResultsPanel({ results, isLoading, uploadedImage, onBack, model, error, timingInfo }) {
  return (
    <div className="results-container">
      {/* 1. ปุ่มย้อนกลับ */}
      <div className="results-topbar">
        <button className="back-btn" onClick={onBack}>
          ← Upload another image
        </button>
        <span className="model-badge">{model}</span>
      </div>

      {/* 2. เนื้อหาแบ่งเป็น 2 ฝั่ง ซ้าย-ขวา */}
      <div className="results-content">
        {/* ฝั่งซ้าย: รูปภาพต้นฉบับ */}
        <div className="left-panel">
          <div className="image-box">
            {uploadedImage && <img src={uploadedImage} alt="Uploaded font" />}
          </div>
        </div>

        {/* ฝั่งขวา: แสดง Top Fonts ด้วย results.map() */}
        <div className="right-panel">
          {isLoading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              Running inference...
            </div>
          ) : error ? (
            <div className="error-state">
              <span className="error-icon">⚠️</span>
              <p className="error-message">{error}</p>
              <p className="error-hint">ตรวจสอบว่า Backend server กำลังทำงาน:<br/>
                <code>cd backend && uvicorn main:app --reload --port 8000</code>
              </p>
            </div>
          ) : results && results.length > 0 ? (
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
                  <p className="specimen-text" style={{ fontFamily: font.name }}>
                    ดูฟอนต์ DooFonts
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              ไม่พบข้อมูลฟอนต์
            </div>
          )}
        </div>
      </div>

      {/* 3. Processing time */}
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