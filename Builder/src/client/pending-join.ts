/**
 * Short-lived join handoff so /table does not flash a spectator state before
 * the seat write is visible to the detail read.
 */

const KEY_PREFIX = 'hd-pending-join:';

export function rememberPendingJoin(campaignId: string, characterId: string): void {
  try {
    sessionStorage.setItem(`${KEY_PREFIX}${campaignId}`, characterId);
  } catch {
    // sessionStorage may be unavailable.
  }
}

export function readPendingJoin(campaignId: string): string | null {
  try {
    return sessionStorage.getItem(`${KEY_PREFIX}${campaignId}`);
  } catch {
    return null;
  }
}

export function clearPendingJoin(campaignId: string): void {
  try {
    sessionStorage.removeItem(`${KEY_PREFIX}${campaignId}`);
  } catch {
    // sessionStorage may be unavailable.
  }
}
