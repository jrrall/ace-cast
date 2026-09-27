// Compare answer ideas rather than articles, possessives, or punctuation.
const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by',
  'for', 'from', 'with', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'it', 'its', 'this', 'that', 'these', 'those', 'my', 'your',
  'our', 'their', 'his', 'her', 'i', 'me', 'you', 'we', 'us', 'they', 'them',
]);
const SIMILARITY_THRESHOLD = 0.5;

function answerWords(text) {
  const words = String(text || '').normalize('NFKC')
    .toLowerCase()
    .replace(/['’]s\b/gu, '')
    .match(/[\p{L}\p{N}]+/gu) || [];
  const meaningful = words.filter((word) => !FILLER_WORDS.has(word));
  // Still recognize duplicate cards made entirely of filler words.
  return new Set(meaningful.length ? meaningful : words);
}

// Fraction of the shorter answer's unique meaningful words shared by both.
// One shared word in two short answers is significant ("haunted Fitbit"),
// while one shared word in two long answers usually is not.
function wordOverlap(left, right) {
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.min(left.size, right.size);
}

module.exports = { answerWords, wordOverlap, SIMILARITY_THRESHOLD };
