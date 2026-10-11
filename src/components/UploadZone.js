import { useState, useRef } from 'react';
import './UploadZone.css';

function UploadZone({ onImageSelected }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);
  const [fileError, setFileError] = useState('');

  const handleFile = (file) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setFileError('Please select a PNG, JPG or WEBP image.');
      return;
    }
    setFileError('');
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

  const openFilePicker = () => inputRef.current?.click();

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFilePicker();
    }
  };

  return (
    <div
      className={`upload-zone ${isDragging ? 'dragging' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Upload an image"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragging(false)}
      onClick={openFilePicker}
      onKeyDown={handleKeyDown}
    >
      <i className="fi fi-ss-cloud-upload upload-icon" aria-hidden="true"></i>
      <p className="upload-text">Drag and drop an image here, or click to browse</p>
      <span className="upload-hint">Supports PNG, JPG and WEBP</span>
      {fileError && <p className="upload-file-error" role="alert">{fileError}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          handleFile(e.target.files[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export default UploadZone;
