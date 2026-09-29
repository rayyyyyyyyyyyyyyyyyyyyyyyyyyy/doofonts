/**
 * Confidence levels for the font and style predictions, used to colour the
 * percentage so weak predictions stand out. Thresholds are only a rough guide
 * from a handful of sample images (correct top font predictions mostly scored
 * 80–90%, wrong ones mostly 30–45%, with exceptions both ways) — not a
 * calibrated accuracy.
 */
const LEVELS = [
  { min: 70, level: 'high', label: 'High confidence (70% or more)' },
  { min: 40, level: 'medium', label: 'Medium confidence (40–69%)' },
  { min: 0, level: 'low', label: 'Low confidence (below 40%)' },
];

/** @returns {{ className: string, label: string }} for a percentage (0–100). */
export function confidenceLevel(percent) {
  const { level, label } = LEVELS.find(({ min }) => percent >= min) ?? LEVELS[LEVELS.length - 1];
  return { className: `confidence--${level}`, label };
}
