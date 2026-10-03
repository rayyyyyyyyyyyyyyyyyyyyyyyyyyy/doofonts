/**
 * Confidence levels for the font and style predictions. Thresholds are only a
 * rough guide from a handful of sample images (correct top font predictions
 * mostly scored 80–90%, wrong ones mostly 30–45%) — not a calibrated accuracy.
 * Colours live in Panel.css (.confidence--*).
 */
const LEVELS = [
  { min: 70, level: 'high', label: 'High confidence (70% or more)' },
  { min: 40, level: 'medium', label: 'Medium confidence (40–69%)' },
  { min: 0, level: 'low', label: 'Low confidence (below 40%)' },
];

/** Font or style confidence %, coloured by level, with the level spelled out on hover. */
function ConfidenceValue({ percent, className }) {
  const { level, label } = LEVELS.find(({ min }) => percent >= min) ?? LEVELS[LEVELS.length - 1];
  return (
    <span className={`${className} confidence--${level}`} title={label}>
      {percent}%
    </span>
  );
}

export default ConfidenceValue;
