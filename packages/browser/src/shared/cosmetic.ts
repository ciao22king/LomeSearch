/**
 * Cosmetic ad filtering.
 *
 * Only selectors that belong to advertising stacks are hidden, and only ones
 * that are unlikely to be reused by page layout: generic names such as `.ad`
 * are deliberately absent because they break real sites. The CSS is inserted
 * at document start so slots never flash before they are removed.
 */

export const COSMETIC_SELECTORS = [
  '[id^="google_ads"]',
  '[id^="div-gpt-ad"]',
  '[id^="aswift_"]',
  '[id^="taboola-"]',
  '[class^="taboola-"]',
  '[id^="outbrain_widget"]',
  '.OUTBRAIN',
  '.adsbygoogle',
  '[data-ad-slot]',
  '[data-ad-unit]',
  '[data-ad-client]',
  '.ad-slot',
  '.ad-unit',
  '.ad-wrapper',
  '.advert-slot',
  '.advertisement',
  '.sponsored-content',
  '.sponsored-post',
  '.native-ad',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="amazon-adsystem.com"]',
  'iframe[src*="adnxs.com"]',
  'iframe[src*="criteo.com"]',
  'iframe[src*="taboola.com"]',
  'iframe[src*="outbrain.com"]',
] as const;

export const COSMETIC_RULE_COUNT = COSMETIC_SELECTORS.length;

export function buildCosmeticCss(): string {
  return `${COSMETIC_SELECTORS.join(',\n')} {\n  display: none !important;\n}`;
}
