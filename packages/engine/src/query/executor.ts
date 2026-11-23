import { FIELD, FIELD_COUNT, POSITIONED_FIELDS, type FieldLengths } from '../core/fields.js';
import type { QueryNode } from './parser.js';
import {
  DEFAULT_SCORING,
  bm25f,
  inverseDocumentFrequency,
  type CorpusStats,
  type ScoringConfig,
} from './scoring.js';

/**
 * Query execution.
 *
 * Term postings are decoded once per query and merged across segments. Plain
 * conjunctions use a leapfrog intersection; disjunctions use a k-way merge over
 * a min-heap; anything with explicit boolean structure falls back to a map
 * based evaluator. Every path feeds the same bounded top-k heap, so memory does
 * not grow with the size of the result set.
 */

export interface TermPostings {
  docIds: Uint32Array;
  /** FIELD_COUNT frequencies per document, flattened. */
  tfs: Uint16Array;
  posOffsets: Uint32Array[];
  posData: Int32Array[];
}

export interface SearchContext {
  totalDocs: number;
  stats: CorpusStats;
  term(term: string): TermPostings | null;
  lengths(docId: number): FieldLengths | null;
  isDeleted(docId: number): boolean;
  allDocIds(): Uint32Array;
}

export interface Hit {
  docId: number;
  score: number;
}

export interface ExecuteOptions {
  limit: number;
  config?: ScoringConfig;
  /** When true, conjunctions are retried as disjunctions. */
  relax?: boolean;
  /** Hard cap on the reported total. */
  maxTotal?: number;
}

export interface ExecuteResult {
  hits: Hit[];
  total: number;
  totalRelation: 'eq' | 'gte';
  relaxed: boolean;
  /** Terms that produced no postings at all. */
  missingTerms: string[];
}

class TopK {
  private readonly items: Hit[] = [];

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.items.length;
  }

  push(hit: Hit): void {
    if (this.capacity <= 0) return;
    if (this.items.length < this.capacity) {
      this.items.push(hit);
      this.siftUp(this.items.length - 1);
      return;
    }
    if (hit.score <= this.items[0]!.score) return;
    this.items[0] = hit;
    this.siftDown(0);
  }

  values(): Hit[] {
    return [...this.items].sort((a, b) => b.score - a.score || a.docId - b.docId);
  }

  private siftUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.items[parent]!.score <= this.items[child]!.score) break;
      [this.items[parent], this.items[child]] = [this.items[child]!, this.items[parent]!];
      child = parent;
    }
  }

  private siftDown(index: number): void {
    let parent = index;
    for (;;) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let smallest = parent;
      if (left < this.items.length && this.items[left]!.score < this.items[smallest]!.score) {
        smallest = left;
      }
      if (right < this.items.length && this.items[right]!.score < this.items[smallest]!.score) {
        smallest = right;
      }
      if (smallest === parent) return;
      [this.items[parent], this.items[smallest]] = [this.items[smallest]!, this.items[parent]!];
      parent = smallest;
    }
  }
}

export function binarySearchDocIds(docIds: Uint32Array, target: number, hint = 0): number {
  let low = hint;
  let high = docIds.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const value = docIds[mid]!;
    if (value === target) return mid;
    if (value < target) low = mid + 1;
    else high = mid - 1;
  }
  return -(low + 1);
}

function positionsFor(list: TermPostings, docIndex: number, field: number): Int32Array | null {
  const offsets = list.posOffsets[field];
  if (!offsets) return null;
  const start = offsets[docIndex]!;
  const end = offsets[docIndex + 1]!;
  if (end <= start) return null;
  return list.posData[field]!.subarray(start, end);
}

function containsPosition(positions: Int32Array, target: number): boolean {
  let low = 0;
  let high = positions.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const value = positions[mid]!;
    if (value === target) return true;
    if (value < target) low = mid + 1;
    else high = mid - 1;
  }
  return false;
}

/** Counts adjacent occurrences of a phrase, per field. */
export function phraseOccurrences(
  lists: TermPostings[],
  docIndexes: number[],
  field: number,
): number {
  if (lists.length === 0) return 0;
  const first = positionsFor(lists[0]!, docIndexes[0]!, field);
  if (!first) return 0;
  const rest: Int32Array[] = [];
  for (let i = 1; i < lists.length; i++) {
    const positions = positionsFor(lists[i]!, docIndexes[i]!, field);
    if (!positions) return 0;
    rest.push(positions);
  }
  let occurrences = 0;
  for (let i = 0; i < first.length; i++) {
    const start = first[i]!;
    let matched = true;
    for (let j = 0; j < rest.length; j++) {
      if (!containsPosition(rest[j]!, start + j + 1)) {
        matched = false;
        break;
      }
    }
    if (matched) occurrences++;
  }
  return occurrences;
}

