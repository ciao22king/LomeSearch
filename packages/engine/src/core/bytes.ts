/**
 * Binary primitives shared by the index writer and reader.
 *
 * The on-disk format favours small integers: document ids, term frequencies and
 * positions are delta encoded with LEB128. All offsets are 32 bit, which caps a
 * single segment file at 4 GiB; segments are small by construction (they are
 * flushed from a bounded memtable), so the limit is never reached in practice.
 */

const MAX_SAFE_VARINT = Number.MAX_SAFE_INTEGER;

export class ByteWriter {
  private buf: Buffer;
  private pos = 0;

  constructor(initialSize = 4096) {
    this.buf = Buffer.allocUnsafe(initialSize);
  }

  get length(): number {
    return this.pos;
  }

  private ensure(extra: number): void {
    const needed = this.pos + extra;
    if (needed <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < needed) size *= 2;
    const next = Buffer.allocUnsafe(size);
    this.buf.copy(next, 0, 0, this.pos);
    this.buf = next;
  }

  byte(value: number): void {
    this.ensure(1);
    this.buf[this.pos++] = value & 0xff;
  }

  u32(value: number): void {
    this.ensure(4);
    this.buf.writeUInt32LE(value >>> 0, this.pos);
    this.pos += 4;
  }

  f64(value: number): void {
    this.ensure(8);
    this.buf.writeDoubleLE(value, this.pos);
    this.pos += 8;
  }

  varint(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > MAX_SAFE_VARINT) {
      throw new RangeError(`varint out of range: ${value}`);
    }
    let n = value;
    while (n >= 0x80) {
      this.byte((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    this.byte(n);
  }

  /** Signed values are zigzag mapped so small negatives stay one byte. */
  svarint(value: number): void {
    this.varint(value < 0 ? -value * 2 - 1 : value * 2);
  }

  bytes(data: Buffer): void {
    this.ensure(data.length);
    data.copy(this.buf, this.pos);
    this.pos += data.length;
  }

  string(value: string): void {
    const encoded = Buffer.from(value, 'utf8');
    this.varint(encoded.length);
    this.bytes(encoded);
  }

  view(): Buffer {
    return this.buf.subarray(0, this.pos);
  }
}

export class ByteReader {
  readonly buf: Buffer;
  pos: number;

  constructor(buf: Buffer, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  byte(): number {
    if (this.pos >= this.buf.length) throw new RangeError('unexpected end of segment');
    return this.buf[this.pos++]!;
  }

  u32(): number {
    if (this.pos + 4 > this.buf.length) throw new RangeError('unexpected end of segment');
    const value = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return value;
  }

  f64(): number {
    if (this.pos + 8 > this.buf.length) throw new RangeError('unexpected end of segment');
    const value = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return value;
  }

  varint(): number {
    let result = 0;
    let multiplier = 1;
    for (let i = 0; i < 8; i++) {
      const byte = this.byte();
      result += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) return result;
      multiplier *= 0x80;
    }
    throw new RangeError('varint is too long');
  }

  svarint(): number {
    const raw = this.varint();
    return raw % 2 === 1 ? -(raw + 1) / 2 : raw / 2;
  }

  bytes(length: number): Buffer {
    if (this.pos + length > this.buf.length) throw new RangeError('unexpected end of segment');
    const slice = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }

  string(): string {
    return this.bytes(this.varint()).toString('utf8');
  }
}

/** FNV-1a, used where a fast non-cryptographic hash is enough. */
export function fnv1a(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
