/**
 * The persistent hosted shell.
 *
 * Blueprint ownership: Section 25 Phase 1 build scope ("responsive hosted
 * shell", "stable navigation") and the accessibility foundations owned by
 * this phase.
 *
 * The shell owns three things every page shares rather than reimplementing:
 * the header/nav/footer chrome, the single persistent live region (a
 * destroyed-and-recreated live region cannot reliably announce anything,
 * which is exactly the defect Phase 0 QA found and fixed), and focus
 * management on navigation.
 */

import type { CandidateIdentity } from '../shared/contract.js';
import { LEGAL_ROUTES } from '../shared/routes.js';
import { escapeHtml } from './dom-utils.js';
import { navigate } from './router.js';

export interface ShellHandle {
  readonly mainElement: HTMLElement;
  /** Announces a message once, only when it differs from the last announcement. */
  announce(message: string): void;
  /** Marks the nav link matching `path` with `aria-current="page"`. */
  setActiveRoute(path: string): void;
  /** Sets the browser tab title, always suffixed with the product name. */
  setDocumentTitle(pageTitle: string): void;
  /** Moves focus to the current page's main heading, for screen-reader users after navigation. */
  focusPageHeading(): void;
}

const LEGAL_LABELS: Record<string, string> = {
  '/legal/terms': 'Terms of Service',
  '/legal/privacy': 'Privacy Notice',
  '/legal/alpha-participation': 'Alpha Participation Terms',
  '/legal/content-and-safety': 'Content and Safety Notice',
};

/** Builds the shell chrome once and returns a handle pages use for the rest of the session. */
export function mountShell(root: HTMLElement, candidate: CandidateIdentity | null): ShellHandle {
  const legalLinks = LEGAL_ROUTES.map(
    (route) =>
      `<li><a href="${route}" target="_blank" rel="noopener noreferrer">${escapeHtml(LEGAL_LABELS[route] ?? route)}</a></li>`,
  ).join('');

  root.innerHTML = `
    <div class="shell">
      <header class="shell-header">
        <div class="shell-header-inner">
          <a class="wordmark" href="/" data-link>Hallucinated Dungeons</a>
          <nav class="primary-nav" aria-label="Primary">
            <ul>
              <li><a href="/" data-link data-testid="nav-home">Home</a></li>
              <li><a href="/characters" data-link data-testid="nav-characters">Characters</a></li>
              <li><a href="/diagnostics" data-link data-testid="nav-diagnostics">Local Arena diagnostics</a></li>
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" class="shell-main" tabindex="-1"></main>
      <footer class="shell-footer">
        <div class="shell-footer-inner">
          <ul class="footer-legal-links" data-testid="footer-legal-links">${legalLinks}</ul>
          <p class="footer-build-info" data-testid="footer-build-info">
            ${
              candidate === null
                ? 'Contacting the Local Arena server…'
                : `Blueprint ${escapeHtml(candidate.blueprintVersion)} · Build ${escapeHtml(candidate.candidateId)}`
            }
          </p>
        </div>
      </footer>
    </div>
    <div class="visually-hidden" role="status" aria-live="polite" data-testid="live-region"></div>`;

  const mainElement = root.querySelector<HTMLElement>('#main');
  const liveRegion = root.querySelector<HTMLElement>('[data-testid="live-region"]');
  if (mainElement === null || liveRegion === null) {
    throw new Error('Shell failed to initialize its main landmark and live region.');
  }

  let lastAnnouncement = '';

  return {
    mainElement,
    announce(message: string): void {
      if (message === lastAnnouncement) {
        return;
      }
      lastAnnouncement = message;
      liveRegion.textContent = message;
    },
    setActiveRoute(path: string): void {
      root.querySelectorAll<HTMLAnchorElement>('.primary-nav a[data-link]').forEach((link) => {
        const linkPath = new URL(link.href, window.location.href).pathname;
        const matches =
          linkPath === path || (linkPath === '/characters' && path.startsWith('/characters/'));
        if (matches) {
          link.setAttribute('aria-current', 'page');
        } else {
          link.removeAttribute('aria-current');
        }
      });
    },
    setDocumentTitle(pageTitle: string): void {
      document.title = `${pageTitle} — Hallucinated Dungeons`;
    },
    focusPageHeading(): void {
      const heading = mainElement.querySelector<HTMLElement>('h1');
      if (heading !== null) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      } else {
        mainElement.focus();
      }
    },
  };
}

/** Re-exported so pages can navigate without importing the router module directly. */
export { navigate };
