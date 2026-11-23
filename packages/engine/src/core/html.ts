/**
 * HTML extraction.
 *
 * This is a token-level parser, not a full HTML5 tree builder: the crawler only
 * needs the title, the visible text, the headings, the metadata and the links,
 * and it must never throw on malformed markup. Raw-text elements are skipped
 * wholesale, which is both faster and safer than trying to repair broken trees.
 */

export interface ExtractedLink {
  href: string;
  text: string;
  nofollow: boolean;
}

export interface ExtractedPage {
  title: string;
  description: string;
  keywords: string;
  lang: string;
  canonical: string | null;
  baseHref: string | null;
  headings: string[];
  text: string;
  links: ExtractedLink[];
  metaRobots: string;
  ogTitle: string;
  ogDescription: string;
  truncated: boolean;
}

export interface ExtractOptions {
  maxTextLength?: number;
  maxLinks?: number;
}

const SKIPPED_ELEMENTS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'embed',
  'select',
  'textarea',
  'math',
]);

const BLOCK_ELEMENTS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

const NAMED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', '\u00a0'],
  ['ensp', '\u2002'],
  ['emsp', '\u2003'],
  ['thinsp', '\u2009'],
  ['shy', '\u00ad'],
  ['ndash', '\u2013'],
  ['mdash', '\u2014'],
  ['hellip', '\u2026'],
  ['lsquo', '\u2018'],
  ['rsquo', '\u2019'],
  ['ldquo', '\u201c'],
  ['rdquo', '\u201d'],
  ['laquo', '\u00ab'],
  ['raquo', '\u00bb'],
  ['bull', '\u2022'],
  ['middot', '\u00b7'],
  ['copy', '\u00a9'],
  ['reg', '\u00ae'],
  ['trade', '\u2122'],
  ['deg', '\u00b0'],
  ['plusmn', '\u00b1'],
  ['frac12', '\u00bd'],
  ['times', '\u00d7'],
  ['divide', '\u00f7'],
  ['euro', '\u20ac'],
  ['pound', '\u00a3'],
  ['yen', '\u00a5'],
  ['cent', '\u00a2'],
  ['sect', '\u00a7'],
  ['para', '\u00b6'],
  ['dagger', '\u2020'],
  ['Dagger', '\u2021'],
  ['permil', '\u2030'],
  ['prime', '\u2032'],
  ['Prime', '\u2033'],
  ['larr', '\u2190'],
  ['uarr', '\u2191'],
  ['rarr', '\u2192'],
  ['darr', '\u2193'],
  ['harr', '\u2194'],
  ['eacute', '\u00e9'],
  ['egrave', '\u00e8'],
  ['agrave', '\u00e0'],
  ['igrave', '\u00ec'],
  ['ograve', '\u00f2'],
  ['ugrave', '\u00f9'],
  ['aacute', '\u00e1'],
  ['iacute', '\u00ed'],
  ['oacute', '\u00f3'],
  ['uacute', '\u00fa'],
  ['acirc', '\u00e2'],
  ['ecirc', '\u00ea'],
  ['icirc', '\u00ee'],
  ['ocirc', '\u00f4'],
  ['ucirc', '\u00fb'],
  ['auml', '\u00e4'],
  ['euml', '\u00eb'],
  ['iuml', '\u00ef'],
  ['ouml', '\u00f6'],
  ['uuml', '\u00fc'],
  ['atilde', '\u00e3'],
  ['otilde', '\u00f5'],
  ['ntilde', '\u00f1'],
  ['ccedil', '\u00e7'],
  ['aring', '\u00e5'],
  ['oslash', '\u00f8'],
  ['aelig', '\u00e6'],
  ['szlig', '\u00df'],
  ['thorn', '\u00fe'],
  ['eth', '\u00f0'],
  ['alpha', '\u03b1'],
  ['beta', '\u03b2'],
  ['gamma', '\u03b3'],
  ['delta', '\u03b4'],
  ['pi', '\u03c0'],
  ['mu', '\u03bc'],
  ['sigma', '\u03c3'],
  ['omega', '\u03c9'],
  ['ne', '\u2260'],
  ['le', '\u2264'],
  ['ge', '\u2265'],
  ['infin', '\u221e'],
  ['radic', '\u221a'],
  ['sum', '\u2211'],
  ['prod', '\u220f'],
  ['int', '\u222b'],
  ['asymp', '\u2248'],
  ['equiv', '\u2261'],
]);

const ENTITY_PATTERN = /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

