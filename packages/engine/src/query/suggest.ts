import { termFor } from '../core/tokenizer.js';

/**
 * Query suggestions.
 *
 * Prefix completion walks the sorted term dictionaries of every segment, so it
 * costs O(k log n) and never loads the lexicon. Spelling correction is a
 * trigram index built lazily on the first miss and bounded to a fixed number of
 * terms, which keeps memory predictable on large indexes.
 */

export interface Lexicon {
  /** Calls back for each term starting with `prefix`, in sorted order. */
  scanPrefix(prefix: string, callback: (term: string) => boolean | void): void;
}

export interface SuggestionOptions {
  limit?: number;
  /** Prefixes shorter than this are not expanded. */
  minPrefix?: number;
}

export function prefixSuggestions(
  lexicons: Lexicon[],
  prefix: string,
  options: SuggestionOptions = {},
): string[] {
  const limit = options.limit ?? 8;
  const minPrefix = options.minPrefix ?? 2;
  const normalized = prefix.trim().toLowerCase();
  if (normalized.length < minPrefix) return [];

  const results: string[] = [];
  const seen = new Set<string>();
  for (const lexicon of lexicons) {
    lexicon.scanPrefix(normalized, (term) => {
      if (seen.has(term)) return;
      seen.add(term);
      results.push(term);
      return results.length < limit * 4;
    });
  }
  results.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return results.slice(0, limit);
}

export class SpellChecker {
  private readonly trigrams = new Map<string, string[]>();
  private readonly vocabulary = new Set<string>();
  private built = false;

  constructor(
    private readonly lexicons: Lexicon[],
    private readonly maxTerms = 150_000,
  ) {}

  private build(): void {
    if (this.built) return;
    this.built = true;
    for (const lexicon of this.lexicons) {
      lexicon.scanPrefix('', (term) => {
        if (this.vocabulary.size >= this.maxTerms) return false;
        if (term.length < 3 || term.length > 32 || !/^[\p{L}\p{N}]+$/u.test(term)) return;
        this.vocabulary.add(term);
        for (const trigram of trigramsOf(term)) {
          const bucket = this.trigrams.get(trigram);
          if (bucket) bucket.push(term);
          else this.trigrams.set(trigram, [term]);
        }
      });
    }
  }

  get size(): number {
    return this.vocabulary.size;
  }

  suggest(word: string): string | null {
    const term = termFor(word, false);
    if (term.length < 3) return null;
    this.build();
    if (this.vocabulary.has(term)) return null;

    const counts = new Map<string, number>();
    for (const trigram of trigramsOf(term)) {
      const bucket = this.trigrams.get(trigram);
      if (!bucket) continue;
      for (const candidate of bucket) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
    }
    if (counts.size === 0) return null;

    const candidates = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
      .slice(0, 32);

    let best: { term: string; distance: number; overlap: number } | null = null;
    for (const [candidate, overlap] of candidates) {
      const distance = editDistance(term, candidate, 2);
      if (distance > 2) continue;
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance && overlap > best.overlap) ||
        (distance === best.distance && overlap === best.overlap && candidate.length < best.term.length)
      ) {
        best = { term: candidate, distance, overlap };
      }
    }
    return best?.term ?? null;
  }
}

function trigramsOf(term: string): string[] {
  const padded = `  ${term} `;
  const trigrams: string[] = [];
  for (let i = 0; i < padded.length - 2; i++) trigrams.push(padded.slice(i, i + 3));
  return trigrams;
}

/** Levenshtein distance with a maximum: returns max + 1 as soon as it is exceeded. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = current[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      rowMin = Math.min(rowMin, current[j]!);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) previous[j] = current[j]!;
  }
  return previous[b.length]!;
}
