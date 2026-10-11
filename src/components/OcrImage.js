import { useCallback, useEffect, useRef, useState } from 'react';
import './OcrImage.css';

/**
 * แสดงรูปพร้อมกรอบข้อความที่ OCR เลือก
 * ใช้ร่วมกันในหน้าโมเดลเดียวและหน้าเปรียบเทียบ
 */
function OcrImage({ src, bbox, className = 'image-box' }) {
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

    // หาขนาดและตำแหน่งรูปบนหน้าจอ โดยคำนึงถึงช่องว่างรอบรูปด้วย
    const scale = Math.min(image.clientWidth / image.naturalWidth, image.clientHeight / image.naturalHeight);
    const displayedWidth = image.naturalWidth * scale;
    const displayedHeight = image.naturalHeight * scale;
    const imageLeft = image.offsetLeft + (image.clientWidth - displayedWidth) / 2;
    const imageTop = image.offsetTop + (image.clientHeight - displayedHeight) / 2;
    const xValues = bbox.map(([x]) => x);
    const yValues = bbox.map(([, y]) => y);

    // ย่อหรือขยายตำแหน่งกรอบ ให้ตรงกับรูปที่ผู้ใช้เห็น
    setBoxStyle({
      left: imageLeft + Math.min(...xValues) * scale,
      top: imageTop + Math.min(...yValues) * scale,
      width: (Math.max(...xValues) - Math.min(...xValues)) * scale,
      height: (Math.max(...yValues) - Math.min(...yValues)) * scale,
    });
  }, [bbox]);

  useEffect(() => {
    // ปรับตำแหน่งกรอบใหม่เมื่อกล่องรูปเปลี่ยนขนาด
    const observer = new ResizeObserver(updateBoxPosition);
    if (containerRef.current) observer.observe(containerRef.current);
    updateBoxPosition();
    return () => observer.disconnect();
  }, [src, updateBoxPosition]);

  return (
    <div className={className} ref={containerRef}>
      {src && <img ref={imageRef} src={src} alt="Uploaded font" onLoad={updateBoxPosition} />}
      {boxStyle && <div className="ocr-bounding-box" style={boxStyle} aria-label="Detected text area" />}
    </div>
  );
}

export default OcrImage;
