import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { protocol, type Session } from 'electron';
import { INTERNAL_PAGES, INTERNAL_SCHEME, type InternalPage } from '../shared/constants.js';

/**
 * Internal pages (`lomesearch://newtab`, `lomesearch://settings`, ...).
 *
 * They are served from the bundled renderer directory by a privileged custom
 * scheme, so they get a real origin, a strict CSP and the same tab machinery as
 * any other page. Only the page shell and its own assets are reachable; path
 * traversal is rejected.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: INTERNAL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function isInternalPage(value: string): value is InternalPage {
  return (INTERNAL_PAGES as readonly string[]).includes(value);
}

export function internalUrl(page: InternalPage): string {
  return `${INTERNAL_SCHEME}://${page}`;
}

export function installInternalProtocol(ses: Session, rendererRoot: string): void {
  const root = resolve(rendererRoot);
  ses.protocol.handle(INTERNAL_SCHEME, async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return textResponse(400, 'invalid request');
    }
    const page = url.hostname;
    if (!isInternalPage(page)) return textResponse(404, 'page not found');

    const relative = url.pathname === '/' ? `/pages/${page}.html` : url.pathname;
    if (!relative.startsWith('/pages/') && !relative.startsWith('/assets/')) {
      return textResponse(404, 'asset not found');
    }
    const filePath = resolve(join(root, relative));
    if (!filePath.startsWith(`${root}/`) && filePath !== root) {
      return textResponse(403, 'access denied');
    }
    try {
      const data = await readFile(filePath);
      return new Response(data, {
        status: 200,
        headers: {
          'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        },
      });
    } catch {
      return textResponse(404, 'asset not found');
    }
  });
}

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
