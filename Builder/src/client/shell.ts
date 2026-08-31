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
 *
 * Phase 1 chunk 1d adds the account chip: the Development Test Identity
 * projected as the ordinary signed-in account (P1-ACCOUNT-PROJECTION).
 */

import type { AccountProjection, CandidateIdentity } from '../shared/contract.js';
import { LEGAL_ROUTES } from '../shared/routes.js';
import {
  getAccount,
  isAccountHydrated,
  signInAccount,
  signOutAccount,
  subscribeAccount,
} from './account-session.js';
import { ApiFailure } from './api.js';
import { escapeHtml } from './dom-utils.js';
import { isHostedPlayerSurface } from './player-surface.js';
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
  /**
   * Presentation chrome modes:
   * - `app` — full shell header/footer (default pages)
   * - `welcome` — no chrome (hosted landing)
   * - `table` — no global chrome; campaign table owns a compact ambient HUD
   */
  setPresentationMode(mode: 'app' | 'welcome' | 'table'): void;
}

const LEGAL_LABELS: Record<string, string> = {
  '/legal/terms': 'Terms of Service',
  '/legal/privacy': 'Privacy Notice',
  '/legal/alpha-participation': 'Alpha Participation Terms',
  '/legal/content-and-safety': 'Content and Safety Notice',
};

function accountChipMarkup(
  account: AccountProjection | null,
  busy: boolean,
  candidateAvailable: boolean,
): string {
  if (!candidateAvailable) {
    return `
      <div class="account-chip" data-testid="shell-account-chip">
        <span class="account-chip-label" data-testid="shell-account-status">Server unreachable</span>
        <button type="button" data-testid="shell-retry-candidate">Retry</button>
      </div>`;
  }
  if (!isAccountHydrated()) {
    return `
      <div class="account-chip" data-testid="shell-account-chip">
        <span class="account-chip-label" data-testid="shell-account-status">Checking session…</span>
      </div>`;
  }
  if (account === null) {
    return `
      <div class="account-chip" data-testid="shell-account-chip">
        <span class="account-chip-label" data-testid="shell-account-status">Not signed in</span>
        <button type="button" data-testid="shell-enter-account" aria-disabled="${busy}">
          ${busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>`;
  }

  return `
    <div class="account-chip" data-testid="shell-account-chip">
      <a class="account-chip-label" href="/account" data-link data-testid="shell-account-link">
        ${escapeHtml(account.displayLabel)}
      </a>
      <button type="button" class="secondary" data-testid="shell-leave-account" aria-disabled="${busy}">
        ${busy ? 'Signing out…' : 'Sign out'}
      </button>
    </div>`;
}

