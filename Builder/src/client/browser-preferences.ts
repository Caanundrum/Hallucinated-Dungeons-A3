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

const INTENT_DRAFT_KEY_PREFIX = 'hd-a3-intent-draft-';

export function readIntentDraftPreference(campaignId: string): string | null {
  try {
    return localStorage.getItem(`${INTENT_DRAFT_KEY_PREFIX}${campaignId}`);
  } catch {
    return null;
  }
}

export function writeIntentDraftPreference(campaignId: string, draftJson: string | null): void {
  try {
    const key = `${INTENT_DRAFT_KEY_PREFIX}${campaignId}`;
    if (draftJson === null || draftJson.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, draftJson);
  } catch {
    // Non-authoritative draft recovery — ignore storage failures.
  }
}

const ASK_DM_THREAD_KEY_PREFIX = 'hd-a3-ask-dm-thread-';

function askDmThreadStorageKey(accountId: string, campaignId: string): string {
  return `${ASK_DM_THREAD_KEY_PREFIX}${accountId}-${campaignId}`;
}

/** Private Ask-the-Director thread for this account + campaign (non-authoritative). */
export function readAskDmThreadPreference(accountId: string, campaignId: string): string | null {
  try {
    return localStorage.getItem(askDmThreadStorageKey(accountId, campaignId));
  } catch {
    return null;
  }
}

export function writeAskDmThreadPreference(
  accountId: string,
  campaignId: string,
  threadJson: string | null,
): void {
  try {
    const key = askDmThreadStorageKey(accountId, campaignId);
    if (threadJson === null || threadJson.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, threadJson);
  } catch {
    // Non-authoritative consulting thread — ignore storage failures.
  }
}

export {
  parseRestorableIntentDraft,
  shouldPersistIntentDraftState,
} from '../shared/intent-draft-contract.js';
