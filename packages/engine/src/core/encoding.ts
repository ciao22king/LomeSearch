/**
 * Character encoding detection for crawled documents.
 *
 * HTTP `charset` wins, then a BOM, then a `<meta charset>` in the first
 * kilobyte, then UTF-8. `TextDecoder` replaces invalid sequences instead of
 * throwing, which is what a crawler wants: a broken page should still yield the
 * text that could be decoded.
 */

const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9_\-:.]+)/i;

const ALIASES = new Map<string, string>([
  ['utf8', 'utf-8'],
  ['latin1', 'windows-1252'],
  ['iso-8859-1', 'windows-1252'],
  ['iso8859-1', 'windows-1252'],
  ['us-ascii', 'windows-1252'],
  ['ascii', 'windows-1252'],
  ['gb2312', 'gbk'],
  ['shift_jis', 'shift_jis'],
  ['sjis', 'shift_jis'],
]);

function normalizeCharset(label: string): string | null {
  const cleaned = label.trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (!cleaned) return null;
  return ALIASES.get(cleaned) ?? cleaned;
}

export function detectCharset(buffer: Buffer, contentType = ''): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'utf-8';
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf-16le';
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf-16be';

  const headerMatch = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType);
  if (headerMatch?.[1]) {
    const normalized = normalizeCharset(headerMatch[1]);
    if (normalized) return normalized;
  }

  const head = buffer.subarray(0, 2048).toString('latin1');
  const metaMatch = META_CHARSET.exec(head);
  if (metaMatch?.[1]) {
    const normalized = normalizeCharset(metaMatch[1]);
    if (normalized) return normalized;
  }
  return 'utf-8';
}

export function decodeHtml(buffer: Buffer, contentType = ''): string {
  const charset = detectCharset(buffer, contentType);
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

export function isSupportedCharset(charset: string): boolean {
  try {
    new TextDecoder(charset);
    return true;
  } catch {
    return false;
  }
}
