import { dialog, type Session, type WebContents } from 'electron';
import type { AppStore } from './store.js';
import { registrableDomain } from './privacy.js';

/**
 * Permission prompts.
 *
 * Decisions are remembered per origin and per permission. Nothing is granted
 * silently: geolocation, camera, microphone, notifications, clipboard reads and
 * MIDI all go through the same dialog. The check handler consults the stored
 * decisions so that Chromium's second, synchronous check agrees with the prompt.
 */

const LABELS: Record<string, string> = {
  geolocation: 'la posizione',
  notifications: 'le notifiche',
  media: 'la fotocamera e il microfono',
  'mediaKeySystem': 'la riproduzione protetta (DRM)',
  midi: 'i dispositivi MIDI',
  midiSysex: 'i dispositivi MIDI',
  pointerLock: 'il blocco del puntatore',
  fullscreen: 'lo schermo intero',
  openExternal: 'l’apertura di applicazioni esterne',
  'clipboard-read': 'la lettura degli appunti',
  'clipboard-sanitized-write': 'la scrittura negli appunti',
  'display-capture': 'la condivisione dello schermo',
  'idle-detection': 'il rilevamento dell’inattività',
  'speaker-selection': 'la selezione degli altoparlanti',
  'window-management': 'la gestione delle finestre',
  unknown: 'un permesso',
};

export class PermissionManager {
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor(private readonly store: AppStore) {}

  configure(session: Session): void {
    session.setPermissionRequestHandler((webContents, permission, callback, details) => {
      void this.handle(webContents, permission, details, callback);
    });

    session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      const origin = originOf(requestingOrigin || webContents?.getURL() || '');
      if (!origin) return false;
      return this.store.permissionFor(origin, permission) === 'allow';
    });
  }

  private async handle(
    webContents: WebContents,
    permission: string,
    details: { requestingUrl?: string; mediaTypes?: string[] } | undefined,
    callback: (allowed: boolean) => void,
  ): Promise<void> {
    const origin = originOf(details?.requestingUrl ?? webContents.getURL());
    if (!origin) {
      callback(false);
      return;
    }
    const remembered = this.store.permissionFor(origin, permission);
    if (remembered) {
      callback(remembered === 'allow');
      return;
    }

    const key = `${origin}|${permission}`;
    const existing = this.pending.get(key);
    if (existing) {
      callback(await existing);
      return;
    }

    const promise = this.ask(origin, permission, details?.mediaTypes ?? []).then((decision) => {
      if (decision !== null) {
        this.store.setPermission(origin, permission, decision.remember ? 'allow' : 'deny');
      }
      return decision?.allowed ?? false;
    });
    this.pending.set(key, promise);
    const allowed = await promise;
    this.pending.delete(key);
    callback(allowed);
  }

  private async ask(
    origin: string,
    permission: string,
    mediaTypes: string[],
  ): Promise<{ allowed: boolean; remember: boolean } | null> {
    const label = LABELS[permission] ?? LABELS.unknown;
    const media = mediaTypes.length > 0 ? ` (${mediaTypes.join(', ')})` : '';
    const result = await dialog.showMessageBox({
      type: 'question',
      title: 'LomeSearch',
      message: `${origin} chiede ${label}${media}`,
      detail: 'Puoi concedere il permesso una volta sola oppure ricordare la scelta per questo sito.',
      buttons: ['Consenti', 'Blocca'],
      defaultId: 1,
      cancelId: 1,
      checkboxLabel: 'Ricorda la scelta per questo sito',
      checkboxChecked: false,
      noLink: true,
    });
    return { allowed: result.response === 0, remember: result.checkboxChecked };
  }
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return registrableDomain(parsed.hostname);
  } catch {
    return null;
  }
}
