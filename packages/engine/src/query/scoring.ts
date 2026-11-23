import type { FieldLengths } from '../index/segment.js';
import { FIELD_COUNT } from '../index/segment.js';

/**
 * BM25F scoring.
 *
 * Term frequencies are summed across fields with per-field boosts, and the
 * document length is normalised by the average length of each field. Keeping
 * the boosts separate from the length normalisation is what makes a hit in the
 * title count more than a hit in the body without letting long pages win.
 */

export interface ScoringConfig {
  k1: number;
  b: number;
  weights: FieldLengths;
  phraseBoost: number;
  titleMatchBoost: number;
}

export const DEFAULT_SCORING: ScoringConfig = {
  k1: 1.2,
  b: 0.75,
  weights: [4.0, 2.0, 1.0, 1.8, 1.2],
  phraseBoost: 1.6,
  titleMatchBoost: 1.35,
};

export interface CorpusStats {
  totalDocs: number;
  avgLengths: FieldLengths;
}

export function inverseDocumentFrequency(totalDocs: number, docFreq: number): number {
  if (totalDocs <= 0 || docFreq <= 0) return 0;
  return Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));
}

function lengthRatio(lengths: FieldLengths, avg: FieldLengths, weights: FieldLengths): number {
  let ratio = 0;
  for (let field = 0; field < FIELD_COUNT; field++) {
    const average = avg[field]! > 0 ? avg[field]! : 1;
    ratio += (weights[field]! * lengths[field]!) / average;
  }
  return ratio;
}

/**
 * `tfs` holds FIELD_COUNT frequencies for one document. `field` restricts the
 * score to a single field (used by intitle: and inurl:).
 */
export function bm25f(
  tfs: ArrayLike<number>,
  offset: number,
  lengths: FieldLengths,
  stats: CorpusStats,
  idf: number,
  config: ScoringConfig = DEFAULT_SCORING,
  field?: number,
): number {
  let weightedTf = 0;
  for (let f = 0; f < FIELD_COUNT; f++) {
    if (field !== undefined && f !== field) continue;
    const tf = tfs[offset + f] ?? 0;
    if (tf > 0) weightedTf += config.weights[f]! * tf;
  }
  if (weightedTf <= 0) return 0;
  const ratio = lengthRatio(lengths, stats.avgLengths, config.weights);
  const norm = config.k1 * (1 - config.b + config.b * ratio);
  return (idf * weightedTf * (config.k1 + 1)) / (weightedTf + norm);
}

/** Upper bound used when deciding whether a page can still make the top-k. */
export function maxTermScore(idf: number, config: ScoringConfig = DEFAULT_SCORING): number {
  return idf * (config.k1 + 1);
}

export interface QualitySignals {
  hostRank: number;
  ageDays: number;
  titleLength: number;
  textLength: number;
  outlinks: number;
  maxTitleTermFrequency: number;
}

/**
 * Small multiplicative adjustments applied after BM25. They are deliberately
 * bounded: relevance still decides the ranking, these only break ties between
 * pages that are otherwise close.
 */
export function qualityMultiplier(signals: QualitySignals): number {
  let multiplier = 1;
  if (signals.hostRank > 0) multiplier *= 1 + 0.35 * Math.min(signals.hostRank, 1);
  if (signals.ageDays >= 0) multiplier *= 1 + 0.1 * Math.exp(-signals.ageDays / 365);
  if (signals.titleLength < 3) multiplier *= 0.6;
  if (signals.textLength < 200 && signals.outlinks > 40) multiplier *= 0.55;
  if (signals.maxTitleTermFrequency > 6) multiplier *= 0.8;
  return multiplier;
}
