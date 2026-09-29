import { confidenceLevel } from '../utils/confidence';

/**
 * Font or style confidence %, coloured by level (high / medium / low) with
 * the level spelled out on hover. Colours live in Panel.css (.confidence--*).
 */
function ConfidenceValue({ percent, className }) {
  const { className: levelClass, label } = confidenceLevel(percent);
  return (
    <span className={`${className} ${levelClass}`} title={label}>
      {percent}%
    </span>
  );
}

export default ConfidenceValue;
