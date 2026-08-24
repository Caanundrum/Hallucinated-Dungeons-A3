/**
 * Non-authoritative UI preferences stored in browser localStorage.
 *
 * Never stores identity, ownership, seating, or canonical game state — only
 * player-local presentation and tutorial dismissal flags.
 */

const CREATOR_TUTORIAL_DISMISSED_KEY = 'hd-a3-creator-tutorial-dismissed';

export function isCreatorTutorialDismissed(): boolean {
  try {
    return localStorage.getItem(CREATOR_TUTORIAL_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setCreatorTutorialDismissed(): void {
  try {
    localStorage.setItem(CREATOR_TUTORIAL_DISMISSED_KEY, 'true');
  } catch {
    // localStorage may be unavailable in hardened browsers.
  }
}

export function readTableNotesPreference(campaignId: string): string {
  try {
    return localStorage.getItem(`hd-a3-table-notes-${campaignId}`) ?? '';
  } catch {
    return '';
  }
}

export function writeTableNotesPreference(campaignId: string, value: string): void {
  try {
    localStorage.setItem(`hd-a3-table-notes-${campaignId}`, value);
  } catch {
    // Non-authoritative scratch notes — ignore storage failures.
  }
}
