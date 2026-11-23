import { termFor, tokenize } from '../core/tokenizer.js';

/**
 * Query language.
 *
 *   "exact phrase"        phrase, scored with positional matching
 *   term1 term2           implicit AND
 *   term1 OR term2        disjunction
 *   -term / NOT term      exclusion
 *   (a OR b) c            grouping
 *   site:example.com      host / registrable-domain filter
 *   inurl:docs            token must appear in the URL
 *   intitle:guide         token must appear in the title
 *   filetype:pdf          path extension filter
 *   lang:it               language filter
 *
 * Field prefixes become scored field-restricted terms; filters are applied to
 * stored documents after ranking.
 */

export type QueryNode =
  | { type: 'term'; term: string; field?: 'title' | 'url' }
  | { type: 'phrase'; terms: string[]; field?: 'title' | 'url' }
  | { type: 'and'; children: QueryNode[] }
  | { type: 'or'; children: QueryNode[] }
  | { type: 'not'; child: QueryNode };

export interface QueryFilters {
  sites: string[];
  hosts: string[];
  filetypes: string[];
  langs: string[];
}

export interface ParsedQuery {
  ast: QueryNode | null;
  filters: QueryFilters;
  /** Positive terms in query order, used for highlighting and suggestions. */
  terms: string[];
  phrases: string[][];
  /** True when the user wrote explicit boolean syntax. */
  explicit: boolean;
}

