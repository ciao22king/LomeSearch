import { readFileSync } from 'node:fs';
import { ByteReader, ByteWriter } from '../core/bytes.js';
import { FIELD, FIELD_COUNT, POSITIONED_FIELDS, type FieldLengths } from '../core/fields.js';

/**
 * Immutable on-disk segment.
 *
 * Layout:
 *   magic | termCount | docCount | termsLength | postingsLength | lengthsLength
 *   term offsets      (termCount + 1 uint32, into the terms blob)
 *   postings offsets  (termCount + 1 uint32, into the postings section)
 *   terms blob        (length-prefixed UTF-8, sorted)
 *   postings          (per term, doc-id delta encoded)
 *   document lengths  (per doc, field lengths, delta encoded doc ids)
 *
 * Both offset tables make a term lookup O(log n) plus the cost of decoding its
 * postings, which is the only random access the query path needs. A segment is
 * written once and never modified; deletions live in the manifest and are
 * applied at read time and during merges.
 */

export { FIELD, FIELD_COUNT, POSITIONED_FIELDS } from '../core/fields.js';
export type { FieldLengths } from '../core/fields.js';

const MAGIC = 'LOMESEG\u0001';
const HEADER_FIXED = 8 + 4 * 5;
const MAX_TERM_CACHE = 512;

export interface PostingList {
  docIds: Uint32Array;
  /** FIELD_COUNT frequencies per document, flattened. */
  tfs: Uint16Array;
  /** Per positioned field: docCount + 1 offsets into posData. */
  posOffsets: Uint32Array[];
  posData: Int32Array[];
}

export interface SegmentTermPosting {
  docId: number;
  tfs: number[];
  positions: number[][];
}

export class SegmentBuilder {
  private readonly postings = new Map<string, Map<number, SegmentTermPosting>>();
  private readonly lengths = new Map<number, FieldLengths>();

  addPosting(
    term: string,
    docId: number,
    tfs: readonly number[],
    positions: readonly number[][],
  ): void {
    let docs = this.postings.get(term);
    if (!docs) {
      docs = new Map();
      this.postings.set(term, docs);
    }
    const existing = docs.get(docId);
    if (existing) {
      for (let field = 0; field < FIELD_COUNT; field++) {
        existing.tfs[field] = (existing.tfs[field] ?? 0) + (tfs[field] ?? 0);
      }
      for (let field = 0; field < POSITIONED_FIELDS; field++) {
        const target = existing.positions[field]!;
        for (const position of positions[field] ?? []) target.push(position);
      }
      return;
    }
    docs.set(docId, {
      docId,
      tfs: Array.from({ length: FIELD_COUNT }, (_, i) => tfs[i] ?? 0),
      positions: Array.from({ length: POSITIONED_FIELDS }, (_, i) => [...(positions[i] ?? [])]),
    });
  }

  setLengths(docId: number, lengths: FieldLengths): void {
    this.lengths.set(docId, lengths);
  }

  get termCount(): number {
    return this.postings.size;
  }

  get docCount(): number {
    return this.lengths.size;
  }

  get isEmpty(): boolean {
    return this.postings.size === 0;
  }

  hasDoc(docId: number): boolean {
    return this.lengths.has(docId);
  }

  terms(): string[] {
    return [...this.postings.keys()].sort();
  }