interface PreparedTerm {
  kind: 'term';
  term: string;
  field?: 'title' | 'url';
  postings: TermPostings;
  idf: number;
}

interface PreparedPhrase {
  kind: 'phrase';
  terms: string[];
  field?: 'title' | 'url';
  postings: TermPostings[];
  idf: number;
}

class QueryRuntime {
  readonly config: ScoringConfig;
  readonly termCache = new Map<string, TermPostings | null>();
  private readonly prepared = new Map<string, PreparedTerm | PreparedPhrase>();
  missing: string[] = [];

  constructor(
    private readonly ctx: SearchContext,
    config?: ScoringConfig,
  ) {
    this.config = config ?? DEFAULT_SCORING;
  }

  postings(term: string): TermPostings | null {
    if (this.termCache.has(term)) return this.termCache.get(term) ?? null;
    const list = this.ctx.term(term);
    this.termCache.set(term, list);
    if (!list) this.missing.push(term);
    return list;
  }

  idf(term: string): number {
    const list = this.termCache.get(term);
    const df = list ? list.docIds.length : 0;
    return inverseDocumentFrequency(this.ctx.totalDocs, df);
  }

  prepare(node: QueryNode): PreparedTerm | PreparedPhrase | null {
    const key = JSON.stringify(node);
    const cached = this.prepared.get(key);
    if (cached) return cached;
    let prepared: PreparedTerm | PreparedPhrase | null = null;
    if (node.type === 'term') {
      const list = this.postings(node.term);
      if (list) {
        prepared = {
          kind: 'term',
          term: node.term,
          field: node.field,
          postings: list,
          idf: this.idf(node.term),
        };
      }
    } else if (node.type === 'phrase') {
      const lists: TermPostings[] = [];
      let idf = 0;
      let complete = true;
      for (const term of node.terms) {
        const list = this.postings(term);
        if (!list) {
          complete = false;
          break;
        }
        lists.push(list);
        idf += this.idf(term);
      }
      if (complete) {
        prepared = {
          kind: 'phrase',
          terms: node.terms,
          field: node.field,
          postings: lists,
          idf: idf * this.config.phraseBoost,
        };
      }
    }
    if (prepared) this.prepared.set(key, prepared);
    return prepared;
  }

  /** Scores one document for a prepared term or phrase. */
  score(prepared: PreparedTerm | PreparedPhrase, docId: number): number {
    const lengths = this.ctx.lengths(docId);
    if (!lengths) return 0;
    if (prepared.kind === 'term') {
      const term = prepared;
      const index = binarySearchDocIds(term.postings.docIds, docId);
      if (index < 0) return 0;
      const field = term.field === 'title' ? FIELD.title : term.field === 'url' ? FIELD.url : undefined;
      return bm25f(
        term.postings.tfs,
        index * FIELD_COUNT,
        lengths,
        this.ctx.stats,
        term.idf,
        this.config,
        field,
      );
    }
    const phrase = prepared;
    const indexes: number[] = [];
    for (const list of phrase.postings) {
      const index = binarySearchDocIds(list.docIds, docId);
      if (index < 0) return 0;
      indexes.push(index);
    }
    const tfs = new Uint16Array(FIELD_COUNT);
    for (let field = 0; field < POSITIONED_FIELDS; field++) {
      if (phrase.field === 'title' && field !== FIELD.title) continue;
      if (phrase.field === 'url' && field !== FIELD.url) continue;
      tfs[field] = Math.min(phraseOccurrences(phrase.postings, indexes, field), 0xffff);
    }
    if ((tfs[0] ?? 0) === 0 && (tfs[1] ?? 0) === 0 && (tfs[2] ?? 0) === 0) return 0;
    return bm25f(tfs, 0, lengths, this.ctx.stats, phrase.idf, this.config);
  }

  /** True when the document satisfies a prepared term or phrase. */
  matches(prepared: PreparedTerm | PreparedPhrase, docId: number): boolean {
    if (prepared.kind === 'term') {
      return binarySearchDocIds(prepared.postings.docIds, docId) >= 0;
    }
    const phrase = prepared;
    const indexes: number[] = [];
    for (const list of phrase.postings) {
      const index = binarySearchDocIds(list.docIds, docId);
      if (index < 0) return false;
      indexes.push(index);
    }
    for (let field = 0; field < POSITIONED_FIELDS; field++) {
      if (phrase.field === 'title' && field !== FIELD.title) continue;
      if (phrase.field === 'url' && field !== FIELD.url) continue;
      if (phraseOccurrences(phrase.postings, indexes, field) > 0) return true;
    }
    return false;
  }