/** Builds the shell chrome once and returns a handle pages use for the rest of the session. */
export function mountShell(root: HTMLElement, candidate: CandidateIdentity | null): ShellHandle {
  const legalLinks = LEGAL_ROUTES.map(
    (route) =>
      `<li><a href="${route}">${escapeHtml(LEGAL_LABELS[route] ?? route)}</a></li>`,
  ).join('');
  const hostedGoldMaster = candidate?.publicSurface === 'gold_master';

  root.innerHTML = `
    <div class="shell">
      <header class="shell-header">
        <div class="shell-header-inner">
          <a class="wordmark" href="/" data-link>Hallucinated Dungeons</a>
          <nav class="primary-nav" aria-label="Primary">
            <ul>
              <li><a href="/" data-link data-testid="nav-home">Home</a></li>
              <li><a href="/characters" data-link data-testid="nav-characters">Characters</a></li>
              <li><a href="/campaigns" data-link data-testid="nav-campaigns">Tables</a></li>
              <li><a href="/account" data-link data-testid="nav-account">Account</a></li>
              <li data-nav-admin hidden><a href="/admin" data-link data-testid="nav-admin">Admin</a></li>
              ${
                hostedGoldMaster
                  ? ''
                  : '<li><a href="/diagnostics" data-link data-testid="nav-diagnostics">Diagnostics</a></li>'
              }
            </ul>
          </nav>
          <div class="shell-account" data-testid="shell-account-slot"></div>
        </div>
      </header>
      <main id="main" class="shell-main" tabindex="-1"></main>
      <footer class="shell-footer">
        <div class="shell-footer-inner">
          <ul class="footer-legal-links" data-testid="footer-legal-links">${legalLinks}</ul>
          <p class="footer-build-info" data-testid="footer-build-info">
            ${
              candidate === null
                ? 'Connecting…'
                : isHostedPlayerSurface(candidate)
                  ? 'Hallucinated Dungeons · Invite-Only Alpha'
                  : `Blueprint ${escapeHtml(candidate.blueprintVersion)} · Build ${escapeHtml(candidate.candidateId)}`
            }
          </p>
        </div>
      </footer>
    </div>
    <div class="visually-hidden" role="status" aria-live="polite" data-testid="live-region"></div>`;

  const mainElement = root.querySelector<HTMLElement>('#main');
  const liveRegionElement = root.querySelector<HTMLElement>('[data-testid="live-region"]');
  const accountSlotElement = root.querySelector<HTMLElement>('[data-testid="shell-account-slot"]');
  if (mainElement === null || liveRegionElement === null || accountSlotElement === null) {
    throw new Error('Shell failed to initialize its main landmark and live region.');
  }
  const liveRegion = liveRegionElement;
  const accountSlot = accountSlotElement;

  let lastAnnouncement = '';
  let accountBusy = false;

  function announce(message: string): void {
    if (message === lastAnnouncement) {
      return;
    }
    lastAnnouncement = message;
    liveRegion.textContent = message;
  }

  function bindAccountChip(): void {
    accountSlot
      .querySelector<HTMLButtonElement>('[data-testid="shell-retry-candidate"]')
      ?.addEventListener('click', () => {
        window.location.reload();
      });

    accountSlot
      .querySelector<HTMLButtonElement>('[data-testid="shell-enter-account"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || accountBusy || getAccount() !== null) {
            return;
          }
          accountBusy = true;
          renderAccountChip();
          try {
            if (candidate.environmentClass === 'milestone') {
              navigate('/');
              announce('Sign in from the welcome screen to enter.');
              return;
            }
            const account = await signInAccount(candidate);
            announce(`Signed in as ${account.displayLabel}.`);
          } catch (failure) {
            announce(
              failure instanceof ApiFailure
                ? failure.message
                : 'Could not mint a development account.',
            );
          } finally {
            accountBusy = false;
            renderAccountChip();
          }
        })();
      });

    accountSlot
      .querySelector<HTMLButtonElement>('[data-testid="shell-leave-account"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || accountBusy || getAccount() === null) {
            return;
          }
          accountBusy = true;
          renderAccountChip();
          try {
            await signOutAccount(candidate);
            if (candidate.environmentClass === 'milestone') {
              navigate('/', { replace: true });
            }
            announce('Signed out.');
          } catch (failure) {
            announce(
              failure instanceof ApiFailure ? failure.message : 'Could not sign out.',
            );
          } finally {
            accountBusy = false;
            renderAccountChip();
          }
        })();
      });
  }

  function updateAdminNavVisibility(): void {
    const adminItem = root.querySelector<HTMLElement>('[data-nav-admin]');
    if (adminItem === null) {
      return;
    }
    if (!isAccountHydrated()) {
      adminItem.hidden = true;
      return;
    }
    const account = getAccount();
    // Hosted and Local Arena alike: Admin only for explicit bootstrap admins.
    const showAdmin = account?.isBootstrapAdmin === true;
    adminItem.hidden = !showAdmin;
  }

  function renderAccountChip(): void {
    accountSlot.innerHTML = accountChipMarkup(getAccount(), accountBusy, candidate !== null);
    bindAccountChip();
    updateAdminNavVisibility();
  }

  renderAccountChip();
  subscribeAccount(() => {
    if (!accountBusy) {
      renderAccountChip();
    } else {
      updateAdminNavVisibility();
    }
  });

  return {
    mainElement,
    announce,
    setPresentationMode(mode: 'app' | 'welcome' | 'table'): void {
      root.classList.toggle('shell-welcome-mode', mode === 'welcome');
      root.classList.toggle('shell-table-mode', mode === 'table');
    },
    setActiveRoute(path: string): void {
      lastAnnouncement = '';
      liveRegion.textContent = '';
      updateAdminNavVisibility();
      root.querySelectorAll<HTMLAnchorElement>('.primary-nav a[data-link]').forEach((link) => {
        const linkPath = new URL(link.href, window.location.href).pathname;
        const matches =
          linkPath === path ||
          (linkPath === '/characters' && path.startsWith('/characters/')) ||
          (linkPath === '/campaigns' && path.startsWith('/campaigns/')) ||
          (linkPath === '/account' && path === '/account');
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
