/**
 * ตรวจจับระดับความสูงของสระและวรรณยุกต์ไทย
 * ใช้สำหรับปรับ padding-top ของ specimen text ให้แสดงสระลอย/วรรณยุกต์ไม่ถูกตัด
 */

// สระบน + วรรณยุกต์ ซ้อนกัน 2 ชั้น (เช่น พื้, ตั้, ปิ๊)
const STACKED_TONE = /[\u0E31\u0E34-\u0E37\u0E47\u0E4D][\u0E48-\u0E4C]/;

// สระบน หรือ วรรณยุกต์เดี่ยว 1 ชั้น (เช่น กิน, บ้าน, รู้)
const UPPER_TONE = /[\u0E31\u0E34-\u0E37\u0E47-\u0E4E]/;

export function getThaiToneClass(text) {
  if (!text) return '';
  if (STACKED_TONE.test(text)) return 'has-stacked-tone';
  if (UPPER_TONE.test(text)) return 'has-upper-tone';
  return '';
}
