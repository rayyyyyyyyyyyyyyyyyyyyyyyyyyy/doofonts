import { useState, useRef } from 'react';
import './UploadZone.css';

function UploadZone({ onImageSelected }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    onImageSelected(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  return (
    <div
      className={`upload-zone ${isDragging ? 'dragging' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragging(false)}
      onClick={() => inputRef.current?.click()}
    >
      <i className="fi fi-ss-cloud-upload upload-icon"></i>
      <p className="upload-text">ลากรูปมาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</p>
      <span className="upload-hint">รองรับ PNG, JPG, WEBP</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => handleFile(e.target.files[0])}
      />
    </div>
  );
}

export default UploadZone;