  serialize(): Buffer {
    const terms = this.terms();
    const termsWriter = new ByteWriter(Math.max(1024, terms.length * 12));
    const termOffsets = new Uint32Array(terms.length + 1);
    for (let i = 0; i < terms.length; i++) {
      const encoded = Buffer.from(terms[i]!, 'utf8');
      termOffsets[i] = termsWriter.length;
      termsWriter.varint(encoded.length);
      termsWriter.bytes(encoded);
    }
    termOffsets[terms.length] = termsWriter.length;

    const postingsWriter = new ByteWriter(Math.max(1024, terms.length * 64));
    const postingOffsets = new Uint32Array(terms.length + 1);
    for (let i = 0; i < terms.length; i++) {
      postingOffsets[i] = postingsWriter.length;
      const docs = [...this.postings.get(terms[i]!)!.values()].sort((a, b) => a.docId - b.docId);
      postingsWriter.varint(docs.length);
      let previousDoc = 0;
      for (const doc of docs) {
        postingsWriter.varint(doc.docId - previousDoc);
        previousDoc = doc.docId;
        let mask = 0;
        for (let field = 0; field < FIELD_COUNT; field++) {
          if ((doc.tfs[field] ?? 0) > 0) mask |= 1 << field;
        }
        postingsWriter.byte(mask);
        for (let field = 0; field < FIELD_COUNT; field++) {
          if (mask & (1 << field)) postingsWriter.varint(Math.min(doc.tfs[field]!, 0xffff));
        }
        for (let field = 0; field < POSITIONED_FIELDS; field++) {
          if (!(mask & (1 << field))) continue;
          const positions = doc.positions[field]!;
          postingsWriter.varint(positions.length);
          let previous = 0;
          for (const position of positions) {
            postingsWriter.varint(Math.max(0, position - previous));
            previous = position;
          }
        }
      }
    }
    postingOffsets[terms.length] = postingsWriter.length;

    const docIds = [...this.lengths.keys()].sort((a, b) => a - b);
    const lengthsWriter = new ByteWriter(Math.max(1024, docIds.length * 16));
    lengthsWriter.varint(docIds.length);
    let previousDoc = 0;
    for (const docId of docIds) {
      lengthsWriter.varint(docId - previousDoc);
      previousDoc = docId;
      const lengths = this.lengths.get(docId)!;
      for (let field = 0; field < FIELD_COUNT; field++) {
        lengthsWriter.varint(Math.max(0, Math.min(lengths[field] ?? 0, 0xffffffff)));
      }
    }

    const termsBlob = termsWriter.view();
    const postingsBlob = postingsWriter.view();
    const lengthsBlob = lengthsWriter.view();
    const header = new ByteWriter(HEADER_FIXED + 8 * (terms.length + 1));
    header.bytes(Buffer.from(MAGIC, 'latin1'));
    header.u32(terms.length);
    header.u32(docIds.length);
    header.u32(termsBlob.length);
    header.u32(postingsBlob.length);
    header.u32(lengthsBlob.length);
    for (let i = 0; i < termOffsets.length; i++) header.u32(termOffsets[i]!);
    for (let i = 0; i < postingOffsets.length; i++) header.u32(postingOffsets[i]!);
    return Buffer.concat([header.view(), termsBlob, postingsBlob, lengthsBlob]);
  }
}

export class SegmentReader {
  readonly path: string;
  readonly termCount: number;
  readonly docCount: number;
  readonly lengths: Map<number, FieldLengths> = new Map();
  readonly fileSize: number;

  private readonly buffer: Buffer;
  private readonly termsBlob: Buffer;
  private readonly termOffsets: Uint32Array;
  private readonly postingOffsets: Uint32Array;
  private readonly postingsStart: number;
  private readonly cache = new Map<string, PostingList>();

  private constructor(path: string, buffer: Buffer) {
    this.path = path;
    this.buffer = buffer;
    this.fileSize = buffer.length;
    if (buffer.subarray(0, 8).toString('latin1') !== MAGIC) {
      throw new Error(`not a LomeSearch segment: ${path}`);
    }
    const reader = new ByteReader(buffer, 8);
    this.termCount = reader.u32();
    this.docCount = reader.u32();
    const termsLength = reader.u32();
    const postingsLength = reader.u32();
    const lengthsLength = reader.u32();

    const offsetCount = this.termCount + 1;
    this.termOffsets = new Uint32Array(offsetCount);
    for (let i = 0; i < offsetCount; i++) this.termOffsets[i] = reader.u32();
    this.postingOffsets = new Uint32Array(offsetCount);
    for (let i = 0; i < offsetCount; i++) this.postingOffsets[i] = reader.u32();

    const termsStart = reader.pos;
    this.termsBlob = buffer.subarray(termsStart, termsStart + termsLength);
    this.postingsStart = termsStart + termsLength;
    const lengthsStart = this.postingsStart + postingsLength;
    if (lengthsStart + lengthsLength > buffer.length) {
      throw new Error(`truncated segment: ${path}`);
    }
    this.readLengths(buffer.subarray(lengthsStart, lengthsStart + lengthsLength));
  }

