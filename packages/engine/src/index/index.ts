import { readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { canonicalizeUrl, hostOf } from '../core/url.js';
import { ensureDir, readJsonFile, writeJsonAtomic } from '../core/fsutil.js';
import { foldText, tokenize } from '../core/tokenizer.js';
import { fingerprintToString, simhash } from '../core/simhash.js';
import { getRegistrableDomain } from '../core/psl.js';
import { DocStore, type StoredDocument } from './docstore.js';
import {
  FIELD_COUNT,
  POSITIONED_FIELDS,
  SegmentBuilder,
  SegmentReader,
  type FieldLengths,
  type PostingList,
} from './segment.js';
import { parseQuery, type QueryFilters } from '../query/parser.js';
import {
  executeQuery,
  type Hit,
  type SearchContext,
  type TermPostings,
} from '../query/executor.js';
import {
  DEFAULT_SCORING,
  qualityMultiplier,
  type CorpusStats,
  type ScoringConfig,
} from '../query/scoring.js';
import { SpellChecker, type Lexicon } from '../query/suggest.js';
import { buildSnippet } from '../query/snippet.js';

/**
 * The index.
 *
 * Documents live in an append-only store; terms live in immutable segments that
 * are merged when they pile up. A small in-memory table absorbs writes between
 * flushes. `commit()` is the durability point: everything before it can be lost
 * on a crash without corrupting the index.
 */

export interface IndexDocument {
  url: string;
  title: string;
  description?: string;
  headings?: string[];
  body: string;
  lang?: string;
  fetchedAt?: number;
  contentHash?: string;
  outlinks?: string[];
  contentType?: string;
  status?: number;
  depth?: number;
  byteSize?: number;
  etag?: string;
  lastModified?: string;
}

export interface IndexOptions {
  flushThreshold?: number;
  mergeFactor?: number;
  scoring?: ScoringConfig;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  sort?: 'relevance' | 'date';
  scoring?: ScoringConfig;
  /** Disable the AND -> OR fallback. */
  strict?: boolean;
}

export interface SearchResult {
  url: string;
  title: string;
  description: string;
  snippet: string;
  site: string;
  host: string;
  lang: string;
  fetchedAt: number;
  score: number;
  matchedTerms: string[];
}

export interface SearchResponse {
  query: string;
  total: number;
  totalRelation: 'eq' | 'gte';
  tookMs: number;
  results: SearchResult[];
  relaxed: boolean;
  suggestion: string | null;
  terms: string[];
}

export interface IndexStats {
  documents: number;
  segments: number;
  indexedTerms: number;
  tombstones: number;
  documentBytes: number;
  segmentBytes: number;
  averageLengths: FieldLengths;
  updatedAt: number;
}

interface SegmentInfo {
  id: number;
  docs: number;
  terms: number;
  size: number;
}

interface Manifest {
  version: number;
  nextDocId: number;
  nextSegmentId: number;
  segments: SegmentInfo[];
  tombstones: number[];
  updatedAt: number;
}

interface MemPosting {
  docId: number;
  tfs: number[];
  positions: number[][];
}

const MANIFEST_VERSION = 1;
const EMPTY_MANIFEST: Manifest = {
  version: MANIFEST_VERSION,
  nextDocId: 1,
  nextSegmentId: 1,
  segments: [],
  tombstones: [],
  updatedAt: 0,
};

function emptyLengths(): FieldLengths {
  return [0, 0, 0, 0, 0];
}

function urlTokens(url: string): string {
  return url.replace(/[^\p{L}\p{N}]+/gu, ' ');
}

export class SearchIndex {
  readonly dir: string;
  readonly segmentsDir: string;
  private readonly options: Required<Omit<IndexOptions, 'scoring'>>;
  private readonly scoring: ScoringConfig;
  private manifest: Manifest;
  private segments: SegmentReader[] = [];
  private docStore: DocStore;
  private tombstones: Set<number>;
  private urlMap: Map<string, number>;
  private docLengths = new Map<number, FieldLengths>();
  private averageLengths: FieldLengths = [1, 1, 1, 1, 1];
  private memTerms = new Map<string, Map<number, MemPosting>>();
  private memLengths = new Map<number, FieldLengths>();
  private memDocCount = 0;
  private linkRank = new Map<string, number>();
  private readonly surfaces = new Map<string, { surface: string; count: number }>();
  private surfaceIndex: Array<{ folded: string; surface: string }> | null = null;
  private spellChecker: SpellChecker | null = null;
  private dirty = false;
  private allDocsCache: Uint32Array | null = null;

  private constructor(dir: string, options: IndexOptions) {
    this.dir = dir;
    this.segmentsDir = join(dir, 'segments');
    this.options = {
      flushThreshold: options.flushThreshold ?? 512,
      mergeFactor: options.mergeFactor ?? 6,
    };
    this.scoring = options.scoring ?? DEFAULT_SCORING;
    ensureDir(dir);
    ensureDir(this.segmentsDir);

    this.manifest = readJsonFile<Manifest>(join(dir, 'manifest.json'), { ...EMPTY_MANIFEST });
    if (this.manifest.version !== MANIFEST_VERSION) {
      throw new Error(`unsupported index version ${this.manifest.version} in ${dir}`);
    }
    this.tombstones = new Set(this.manifest.tombstones);
    this.docStore = DocStore.open(dir);
    this.manifest.nextDocId = Math.max(this.manifest.nextDocId, this.docStore.maxDocId() + 1);
    this.urlMap = new Map(readJsonFile<Array<[string, number]>>(join(dir, 'urls.json'), []));
    for (const [stem, surface] of readJsonFile<Array<[string, string]>>(join(dir, 'surfaces.json'), [])) {
      if (typeof stem === 'string' && typeof surface === 'string') {
        this.surfaces.set(stem, { surface, count: 1 });
      }
    }
    for (const [url, docId] of this.urlMap) {
      if (this.tombstones.has(docId) || !this.docStore.has(docId)) this.urlMap.delete(url);
    }
    this.loadSegments();
    this.loadLinkGraph();
    this.recomputeStats();
  }

  static open(dir: string, options: IndexOptions = {}): SearchIndex {
    return new SearchIndex(dir, options);
  }

  private loadSegments(): void {
    const known = new Set<string>();
    const loaded: SegmentInfo[] = [];
    for (const info of this.manifest.segments) {
      const path = join(this.segmentsDir, `seg-${info.id}.seg`);
      known.add(`seg-${info.id}.seg`);
      try {
        this.segments.push(SegmentReader.open(path));
        loaded.push(info);
      } catch {
        // A missing or corrupt segment is dropped; its documents become
        // unreachable and the next `optimize()` removes them.
      }
    }
    this.manifest.segments = loaded;
    for (const name of readdirSync(this.segmentsDir)) {
      if (!name.endsWith('.seg') || known.has(name)) continue;
      try {
        unlinkSync(join(this.segmentsDir, name));
      } catch {
        // Best effort: an orphan segment is harmless.
      }
    }
  }

  private loadLinkGraph(): void {
    const raw = readJsonFile<Record<string, number>>(join(this.dir, 'linkgraph.json'), {});
    for (const [host, rank] of Object.entries(raw)) this.linkRank.set(host, rank);
  }

  private recomputeStats(): void {
    this.docLengths.clear();
    const sums = emptyLengths();
    let live = 0;
    for (const segment of this.segments) {
      for (const [docId, lengths] of segment.lengths) {
        if (this.tombstones.has(docId)) continue;
        this.docLengths.set(docId, lengths);
        for (let field = 0; field < FIELD_COUNT; field++) sums[field] = sums[field]! + lengths[field]!;
        live++;
      }
    }
    for (const [docId, lengths] of this.memLengths) {
      if (this.tombstones.has(docId)) continue;
      this.docLengths.set(docId, lengths);
      for (let field = 0; field < FIELD_COUNT; field++) sums[field] = sums[field]! + lengths[field]!;
      live++;
    }
    for (let field = 0; field < FIELD_COUNT; field++) {
      this.averageLengths[field] = live > 0 ? Math.max(1, sums[field]! / live) : 1;
    }
    this.allDocsCache = null;
  }

  get documentCount(): number {
    return this.docLengths.size;
  }

  // ---------------------------------------------------------------- indexing

  addDocument(document: IndexDocument): number {
    const url = canonicalizeUrl(document.url);
    if (!url) throw new Error(`invalid document url: ${document.url}`);
    const existing = this.urlMap.get(url);
    if (existing !== undefined) this.tombstone(existing);

    const docId = this.manifest.nextDocId++;
    const title = (document.title ?? '').slice(0, 500);
    const headings = (document.headings ?? []).slice(0, 64).join('\n');
    const body = (document.body ?? '').slice(0, 60_000);
    const description = (document.description ?? '').slice(0, 2_000);
    const meta = `${description}\n${document.lang ?? ''}`;
    const host = hostOf(url) ?? '';
    const site = getRegistrableDomain(host) ?? host;

    const fieldTexts = [title, headings, body, urlTokens(url), meta];
    const analysis = fieldTexts.map((text) => analyzeText(text));

    const termEntries = new Map<string, MemPosting>();
    const lengths = emptyLengths();
    for (let field = 0; field < FIELD_COUNT; field++) {
      const fieldTerms = analysis[field]!;
      lengths[field] = fieldTerms.terms.length;
      for (const [term, positions] of fieldTerms.positions) {
        let entry = termEntries.get(term);
        if (!entry) {
          entry = { docId, tfs: emptyLengths(), positions: [[], [], [], []] };
          termEntries.set(term, entry);
        }
        entry.tfs[field] = positions.length;
        if (field < POSITIONED_FIELDS) entry.positions[field] = positions;
      }
      for (const [stem, surfaces] of fieldTerms.surfaces) {
        for (const [surface, count] of surfaces) {
          const existing = this.surfaces.get(stem);
          if (!existing || count > existing.count) this.surfaces.set(stem, { surface, count });
        }
      }
    }

    for (const [term, entry] of termEntries) {
      let docs = this.memTerms.get(term);
      if (!docs) {
        docs = new Map();
        this.memTerms.set(term, docs);
      }
      docs.set(docId, entry);
    }
    this.memLengths.set(docId, lengths);
    this.memDocCount++;

    const fingerprint = simhash(analysis[2]!.terms.slice(0, 20_000));
    const stored: StoredDocument = {
      url,
      title,
      description,
      headings: document.headings?.slice(0, 64) ?? [],
      text: body,
      lang: document.lang ?? '',
      host,
      site,
      fetchedAt: document.fetchedAt ?? Date.now(),
      contentHash: document.contentHash ?? '',
      fingerprint: fingerprintToString(fingerprint),
      outlinks: (document.outlinks ?? []).slice(0, 500),
      contentType: document.contentType ?? '',
      status: document.status ?? 200,
      depth: document.depth ?? 0,
      byteSize: document.byteSize ?? 0,
      etag: document.etag ?? '',
      lastModified: document.lastModified ?? '',
    };
    this.docStore.append(docId, stored);
    this.urlMap.set(url, docId);
    this.docLengths.set(docId, lengths);
    this.dirty = true;
    this.allDocsCache = null;
    this.surfaceIndex = null;
    this.spellChecker = null;

    if (this.memDocCount >= this.options.flushThreshold) this.flushMemtable();
    return docId;
  }

  hasUrl(url: string): boolean {
    const canonical = canonicalizeUrl(url);
    return canonical !== null && this.urlMap.has(canonical);
  }

  docIdForUrl(url: string): number | null {
    const canonical = canonicalizeUrl(url);
    if (!canonical) return null;
    return this.urlMap.get(canonical) ?? null;
  }

  storedDocument(url: string): StoredDocument | null {
    const docId = this.docIdForUrl(url);
    return docId === null ? null : this.docStore.get(docId);
  }

  deleteUrl(url: string): boolean {
    const canonical = canonicalizeUrl(url);
    if (!canonical) return false;
    const docId = this.urlMap.get(canonical);
    if (docId === undefined) return false;
    this.urlMap.delete(canonical);
    this.tombstone(docId);
    this.dirty = true;
    return true;
  }

  private tombstone(docId: number): void {
    this.tombstones.add(docId);
    this.docLengths.delete(docId);
    this.allDocsCache = null;
  }

  private flushMemtable(): void {
    if (this.memDocCount === 0) return;
    const builder = new SegmentBuilder();
    for (const [term, docs] of this.memTerms) {
      for (const posting of docs.values()) {
        if (this.tombstones.has(posting.docId)) continue;
        builder.addPosting(term, posting.docId, posting.tfs, posting.positions);
      }
    }
    for (const [docId, lengths] of this.memLengths) {
      if (this.tombstones.has(docId)) continue;
      builder.setLengths(docId, lengths);
    }

    if (!builder.isEmpty) {
      const id = this.manifest.nextSegmentId++;
      const path = join(this.segmentsDir, `seg-${id}.seg`);
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, builder.serialize());
      renameSync(tmp, path);
      const reader = SegmentReader.open(path);
      this.segments.push(reader);
      this.manifest.segments.push({
        id,
        docs: reader.docCount,
        terms: reader.termCount,
        size: reader.fileSize,
      });
    }

    this.memTerms = new Map();
    this.memLengths = new Map();
    this.memDocCount = 0;
    this.spellChecker = null;
    this.surfaceIndex = null;
    this.dirty = true;
  }

  commit(): void {
    this.flushMemtable();
    this.docStore.flush();
    this.recomputeStats();
    this.manifest.tombstones = [...this.tombstones];
    this.manifest.updatedAt = Date.now();
    writeJsonAtomic(join(this.dir, 'urls.json'), [...this.urlMap.entries()]);
    writeJsonAtomic(
      join(this.dir, 'surfaces.json'),
      [...this.surfaces.entries()].map(([stem, value]) => [stem, value.surface]),
    );
    writeJsonAtomic(join(this.dir, 'manifest.json'), this.manifest);
    this.dirty = false;
  }

  get hasPendingChanges(): boolean {
    return this.dirty;
  }

  /** Merges segments and rewrites the document log without tombstones. */
  optimize(): { mergedSegments: number; vacuumedDocuments: number } {
    this.flushMemtable();
    const mergedSegments = this.mergeSegments();
    const vacuumedDocuments = this.docStore.vacuum((docId) => !this.tombstones.has(docId));
    this.tombstones.clear();
    this.recomputeStats();
    this.updateLinkGraph();
    this.commit();
    return { mergedSegments, vacuumedDocuments };
  }

  private mergeSegments(): number {
    if (this.segments.length < 2) return 0;
    const segments = this.segments;
    const builder = new SegmentBuilder();
    const cursors = segments.map(() => 0);

    for (;;) {
      let smallest: string | null = null;
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]!;
        const cursor = cursors[i]!;
        if (cursor >= segment.termCount) continue;
        const term = segment.termAt(cursor);
        if (smallest === null || term < smallest) smallest = term;
      }
      if (smallest === null) break;

      const lists: PostingList[] = [];
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]!;
        const cursor = cursors[i]!;
        if (cursor >= segment.termCount || segment.termAt(cursor) !== smallest) continue;
        const list = segment.readTerm(smallest);
        if (list) lists.push(list);
        cursors[i] = cursor + 1;
      }
      if (lists.length === 0) continue;

      let docIndexes = new Array<number>(lists.length).fill(0);
      for (;;) {
        let minDoc = Number.POSITIVE_INFINITY;
        for (let i = 0; i < lists.length; i++) {
          const index = docIndexes[i]!;
          if (index < lists[i]!.docIds.length) minDoc = Math.min(minDoc, lists[i]!.docIds[index]!);
        }
        if (!Number.isFinite(minDoc)) break;
        const tfs = emptyLengths();
        const positions: number[][] = [[], [], [], []];
        for (let i = 0; i < lists.length; i++) {
          const list = lists[i]!;
          const index = docIndexes[i]!;
          if (index >= list.docIds.length || list.docIds[index] !== minDoc) continue;
          for (let field = 0; field < FIELD_COUNT; field++) {
            tfs[field] = tfs[field]! + (list.tfs[index * FIELD_COUNT + field] ?? 0);
          }
          for (let field = 0; field < POSITIONED_FIELDS; field++) {
            const offsets = list.posOffsets[field]!;
            const data = list.posData[field]!;
            for (let p = offsets[index]!; p < offsets[index + 1]!; p++) {
              positions[field]!.push(data[p]!);
            }
          }
          docIndexes[i] = index + 1;
        }
        if (this.tombstones.has(minDoc)) continue;
        builder.addPosting(smallest, minDoc, tfs, positions);
      }
    }

    for (const segment of segments) {
      for (const [docId, lengths] of segment.lengths) {
        if (this.tombstones.has(docId)) continue;
        builder.setLengths(docId, lengths);
      }
    }

    const id = this.manifest.nextSegmentId++;
    const path = join(this.segmentsDir, `seg-${id}.seg`);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, builder.serialize());
    renameSync(tmp, path);
    const reader = SegmentReader.open(path);
    for (const info of this.manifest.segments) {
      try {
        unlinkSync(join(this.segmentsDir, `seg-${info.id}.seg`));
      } catch {
        // Already gone.
      }
    }
    this.manifest.segments = [{ id, docs: reader.docCount, terms: reader.termCount, size: reader.fileSize }];
    this.segments = [reader];
    this.spellChecker = null;
    this.dirty = true;
    return segments.length;
  }

  /** Recomputes host-level PageRank from the stored outlinks. */
  updateLinkGraph(): void {
    const ids = [...this.docLengths.keys()];
    const hostIndex = new Map<string, number>();
    const hosts: string[] = [];
    const edges: Array<Set<number>> = [];

    const hostId = (host: string): number => {
      let index = hostIndex.get(host);
      if (index === undefined) {
        index = hosts.length;
        hostIndex.set(host, index);
        hosts.push(host);
        edges.push(new Set());
      }
      return index;
    };

    for (const docId of ids) {
      const doc = this.docStore.get(docId);
      if (!doc || !doc.host) continue;
      const from = hostId(doc.host);
      for (const link of doc.outlinks) {
        const host = hostOf(link);
        if (!host || host === doc.host) continue;
        edges[from]!.add(hostId(host));
      }
    }

    const count = hosts.length;
    if (count === 0) {
      this.linkRank.clear();
      writeJsonAtomic(join(this.dir, 'linkgraph.json'), {});
      return;
    }
    const damping = 0.85;
    let ranks = new Float64Array(count).fill(1 / count);
    const outDegree = edges.map((set) => set.size);
    for (let iteration = 0; iteration < 20; iteration++) {
      const next = new Float64Array(count).fill((1 - damping) / count);
      for (let from = 0; from < count; from++) {
        const degree = outDegree[from]!;
        if (degree === 0) continue;
        const share = (damping * ranks[from]!) / degree;
        for (const to of edges[from]!) next[to]! += share;
      }
      ranks = next;
    }
    let max = 0;
    for (let i = 0; i < count; i++) max = Math.max(max, ranks[i]!);
    const output: Record<string, number> = {};
    this.linkRank.clear();
    for (let i = 0; i < count; i++) {
      const normalized = max > 0 ? ranks[i]! / max : 0;
      output[hosts[i]!] = Number(normalized.toFixed(5));
      this.linkRank.set(hosts[i]!, normalized);
    }
    writeJsonAtomic(join(this.dir, 'linkgraph.json'), output);
  }

  // ---------------------------------------------------------------- querying

  search(query: string, options: SearchOptions = {}): SearchResponse {
    const started = performance.now();
    const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
    const offset = Math.max(0, options.offset ?? 0);
    const parsed = parseQuery(query);
    const response: SearchResponse = {
      query,
      total: 0,
      totalRelation: 'eq',
      tookMs: 0,
      results: [],
      relaxed: false,
      suggestion: null,
      terms: parsed.terms,
    };
    const hasFilters =
      parsed.filters.sites.length > 0 ||
      parsed.filters.hosts.length > 0 ||
      parsed.filters.filetypes.length > 0 ||
      parsed.filters.langs.length > 0;

    if (!parsed.ast) {
      if (hasFilters) {
        // A filter-only query ("site:example.com") lists matching pages by date.
        const hits: Hit[] = [];
        for (const docId of this.allDocIds()) {
          const doc = this.docStore.get(docId);
          if (doc && matchesFilters(doc, parsed.filters)) hits.push({ docId, score: 0 });
          if (hits.length >= (offset + limit) * 8) break;
        }
        const filtered = this.collectResults(hits, parsed.filters, [], options);
        response.results = filtered.slice(offset, offset + limit);
        response.total = filtered.length;
        response.totalRelation = 'gte';
      }
      response.tookMs = performance.now() - started;
      return response;
    }

    const candidateLimit = Math.min(500, (offset + limit) * 4 + 32);
    const context = this.createContext();
    const executed = executeQuery(parsed.ast, context, {
      limit: candidateLimit,
      config: options.scoring ?? this.scoring,
      relax: !options.strict && !parsed.explicit,
    });

    const filtered = this.collectResults(executed.hits, parsed.filters, parsed.terms, options);
    response.results = filtered.slice(offset, offset + limit);
    response.total = hasFilters ? filtered.length : executed.total;
    response.totalRelation = hasFilters ? 'gte' : executed.totalRelation;
    response.relaxed = executed.relaxed;

    if (executed.hits.length === 0) {
      const correction = this.correctQuery(parsed.terms);
      if (correction && correction !== query.trim()) {
        response.suggestion = correction;
        const retried = this.search(correction, { ...options, limit, offset });
        if (retried.results.length > 0) {
          response.results = retried.results;
          response.total = retried.total;
          response.totalRelation = retried.totalRelation;
          response.relaxed = retried.relaxed;
        }
      }
    }

    response.tookMs = performance.now() - started;
    return response;
  }

  private collectResults(
    hits: Hit[],
    filters: QueryFilters,
    terms: string[],
    options: SearchOptions,
  ): SearchResult[] {
    const scored: Array<{ result: SearchResult; rank: number }> = [];
    for (const hit of hits) {
      if (this.tombstones.has(hit.docId)) continue;
      const doc = this.docStore.get(hit.docId);
      if (!doc) continue;
      if (!matchesFilters(doc, filters)) continue;
      const rank = this.linkRank.get(doc.host) ?? 0;
      const multiplier = qualityMultiplier({
        hostRank: rank,
        ageDays: Math.max(0, (Date.now() - doc.fetchedAt) / 86_400_000),
        titleLength: doc.title.length,
        textLength: doc.text.length,
        outlinks: doc.outlinks.length,
        maxTitleTermFrequency: maxTermFrequency(doc.title, terms),
      });
      const result: SearchResult = {
        url: doc.url,
        title: doc.title || doc.url,
        description: doc.description,
        snippet:
          doc.description && containsAnyTerm(doc.description, terms)
            ? buildSnippet(doc.description, terms, 240)
            : buildSnippet(doc.text, terms),
        site: doc.site,
        host: doc.host,
        lang: doc.lang,
        fetchedAt: doc.fetchedAt,
        score: Number((hit.score * multiplier).toFixed(6)),
        matchedTerms: terms,
      };
      scored.push({ result, rank: result.score });
    }
    if (options.sort === 'date') {
      scored.sort((a, b) => b.result.fetchedAt - a.result.fetchedAt);
    } else {
      scored.sort((a, b) => b.rank - a.rank || a.result.url.localeCompare(b.result.url));
    }
    return scored.map((entry) => entry.result);
  }

  private createContext(): SearchContext {
    const termCache = new Map<string, TermPostings | null>();
    const stats: CorpusStats = {
      totalDocs: this.documentCount,
      avgLengths: this.averageLengths,
    };
    return {
      totalDocs: stats.totalDocs,
      stats,
      term: (term) => {
        if (termCache.has(term)) return termCache.get(term) ?? null;
        const list = this.termPostings(term);
        termCache.set(term, list);
        return list;
      },
      lengths: (docId) => this.docLengths.get(docId) ?? null,
      isDeleted: (docId) => this.tombstones.has(docId),
      allDocIds: () => this.allDocIds(),
    };
  }

  private allDocIds(): Uint32Array {
    if (this.allDocsCache) return this.allDocsCache;
    const ids = [...this.docLengths.keys()].filter((docId) => !this.tombstones.has(docId));
    this.allDocsCache = Uint32Array.from(ids.sort((a, b) => a - b));
    return this.allDocsCache;
  }

  private termPostings(term: string): TermPostings | null {
    const lists: PostingList[] = [];
    for (const segment of this.segments) {
      const list = segment.readTerm(term);
      if (list) lists.push(list);
    }
    const memory = this.memTerms.get(term);
    if (lists.length === 0 && !memory) return null;
    if (lists.length === 1 && !memory) return lists[0]!;
    if (lists.length === 0 && memory) return memoryPostings(memory);
    return mergePostingLists(lists, memory);
  }

  private correctQuery(terms: string[]): string | null {
    if (terms.length === 0) return null;
    const checker = this.getSpellChecker();
    for (const term of terms) {
      const suggestion = checker.suggest(term);
      if (suggestion) return suggestion;
    }
    return null;
  }

  private getSpellChecker(): SpellChecker {
    this.spellChecker ??= new SpellChecker([this.surfaceLexicon()]);
    return this.spellChecker;
  }

  /**
   * Sorted list of display words. The index stores stems, so suggestions are
   * resolved back to the most frequent surface form ("privacy", not "privaci").
   */
  private getSurfaceIndex(): Array<{ folded: string; surface: string }> {
    if (this.surfaceIndex) return this.surfaceIndex;
    const entries: Array<{ folded: string; surface: string }> = [];
    const seen = new Set<string>();
    const addTerm = (term: string): void => {
      const surface = this.surfaces.get(term)?.surface ?? term;
      const folded = foldText(surface);
      if (folded && !seen.has(folded)) {
        seen.add(folded);
        entries.push({ folded, surface });
      }
    };
    for (const segment of this.segments) segment.forEachTerm(addTerm);
    for (const term of this.memTerms.keys()) addTerm(term);
    entries.sort((a, b) => a.folded.localeCompare(b.folded));
    this.surfaceIndex = entries;
    return entries;
  }

  private surfaceLexicon(): Lexicon {
    return {
      scanPrefix: (prefix, callback) => {
        const entries = this.getSurfaceIndex();
        let low = 0;
        let high = entries.length - 1;
        let start = entries.length;
        while (low <= high) {
          const mid = (low + high) >>> 1;
          if (entries[mid]!.folded >= prefix) {
            start = mid;
            high = mid - 1;
          } else {
            low = mid + 1;
          }
        }
        for (let i = start; i < entries.length; i++) {
          const entry = entries[i]!;
          if (!entry.folded.startsWith(prefix)) return;
          if (callback(entry.folded) === false) return;
        }
      },
    };
  }

  suggest(prefix: string, limit = 8): string[] {
    const normalized = foldText(prefix.trim());
    if (!normalized) return [];
    const tokens = tokenize(prefix.trim());
    const last = tokens[tokens.length - 1];
    const stemPrefix = last?.term ?? normalized;
    const entries = this.getSurfaceIndex();
    const results: string[] = [];
    const seen = new Set<string>();
    let low = 0;
    let high = entries.length - 1;
    let start = entries.length;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (entries[mid]!.folded >= stemPrefix) {
        start = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    for (let i = start; i < entries.length && results.length < limit; i++) {
      const entry = entries[i]!;
      if (!entry.folded.startsWith(stemPrefix)) break;
      if (seen.has(entry.surface)) continue;
      seen.add(entry.surface);
      results.push(entry.surface);
    }
    results.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return results.slice(0, limit);
  }

  stats(): IndexStats {
    let indexedTerms = 0;
    let segmentBytes = 0;
    for (const segment of this.segments) {
      indexedTerms += segment.termCount;
      segmentBytes += segment.fileSize;
    }
    return {
      documents: this.documentCount,
      segments: this.segments.length,
      indexedTerms,
      tombstones: this.tombstones.size,
      documentBytes: this.docStore.logSize,
      segmentBytes,
      averageLengths: [...this.averageLengths] as FieldLengths,
      updatedAt: this.manifest.updatedAt,
    };
  }

  /** Streams every live document; used by the crawler for the link graph. */
  forEachDocument(callback: (docId: number, doc: StoredDocument) => void): void {
    for (const docId of this.docLengths.keys()) {
      if (this.tombstones.has(docId)) continue;
      const doc = this.docStore.get(docId);
      if (doc) callback(docId, doc);
    }
  }

  close(): void {
    if (this.dirty) this.commit();
    this.docStore.close();
  }
}

