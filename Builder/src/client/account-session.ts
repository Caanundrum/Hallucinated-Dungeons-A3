/**
 * Client-side session handle for the Local Arena development account.
 *
 * Blueprint ownership: Section 1.5.20 and ledger P1-ACCOUNT-PROJECTION —
 * the Development Test Identity is projected as the ordinary account surface
 * for Phase 1. This module never invents identity fields; it only stores the
 * last server projection and notifies the shell when that projection changes.
 */

import type { AccountProjection, CandidateIdentity } from '../shared/contract.js';
import { ApiFailure, enterGoogleEmulatorSession, enterLocalArena, fetchSession, leaveLocalArena } from './api.js';

type Listener = () => void;

let account: AccountProjection | null = null;
let hydrated = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** The current server-projected account, or null when signed out. */
export function getAccount(): AccountProjection | null {
  return account;
}

export function isAccountHydrated(): boolean {
  return hydrated;
}

/** Subscribe to account changes. Returns an unsubscribe function. */
export function subscribeAccount(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Loads the existing session cookie into the account surface, if any. */
export async function hydrateAccount(): Promise<AccountProjection | null> {
  try {
    account = await fetchSession();
  } catch (failure) {
    if (failure instanceof ApiFailure && failure.code === 'NOT_AUTHENTICATED') {
      account = null;
    } else if (failure instanceof ApiFailure && failure.code === 'SESSION_EXPIRED') {
      account = null;
    } else {
      account = null;
    }
  }
  hydrated = true;
  notify();
  return account;
}

/** Mints a Development Test Identity and projects it as the signed-in account. */
export async function signInAccount(candidate: CandidateIdentity): Promise<AccountProjection> {
  account = await enterLocalArena(candidate.candidateId);
  hydrated = true;
  notify();
  return account;
}

/** Hosted-identity rehearsal: Google Sign-In mode via the Auth emulator. */
export async function signInGoogleEmulator(
  candidate: CandidateIdentity,
  email: string,
): Promise<AccountProjection> {
  account = await enterGoogleEmulatorSession({
    candidateId: candidate.candidateId,
    email,
  });
  hydrated = true;
  notify();
  return account;
}

/** Ends the development session. Character and campaign records remain on the server. */
export async function signOutAccount(candidate: CandidateIdentity): Promise<void> {
  await leaveLocalArena(candidate.candidateId);
  account = null;
  hydrated = true;
  notify();
}

/**
 * Used by diagnostics so its enter/leave controls stay synchronized with the
 * shared account surface without inventing a second session model.
 */
export function setAccountFromServer(next: AccountProjection | null): void {
  account = next;
  hydrated = true;
  notify();
}

/**
 * Clears the local account when the server reports an expired or missing
 * session. Called from the API transport so product pages do not keep a
 * stale signed-in chip after auth death.
 */
export function clearAccountOnAuthFailure(): void {
  if (account === null && hydrated) {
    return;
  }
  account = null;
  hydrated = true;
  notify();
}
