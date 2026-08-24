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
const listeners = new Set<() => void>();

export function subscribeLegalAcceptance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

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
    notify();
    return;
  }
  if (loadedForAccountId === account.accountId || loading) {
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
    notify();
  }
}

export function setLegalAcceptance(next: LegalAcceptanceProjection): void {
  acceptance = next;
  notify();
}

export function clearLegalAcceptance(): void {
  acceptance = null;
  loadedForAccountId = null;
  notify();
}

subscribeAccount(() => {
  void hydrateLegalAcceptance();
});
