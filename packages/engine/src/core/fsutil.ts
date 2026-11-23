import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

/**
 * Writes through a temporary file in the same directory and renames it, so a
 * crash never leaves a half-written manifest behind.
 */
export function writeFileAtomic(path: string, data: string | Buffer): void {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, data);
  const fd = openSync(tmp, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

export function readJsonFile<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  writeFileAtomic(path, `${JSON.stringify(value)}\n`);
}

export function filePath(dir: string, name: string): string {
  return join(dir, name);
}

export function readTextIfExists(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
