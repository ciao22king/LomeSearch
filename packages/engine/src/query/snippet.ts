import { findBestWindow, tokenize } from '../core/tokenizer.js';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/**
 * Builds a snippet window around the first matching query term and wraps
 * matches in <mark>. Everything outside the marks is escaped, so page text can
 * never inject markup into the result page.
 */
export function buildSnippet(text: string, terms: string[], maxLength = 220): string {
  if (!text) return '';
  const window = findBestWindow(text, terms, maxLength);
  const wanted = new Set(terms);
  const tokens = tokenize(window.text);
  const output: string[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (!wanted.has(token.term)) continue;
    if (token.start < cursor) continue;
    output.push(escapeHtml(window.text.slice(cursor, token.start)));
    output.push(`<mark>${escapeHtml(window.text.slice(token.start, token.end))}</mark>`);
    cursor = token.end;
  }
  output.push(escapeHtml(window.text.slice(cursor)));
  const prefix = window.start > 0 ? '\u2026' : '';
  const suffix = window.end < text.length ? '\u2026' : '';
  return `${prefix}${output.join('')}${suffix}`;
}
