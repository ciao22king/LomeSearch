/**
 * Porter stemming algorithm (Porter, 1980).
 *
 * Only applied to plain ASCII words: stemming non-Latin scripts is lossy and
 * unnecessary, and the regex-based implementation below is defined for
 * `[a-z]` only.
 */

const step2 = new Map<string, string>([
  ['ational', 'ate'],
  ['tional', 'tion'],
  ['enci', 'ence'],
  ['anci', 'ance'],
  ['izer', 'ize'],
  ['bli', 'ble'],
  ['alli', 'al'],
  ['entli', 'ent'],
  ['eli', 'e'],
  ['ousli', 'ous'],
  ['ization', 'ize'],
  ['ation', 'ate'],
  ['ator', 'ate'],
  ['alism', 'al'],
  ['iveness', 'ive'],
  ['fulness', 'ful'],
  ['ousness', 'ous'],
  ['aliti', 'al'],
  ['iviti', 'ive'],
  ['biliti', 'ble'],
  ['logi', 'log'],
]);

const step3 = new Map<string, string>([
  ['icate', 'ic'],
  ['ative', ''],
  ['alize', 'al'],
  ['iciti', 'ic'],
  ['ical', 'ic'],
  ['ful', ''],
  ['ness', ''],
]);

const step4 = [
  'al',
  'ance',
  'ence',
  'er',
  'ic',
  'able',
  'ible',
  'ant',
  'ement',
  'ment',
  'ent',
  'ion',
  'ou',
  'ism',
  'ate',
  'iti',
  'ous',
  'ive',
  'ize',
];

const C = '[^aeiou]';
const V = '[aeiouy]';
const CC = `${C}[^aeiouy]*`;
const VV = `${V}[aeiou]*`;
const M_GT_0 = new RegExp(`^(${CC})?${VV}${CC}`);
const M_EQ_1 = new RegExp(`^(${CC})?${VV}${CC}(${VV})?$`);
const M_GT_1 = new RegExp(`^(${CC})?${VV}${CC}${VV}${CC}`);
const HAS_VOWEL = new RegExp(`^(${CC})?${V}`);
const CVC = new RegExp(`^${CC}${V}[^aeiouwxy]$`);

function measure(stem: string): number {
  if (M_GT_1.test(stem)) return 2;
  if (M_EQ_1.test(stem)) return 1;
  return 0;
}

function containsVowel(stem: string): boolean {
  return HAS_VOWEL.test(stem);
}

function endsCvc(stem: string): boolean {
  return CVC.test(stem);
}

export function stem(word: string): string {
  if (word.length < 3) return word;
  let w = word;

  // Step 1a: plurals.
  if (w.endsWith('sses')) w = `${w.slice(0, -2)}`;
  else if (w.endsWith('ies')) w = `${w.slice(0, -2)}`;
  else if (w.endsWith('ss')) {
    // unchanged
  } else if (w.endsWith('s')) w = w.slice(0, -1);

  // Step 1b: -ed, -ing.
  let step1bExtra = false;
  if (w.endsWith('eed')) {
    const stemPart = w.slice(0, -3);
    if (measure(stemPart) > 0) w = `${stemPart}ee`;
  } else if (w.endsWith('ed') && containsVowel(w.slice(0, -2))) {
    w = w.slice(0, -2);
    step1bExtra = true;
  } else if (w.endsWith('ing') && containsVowel(w.slice(0, -3))) {
    w = w.slice(0, -3);
    step1bExtra = true;
  }
  if (step1bExtra) {
    if (w.endsWith('at') || w.endsWith('bl') || w.endsWith('iz')) w += 'e';
    else if (/(bb|dd|ff|gg|mm|nn|pp|rr|tt)$/.test(w)) w = w.slice(0, -1);
    else if (measure(w) === 1 && endsCvc(w)) w += 'e';
  }

  // Step 1c: y -> i.
  if (w.endsWith('y') && containsVowel(w.slice(0, -1))) w = `${w.slice(0, -1)}i`;

  // Step 2.
  for (const [suffix, replacement] of step2) {
    if (w.endsWith(suffix)) {
      const stemPart = w.slice(0, -suffix.length);
      if (measure(stemPart) > 0) w = stemPart + replacement;
      break;
    }
  }

  // Step 3.
  for (const [suffix, replacement] of step3) {
    if (w.endsWith(suffix)) {
      const stemPart = w.slice(0, -suffix.length);
      if (measure(stemPart) > 0) w = stemPart + replacement;
      break;
    }
  }

  // Step 4.
  for (const suffix of step4) {
    if (!w.endsWith(suffix)) continue;
    const stemPart = w.slice(0, -suffix.length);
    if (measure(stemPart) > 1 && (suffix !== 'ion' || /[st]$/.test(stemPart))) {
      w = stemPart;
    }
    break;
  }

  // Step 5.
  if (w.endsWith('e')) {
    const stemPart = w.slice(0, -1);
    const m = measure(stemPart);
    if (m > 1 || (m === 1 && !endsCvc(stemPart))) w = stemPart;
  }
  if (w.endsWith('ll') && measure(w) > 1) w = w.slice(0, -1);

  return w;
}
