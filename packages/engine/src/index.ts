export { SearchIndex } from './index/index.js';
export type {
  IndexDocument,
  IndexOptions,
  IndexStats,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from './index/index.js';
export { DocStore } from './index/docstore.js';
export type { StoredDocument } from './index/docstore.js';
export { SegmentBuilder, SegmentReader } from './index/segment.js';
export type { FieldLengths, PostingList } from './index/segment.js';

export { Crawler, DEFAULT_USER_AGENT } from './crawl/crawler.js';
export type { CrawlEvent, CrawlOptions, CrawlStats } from './crawl/crawler.js';
export { CrawlService } from './crawl/service.js';
export { Frontier } from './crawl/frontier.js';
export type { FrontierEntry } from './crawl/frontier.js';
export { fetchResource, FetchError } from './crawl/fetcher.js';
export type { FetchOptions, FetchResult } from './crawl/fetcher.js';
export { parseSitemapXml, loadSitemap } from './crawl/sitemap.js';
export type { SitemapDocument, SitemapUrl } from './crawl/sitemap.js';

export { startSearchServer } from './server/http.js';
export type { SearchServerHandle, SearchServerOptions } from './server/http.js';

export {
  INDEXNOW_ENDPOINT,
  INDEXNOW_MAX_URLS,
  IndexNowClient,
  IndexNowVerifier,
  buildKeyLocation,
  generateKey,
  validatePayload,
  verifyKeyFile,
} from './indexnow.js';
export type {
  IndexNowPayload,
  IndexNowSubmitResult,
  KeyVerification,
  ValidationResult,
} from './indexnow.js';

export { parseQuery } from './query/parser.js';
export type { ParsedQuery, QueryFilters, QueryNode } from './query/parser.js';
export { DEFAULT_SCORING, bm25f, inverseDocumentFrequency } from './query/scoring.js';
export type { CorpusStats, ScoringConfig } from './query/scoring.js';
export { executeQuery } from './query/executor.js';
export type { ExecuteOptions, ExecuteResult, Hit, SearchContext, TermPostings } from './query/executor.js';
export { SpellChecker, editDistance, prefixSuggestions } from './query/suggest.js';
export { buildSnippet, escapeHtml } from './query/snippet.js';

export { tokenize, termFor, foldText, positionedTerms } from './core/tokenizer.js';
export type { Token, TokenizeOptions } from './core/tokenizer.js';
export { canonicalizeUrl, looksLikeUrl, normalizeUserUrl, displayUrl } from './core/url.js';
export { extractHtml, decodeEntities, stripTags } from './core/html.js';
export type { ExtractedLink, ExtractedPage } from './core/html.js';
export { RobotsTxt } from './core/robots.js';
export { getPublicSuffix, getRegistrableDomain, sameSite } from './core/psl.js';
export { simhash, hammingDistance, isNearDuplicate } from './core/simhash.js';
export { detectCharset, decodeHtml } from './core/encoding.js';
