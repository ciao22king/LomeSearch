/**
 * When an idle tab is worth freezing.
 *
 * Pure so the policy can be tested without Electron: the window only supplies
 * the facts it can observe.
 */

export interface FreezeCandidate {
  id: number;
  frozen: boolean;
  live: boolean;
  loading: boolean;
  audible: boolean;
  lastActive: number;
}

export function shouldFreeze(
  tab: FreezeCandidate,
  activeId: number | null,
  minutes: number,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(minutes) || minutes <= 0) return false;
  if (tab.id === activeId) return false;
  if (tab.frozen || !tab.live || tab.loading || tab.audible) return false;
  return tab.lastActive <= now - minutes * 60_000;
}
