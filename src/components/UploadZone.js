import { useState, useRef } from 'react';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import './UploadZone.css';

function UploadZone({ onImageSelected }) {
  const [preview, setPreview] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const handleFile = (file) => {
    // TODO: สร้าง preview URL ด้วย URL.createObjectURL(file)
    // TODO: เรียก onImageSelected(file)
  };

  const handleDrop = (e) => {
    // TODO: e.preventDefault(), ดึงไฟล์จาก e.dataTransfer.files[0]
  };

  const handleDragOver = (e) => {
    // TODO: e.preventDefault(), setIsDragging(true)
  };

  return (
    <div
      className={`upload-zone ${isDragging ? 'dragging' : ''} ${preview ? 'has-preview' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragging(false)}
      onClick={() => inputRef.current?.click()}
    >
      {preview ? (
        <img src={preview} alt="Preview" className="upload-preview" />
      ) : (
        <>
          <CloudUploadOutlinedIcon className="upload-icon" />
          <p className="upload-text">ลากรูปมาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</p>
          <span className="upload-hint">รองรับ PNG, JPG, WEBP</span>
        </>
      )}
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