  preparedChildren(node: QueryNode): Array<PreparedTerm | PreparedPhrase> {
    if (node.type === 'term' || node.type === 'phrase') {
      const prepared = this.prepare(node);
      return prepared ? [prepared] : [];
    }
    return [];
  }
}

export function executeQuery(
  ast: QueryNode | null,
  ctx: SearchContext,
  options: ExecuteOptions,
): ExecuteResult {
  const runtime = new QueryRuntime(ctx, options.config);
  const limit = Math.max(1, options.limit);
  if (!ast) {
    return { hits: [], total: 0, totalRelation: 'eq', relaxed: false, missingTerms: [] };
  }

  if (ast.type === 'not') {
    return { hits: [], total: 0, totalRelation: 'eq', relaxed: false, missingTerms: [] };
  }
  const result = run(ast, runtime, ctx, limit, options.maxTotal ?? 50_000);
  if (options.relax && result.hits.length < limit) {
    const relaxedAst = relax(ast);
    if (relaxedAst) {
      const relaxedResult = run(relaxedAst, runtime, ctx, limit, options.maxTotal ?? 50_000);
      if (relaxedResult.hits.length > result.hits.length) {
        return {
          ...relaxedResult,
          relaxed: true,
          missingTerms: runtime.missing,
        };
      }
    }
  }
  return { ...result, relaxed: false, missingTerms: runtime.missing };
}

function run(
  ast: QueryNode,
  runtime: QueryRuntime,
  ctx: SearchContext,
  limit: number,
  maxTotal: number,
): ExecuteResult {
  if (ast.type === 'term' || ast.type === 'phrase') {
    const prepared = runtime.prepare(ast);
    if (!prepared) {
      return { hits: [], total: 0, totalRelation: 'eq', relaxed: false, missingTerms: runtime.missing };
    }
    return scanPostings(prepared, runtime, ctx, limit, maxTotal);
  }
  if (ast.type === 'and' && ast.children.every((child) => child.type === 'term' || child.type === 'phrase')) {
    const conjuncts = ast.children.map((child) => runtime.prepare(child));
    if (conjuncts.some((prepared) => prepared === null)) {
      return { hits: [], total: 0, totalRelation: 'eq', relaxed: false, missingTerms: runtime.missing };
    }
    return intersect(conjuncts as Array<PreparedTerm | PreparedPhrase>, runtime, ctx, limit, maxTotal);
  }
  const scores = evaluateMap(ast, runtime, ctx);
  const heap = new TopK(limit);
  for (const [docId, score] of scores) {
    if (score <= 0 || ctx.isDeleted(docId)) continue;
    heap.push({ docId, score });
  }
  return {
    hits: heap.values(),
    total: Math.min(scores.size, maxTotal),
    totalRelation: scores.size > maxTotal ? 'gte' : 'eq',
    relaxed: false,
    missingTerms: runtime.missing,
  };
}

function scanPostings(
  prepared: PreparedTerm | PreparedPhrase,
  runtime: QueryRuntime,
  ctx: SearchContext,
  limit: number,
  maxTotal: number,
): ExecuteResult {
  const heap = new TopK(limit);
  const list = prepared.kind === 'term' ? prepared.postings : prepared.postings[0]!;
  let total = 0;
  for (let i = 0; i < list.docIds.length; i++) {
    const docId = list.docIds[i]!;
    if (ctx.isDeleted(docId)) continue;
    if (!runtime.matches(prepared, docId)) continue;
    total++;
    if (total > maxTotal) continue;
    heap.push({ docId, score: runtime.score(prepared, docId) });
  }
  return {
    hits: heap.values(),
    total: Math.min(total, maxTotal),
    totalRelation: total > maxTotal ? 'gte' : 'eq',
    relaxed: false,
    missingTerms: runtime.missing,
  };
}