type Token =
  | { kind: 'word'; value: string }
  | { kind: 'phrase'; value: string }
  | { kind: 'or' }
  | { kind: 'and' }
  | { kind: 'not' }
  | { kind: 'minus' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

const FILTER_FIELDS = new Set(['site', 'host', 'filetype', 'lang']);
const FIELD_FIELDS = new Set(['intitle', 'inurl']);

function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index]!;
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (char === '(') {
      tokens.push({ kind: 'lparen' });
      index++;
      continue;
    }
    if (char === ')') {
      tokens.push({ kind: 'rparen' });
      index++;
      continue;
    }
    if (char === '|') {
      tokens.push({ kind: 'or' });
      index++;
      continue;
    }
    if (char === '-' && index + 1 < input.length && !/\s/.test(input[index + 1]!)) {
      tokens.push({ kind: 'minus' });
      index++;
      continue;
    }
    if (char === '"' || char === '\u201c') {
      const closing = char === '"' ? '"' : '\u201d';
      const end = input.indexOf(closing, index + 1);
      const value = end === -1 ? input.slice(index + 1) : input.slice(index + 1, end);
      tokens.push({ kind: 'phrase', value });
      index = end === -1 ? input.length : end + 1;
      continue;
    }

    const start = index;
    while (index < input.length && !/[\s()]/.test(input[index]!)) {
      if (input[index] === '|') break;
      index++;
    }
    let word = input.slice(start, index);
    // A field prefix followed by a quoted value: site:"example com".
    if (word.endsWith(':') && (input[index] === '"' || input[index] === '\u201c')) {
      const closing = input[index] === '"' ? '"' : '\u201d';
      const end = input.indexOf(closing, index + 1);
      const value = end === -1 ? input.slice(index + 1) : input.slice(index + 1, end);
      word += value;
      index = end === -1 ? input.length : end + 1;
    }
    if (!word) continue;
    const lower = word.toLowerCase();
    if (lower === 'or') tokens.push({ kind: 'or' });
    else if (lower === 'and') tokens.push({ kind: 'and' });
    else if (lower === 'not') tokens.push({ kind: 'not' });
    else tokens.push({ kind: 'word', value: word });
  }
  return tokens;
}

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly filters: QueryFilters,
    private readonly terms: string[],
    private readonly phrases: string[][],
  ) {}

  parse(): QueryNode | null {
    if (this.tokens.length === 0) return null;
    return this.parseOr();
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private parseOr(): QueryNode | null {
    const children: QueryNode[] = [];
    let left = this.parseAnd();
    if (left) children.push(left);
    while (this.peek()?.kind === 'or') {
      this.position++;
      const right = this.parseAnd();
      if (right) children.push(right);
    }
    if (children.length === 0) return null;
    return children.length === 1 ? children[0]! : { type: 'or', children };
  }

  private parseAnd(): QueryNode | null {
    const children: QueryNode[] = [];
    for (;;) {
      const token = this.peek();
      if (!token || token.kind === 'rparen' || token.kind === 'or') break;
      if (token.kind === 'and') {
        this.position++;
        continue;
      }
      const node = this.parseUnary();
      if (node) children.push(node);
    }
    if (children.length === 0) return null;
    return children.length === 1 ? children[0]! : { type: 'and', children };
  }

  private parseUnary(): QueryNode | null {
    const token = this.peek();
    if (!token) return null;
    if (token.kind === 'minus' || token.kind === 'not') {
      this.position++;
      const child = this.parseUnary();
      return child ? { type: 'not', child } : null;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): QueryNode | null {
    const token = this.peek();
    if (!token) return null;
    if (token.kind === 'lparen') {
      this.position++;
      const node = this.parseOr();
      if (this.peek()?.kind === 'rparen') this.position++;
      return node;
    }
    if (token.kind === 'rparen') {
      this.position++;
      return null;
    }
    if (token.kind === 'phrase') {
      this.position++;
      return this.phraseNode(token.value);
    }
    if (token.kind === 'word') {
      this.position++;
      return this.wordNode(token.value);
    }
    this.position++;
    return null;
  }

  private phraseNode(value: string): QueryNode | null {
    // Analyse the phrase exactly like document text, so that single-letter
    // tokens dropped at index time cannot make a phrase unmatchable.
    const terms = tokenize(value).map((token) => token.term);
    if (terms.length === 0) return null;
    if (terms.length === 1) {
      this.terms.push(terms[0]!);
      return { type: 'term', term: terms[0]! };
    }
    this.phrases.push(terms);
    this.terms.push(...terms);
    return { type: 'phrase', terms };
  }

  private wordNode(word: string): QueryNode | null {
    const colon = word.indexOf(':');
    if (colon > 0) {
      const prefix = word.slice(0, colon).toLowerCase();
      const value = word.slice(colon + 1).trim();
      if (value) {
        if (FILTER_FIELDS.has(prefix)) {
          this.applyFilter(prefix, value);
          return null;
        }
        if (FIELD_FIELDS.has(prefix)) {
          const field = prefix === 'intitle' ? 'title' : 'url';
          const terms = tokenize(value).map((token) => token.term);
          if (terms.length === 0) return null;
          this.terms.push(...terms);
          if (terms.length === 1) return { type: 'term', term: terms[0]!, field };
          this.phrases.push(terms);
          return { type: 'phrase', terms, field };
        }
      }
    }
    const term = termFor(word);
    if (!term) return null;
    this.terms.push(term);
    return { type: 'term', term };
  }

  private applyFilter(prefix: string, value: string): void {
    const lower = value.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (prefix === 'site') this.filters.sites.push(lower);
    else if (prefix === 'host') this.filters.hosts.push(lower);
    else if (prefix === 'filetype') this.filters.filetypes.push(value.toLowerCase().replace(/^\./, ''));
    else if (prefix === 'lang') this.filters.langs.push(value.toLowerCase().slice(0, 5));
  }
}

export function emptyFilters(): QueryFilters {
  return { sites: [], hosts: [], filetypes: [], langs: [] };
}

export function parseQuery(input: string): ParsedQuery {
  const filters = emptyFilters();
  const terms: string[] = [];
  const phrases: string[][] = [];
  const tokens = lex(input);
  const parser = new Parser(tokens, filters, terms, phrases);
  const ast = parser.parse();
  const explicit = tokens.some(
    (token) => token.kind === 'or' || token.kind === 'not' || token.kind === 'minus' || token.kind === 'and',
  );
  return { ast, filters, terms, phrases, explicit };
}

/** Collects the positive terms of a tree, ignoring negated branches. */
export function positiveTerms(node: QueryNode | null): string[] {
  if (!node) return [];
  switch (node.type) {
    case 'term':
      return [node.term];
    case 'phrase':
      return [...node.terms];
    case 'and':
    case 'or':
      return node.children.flatMap((child) => positiveTerms(child));
    case 'not':
      return [];
  }
}
