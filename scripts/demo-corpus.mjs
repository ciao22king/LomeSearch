#!/usr/bin/env node
/**
 * Builds the corpus used by the web edition (site/web).
 *
 * Every document is a Wikipedia extract, stored with its canonical URL so the
 * demo keeps the attribution the licence requires. Nothing else is scraped and
 * nothing is rewritten: the text is trimmed at a sentence boundary and the
 * first sentence doubles as the description.
 *
 *   node scripts/demo-corpus.mjs [--out site/web/data/corpus.json]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const USER_AGENT = 'LomeSearchDemo/1.0 (https://github.com/ciao22king/LomeSearch)';
const CHARS = 2800;

const TOPICS = {
  en: [
    'Web browser', 'Search engine', 'Search engine indexing', 'Web search engine',
    'Inverted index', 'Okapi BM25', 'Tf–idf', 'Stop word', 'Stemming', 'Porter stemmer',
    'Crawler', 'Robots.txt', 'Sitemaps', 'Search engine optimization', 'IndexNow',
    'OpenSearch', 'Hypertext Transfer Protocol', 'HTTP cookie', 'Transport Layer Security',
    'HTTPS', 'Domain Name System', 'DNS over HTTPS', 'WebRTC', 'Same-origin policy',
    'Cross-origin resource sharing', 'Content Security Policy', 'HTTP Strict Transport Security',
    'Referer', 'Do Not Track', 'Global Privacy Control', 'Device fingerprint', 'Canvas fingerprinting',
    'Ad blocking', 'Tracker blocking', 'Privacy sandbox', 'Third-party cookie', 'Web tracking',
    'Tor (network)', 'DuckDuckGo', 'Brave (browser)', 'Firefox', 'Chromium (web browser)',
    'Chromium', 'Electron (software framework)', 'V8 (JavaScript engine)', 'Blink (browser engine)',
    'WebExtensions', 'Google Chrome', 'Microsoft Edge', 'Safari (web browser)', 'Opera (web browser)',
    'Mozilla', 'World Wide Web', 'HTML', 'Cascading Style Sheets', 'JavaScript', 'WebAssembly',
    'Progressive web app', 'Service worker', 'Local storage', 'IndexedDB', 'WebSocket',
    'Virtual private network', 'Encryption', 'Public-key cryptography', 'Diffie–Hellman key exchange',
    'Advanced Encryption Standard', 'SHA-2', 'Digital signature', 'Certificate authority',
    'General Data Protection Regulation', 'Privacy by design', 'Data minimization', 'Right to be forgotten',
    'European Data Protection Board', 'ePrivacy Regulation', 'Privacy', 'Anonymity', 'Internet privacy',
    'Surveillance', 'Adware', 'Malware', 'Phishing', 'Cross-site scripting', 'SQL injection',
    'Denial-of-service attack', 'Computer security', 'Open-source software', 'Apache License',
    'SQLite', 'Node.js', 'TypeScript', 'Gzip', 'Unicode', 'UTF-8',
  ],
  it: [
    'Browser', 'Motore di ricerca', 'Indicizzazione (motori di ricerca)', 'Indice inverso',
    'Protocollo HTTP', 'Cookie', 'Sicurezza informatica', 'Crittografia', 'Firma digitale',
    'Navigazione in incognito', 'Pubblicità online', 'Tracciamento web', 'Fingerprint del dispositivo',
    'Tor (rete)', 'Elaborazione in locale', 'Software libero', 'Licenza Apache', 'Privacy',
    'Riservatezza', 'Identità digitale', 'Base di dati', 'Foglio di stile', 'HTML',
    'JavaScript', 'Motore di rendering', 'Applicazione web', 'Rete privata virtuale',
    'Trasporto Layer di Sicurezza', 'HTTPS', 'Domain Name System', 'Regolamento generale sulla protezione dei dati',
    'Garante per la protezione dei dati personali', 'Consenso (diritto)', 'Dato personale',
    'Armazenamento locale', 'Prestazioni (informatica)', 'Compressione dei dati', 'Unicode',
    'Ricerca full-text', 'Algoritmo', 'Heap (informatica)', 'Programmazione concorrente',
    'Test automatizzato', 'Integrazione continua', 'Distribuzione software', 'Gestore di pacchetti',
    'Sistema di finestre', 'Scheda (informatica)', 'Interfaccia grafica', 'Usabilità',
    'Accessibilità web', 'Foglio elettronico', 'Formato aperto', 'Software proprietario',
    'Open source', 'Copia di backup', 'Cache (informatica)', 'Cache web', 'Snippet',
    'Markov chain', 'Probabilità', 'Statistica', 'Analisi lessicale',
  ],
};

async function fetchExtract(lang, title) {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'extracts',
    explaintext: '1',
    exsectionformat: 'plain',
    exchars: String(CHARS),
    redirects: '1',
    titles: title,
  }).toString();
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${title}: HTTP ${response.status}`);
  const body = await response.json();
  const page = body.query?.pages?.[0];
  if (!page || page.missing) return null;
  const text = (page.extract ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < 220) return null;
  const canonical = page.title.replace(/ /g, '_');
  return {
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(canonical)}`,
    title: page.title,
    body: text,
    lang,
    site: 'wikipedia.org',
  };
}

function firstSentence(text) {
  const stop = text.search(/\.\s/);
  const sentence = stop === -1 ? text : text.slice(0, stop + 1);
  return sentence.length > 240 ? `${sentence.slice(0, 237)}…` : sentence;
}

function outPath() {
  const index = process.argv.indexOf('--out');
  return resolve(index === -1 ? 'site/web/data/corpus.json' : process.argv[index + 1]);
}

const documents = [];
const seen = new Set();
for (const [lang, titles] of Object.entries(TOPICS)) {
  for (const title of titles) {
    try {
      const doc = await fetchExtract(lang, title);
      if (!doc || seen.has(doc.url)) continue;
      seen.add(doc.url);
      documents.push({
        url: doc.url,
        title: doc.title,
        description: firstSentence(doc.body),
        body: doc.body,
        lang: doc.lang,
        site: doc.site,
        fetchedAt: Date.UTC(2026, 10, 20),
      });
      process.stdout.write('.');
    } catch (error) {
      process.stdout.write(`\n${title}: ${error.message}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  source: {
    name: 'Wikipedia',
    url: 'https://www.wikipedia.org',
    license: 'CC BY-SA 4.0',
    note: 'Each document links to the article it was taken from.',
  },
  documents,
};

const target = outPath();
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(payload)}\n`);
const bytes = JSON.stringify(payload).length;
console.log(`\n${documents.length} documents, ${(bytes / 1024).toFixed(0)} KiB -> ${target}`);