export function decodeEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(ENTITY_PATTERN, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const codePoint = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint === 0 || codePoint > 0x10ffff) return match;
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return match;
      return String.fromCodePoint(codePoint);
    }
    return NAMED_ENTITIES.get(body) ?? NAMED_ENTITIES.get(body.toLowerCase()) ?? match;
  });
}

interface Tag {
  name: string;
  attributes: Map<string, string>;
  selfClosing: boolean;
}

function parseTag(source: string, start: number): { tag: Tag; end: number } | null {
  let index = start + 1;
  const length = source.length;
  const nameStart = index;
  while (index < length) {
    const code = source.charCodeAt(index);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 47 || code === 62) break;
    index++;
  }
  const name = source.slice(nameStart, index).toLowerCase();
  if (!name || !/^[a-z][a-z0-9:-]*$/.test(name)) return null;

  const attributes = new Map<string, string>();
  let selfClosing = false;
  while (index < length) {
    while (index < length) {
      const code = source.charCodeAt(index);
      if (code === 32 || code === 9 || code === 10 || code === 13) index++;
      else break;
    }
    if (index >= length) return null;
    const code = source.charCodeAt(index);
    if (code === 62) return { tag: { name, attributes, selfClosing }, end: index + 1 };
    if (code === 47) {
      selfClosing = true;
      index++;
      continue;
    }
    selfClosing = false;
    const attrStart = index;
    while (index < length) {
      const c = source.charCodeAt(index);
      if (c === 61 || c === 32 || c === 9 || c === 10 || c === 13 || c === 62 || c === 47) break;
      index++;
    }
    const attrName = source.slice(attrStart, index).toLowerCase();
    while (index < length && /\s/.test(source[index]!)) index++;
    let value = '';
    if (source[index] === '=') {
      index++;
      while (index < length && /\s/.test(source[index]!)) index++;
      const quote = source[index];
      if (quote === '"' || quote === "'") {
        index++;
        const valueStart = index;
        while (index < length && source[index] !== quote) index++;
        value = source.slice(valueStart, index);
        if (index < length) index++;
      } else {
        const valueStart = index;
        while (index < length && !/[\s>]/.test(source[index]!)) index++;
        value = source.slice(valueStart, index);
      }
    }
    if (attrName) attributes.set(attrName, decodeEntities(value));
    if (attrName === '' && index >= length) return null;
  }
  return null;
}

function collapseText(parts: string[], maxLength: number): { text: string; truncated: boolean } {
  let length = 0;
  const lines: string[] = [];
  let current = '';
  for (const part of parts) {
    if (part === '\n') {
      if (current) lines.push(current.replace(/\s+/g, ' ').trim());
      current = '';
      continue;
    }
    if (length >= maxLength) return { text: lines.join('\n'), truncated: true };
    current += part;
    length += part.length;
  }
  if (current) lines.push(current.replace(/\s+/g, ' ').trim());
  return { text: lines.filter(Boolean).join('\n'), truncated: false };
}

