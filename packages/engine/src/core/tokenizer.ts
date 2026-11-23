import { stem } from './porter.js';

/**
 * Text analysis.
 *
 * Tokens keep their offsets in the source string so that snippets can be cut
 * from the original page text instead of from a normalised copy. Word breaking
 * uses ICU (`Intl.Segmenter`), which handles scripts without spaces (Chinese,
 * Japanese, Thai) correctly.
 */

export interface Token {
  /** Indexed term: folded, lowercased, stemmed. */
  term: string;
  /** Surface form as it appears in the source. */
  raw: string;
  start: number;
  end: number;
}

export interface TokenizeOptions {
  stemming?: boolean;
  minLength?: number;
  maxLength?: number;
}

const segmenter = new Intl.Segmenter('und', { granularity: 'word' });

const APOSTROPHES = /[\u2018\u2019\u02bc\u02bb`´']/g;
const NON_WORD_EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const ASCII_WORD = /^[a-z]+$/;
const LATIN_LETTER = /\p{Script=Latin}/u;
const MARK = /\p{M}+/gu;

/** Case folding plus diacritic removal: "Crème Brûlée" -> "creme brulee". */
export function foldText(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(MARK, '')
    .normalize('NFC');
}

export function normalizeWord(raw: string): string {
  const folded = foldText(raw).replace(APOSTROPHES, '');
  return folded.replace(NON_WORD_EDGES, '');
}

function splitOnApostrophe(raw: string): Array<{ text: string; offset: number }> {
  if (!/['\u2018\u2019\u02bc\u02bb]/.test(raw)) return [{ text: raw, offset: 0 }];
  const parts: Array<{ text: string; offset: number }> = [];
  let start = 0;
  for (let i = 0; i <= raw.length; i++) {
    const char = raw[i];
    if (i === raw.length || char === "'" || char === '\u2018' || char === '\u2019' || char === '\u02bc' || char === '\u02bb') {
      const text = raw.slice(start, i);
      if (text) parts.push({ text, offset: start });
      start = i + 1;
    }
  }
  return parts;
}

export function termFor(raw: string, stemming = true): string {
  const word = normalizeWord(raw);
  if (!word) return '';
  if (stemming && ASCII_WORD.test(word) && word.length > 3) return stem(word);
  return word;
}

export function tokenize(text: string, options: TokenizeOptions = {}): Token[] {
  const stemming = options.stemming ?? true;
  const minLength = options.minLength ?? 2;
  const maxLength = options.maxLength ?? 48;
  const tokens: Token[] = [];
  if (!text) return tokens;

  for (const segment of segmenter.segment(text)) {
    if (!segment.isWordLike) continue;
    const raw = segment.segment;
    if (!LETTER_OR_DIGIT.test(raw)) continue;
    // ICU keeps elisions such as "l'éléphant" together; split them so the
    // article does not become part of the word.
    const parts = splitOnApostrophe(raw);
    for (const part of parts) {
      const term = termFor(part.text, stemming);
      if (!term || term.length > maxLength) continue;
      // Single letters are noise in Latin text, but meaningful in CJK.
      if (term.length < minLength && LATIN_LETTER.test(term)) continue;
      tokens.push({
        term,
        raw: part.text,
        start: segment.index + part.offset,
        end: segment.index + part.offset + part.text.length,
      });
    }
  }
  return tokens;
}

export function tokenTerms(text: string, options?: TokenizeOptions): string[] {
  return tokenize(text, options).map((token) => token.term);
}

export interface PositionedTerms {
  terms: string[];
  /** term -> ascending token positions */
  positions: Map<string, number[]>;
}

/** Tokenises a field and records token positions, used for phrase queries. */
export function positionedTerms(text: string, options?: TokenizeOptions): PositionedTerms {
  const tokens = tokenize(text, options);
  const terms: string[] = [];
  const positions = new Map<string, number[]>();
  for (let i = 0; i < tokens.length; i++) {
    const term = tokens[i]!.term;
    terms.push(term);
    const list = positions.get(term);
    if (list) list.push(i);
    else positions.set(term, [i]);
  }
  return { terms, positions };
}

/** Unique terms with their frequency, preserving first-seen order. */
export function termFrequencies(text: string, options?: TokenizeOptions): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokenize(text, options)) {
    counts.set(token.term, (counts.get(token.term) ?? 0) + 1);
  }
  return counts;
}

/** Splits a query string into the terms that should be highlighted. */
export function queryHighlightTerms(query: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokenize(query)) {
    if (seen.has(token.term)) continue;
    seen.add(token.term);
    result.push(token.term);
  }
  return result;
}

/**
 * Finds the first occurrence of any query term in `text` and returns a window
 * around it. Matching reuses the tokenizer so that offsets stay exact even when
 * folding changes the length of a word.
 */
export function findBestWindow(
  text: string,
  queryTerms: string[],
  maxLength = 220,
): { text: string; start: number; end: number } {
  if (!text) return { text: '', start: 0, end: 0 };
  if (text.length <= maxLength) return { text, start: 0, end: text.length };

  const wanted = new Set(queryTerms.filter(Boolean).map((term) => termFor(term)));
  let hit = -1;
  if (wanted.size > 0) {
    for (const token of tokenize(text.slice(0, maxLength * 40))) {
      if (wanted.has(token.term)) {
        hit = token.start;
        break;
      }
    }
  }
  if (hit === -1) hit = 0;

  const context = Math.floor(maxLength * 0.35);
  let start = Math.max(0, hit - context);
  let end = Math.min(text.length, start + maxLength);
  if (end === text.length) start = Math.max(0, end - maxLength);

  // Do not cut words in half when a space is available nearby.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space - start < 24) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space !== -1 && end - space < 24) end = space;
  }
  return { text: text.slice(start, end), start, end };
}
