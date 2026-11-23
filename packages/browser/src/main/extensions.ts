import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dialog, type Extension, type Session } from 'electron';
import type { ExtensionInfo } from '../shared/types.js';
import type { AppStore } from './store.js';

/**
 * Chrome extension support.
 *
 * Electron implements a large subset of the extension APIs, enough for content
 * blockers, readers, password managers and most UI tweaks. Extensions are loaded
 * unpacked from a directory the user picks, because the Chrome Web Store
 * installation flow is not available outside Chrome. Loading happens per
 * session, so private windows stay clean.
 */
export class ExtensionManager {
  private readonly loaded = new Map<string, Extension>();
  private readonly errors = new Map<string, string>();
  private readonly disabled = new Set<string>();

  constructor(
    private readonly store: AppStore,
    private readonly onUpdate: () => void,
  ) {}

  async loadAll(session: Session): Promise<void> {
    if (!this.store.settings.value.extensions.enabled) return;
    for (const path of this.store.settings.value.extensions.paths) {
      await this.loadPath(session, path, { silent: true });
    }
    this.onUpdate();
  }

  async loadPath(
    session: Session,
    inputPath: string,
    options: { silent?: boolean } = {},
  ): Promise<ExtensionInfo | null> {
    const path = resolve(inputPath);
    if (!isExtensionDirectory(path)) {
      this.errors.set(path, 'manifest.json non trovato o non valido');
      this.onUpdate();
      return null;
    }
    try {
      const extension = await session.loadExtension(path);
      this.loaded.set(path, extension);
      this.errors.delete(path);
      this.rememberPath(path);
      this.onUpdate();
      return this.toInfo(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errors.set(path, message);
      if (!options.silent) {
        await dialog.showMessageBox({
          type: 'error',
          title: 'Estensione non caricata',
          message: 'LomeSearch non è riuscito a caricare l’estensione.',
          detail: `${path}\n\n${message}`,
          buttons: ['Chiudi'],
        });
      }
      this.onUpdate();
      return null;
    }
  }

  async remove(session: Session, path: string): Promise<void> {
    const extension = this.loaded.get(path);
    if (extension) {
      session.removeExtension(extension.id);
      this.loaded.delete(path);
    }
    this.errors.delete(path);
    this.disabled.delete(path);
    const paths = this.store.settings.value.extensions.paths.filter((item) => item !== path);
    this.store.updateSettings({ extensions: { ...this.store.settings.value.extensions, paths } });
    this.onUpdate();
  }

  async setEnabled(session: Session, path: string, enabled: boolean): Promise<void> {
    if (enabled) {
      this.disabled.delete(path);
      await this.loadPath(session, path, { silent: true });
    } else {
      const extension = this.loaded.get(path);
      if (extension) {
        session.removeExtension(extension.id);
        this.loaded.delete(path);
      }
      this.disabled.add(path);
      this.onUpdate();
    }
  }

  async pickDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: 'Seleziona la cartella dell’estensione',
      properties: ['openDirectory'],
      buttonLabel: 'Carica estensione',
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  list(): ExtensionInfo[] {
    const paths = new Set<string>([
      ...this.store.settings.value.extensions.paths,
      ...this.loaded.keys(),
      ...this.errors.keys(),
    ]);
    return [...paths]
      .sort()
      .map((path) => this.toInfo(path))
      .filter((info): info is ExtensionInfo => info !== null);
  }

  private toInfo(path: string): ExtensionInfo | null {
    const extension = this.loaded.get(path);
    if (extension) {
      return {
        id: extension.id,
        name: extension.name || path.split('/').pop() || path,
        version: extension.version ?? '',
        path,
        enabled: true,
      };
    }
    if (!existsSync(path)) {
      return {
        id: `missing:${path}`,
        name: path.split('/').pop() || path,
        version: '',
        path,
        enabled: false,
        error: 'cartella non trovata',
      };
    }
    return {
      id: `path:${path}`,
      name: readExtensionName(path) ?? path.split('/').pop() ?? path,
      version: readExtensionVersion(path) ?? '',
      path,
      enabled: false,
      error: this.errors.get(path) ?? (this.disabled.has(path) ? 'disattivata' : 'non caricata'),
    };
  }

  private rememberPath(path: string): void {
    const current = this.store.settings.value.extensions;
    if (current.paths.includes(path)) return;
    this.store.updateSettings({
      extensions: { ...current, paths: [...current.paths, path] },
    });
  }
}

function isExtensionDirectory(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
    const manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8')) as {
      manifest_version?: number;
    };
    return manifest.manifest_version === 2 || manifest.manifest_version === 3;
  } catch {
    return false;
  }
}

function readExtensionName(path: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8')) as { name?: string };
    return typeof manifest.name === 'string' ? manifest.name : null;
  } catch {
    return null;
  }
}

function readExtensionVersion(path: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8')) as { version?: string };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}
