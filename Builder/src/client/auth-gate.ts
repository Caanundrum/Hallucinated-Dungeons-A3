/**
 * Shared markup and actions for pages that need a signed-in development account.
 *
 * Blueprint ownership: P1-ACCOUNT-PROJECTION — product surfaces project the
 * Development Test Identity as the ordinary account, so gated pages offer
 * sign-in here rather than sending the player to foundation diagnostics.
 */

import type { CandidateIdentity } from '../shared/contract.js';
import { getAccount, signInAccount } from './account-session.js';
import { ApiFailure } from './api.js';
import { escapeHtml } from './dom-utils.js';
import type { ShellHandle } from './shell.js';

export function renderSignedOutGate(options: {
  readonly title: string;
  readonly body: string;
  readonly candidate: CandidateIdentity | null;
  readonly busy: boolean;
  readonly error: string | null;
}): string {
  return `
    <div class="page">
      <h1 data-testid="signed-out-heading">${escapeHtml(options.title)}</h1>
      <section class="panel" aria-labelledby="account-gate-heading">
        <h2 id="account-gate-heading">Development account required</h2>
        <p>${escapeHtml(options.body)}</p>
        <p class="record-meta">
          Phase 1 uses a Local Arena development account — the same ownership model
          later Google Sign-In will use. There is no password.
        </p>
        ${
          options.error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="account-gate-error">${escapeHtml(options.error)}</div>`
        }
        <div class="actions">
          <button type="button" data-testid="gate-enter-account"
            aria-disabled="${options.busy || options.candidate === null}">
            ${options.busy ? 'Signing in…' : 'Sign in for local testing'}
          </button>
          <a href="/account" data-link data-testid="gate-account-link">Open Account</a>
        </div>
      </section>
    </div>`;
}

export function bindSignedOutGate(options: {
  readonly container: HTMLElement;
  readonly shell: ShellHandle;
  readonly candidate: CandidateIdentity | null;
  readonly onSignedIn: () => void;
  readonly setBusy: (busy: boolean) => void;
  readonly setError: (message: string | null) => void;
  readonly render: () => void;
}): void {
  options.container
    .querySelector<HTMLButtonElement>('[data-testid="gate-enter-account"]')
    ?.addEventListener('click', () => {
      void (async () => {
        if (options.candidate === null || getAccount() !== null) {
          return;
        }
        options.setBusy(true);
        options.setError(null);
        options.render();
        try {
          const account = await signInAccount(options.candidate);
          options.shell.announce(`Signed in as ${account.displayLabel}.`);
          options.onSignedIn();
        } catch (failure) {
          options.setError(
            failure instanceof ApiFailure
              ? failure.message
              : 'Could not mint a development account.',
          );
        } finally {
          options.setBusy(false);
          options.render();
        }
      })();
    });
}
