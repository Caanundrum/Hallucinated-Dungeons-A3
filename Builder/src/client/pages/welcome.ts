/**
 * Hosted player welcome: one full-screen entry point before sign-in.
 *
 * Milestone / Gold Master artifacts land here first. Signed-in players are
 * routed straight to the campaign list; unsigned players see a single CTA.
 */

import { LEGAL_ROUTES } from '../../shared/routes.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import { primeHostedGoogleSignIn, triggerHostedGoogleSignIn } from '../hosted-google-sign-in.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

const LEGAL_LABELS: Record<string, string> = {
  '/legal/terms': 'Terms',
  '/legal/privacy': 'Privacy',
  '/legal/alpha-participation': 'Alpha terms',
  '/legal/content-and-safety': 'Safety',
};

const WELCOME_LOGO_MARK = `
  <svg class="welcome-logo-mark" width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true" focusable="false">
    <path class="welcome-logo-arch" d="M20 88 V48 A28 28 0 0 1 76 48 V88" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
    <path class="welcome-logo-base" d="M12 88 H84" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
    <path class="welcome-logo-pillar welcome-logo-pillar-left" d="M30 88 V56" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.6" />
    <path class="welcome-logo-pillar welcome-logo-pillar-right" d="M66 88 V56" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.6" />
  </svg>`;

function welcomeLegalLinks(): string {
  return LEGAL_ROUTES.map(
    (route) =>
      `<li><a href="${route}" target="_blank" rel="noopener noreferrer">${escapeHtml(LEGAL_LABELS[route] ?? route)}</a></li>`,
  ).join('');
}

export function mountWelcomePage(host: PageHost): void {
  const { container, shell, candidate } = host;

  shell.setPresentationMode('welcome');
  shell.setDocumentTitle('Welcome');

  let busy = false;
  let error: string | null = null;
  const mountToken = beginPageMount(container);
  const searchParams = new URLSearchParams(window.location.search);
  if (error === null && searchParams.get('auth_error') === 'google_signin_failed') {
    error = 'Google Sign-In could not be completed. Please try again.';
  }

  function redirectSignedIn(): void {
    if (getAccount() === null) {
      return;
    }
    shell.setPresentationMode('app');
    navigate('/campaigns', { replace: true });
  }

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    if (getAccount() !== null) {
      redirectSignedIn();
      return;
    }

    container.innerHTML = `
      <div class="welcome-screen" data-testid="welcome-screen">
        <div class="welcome-screen-inner">
          <div class="welcome-logo-stage" data-testid="welcome-logo-stage">
            ${WELCOME_LOGO_MARK}
          </div>
          <p class="welcome-eyebrow">Invite-only alpha</p>
          <h1 class="welcome-title" data-testid="welcome-heading">Hallucinated Dungeons</h1>
          <p class="welcome-lead">
            A shared online table for creating characters, gathering a party, and playing
            together in the browser with a locked Game Director.
          </p>
          ${
            error === null
              ? ''
              : `<div class="message error welcome-error" role="alert" tabindex="-1" data-testid="welcome-error">${escapeHtml(error)}</div>`
          }
          <div class="welcome-actions">
            ${
              candidate === null
                ? `<button type="button" data-testid="welcome-retry-candidate">Retry connection</button>`
                : candidate.hostedGoogleClientId === null
                  ? `<p class="welcome-note">Google Sign-In is not configured for this build yet.</p>`
                  : `<button type="button" class="welcome-cta" data-testid="welcome-sign-in-cta" aria-disabled="${busy}">
                       ${busy ? 'Opening Google…' : 'Begin your adventure'}
                     </button>`
            }
          </div>
          <p class="welcome-note">Sign in continues in this window and returns you to your campaigns.</p>
          <ul class="welcome-legal" data-testid="welcome-legal-links">${welcomeLegalLinks()}</ul>
          <div class="visually-hidden" aria-hidden="true" data-testid="welcome-google-hosted-button"></div>
        </div>
      </div>`;

    container
      .querySelector<HTMLButtonElement>('[data-testid="welcome-retry-candidate"]')
      ?.addEventListener('click', () => {
        window.location.reload();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="welcome-sign-in-cta"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          const buttonHost = container.querySelector<HTMLElement>(
            '[data-testid="welcome-google-hosted-button"]',
          );
          if (buttonHost === null) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            await triggerHostedGoogleSignIn(buttonHost);
          } catch {
            error = 'Google Sign-In failed to load.';
            busy = false;
            render();
          }
        })();
      });

    const buttonHost = container.querySelector<HTMLElement>('[data-testid="welcome-google-hosted-button"]');
    if (buttonHost !== null && candidate !== null && candidate.hostedGoogleClientId !== null && !busy) {
      void primeHostedGoogleSignIn({ candidate, buttonHost }).catch(() => {
        error = 'Google Sign-In failed to load.';
        render();
      });
    }
  }

  subscribeAccount(() => {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    redirectSignedIn();
  });

  render();
  redirectSignedIn();
}
