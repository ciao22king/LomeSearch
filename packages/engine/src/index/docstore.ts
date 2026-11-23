import {
  closeSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { writeFileAtomic } from '../core/fsutil.js';

/**
 * Append-only document store.
 *
 * Each record is `[uint32 compressedLength][uint32 docId][gzip JSON]`. Stored
 * fields are compressed individually and addressed by an offset table, so
 * fetching ten results does not touch the rest of the corpus. Tombstoned
 * documents keep occupying space until `vacuum()` rewrites the log.
 */

export interface StoredDocument {
  url: string;
  title: string;
  description: string;
  headings: string[];
  text: string;
  lang: string;
  host: string;
  site: string;
  fetchedAt: number;
  contentHash: string;
  fingerprint: string;
  outlinks: string[];
  contentType: string;
  status: number;
  depth: number;
  byteSize: number;
  etag: string;
  lastModified: string;
}

interface DocLocation {
  offset: number;
  length: number;
}

const INDEX_MAGIC = 'LOMEDOC\u0001';
const INDEX_HEADER = 8 + 4;
const RECORD_HEADER = 8;
const MAX_CACHE = 256;

export class DocStore {
  readonly dir: string;
  readonly logPath: string;
  readonly indexPath: string;
  private fd: number;
  private size: number;
  private readonly locations = new Map<number, DocLocation>();
  private readonly cache = new Map<number, StoredDocument>();

  private constructor(dir: string) {
    this.dir = dir;
    this.logPath = join(dir, 'docs.log');
    this.indexPath = join(dir, 'docs.idx');
    this.fd = openSync(this.logPath, 'a+');
    this.size = fstatSync(this.fd).size;
    if (!this.loadIndex()) this.rebuildFromLog();
  }

  static open(dir: string): DocStore {
    return new DocStore(dir);
  }

  get docCount(): number {
    return this.locations.size;
  }

  maxDocId(): number {
    let max = 0;
    for (const docId of this.locations.keys()) if (docId > max) max = docId;
    return max;
  }

  get logSize(): number {
    return this.size;
  }

  private loadIndex(): boolean {
    let buffer: Buffer;
    try {
      buffer = readFileSync(this.indexPath);
    } catch {
      return false;
    }
    if (buffer.length < INDEX_HEADER || buffer.subarray(0, 8).toString('latin1') !== INDEX_MAGIC) {
      return false;
    }
    const count = buffer.readUInt32LE(8);
    if (buffer.length < INDEX_HEADER + count * 12) return false;
    let cursor = INDEX_HEADER;
    for (let i = 0; i < count; i++) {
      const docId = buffer.readUInt32LE(cursor);
      const offset = buffer.readUInt32LE(cursor + 4);
      const length = buffer.readUInt32LE(cursor + 8);
      cursor += 12;
      this.locations.set(docId, { offset, length });
    }
    return true;
  }

  /** Recovers the id -> offset map by walking the log (crash recovery). */
  private rebuildFromLog(): void {
    let buffer: Buffer;
    try {
      buffer = readFileSync(this.logPath);
    } catch {
      return;
    }
    this.locations.clear();
    let cursor = 0;
    while (cursor + RECORD_HEADER <= buffer.length) {
      const length = buffer.readUInt32LE(cursor);
      const docId = buffer.readUInt32LE(cursor + 4);
      if (length === 0 || cursor + RECORD_HEADER + length > buffer.length) break;
      this.locations.set(docId, { offset: cursor, length });
      cursor += RECORD_HEADER + length;
    }
    this.size = fstatSync(this.fd).size;
  }

  append(docId: number, doc: StoredDocument): void {
    const compressed = gzipSync(Buffer.from(JSON.stringify(doc), 'utf8'), { level: 6 });
    const record = Buffer.allocUnsafe(RECORD_HEADER + compressed.length);
    record.writeUInt32LE(compressed.length, 0);
    record.writeUInt32LE(docId, 4);
    compressed.copy(record, RECORD_HEADER);
    const offset = this.size;
    writeSync(this.fd, record, 0, record.length, offset);
    this.size += record.length;
    this.locations.set(docId, { offset, length: compressed.length });
    this.cache.delete(docId);
  }

  get(docId: number): StoredDocument | null {
    const cached = this.cache.get(docId);
    if (cached) return cached;
    const location = this.locations.get(docId);
    if (!location) return null;
    const payload = Buffer.allocUnsafe(location.length);
    const read = readSync(this.fd, payload, 0, location.length, location.offset + RECORD_HEADER);
    if (read !== location.length) return null;
    let doc: StoredDocument;
    try {
      doc = JSON.parse(gunzipSync(payload).toString('utf8')) as StoredDocument;
    } catch {
      return null;
    }
    if (this.cache.size >= MAX_CACHE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(docId, doc);
    return doc;
  }

  has(docId: number): boolean {
    return this.locations.has(docId);
  }

  locationOf(docId: number): DocLocation | null {
    return this.locations.get(docId) ?? null;
  }

  entries(): Array<{ docId: number; offset: number; length: number }> {
    return [...this.locations.entries()].map(([docId, location]) => ({
      docId,
      offset: location.offset,
      length: location.length,
    }));
  }

  flush(): void {
    fsyncSync(this.fd);
    const entries = this.entries();
    const buffer = Buffer.allocUnsafe(INDEX_HEADER + entries.length * 12);
    buffer.write(INDEX_MAGIC, 0, 'latin1');
    buffer.writeUInt32LE(entries.length, 8);
    let cursor = INDEX_HEADER;
    for (const entry of entries) {
      buffer.writeUInt32LE(entry.docId, cursor);
      buffer.writeUInt32LE(entry.offset, cursor + 4);
      buffer.writeUInt32LE(entry.length, cursor + 8);
      cursor += 12;
    }
    writeFileAtomic(this.indexPath, buffer);
  }

  /** Rewrites the log keeping only the documents accepted by `keep`. */
  vacuum(keep: (docId: number) => boolean): number {
    const kept = [...this.locations.keys()].filter(keep).sort((a, b) => a - b);
    const tmpPath = `${this.logPath}.vacuum`;
    const tmpFd = openSync(tmpPath, 'w+');
    const newLocations = new Map<number, DocLocation>();
    let offset = 0;
    try {
      for (const docId of kept) {
        const doc = this.get(docId);
        if (!doc) continue;
        const compressed = gzipSync(Buffer.from(JSON.stringify(doc), 'utf8'), { level: 6 });
        const record = Buffer.allocUnsafe(RECORD_HEADER + compressed.length);
        record.writeUInt32LE(compressed.length, 0);
        record.writeUInt32LE(docId, 4);
        compressed.copy(record, RECORD_HEADER);
        writeSync(tmpFd, record, 0, record.length, offset);
        newLocations.set(docId, { offset, length: compressed.length });
        offset += record.length;
      }
      fsyncSync(tmpFd);
    } finally {
      closeSync(tmpFd);
    }

    closeSync(this.fd);
    renameSync(tmpPath, this.logPath);
    this.fd = openSync(this.logPath, 'a+');
    this.size = offset;
    this.locations.clear();
    for (const [docId, location] of newLocations) this.locations.set(docId, location);
    this.cache.clear();
    this.flush();
    return kept.length;
  }

  close(): void {
    try {
      this.flush();
    } finally {
      closeSync(this.fd);
    }
  }
}
