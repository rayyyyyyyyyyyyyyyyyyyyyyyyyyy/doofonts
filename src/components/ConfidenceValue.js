/**
 * แบ่งสีค่าความมั่นใจเป็นสูง กลาง และต่ำ โดยกำหนดสีใน Panel.css
 * เกณฑ์สีเป็นเพียงแนวทาง ไม่ใช่อัตราความถูกต้องที่ผ่านการวัดแล้ว
 */
const LEVELS = [
  { min: 70, level: 'high', label: 'High confidence (70% or more)' },
  { min: 40, level: 'medium', label: 'Medium confidence (40–69%)' },
  { min: 0, level: 'low', label: 'Low confidence (below 40%)' },
];

/** แสดงค่าความมั่นใจพร้อมสี และคำอธิบายเมื่อวางเมาส์ */
function ConfidenceValue({ percent, className }) {
  const { level, label } = LEVELS.find(({ min }) => percent >= min) ?? LEVELS[LEVELS.length - 1];
  return (
    <span className={`${className} confidence--${level}`} title={label}>
      {percent}%
    </span>
  );
}

export default ConfidenceValue;
