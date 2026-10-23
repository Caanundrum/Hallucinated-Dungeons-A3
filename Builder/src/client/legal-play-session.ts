/**
 * Shared legal acceptance state — loaded once per session after sign-in.
 */

import type { LegalAcceptanceProjection } from './api.js';
import { fetchLegalAcceptance } from './api.js';
import { getAccount, subscribeAccount } from './account-session.js';
import { isLegalPlayBlocked } from './legal-play-gate.js';

let acceptance: LegalAcceptanceProjection | null = null;
let loadedForAccountId: string | null = null;
let loading = false;

export function getLegalAcceptance(): LegalAcceptanceProjection | null {
  return acceptance;
}

export function isPlayBlockedByLegal(): boolean {
  return isLegalPlayBlocked(acceptance);
}

export async function hydrateLegalAcceptance(): Promise<void> {
  const account = getAccount();
  if (account === null) {
    acceptance = null;
    loadedForAccountId = null;
    return;
  }
  if (loading) {
    return;
  }
  if (loadedForAccountId === account.accountId && acceptance !== null) {
    return;
  }
  loading = true;
  try {
    acceptance = await fetchLegalAcceptance();
    loadedForAccountId = account.accountId;
  } catch {
    acceptance = null;
    loadedForAccountId = account.accountId;
  } finally {
    loading = false;
  }
}

export function setLegalAcceptance(next: LegalAcceptanceProjection): void {
  acceptance = next;
}

subscribeAccount(() => {
  void hydrateLegalAcceptance();
});
