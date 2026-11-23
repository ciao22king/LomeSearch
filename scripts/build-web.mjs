#!/usr/bin/env node
/**
 * Bundles the in-memory engine for the web edition (site/web/engine.js).
 *
 * Only modules that run without a file system are reachable from the entry
 * point, so the bundle stays small and nothing tries to touch `node:fs`.
 */

import { build } from 'esbuild';

const result = await build({
  entryPoints: ['packages/engine/src/web/entry.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome110', 'firefox110', 'safari16'],
  minify: true,
  legalComments: 'none',
  outfile: 'site/web/engine.js',
  metafile: true,
  logLevel: 'warning',
});

const output = Object.entries(result.metafile.outputs)[0];
console.log(`${output[0]}: ${(output[1].bytes / 1024).toFixed(1)} KiB from ${Object.keys(result.metafile.inputs).length} modules`);
