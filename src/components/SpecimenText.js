import './SpecimenText.css';

/**
 * ช่องแก้ไขข้อความตัวอย่าง โดยแสดงด้วยฟอนต์ที่โมเดลทำนาย
 * ใช้ขนาด large ในหน้าโมเดลเดียว และ compact ในหน้าเปรียบเทียบ
 */
function SpecimenText({ font, value, onChange, size = 'large' }) {
  return (
    <textarea
      className={`specimen specimen--${size}`}
      style={{
        fontFamily: `'${font.name}', 'Noto Sans Thai', sans-serif`,
        fontWeight: font.style?.includes('bold') ? 700 : 400,
        fontStyle: font.style?.includes('italic') ? 'italic' : 'normal',
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Type to preview..."
      // เริ่มที่หนึ่งบรรทัด; CSS จะขยายความสูงถ้าเบราว์เซอร์รองรับ field-sizing
      rows={1}
      aria-label="Font preview text, maximum 50 characters"
      title="Maximum 50 characters"
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
    />
  );
}

export default SpecimenText;
