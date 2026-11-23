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
  geolocation: 'your location',
  notifications: 'notifications',
  media: 'the camera and the microphone',
  'mediaKeySystem': 'protected playback (DRM)',
  midi: 'MIDI devices',
  midiSysex: 'MIDI devices',
  pointerLock: 'pointer lock',
  fullscreen: 'full screen',
  openExternal: 'opening external applications',
  'clipboard-read': 'reading the clipboard',
  'clipboard-sanitized-write': 'writing to the clipboard',
  'display-capture': 'screen sharing',
  'idle-detection': 'idle detection',
  'speaker-selection': 'speaker selection',
  'window-management': 'window management',
  unknown: 'a permission',
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
      message: `${origin} asks for ${label}${media}`,
      detail: 'You can allow it once or remember the choice for this site.',
      buttons: ['Allow', 'Block'],
      defaultId: 1,
      cancelId: 1,
      checkboxLabel: 'Remember this choice for this site',
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