  static open(path: string): SegmentReader {
    return new SegmentReader(path, readFileSync(path));
  }

  private readLengths(blob: Buffer): void {
    const reader = new ByteReader(blob);
    const count = reader.varint();
    let docId = 0;
    for (let i = 0; i < count; i++) {
      docId += reader.varint();
      const lengths: FieldLengths = [0, 0, 0, 0, 0];
      for (let field = 0; field < FIELD_COUNT; field++) lengths[field] = reader.varint();
      this.lengths.set(docId, lengths);
    }
  }

  termAt(index: number): string {
    if (index < 0 || index >= this.termCount) return '';
    let cursor = this.termOffsets[index]!;
    let length = 0;
    let multiplier = 1;
    for (;;) {
      const byte = this.termsBlob[cursor++]!;
      length += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) break;
      multiplier *= 0x80;
    }
    return this.termsBlob.subarray(cursor, cursor + length).toString('utf8');
  }

  termIndex(term: string): number {
    let low = 0;
    let high = this.termCount - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const candidate = this.termAt(mid);
      if (candidate === term) return mid;
      if (candidate < term) low = mid + 1;
      else high = mid - 1;
    }
    return -1;
  }

  hasTerm(term: string): boolean {
    return this.termIndex(term) !== -1;
  }

  readTerm(term: string): PostingList | null {
    const cached = this.cache.get(term);
    if (cached) return cached;
    const index = this.termIndex(term);
    if (index === -1) return null;
    const list = this.decodePostings(index);
    if (this.cache.size >= MAX_TERM_CACHE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(term, list);
    return list;
  }

  private decodePostings(index: number): PostingList {
    const reader = new ByteReader(this.buffer, this.postingsStart + this.postingOffsets[index]!);
    const docFreq = reader.varint();
    const docIds = new Uint32Array(docFreq);
    const tfs = new Uint16Array(docFreq * FIELD_COUNT);
    const positionLists: number[][][] = Array.from({ length: POSITIONED_FIELDS }, () =>
      Array.from({ length: docFreq }, () => [] as number[]),
    );

    let docId = 0;
    for (let i = 0; i < docFreq; i++) {
      docId += reader.varint();
      docIds[i] = docId;
      const mask = reader.byte();
      for (let field = 0; field < FIELD_COUNT; field++) {
        if (mask & (1 << field)) tfs[i * FIELD_COUNT + field] = reader.varint();
      }
      for (let field = 0; field < POSITIONED_FIELDS; field++) {
        if (!(mask & (1 << field))) continue;
        const count = reader.varint();
        let position = 0;
        const list = positionLists[field]![i]!;
        for (let p = 0; p < count; p++) {
          position += reader.varint();
          list.push(position);
        }
      }
    }

    const posOffsets: Uint32Array[] = [];
    const posData: Int32Array[] = [];
    for (let field = 0; field < POSITIONED_FIELDS; field++) {
      const offsets = new Uint32Array(docFreq + 1);
      let total = 0;
      for (let i = 0; i < docFreq; i++) {
        offsets[i] = total;
        total += positionLists[field]![i]!.length;
      }
      offsets[docFreq] = total;
      const data = new Int32Array(total);
      let cursor = 0;
      for (let i = 0; i < docFreq; i++) {
        for (const position of positionLists[field]![i]!) data[cursor++] = position;
      }
      posOffsets.push(offsets);
      posData.push(data);
    }

    return { docIds, tfs, posOffsets, posData };
  }

  forEachTerm(callback: (term: string) => void): void {
    for (let i = 0; i < this.termCount; i++) callback(this.termAt(i));
  }

  /**
   * Visits terms in sorted order starting at `prefix`. Returning false from the
   * callback stops the scan.
   */
  scanPrefix(prefix: string, callback: (term: string) => boolean | void): void {
    let low = 0;
    let high = this.termCount - 1;
    let start = this.termCount;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (this.termAt(mid) >= prefix) {
        start = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    for (let i = start; i < this.termCount; i++) {
      const term = this.termAt(i);
      if (!term.startsWith(prefix)) return;
      if (callback(term) === false) return;
    }
  }
}
