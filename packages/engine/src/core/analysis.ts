import { tokenize } from './tokenizer.js';

/**
 * Document analysis shared by the disk-backed index and the in-memory one.
 *
 * Each field is tokenized on its own: positions stay field-local, which is what
 * phrase matching expects, and the accumulated frequency feeds BM25F.
 */

export interface FieldAnalysis {
  terms: string[];
  positions: Map<string, number[]>;
  surfaces: Map<string, Map<string, number>>;
}

export function analyzeText(text: string): FieldAnalysis {
  const tokens = tokenize(text);
  const terms: string[] = [];
  const positions = new Map<string, number[]>();
  const surfaces = new Map<string, Map<string, number>>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    terms.push(token.term);
    const list = positions.get(token.term);
    if (list) list.push(i);
    else positions.set(token.term, [i]);
    const surface = token.raw.toLowerCase();
    if (surface !== token.term) {
      let counts = surfaces.get(token.term);
      if (!counts) {
        counts = new Map();
        surfaces.set(token.term, counts);
      }
      counts.set(surface, (counts.get(surface) ?? 0) + 1);
    }
  }
  return { terms, positions, surfaces };
}

export function urlTokens(url: string): string {
  return url.replace(/[^\p{L}\p{N}]+/gu, ' ');
}

export function containsAnyTerm(text: string, terms: string[]): boolean {
  if (!text || terms.length === 0) return false;
  const wanted = new Set(terms);
  for (const token of tokenize(text)) {
    if (wanted.has(token.term)) return true;
  }
  return false;
}

export function maxTermFrequency(text: string, terms: string[]): number {
  if (!text || terms.length === 0) return 0;
  const wanted = new Set(terms);
  const counts = new Map<string, number>();
  let max = 0;
  for (const token of tokenize(text)) {
    if (!wanted.has(token.term)) continue;
    const count = (counts.get(token.term) ?? 0) + 1;
    counts.set(token.term, count);
    if (count > max) max = count;
  }
  return max;
}
