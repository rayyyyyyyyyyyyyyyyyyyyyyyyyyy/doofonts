import './SpecimenText.css';

/**
 * Editable preview text rendered in a predicted font.
 * Used by both ResultsPanel (size="large") and CompareResultsPanel (size="compact").
 */
function SpecimenText({ font, value, onChange, size = 'large' }) {
  return (
    <textarea
      className={`specimen specimen--${size}`}
      style={{
        fontFamily: `'${font.name}', sans-serif`,
        fontWeight: font.style?.includes('bold') ? 700 : 400,
        fontStyle: font.style?.includes('italic') ? 'italic' : 'normal',
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Type to preview..."
      // Start at one line and grow with the text where CSS field-sizing is supported.
      rows={1}
      aria-label="Font preview text, maximum 50 words"
      title="Maximum 50 words"
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
    />
  );
}

export default SpecimenText;