export function extractHtml(html: string, options: ExtractOptions = {}): ExtractedPage {
  const maxTextLength = options.maxTextLength ?? 24_000;
  const maxLinks = options.maxLinks ?? 2_000;
  const page: ExtractedPage = {
    title: '',
    description: '',
    keywords: '',
    lang: '',
    canonical: null,
    baseHref: null,
    headings: [],
    text: '',
    links: [],
    metaRobots: '',
    ogTitle: '',
    ogDescription: '',
    truncated: false,
  };

  const textParts: string[] = [];
  let index = 0;
  let skipUntil: string | null = null;
  let titleCapture: string[] | null = null;
  let headingTag: string | null = null;
  let headingBuffer: string[] = [];
  let anchorHref: string | null = null;
  let anchorNofollow = false;
  let anchorText: string[] = [];
  let anchorDepth = 0;
  const source = html;
  const length = source.length;

  const appendText = (value: string): void => {
    if (!value) return;
    if (titleCapture) titleCapture.push(value);
    if (headingTag) headingBuffer.push(value);
    if (anchorDepth > 0) anchorText.push(value);
    textParts.push(value);
  };

  while (index < length) {
    const lt = source.indexOf('<', index);
    if (lt === -1) {
      if (!skipUntil) appendText(decodeEntities(source.slice(index)));
      break;
    }
    if (lt > index && !skipUntil) appendText(decodeEntities(source.slice(index, lt)));

    if (source.startsWith('<!--', lt)) {
      const close = source.indexOf('-->', lt + 4);
      index = close === -1 ? length : close + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const close = source.indexOf(']]>', lt + 9);
      index = close === -1 ? length : close + 3;
      continue;
    }
    if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
      const close = source.indexOf('>', lt + 2);
      index = close === -1 ? length : close + 1;
      continue;
    }
    if (source.startsWith('</', lt)) {
      const close = source.indexOf('>', lt + 2);
      const rawName = source.slice(lt + 2, close === -1 ? length : close).trim().toLowerCase();
      index = close === -1 ? length : close + 1;
      if (skipUntil && rawName === skipUntil) skipUntil = null;
      if (titleCapture && rawName === 'title') {
        const title = titleCapture.join('').replace(/\s+/g, ' ').trim();
        if (!page.title && title) page.title = title;
        titleCapture = null;
      }
      if (headingTag && rawName === headingTag) {
        const heading = headingBuffer.join('').replace(/\s+/g, ' ').trim();
        if (heading && page.headings.length < 64) page.headings.push(heading);
        headingTag = null;
        headingBuffer = [];
      }
      if (rawName === 'a' && anchorDepth > 0) {
        anchorDepth--;
        if (anchorDepth === 0) {
          if (anchorHref && page.links.length < maxLinks) {
            page.links.push({
              href: anchorHref,
              text: anchorText.join('').replace(/\s+/g, ' ').trim().slice(0, 200),
              nofollow: anchorNofollow,
            });
          }
          anchorHref = null;
          anchorText = [];
          anchorNofollow = false;
        }
      }
      if (BLOCK_ELEMENTS.has(rawName)) textParts.push('\n');
      continue;
    }

    const parsed = parseTag(source, lt);
    if (!parsed) {
      index = lt + 1;
      if (!skipUntil) appendText('<');
      continue;
    }
    index = parsed.end;
    const { name, attributes, selfClosing } = parsed.tag;

    if (skipUntil) continue;

    if (SKIPPED_ELEMENTS.has(name)) {
      if (!selfClosing) skipUntil = name;
      if (BLOCK_ELEMENTS.has(name)) textParts.push('\n');
      continue;
    }

    if (name === 'title') {
      titleCapture = [];
      continue;
    }
    if (name === 'html') {
      page.lang = attributes.get('lang') ?? page.lang;
      continue;
    }
    if (name === 'meta') {
      const metaName = (attributes.get('name') ?? attributes.get('property') ?? '').toLowerCase();
      const content = attributes.get('content') ?? '';
      if (!content) continue;
      if (metaName === 'description' && !page.description) page.description = content.slice(0, 1000);
      else if (metaName === 'keywords' && !page.keywords) page.keywords = content.slice(0, 1000);
      else if (metaName === 'robots') page.metaRobots = content.toLowerCase();
      else if (metaName === 'og:title' && !page.ogTitle) page.ogTitle = content.slice(0, 300);
      else if (metaName === 'og:description' && !page.ogDescription) {
        page.ogDescription = content.slice(0, 1000);
      }
      continue;
    }
    if (name === 'link') {
      const rel = (attributes.get('rel') ?? '').toLowerCase();
      const href = attributes.get('href');
      if (href && rel.split(/\s+/).includes('canonical') && !page.canonical) page.canonical = href;
      continue;
    }
    if (name === 'base') {
      const href = attributes.get('href');
      if (href && !page.baseHref) page.baseHref = href;
      continue;
    }
    if (name === 'a') {
      const href = attributes.get('href');
      const rel = (attributes.get('rel') ?? '').toLowerCase();
      if (href && anchorDepth === 0) {
        anchorHref = href;
        anchorNofollow = rel.split(/\s+/).includes('nofollow');
      }
      if (!selfClosing) anchorDepth++;
      continue;
    }
    if (name === 'img') {
      const alt = attributes.get('alt');
      if (alt) appendText(` ${alt} `);
      continue;
    }
    if (name === 'h1' || name === 'h2' || name === 'h3') {
      if (!headingTag) {
        headingTag = name;
        headingBuffer = [];
      }
      textParts.push('\n');
      continue;
    }
    if (BLOCK_ELEMENTS.has(name)) textParts.push('\n');
  }

  if (titleCapture) {
    const title = (titleCapture as string[]).join('').replace(/\s+/g, ' ').trim();
    if (!page.title && title) page.title = title;
  }

  const collapsed = collapseText(textParts, maxTextLength);
  page.text = collapsed.text;
  page.truncated = collapsed.truncated;
  if (!page.title) page.title = page.ogTitle || page.headings[0] || '';
  return page;
}

/** Removes tags from a short fragment such as an OpenSearch title. */
export function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
