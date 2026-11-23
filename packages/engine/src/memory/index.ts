import {
  analyzeText,
  containsAnyTerm,
  maxTermFrequency,
  urlTokens,
} from '../core/analysis.js';
import {
  FIELD_COUNT,
  POSITIONED_FIELDS,
  emptyLengths,
  type FieldLengths,
} from '../core/fields.js';
import { foldText } from '../core/tokenizer.js';
import {
  executeQuery,
  type Hit,
  type SearchContext,
  type TermPostings,
} from '../query/executor.js';
import { matchesFilters } from '../query/filters.js';
import { parseQuery, type QueryFilters } from '../query/parser.js';
import {
  DEFAULT_SCORING,
  qualityMultiplier,
  type CorpusStats,
  type ScoringConfig,
} from '../query/scoring.js';
import { buildSnippet } from '../query/snippet.js';
import { SpellChecker, prefixSuggestions, type Lexicon } from '../query/suggest.js';
import type {
  IndexDocument,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from '../index/index.js';

/**
 * In-memory index.
 *
 * Same analysis, scoring and query execution as the on-disk index, minus the
 * segments: the corpus is loaded once, postings are built in memory and the
 * index is read-only afterwards. It exists so the engine can run where there is
 * no file system; the web edition uses it to rank a bundled corpus in the
 * browser.
 */

export interface MemoryDocument extends IndexDocument {
  /** Registrable domain; derived from the host when missing. */
  site?: string;
  host?: string;
}

interface Posting {
  tfs: FieldLengths;
  /** Token positions per positioned field (title, heading, body, url). */
  positions: number[][];
}

interface StoredMemoryDocument {
  url: string;
  title: string;
  description: string;
  text: string;
  headings: string[];
  lang: string;
  host: string;
  site: string;
  fetchedAt: number;
}

function hostOfUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export class MemoryIndex {
  private readonly documents: StoredMemoryDocument[] = [];
  private readonly lengths: FieldLengths[] = [];
  private readonly postings = new Map<string, Map<number, Posting>>();
  private readonly surfaces = new Map<string, { surface: string; count: number }>();
  private averageLengths: FieldLengths = [1, 1, 1, 1, 1];
  private readonly buffers = new Map<string, TermPostings | null>();
  private surfaceIndex: Array<{ folded: string; surface: string }> | null = null;
  private spellChecker: SpellChecker | null = null;
  private readonly scoring: ScoringConfig;

  constructor(documents: MemoryDocument[], options: { scoring?: ScoringConfig } = {}) {
    this.scoring = options.scoring ?? DEFAULT_SCORING;
    for (const document of documents) this.add(document);
  }

  get size(): number {
    return this.documents.length;
  }

  stats(): { documents: number; terms: number; averageLengths: FieldLengths } {
    return {
      documents: this.documents.length,
      terms: this.postings.size,
      averageLengths: [...this.averageLengths] as FieldLengths,
    };
  }

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
        const hits: Hit[] = [];
        for (let docId = 0; docId < this.documents.length; docId++) {
          const doc = this.documents[docId]!;
          if (matchesFilters(doc, parsed.filters)) hits.push({ docId, score: 0 });
        }
        const filtered = this.collect(hits, parsed.filters, [], options);
        response.results = filtered.slice(offset, offset + limit);
        response.total = filtered.length;
        response.totalRelation = 'gte';
      }
      response.tookMs = performance.now() - started;
      return response;
    }

    const candidateLimit = Math.min(500, (offset + limit) * 4 + 32);
    const executed = executeQuery(parsed.ast, this.context(), {
      limit: candidateLimit,
      config: options.scoring ?? this.scoring,
      relax: !options.strict && !parsed.explicit,
    });

    const filtered = this.collect(executed.hits, parsed.filters, parsed.terms, options);
    response.results = filtered.slice(offset, offset + limit);
    response.total = hasFilters ? filtered.length : executed.total;
    response.totalRelation = hasFilters ? 'gte' : executed.totalRelation;
    response.relaxed = executed.relaxed;

    if (executed.hits.length === 0) {
      const correction = this.correction(parsed.terms);
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

  /** Prefix completions over the indexed vocabulary, cheapest words first. */
  suggest(prefix: string, limit = 8): string[] {
    return prefixSuggestions([this.lexicon()], prefix, { limit });
  }

  private add(input: MemoryDocument): void {
    const url = input.url;
    const host = input.host ?? hostOfUrl(url);
    const title = (input.title ?? '').slice(0, 500);
    const body = (input.body ?? '').slice(0, 60_000);
    const description = (input.description ?? '').slice(0, 2_000);
    const headings = (input.headings ?? []).slice(0, 64);
    const meta = `${description}\n${input.lang ?? ''}`;
    const docId = this.documents.length;

    const fieldTexts = [title, headings.join('\n'), body, urlTokens(url), meta];
    const lengths = emptyLengths();
    const byTerm = new Map<string, Posting>();
    for (let field = 0; field < FIELD_COUNT; field++) {
      const analysis = analyzeText(fieldTexts[field]!);
      lengths[field] = analysis.terms.length;
      for (const [term, positions] of analysis.positions) {
        let posting = byTerm.get(term);
        if (!posting) {
          posting = { tfs: emptyLengths(), positions: [[], [], [], []] };
          byTerm.set(term, posting);
        }
        posting.tfs[field] = positions.length;
        if (field < POSITIONED_FIELDS) posting.positions[field] = positions;
      }
      for (const [stem, forms] of analysis.surfaces) {
        for (const [surface, count] of forms) {
          const known = this.surfaces.get(stem);
          if (!known || count > known.count) this.surfaces.set(stem, { surface, count });
        }
      }
    }

    for (const [term, posting] of byTerm) {
      let docs = this.postings.get(term);
      if (!docs) {
        docs = new Map();
        this.postings.set(term, docs);
      }
      docs.set(docId, posting);
    }

    this.documents.push({
      url,
      title,
      description,
      text: body,
      headings,
      lang: input.lang ?? '',
      host,
      site: input.site ?? host,
      fetchedAt: input.fetchedAt ?? Date.now(),
    });
    this.lengths.push(lengths);
    this.buffers.clear();
    this.surfaceIndex = null;
    this.spellChecker = null;
    this.updateAverageLengths();
  }

  private updateAverageLengths(): void {
    const totals = emptyLengths();
    for (const lengths of this.lengths) {
      for (let field = 0; field < FIELD_COUNT; field++) totals[field]! += lengths[field]!;
    }
    const count = Math.max(1, this.lengths.length);
    this.averageLengths = totals.map((total) => Math.max(1, total / count)) as FieldLengths;
  }

  private context(): SearchContext {
    const stats: CorpusStats = {
      totalDocs: this.documents.length,
      avgLengths: this.averageLengths,
    };
    return {
      totalDocs: stats.totalDocs,
      stats,
      term: (term) => this.bufferFor(term),
      lengths: (docId) => this.lengths[docId] ?? null,
      isDeleted: () => false,
      allDocIds: () => Uint32Array.from(this.documents.keys()),
    };
  }

  private bufferFor(term: string): TermPostings | null {
    const cached = this.buffers.get(term);
    if (cached !== undefined) return cached;
    const postings = this.postings.get(term);
    if (!postings) {
      this.buffers.set(term, null);
      return null;
    }
    const docs = [...postings.entries()].sort((a, b) => a[0] - b[0]);
    const docIds = new Uint32Array(docs.length);
    const tfs = new Uint16Array(docs.length * FIELD_COUNT);
    const posOffsets: Uint32Array[] = [];
    const posData: Int32Array[] = [];
    for (let field = 0; field < POSITIONED_FIELDS; field++) {
      const offsets = new Uint32Array(docs.length + 1);
      let total = 0;
      for (let i = 0; i < docs.length; i++) {
        offsets[i] = total;
        total += docs[i]![1].positions[field]!.length;
      }
      offsets[docs.length] = total;
      const data = new Int32Array(total);
      let cursor = 0;
      for (const [, posting] of docs) {
        for (const position of posting.positions[field]!) data[cursor++] = position;
      }
      posOffsets.push(offsets);
      posData.push(data);
    }
    for (let i = 0; i < docs.length; i++) {
      docIds[i] = docs[i]![0];
      for (let field = 0; field < FIELD_COUNT; field++) {
        tfs[i * FIELD_COUNT + field] = Math.min(docs[i]![1].tfs[field]!, 0xffff);
      }
    }
    const buffer: TermPostings = { docIds, tfs, posOffsets, posData };
    this.buffers.set(term, buffer);
    return buffer;
  }

  private collect(
    hits: Hit[],
    filters: QueryFilters,
    terms: string[],
    options: SearchOptions,
  ): SearchResult[] {
    const scored: Array<{ result: SearchResult; rank: number }> = [];
    for (const hit of hits) {
      const doc = this.documents[hit.docId];
      if (!doc) continue;
      if (!matchesFilters(doc, filters)) continue;
      const multiplier = qualityMultiplier({
        hostRank: 0,
        ageDays: Math.max(0, (Date.now() - doc.fetchedAt) / 86_400_000),
        titleLength: doc.title.length,
        textLength: doc.text.length,
        outlinks: 0,
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

  private correction(terms: string[]): string | null {
    if (terms.length === 0) return null;
    this.spellChecker ??= new SpellChecker([this.lexicon()]);
    for (const term of terms) {
      const suggestion = this.spellChecker.suggest(term);
      if (suggestion) return suggestion;
    }
    return null;
  }

  private lexicon(): Lexicon {
    return {
      scanPrefix: (prefix, callback) => {
        const entries = this.surfaceEntries();
        let low = 0;
        let high = entries.length - 1;
        let start = entries.length;
        while (low <= high) {
          const mid = (low + high) >>> 1;
          if (entries[mid]!.folded < prefix) low = mid + 1;
          else {
            start = mid;
            high = mid - 1;
          }
        }
        for (let i = start; i < entries.length; i++) {
          const entry = entries[i]!;
          if (!entry.folded.startsWith(prefix)) break;
          if (callback(entry.surface) === false) break;
        }
      },
    };
  }

  private surfaceEntries(): Array<{ folded: string; surface: string }> {
    if (this.surfaceIndex) return this.surfaceIndex;
    const entries: Array<{ folded: string; surface: string }> = [];
    const seen = new Set<string>();
    for (const term of this.postings.keys()) {
      const surface = this.surfaces.get(term)?.surface ?? term;
      const folded = foldText(surface);
      if (!folded || seen.has(folded)) continue;
      seen.add(folded);
      entries.push({ folded, surface });
    }
    entries.sort((a, b) => a.folded.localeCompare(b.folded));
    this.surfaceIndex = entries;
    return entries;
  }
}