interface FieldAnalysis {
  terms: string[];
  positions: Map<string, number[]>;
  surfaces: Map<string, Map<string, number>>;
}

function analyzeText(text: string): FieldAnalysis {
  const tokens = tokenize(text);
  const terms: string[] = [];
  const positions = new Map<string, number[]>();
  const surfaces = new Map<string, Map<string, number>>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    terms.push(token.term);
    const list = positions.get(token.term);
    if (list) list.push(i);
    else positions.set(token.term, [i]);
    const surface = token.raw.toLowerCase();
    if (surface !== token.term) {
      let counts = surfaces.get(token.term);
      if (!counts) {
        counts = new Map();
        surfaces.set(token.term, counts);
      }
      counts.set(surface, (counts.get(surface) ?? 0) + 1);
    }
  }
  return { terms, positions, surfaces };
}

function matchesFilters(doc: StoredDocument, filters: QueryFilters): boolean {
  if (filters.sites.length > 0) {
    const site = doc.site;
    const host = doc.host;
    const ok = filters.sites.some(
      (value) => site === value || host === value || host.endsWith(`.${value}`),
    );
    if (!ok) return false;
  }
  if (filters.hosts.length > 0 && !filters.hosts.includes(doc.host)) return false;
  if (filters.filetypes.length > 0) {
    const path = doc.url.split(/[?#]/)[0] ?? '';
    const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
    if (!filters.filetypes.includes(extension)) return false;
  }
  if (filters.langs.length > 0) {
    const lang = doc.lang.toLowerCase();
    if (!filters.langs.some((value) => lang.startsWith(value))) return false;
  }
  return true;
}

function containsAnyTerm(text: string, terms: string[]): boolean {
  if (!text || terms.length === 0) return false;
  const wanted = new Set(terms);
  for (const token of tokenize(text)) {
    if (wanted.has(token.term)) return true;
  }
  return false;
}

function maxTermFrequency(text: string, terms: string[]): number {
  if (!text || terms.length === 0) return 0;
  const wanted = new Set(terms);
  const counts = new Map<string, number>();
  let max = 0;
  for (const token of tokenize(text)) {
    if (!wanted.has(token.term)) continue;
    const count = (counts.get(token.term) ?? 0) + 1;
    counts.set(token.term, count);
    if (count > max) max = count;
  }
  return max;
}

function memoryPostings(memory: Map<number, MemPosting>): TermPostings {
  const docs = [...memory.values()].sort((a, b) => a.docId - b.docId);
  const docIds = new Uint32Array(docs.length);
  const tfs = new Uint16Array(docs.length * FIELD_COUNT);
  const posOffsets: Uint32Array[] = [];
  const posData: Int32Array[] = [];
  for (let field = 0; field < POSITIONED_FIELDS; field++) {
    const offsets = new Uint32Array(docs.length + 1);
    let total = 0;
    for (let i = 0; i < docs.length; i++) {
      offsets[i] = total;
      total += docs[i]!.positions[field]!.length;
    }
    offsets[docs.length] = total;
    const data = new Int32Array(total);
    let cursor = 0;
    for (const doc of docs) {
      for (const position of doc.positions[field]!) data[cursor++] = position;
    }
    posOffsets.push(offsets);
    posData.push(data);
  }
  for (let i = 0; i < docs.length; i++) {
    docIds[i] = docs[i]!.docId;
    for (let field = 0; field < FIELD_COUNT; field++) {
      tfs[i * FIELD_COUNT + field] = Math.min(docs[i]!.tfs[field] ?? 0, 0xffff);
    }
  }
  return { docIds, tfs, posOffsets, posData };
}

function mergePostingLists(
  lists: PostingList[],
  memory: Map<number, MemPosting> | undefined,
): TermPostings {
  const all: PostingList[] = memory ? [...lists, memoryPostings(memory)] : lists;
  const cursors = new Array<number>(all.length).fill(0);
  const mergedDocIds: number[] = [];
  const mergedTfs: number[] = [];
  const mergedPositions: number[][][] = [[], [], [], []];

  for (;;) {
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < all.length; i++) {
      const list = all[i]!;
      const cursor = cursors[i]!;
      if (cursor < list.docIds.length) min = Math.min(min, list.docIds[cursor]!);
    }
    if (!Number.isFinite(min)) break;
    const tfs = emptyLengths();
    const positions: number[][] = [[], [], [], []];
    for (let i = 0; i < all.length; i++) {
      const list = all[i]!;
      let cursor = cursors[i]!;
      if (cursor >= list.docIds.length || list.docIds[cursor] !== min) continue;
      for (let field = 0; field < FIELD_COUNT; field++) {
        tfs[field] = tfs[field]! + (list.tfs[cursor * FIELD_COUNT + field] ?? 0);
      }
      for (let field = 0; field < POSITIONED_FIELDS; field++) {
        const offsets = list.posOffsets[field]!;
        const data = list.posData[field]!;
        for (let p = offsets[cursor]!; p < offsets[cursor + 1]!; p++) positions[field]!.push(data[p]!);
      }
      cursors[i] = cursor + 1;
    }
    mergedDocIds.push(min);
    for (let field = 0; field < FIELD_COUNT; field++) mergedTfs.push(tfs[field]!);
    for (let field = 0; field < POSITIONED_FIELDS; field++) mergedPositions[field]!.push(positions[field]!);
  }

  const docCount = mergedDocIds.length;
  const docIds = Uint32Array.from(mergedDocIds);
  const tfs = Uint16Array.from(mergedTfs.map((value) => Math.min(value, 0xffff)));
  const posOffsets: Uint32Array[] = [];
  const posData: Int32Array[] = [];
  for (let field = 0; field < POSITIONED_FIELDS; field++) {
    const offsets = new Uint32Array(docCount + 1);
    let total = 0;
    for (let i = 0; i < docCount; i++) {
      offsets[i] = total;
      total += mergedPositions[field]![i]!.length;
    }
    offsets[docCount] = total;
    const data = new Int32Array(total);
    let cursor = 0;
    for (let i = 0; i < docCount; i++) {
      for (const position of mergedPositions[field]![i]!) data[cursor++] = position;
    }
    posOffsets.push(offsets);
    posData.push(data);
  }
  return { docIds, tfs, posOffsets, posData };
}
