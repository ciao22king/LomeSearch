import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COSMETIC_RULE_COUNT, COSMETIC_SELECTORS, buildCosmeticCss } from '../src/shared/cosmetic.js';

test('the cosmetic list hides ad containers and nothing generic', () => {
  assert.ok(COSMETIC_RULE_COUNT > 15);
  assert.ok(COSMETIC_SELECTORS.includes('.adsbygoogle'));
  assert.ok(COSMETIC_SELECTORS.some((selector) => selector.startsWith('[id^="div-gpt-ad"')));
  const selectors: readonly string[] = COSMETIC_SELECTORS;
  assert.ok(!selectors.includes('.ad'));
  assert.ok(!selectors.includes('.ads'));
  assert.ok(!selectors.includes('aside'));
});

test('the generated CSS hides every selector with !important', () => {
  const css = buildCosmeticCss();
  assert.match(css, /display: none !important;/);
  for (const selector of COSMETIC_SELECTORS) assert.ok(css.includes(selector));
});
