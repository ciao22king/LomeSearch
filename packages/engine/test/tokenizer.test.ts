import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  foldText,
  findBestWindow,
  positionedTerms,
  termFor,
  tokenize,
} from '../src/core/tokenizer.js';
import { stem } from '../src/core/porter.js';

test('foldText removes case and diacritics', () => {
  assert.equal(foldText('Crème Brûlée'), 'creme brulee');
  assert.equal(foldText('ÄÖÜ ß'), 'aou ß');
});

test('tokenize keeps word offsets', () => {
  const tokens = tokenize('Hello, brave new world!');
  assert.deepEqual(
    tokens.map((token) => token.term),
    ['hello', 'brave', 'new', 'world'],
  );
  assert.equal(tokens[0]!.start, 0);
  assert.equal(tokens[3]!.start, 'Hello, brave new '.length);
});

test('tokenize drops single Latin letters but keeps CJK characters', () => {
  const latin = tokenize('a b c real words');
  assert.deepEqual(
    latin.map((token) => token.term),
    ['real', 'word'],
  );
  const cjk = tokenize('日本語');
  assert.equal(cjk.length, 1);
  assert.equal(cjk[0]!.term, '日本語');
});

test('tokenize handles apostrophes and accents', () => {
  assert.deepEqual(
    tokenize("l'éléphant d'Afrique").map((token) => token.term),
    ['eleph', 'afriqu'],
  );
  assert.deepEqual(
    tokenize("l'éléphant d'Afrique", { stemming: false }).map((token) => token.term),
    ['elephant', 'afrique'],
  );
});

test('termFor stems plain ASCII words only', () => {
  assert.equal(termFor('running'), 'run');
  assert.equal(termFor('relational'), 'relat');
  assert.equal(termFor('città'), 'citta');
});

test('Porter stemmer matches the reference examples', () => {
  const cases: Array<[string, string]> = [
    ['caresses', 'caress'],
    ['ponies', 'poni'],
    ['ties', 'ti'],
    ['caress', 'caress'],
    ['cats', 'cat'],
    ['feed', 'feed'],
    ['agreed', 'agre'],
    ['plastered', 'plaster'],
    ['motoring', 'motor'],
    ['sing', 'sing'],
    ['conflated', 'conflat'],
    ['troubled', 'troubl'],
    ['sized', 'size'],
    ['hopping', 'hop'],
    ['tanned', 'tan'],
    ['falling', 'fall'],
    ['hissing', 'hiss'],
    ['fizzed', 'fizz'],
    ['failing', 'fail'],
    ['filing', 'file'],
    ['happy', 'happi'],
    ['sky', 'sky'],
    ['relational', 'relat'],
    ['conditional', 'condit'],
    ['rational', 'ration'],
    ['valenci', 'valenc'],
    ['hesitanci', 'hesit'],
    ['digitizer', 'digit'],
    ['conformabli', 'conform'],
    ['radicalli', 'radic'],
    ['differentli', 'differ'],
    ['vileli', 'vile'],
    ['analogousli', 'analog'],
    ['vietnamization', 'vietnam'],
    ['predication', 'predic'],
    ['operator', 'oper'],
    ['feudalism', 'feudal'],
    ['decisiveness', 'decis'],
    ['hopefulness', 'hope'],
    ['callousness', 'callous'],
    ['formaliti', 'formal'],
    ['sensitiviti', 'sensit'],
    ['sensibiliti', 'sensibl'],
    ['triplicate', 'triplic'],
    ['formative', 'form'],
    ['formalize', 'formal'],
    ['electriciti', 'electr'],
    ['electrical', 'electr'],
    ['hopeful', 'hope'],
    ['goodness', 'good'],
    ['revival', 'reviv'],
    ['allowance', 'allow'],
    ['inference', 'infer'],
    ['airliner', 'airlin'],
    ['gyroscopic', 'gyroscop'],
    ['adjustable', 'adjust'],
    ['defensible', 'defens'],
    ['irritant', 'irrit'],
    ['replacement', 'replac'],
    ['adjustment', 'adjust'],
    ['dependent', 'depend'],
    ['adoption', 'adopt'],
    ['homologou', 'homolog'],
    ['communism', 'commun'],
    ['activate', 'activ'],
    ['angulariti', 'angular'],
    ['homologous', 'homolog'],
    ['effective', 'effect'],
    ['bowdlerize', 'bowdler'],
    ['probate', 'probat'],
    ['rate', 'rate'],
    ['cease', 'ceas'],
    ['controll', 'control'],
    ['roll', 'roll'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(stem(input), expected, `stem(${input})`);
  }
});

test('positionedTerms records ascending positions', () => {
  const result = positionedTerms('the quick brown fox jumps over the lazy dog');
  assert.deepEqual(result.positions.get('the'), [0, 6]);
  assert.deepEqual(result.positions.get('quick'), [1]);
  assert.equal(result.terms.length, 9);
});

test('findBestWindow centres the snippet on a query term', () => {
  const text = `${'padding '.repeat(60)}needle in a haystack ${'trailing '.repeat(60)}`;
  const window = findBestWindow(text, ['needle'], 120);
  assert.ok(window.text.includes('needle'));
  assert.ok(window.text.length <= 130);
  assert.ok(window.start > 0);
});
