import { fnv1a } from './bytes.js';

/**
 * 64-bit SimHash, stored as two 32-bit halves so the whole hot path stays on
 * plain numbers. Near-duplicate pages are rejected at index time with a small
 * Hamming threshold.
 */

export interface Fingerprint {
  hi: number;
  lo: number;
}

const MAX_FEATURES = 400;

export function simhash(terms: readonly string[]): Fingerprint {
  const counts = new Map<string, number>();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);

  const weights = new Int32Array(64);
  let features = 0;
  for (const [term, count] of counts) {
    if (features++ >= MAX_FEATURES) break;
    const low = fnv1a(term, 0x811c9dc5);
    const high = fnv1a(term, 0x01000193);
    const weight = Math.min(count, 8);
    for (let bit = 0; bit < 32; bit++) {
      weights[bit]! += (low >>> bit) & 1 ? weight : -weight;
      weights[bit + 32]! += (high >>> bit) & 1 ? weight : -weight;
    }
  }

  let hi = 0;
  let lo = 0;
  for (let bit = 0; bit < 32; bit++) {
    if (weights[bit]! > 0) lo = (lo | (1 << bit)) >>> 0;
    if (weights[bit + 32]! > 0) hi = (hi | (1 << bit)) >>> 0;
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

export function hammingDistance(a: Fingerprint, b: Fingerprint): number {
  return popcount32((a.hi ^ b.hi) >>> 0) + popcount32((a.lo ^ b.lo) >>> 0);
}

export function popcount32(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function isNearDuplicate(a: Fingerprint, b: Fingerprint, threshold = 3): boolean {
  return hammingDistance(a, b) <= threshold;
}

export function fingerprintToString(fingerprint: Fingerprint): string {
  return `${fingerprint.hi.toString(16).padStart(8, '0')}${fingerprint.lo.toString(16).padStart(8, '0')}`;
}

export function fingerprintFromString(value: string): Fingerprint | null {
  if (!/^[0-9a-f]{16}$/.test(value)) return null;
  return {
    hi: Number.parseInt(value.slice(0, 8), 16) >>> 0,
    lo: Number.parseInt(value.slice(8), 16) >>> 0,
  };
}
