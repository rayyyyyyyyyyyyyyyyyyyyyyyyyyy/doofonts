/**
 * Pick the OCR preview word shown in the specimen boxes: the longest word of at
 * most MAX_WORD_LENGTH characters among the backend's OCR candidates.
 *
 * Thai is written without spaces, so a candidate is often a whole line
 * ("โดยที่ประชาชนแห่งสหประชาชาติ"). Such lines are split into words with the
 * browser's built-in Intl.Segmenter (no extra dependency), and each word's box
 * is estimated from its share of the line's width.
 */

const MAX_WORD_LENGTH = 15;

// Tone marks (่้๊๋) don't count towards the word length.
const THAI_TONE_MARK = /[\u0E48-\u0E4B]/;
// Vowels and marks drawn above/below the base letter take no horizontal space.
const THAI_COMBINING_MARK = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('th', { granularity: 'word' })
    : null;

/** Characters counted for the length limit: no spaces, no tone marks. */
function wordLength(text) {
  return [...text].filter((ch) => !/\s/.test(ch) && !THAI_TONE_MARK.test(ch)).length;
}

/** Approximate horizontal width in characters (combining marks take none). */
function textAdvance(text) {
  return [...text].filter((ch) => !THAI_COMBINING_MARK.test(ch)).length;
}

function fitsAsOneWord(text) {
  return text.trim().split(/\s+/).length === 1 && wordLength(text) <= MAX_WORD_LENGTH;
}

/** [{ word, index }] for each word in text. */
function segmentWords(text) {
  if (segmenter) {
    return [...segmenter.segment(text)]
      .filter((s) => s.isWordLike)
      .map((s) => ({ word: s.segment, index: s.index }));
  }
  // Without Intl.Segmenter only whitespace-separated words can be split.
  return [...text.matchAll(/\S+/g)].map((m) => ({ word: m[0], index: m.index }));
}

function splitIntoWords(candidate) {
  const { text, bbox } = candidate;
  // Keep results that already fit untouched: re-segmenting a misread word
  // ("พนฐาน") would split it into dictionary fragments ("ฐาน").
  if (fitsAsOneWord(text)) return [candidate];

  const xs = bbox.map(([x]) => x);
  const ys = bbox.map(([, y]) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const total = textAdvance(text) || 1;

  return segmentWords(text).map(({ word, index }) => {
    const wordLeft = left + ((right - left) * textAdvance(text.slice(0, index))) / total;
    const wordRight =
      left + ((right - left) * textAdvance(text.slice(0, index + word.length))) / total;
    return {
      text: word,
      confidence: candidate.confidence,
      bbox: [[wordLeft, top], [wordRight, top], [wordRight, bottom], [wordLeft, bottom]],
    };
  });
}

/**
 * @param candidates [{ text, confidence, bbox }] from the backend's `ocr.candidates`
 * @returns { text, item } — item is the chosen word ({ text, confidence, bbox }) or null
 */
export function pickOcrPreview(candidates = []) {
  let best = null;
  for (const word of candidates.flatMap(splitIntoWords)) {
    if (!fitsAsOneWord(word.text)) continue;
    const better =
      !best ||
      wordLength(word.text) > wordLength(best.text) ||
      (wordLength(word.text) === wordLength(best.text) && word.confidence > best.confidence);
    if (better) best = word;
  }
  return { text: best ? best.text : '', item: best };
}
