/** แยกข้อความแจ้งว่า OCR ผิดพลาด หรือทำงานสำเร็จแต่ไม่พบข้อความ */
function OcrStatus({ result }) {
  if (!result || result.status === 'success') return null;
  if (result.status === 'error') {
    return <p role="alert">OCR could not read the image. Please try again or type the preview text.</p>;
  }
  if (result.status === 'no_text') {
    return <p role="status">No readable text found. You can type the preview text.</p>;
  }
  return null;
}

export default OcrStatus;
