/**
 * Hosted player welcome: one full-screen entry point before sign-in.
 *
 * Milestone / Gold Master artifacts land here first. Signed-in players are
 * routed straight to the campaign list; unsigned players see the official
 * Google Sign-In button per Google Identity Services branding policy.
 */

import { LEGAL_ROUTES } from '../../shared/routes.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import { mountHostedGoogleSignInButton } from '../hosted-google-sign-in.js';
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

  let error: string | null = null;
  const mountToken = beginPageMount(container);
  const searchParams = new URLSearchParams(window.location.search);
  if (error === null && searchParams.get('auth_error') === 'google_signin_failed') {
    error = 'We couldn\u2019t finish signing you in. Please try again.';
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
            Your table awaits. Shape a hero, call your companions, and fall into a story
            told together &mdash; wherever you are, right in the browser.
          </p>
          <section class="welcome-about" aria-labelledby="welcome-about-heading" data-testid="welcome-about">
            <h2 id="welcome-about-heading" class="welcome-about-heading">About Hallucinated Dungeons</h2>
            <p class="welcome-about-body">
              Hallucinated Dungeons is an invite-only alpha for a browser-based tabletop
              roleplaying game. Create heroes, gather a party, and play together around a
              shared table with friends &mdash; no install required.
            </p>
            <ul class="welcome-about-list">
              <li>Build and save characters in the Character Vault</li>
              <li>Create campaigns and invite other players</li>
              <li>Play sessions in the browser with a narrator who guides the story</li>
            </ul>
            <p class="welcome-about-links">
              <a href="/legal/privacy" target="_blank" rel="noopener noreferrer">Privacy Notice</a>
              <span aria-hidden="true">&middot;</span>
              <a href="/legal/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
            </p>
          </section>
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
                  ? `<p class="welcome-note">Sign-in isn\u2019t ready on this build yet.</p>`
                  : `<div class="hosted-google-sign-in" data-testid="welcome-google-hosted-button"></div>`
            }
          </div>
          <p class="welcome-note">
            Signing in with Google shares your account with Hallucinated Dungeons as described in our
            <a href="/legal/privacy" target="_blank" rel="noopener noreferrer">Privacy Notice</a>.
          </p>
          <ul class="welcome-legal" data-testid="welcome-legal-links">${welcomeLegalLinks()}</ul>
        </div>
      </div>`;

    container
      .querySelector<HTMLButtonElement>('[data-testid="welcome-retry-candidate"]')
      ?.addEventListener('click', () => {
        window.location.reload();
      });

    const buttonHost = container.querySelector<HTMLElement>('[data-testid="welcome-google-hosted-button"]');
    if (buttonHost !== null && candidate !== null && candidate.hostedGoogleClientId !== null) {
      void mountHostedGoogleSignInButton({ candidate, buttonHost }).catch(() => {
        error = 'Sign-in isn\u2019t available right now. Refresh and try again.';
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
