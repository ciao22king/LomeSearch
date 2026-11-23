import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * Browser build.
 *
 * Three bundles: the Electron main process (ESM), the two preloads (CJS, the
 * only format sandboxed preloads accept) and the renderers (IIFE, one per page).
 * HTML and CSS are copied verbatim; everything is bundled so `node_modules` is
 * not needed at runtime.
 */

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, 'dist');
const rendererDir = join(root, 'src', 'renderer');
const pagesDir = join(rendererDir, 'pages');

const dev = process.argv.includes('--dev');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'main'), { recursive: true });
mkdirSync(join(outDir, 'preload'), { recursive: true });
mkdirSync(join(outDir, 'renderer'), { recursive: true });

cpSync(rendererDir, join(outDir, 'renderer'), {
  recursive: true,
  filter: (source) => !source.endsWith('.ts'),
});

const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: 'warning',
  minify: !dev,
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'main', 'main.ts')],
    outfile: join(outDir, 'main', 'main.js'),
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'preload', 'chrome.ts')],
    outfile: join(outDir, 'preload', 'chrome.cjs'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'preload', 'page.ts')],
    outfile: join(outDir, 'preload', 'page.cjs'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
]);

const pageEntries = readdirSync(pagesDir)
  .filter((name) => name.endsWith('.ts') && name !== 'common.ts')
  .map((name) => join(pagesDir, name));

await Promise.all([
  build({
    ...shared,
    entryPoints: [join(rendererDir, 'chrome.ts')],
    outfile: join(outDir, 'renderer', 'chrome.js'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
  }),
  build({
    ...shared,
    entryPoints: pageEntries,
    outdir: join(outDir, 'renderer', 'pages'),
    platform: 'browser',
    format: 'esm',
    target: 'chrome130',
  }),
]);

process.stdout.write(`build completed${dev ? ' (dev)' : ''}\n`);
