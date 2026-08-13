/**
 * The Account page: Phase 1's product surface for the Development Test Identity.
 *
 * Blueprint ownership: Section 1.5.20 and P1-ACCOUNT-PROJECTION. No second
 * identity provider, password, or Google flow appears here. The page projects
 * the existing Local Arena identity as the account that owns characters and
 * (later) campaigns.
 */

import { getAccount, signInAccount, signOutAccount, subscribeAccount } from '../account-session.js';
import { ApiFailure } from '../api.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import type { PageHost } from './home.js';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function mountAccountPage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Account');

  let busy = false;
  let error: string | null = null;
  const mountToken = beginPageMount(container);

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    const account = getAccount();

    if (account === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="account-heading">Account</h1>
          <p class="tagline">
            Sign in with a Local Arena development account. This is the same ownership
            identity characters and campaigns use — not a second login system.
          </p>
          ${
            error === null
              ? ''
              : `<div class="message error" role="alert" tabindex="-1" data-testid="account-error">${escapeHtml(error)}</div>`
          }
          <section class="panel" aria-labelledby="sign-in-heading">
            <h2 id="sign-in-heading">Development account</h2>
            <p>
              The server mints a temporary development identity for local testing.
              There is no password to create or store. Google Sign-In arrives in a later phase.
            </p>
            <div class="actions">
              <button type="button" data-testid="account-enter"
                aria-disabled="${busy || candidate === null}">
                ${busy ? 'Signing in…' : 'Sign in for local testing'}
              </button>
            </div>
          </section>
        </div>`;
    } else {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="account-heading">Account</h1>
          <p class="tagline">
            Signed in for local testing. Characters you create are owned by this account.
          </p>
          ${
            error === null
              ? ''
              : `<div class="message error" role="alert" tabindex="-1" data-testid="account-error">${escapeHtml(error)}</div>`
          }
          <section class="panel" aria-labelledby="account-details-heading">
            <h2 id="account-details-heading">Your development account</h2>
            <dl class="account-details" data-testid="account-details">
              <div>
                <dt>Display name</dt>
                <dd data-testid="account-display-label">${escapeHtml(account.displayLabel)}</dd>
              </div>
              <div>
                <dt>Account id</dt>
                <dd><code data-testid="account-page-id">${escapeHtml(account.accountId)}</code></dd>
              </div>
              <div>
                <dt>Identity mode</dt>
                <dd data-testid="account-identity-mode">Development Test Identity</dd>
              </div>
              <div>
                <dt>Session expires</dt>
                <dd data-testid="account-expires">${escapeHtml(formatTimestamp(account.expiresAt))}</dd>
              </div>
            </dl>
            <div class="actions">
              <button type="button" class="secondary" data-testid="account-leave"
                aria-disabled="${busy}">
                ${busy ? 'Signing out…' : 'Sign out'}
              </button>
              <a href="/characters" data-link data-testid="account-characters-link">Open Character Vault</a>
            </div>
          </section>
          <p class="record-meta">
            Signing out ends this browser session. It does not delete characters or other
            records already stored for this account.
          </p>
        </div>`;
    }

    container
      .querySelector<HTMLButtonElement>('[data-testid="account-enter"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const next = await signInAccount(candidate);
            shell.announce(`Signed in as ${next.displayLabel}.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Could not mint a development account.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="account-leave"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            await signOutAccount(candidate);
            shell.announce('Signed out.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure ? failure.message : 'Could not sign out.';
          } finally {
            busy = false;
            render();
          }
        })();
      });
  }

  subscribeAccount(() => {
    if (!isPageMountCurrent(container, mountToken) || busy) {
      return;
    }
    render();
  });

  render();
}