function intersect(
  conjuncts: Array<PreparedTerm | PreparedPhrase>,
  runtime: QueryRuntime,
  ctx: SearchContext,
  limit: number,
  maxTotal: number,
): ExecuteResult {
  const lists = conjuncts.map((prepared) =>
    prepared.kind === 'term' ? prepared.postings : prepared.postings[0]!,
  );
  // Drive the intersection from the rarest term.
  let driverIndex = 0;
  for (let i = 1; i < lists.length; i++) {
    if (lists[i]!.docIds.length < lists[driverIndex]!.docIds.length) driverIndex = i;
  }
  const cursors = new Array<number>(lists.length).fill(0);
  const heap = new TopK(limit);
  let total = 0;
  const driver = lists[driverIndex]!;

  while (cursors[driverIndex]! < driver.docIds.length) {
    const docId = driver.docIds[cursors[driverIndex]!]!;
    let aligned = true;
    for (let i = 0; i < lists.length; i++) {
      if (i === driverIndex) continue;
      const list = lists[i]!;
      let position = binarySearchDocIds(list.docIds, docId, cursors[i]!);
      if (position < 0) {
        position = -position - 1;
        cursors[i] = position;
        if (position >= list.docIds.length) {
          return {
            hits: heap.values(),
            total: Math.min(total, maxTotal),
            totalRelation: total > maxTotal ? 'gte' : 'eq',
            relaxed: false,
            missingTerms: runtime.missing,
          };
        }
        aligned = false;
        break;
      }
      cursors[i] = position;
    }

    if (!aligned) {
      // Jump the driver to the furthest cursor to skip non-matching documents.
      let furthest = docId;
      for (let i = 0; i < lists.length; i++) {
        const list = lists[i]!;
        const position = cursors[i]!;
        if (position < list.docIds.length) furthest = Math.max(furthest, list.docIds[position]!);
      }
      let next = binarySearchDocIds(driver.docIds, furthest, cursors[driverIndex]!);
      if (next < 0) next = -next - 1;
      cursors[driverIndex] = next;
      continue;
    }

    let matchesAll = true;
    for (const prepared of conjuncts) {
      if (!runtime.matches(prepared, docId)) {
        matchesAll = false;
        break;
      }
    }
    if (matchesAll && !ctx.isDeleted(docId)) {
      total++;
      if (total <= maxTotal) {
        let score = 0;
        for (const prepared of conjuncts) score += runtime.score(prepared, docId);
        heap.push({ docId, score });
      }
    }
    for (let i = 0; i < lists.length; i++) cursors[i] = cursors[i]! + 1;
  }

  return {
    hits: heap.values(),
    total: Math.min(total, maxTotal),
    totalRelation: total > maxTotal ? 'gte' : 'eq',
    relaxed: false,
    missingTerms: runtime.missing,
  };
}

function evaluateMap(
  node: QueryNode,
  runtime: QueryRuntime,
  ctx: SearchContext,
): Map<number, number> {
  switch (node.type) {
    case 'term':
    case 'phrase': {
      const prepared = runtime.prepare(node);
      const scores = new Map<number, number>();
      if (!prepared) return scores;
      const list = prepared.kind === 'term' ? prepared.postings : prepared.postings[0]!;
      for (let i = 0; i < list.docIds.length; i++) {
        const docId = list.docIds[i]!;
        if (ctx.isDeleted(docId)) continue;
        if (prepared.kind === 'phrase' && !runtime.matches(prepared, docId)) continue;
        scores.set(docId, runtime.score(prepared, docId));
      }
      return scores;
    }
    case 'and': {
      let accumulated: Map<number, number> | null = null;
      for (const child of node.children) {
        const childScores = evaluateMap(child, runtime, ctx);
        if (!accumulated) {
          accumulated = childScores;
          continue;
        }
        const next = new Map<number, number>();
        const [small, large] =
          accumulated.size <= childScores.size
            ? [accumulated, childScores]
            : [childScores, accumulated];
        for (const [docId, score] of small) {
          const other = large.get(docId);
          if (other === undefined) continue;
          next.set(docId, score + other);
        }
        accumulated = next;
        if (accumulated.size === 0) break;
      }
      return accumulated ?? new Map();
    }
    case 'or': {
      const scores = new Map<number, number>();
      for (const child of node.children) {
        for (const [docId, score] of evaluateMap(child, runtime, ctx)) {
          scores.set(docId, (scores.get(docId) ?? 0) + score);
        }
      }
      return scores;
    }
    case 'not': {
      const excluded = evaluateMap(node.child, runtime, ctx);
      const all = ctx.allDocIds();
      const scores = new Map<number, number>();
      for (let i = 0; i < all.length; i++) {
        const docId = all[i]!;
        if (!excluded.has(docId) && !ctx.isDeleted(docId)) scores.set(docId, 1);
      }
      return scores;
    }
  }
}

/** Converts `a b -c` into `(a OR b) -c` so a strict query can fall back. */
function relax(node: QueryNode): QueryNode | null {
  if (node.type === 'and') {
    const positives = node.children.filter((child) => child.type !== 'not');
    const negatives = node.children.filter((child) => child.type === 'not');
    if (positives.length === 0) return null;
    const relaxedPositive: QueryNode =
      positives.length === 1 ? positives[0]! : { type: 'or', children: positives };
    if (negatives.length === 0) return relaxedPositive;
    return { type: 'and', children: [relaxedPositive, ...negatives] };
  }
  if (node.type === 'or') {
    const children = node.children.filter((child) => child.type !== 'not');
    return children.length > 0 ? { type: 'or', children } : null;
  }
  return null;
}
