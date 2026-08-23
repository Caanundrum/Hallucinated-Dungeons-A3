/**
 * The Home page: the opening identity sequence, then the persistent shell
 * dashboard.
 *
 * Blueprint ownership: Section 1.8.6 (programmatic-first cinematic asset
 * contract) and Section 25 Phase 1 build scope ("opening identity sequence").
 * No runtime image generation, AI call, remote animation service, iframe,
 * third-party script, or WebGL-only effect forms the title — it is plain
 * semantic text with a CSS-animated reveal and one local, original inline
 * SVG motif, per Design System Manifest v1 Section 10.
 *
 * The intro is a decorative, skippable hero, not a gate: the page's title is
 * plain semantic text present in the DOM regardless of whether the visual
 * sequence has finished or was skipped, and it never blocks reaching the
 * dashboard below it.
 */

import type { CandidateIdentity } from '../../shared/contract.js';
import { BROWSER_SUPPORT_MATRIX } from '../../shared/public-surface-contract.js';
import { escapeHtml } from '../dom-utils.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import type { ShellHandle } from '../shell.js';

export interface PageHost {
  readonly container: HTMLElement;
  readonly shell: ShellHandle;
  readonly candidate: CandidateIdentity | null;
}

/**
 * In-memory only, reset on every full page load. The intro replays once per
 * fresh visit and is not shown again when navigating back to Home within the
 * same session, without persisting anything in browser storage.
 */
let introAlreadyShown = false;

function browserStatusLabel(entry: (typeof BROWSER_SUPPORT_MATRIX)[number]): string {
  switch (entry.status) {
    case 'certified_chromium_class':
      return 'Certified on this candidate (Chromium-class automated evidence)';
    case 'ordinary_regression_when_available':
      return 'Ordinary regression when available — not a full certification claim on this host';
    case 'not_yet_certified':
      return 'Not yet certified for this milestone';
    case 'unsupported':
      if (entry.id === 'phone') {
        return 'Partial support — the tactical table is usable at 390px width, but phone browsers are not certified for the full experience';
      }
      return 'Unsupported for the full tactical table';
  }
}

const DOORWAY_MOTIF = `
  <svg class="intro-motif" width="72" height="72" viewBox="0 0 96 96" fill="none" aria-hidden="true" focusable="false">
    <path d="M20 88 V48 A28 28 0 0 1 76 48 V88" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
    <path d="M12 88 H84" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
    <path d="M30 88 V56" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.6" />
    <path d="M66 88 V56" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.6" />
  </svg>`;

export function mountHomePage(host: PageHost): void {
  const { container, shell, candidate } = host;
  host.shell.setDocumentTitle('Home');

  const showIntro = !introAlreadyShown;

  container.innerHTML = `
    <div class="page page-wide">
      <h1 class="intro-title" data-testid="home-heading">Hallucinated Dungeons</h1>
      ${
        showIntro
          ? `
      <section class="intro-overlay" data-testid="intro-overlay" aria-label="Opening sequence">
        ${DOORWAY_MOTIF}
        <p class="intro-subtitle">
          An original multiplayer tabletop roleplaying project, played through the browser under
          the licensed SRD 5.2.1 rules foundation. This build is a closed, unpaid Alpha under
          active construction.
        </p>
        <div class="actions" style="justify-content: center;">
          <button type="button" data-testid="skip-intro">Skip introduction</button>
        </div>
      </section>`
          : ''
      }
      <section class="panel" aria-labelledby="status-heading">
        <h2 id="status-heading">What's here right now</h2>
        <p>
          ${
            candidate?.environmentClass === 'milestone'
              ? 'This invite-only Alpha opens with Google Sign-In. Forge heroes in the Character Vault, gather a party, and choose who narrates your world when you create a campaign.'
              : candidate?.publicSurface === 'gold_master'
              ? 'Sign in with Google, shape a hero in the Character Vault, and gather a party around a narrator you choose when you create a campaign.'
              : 'This Local Arena build may mint a development account for testing. Hosted Gold Master artifacts use Google Sign-In only and strip development identities, QA fixtures, and the QA harness. Create characters in the Character Vault and create or join campaigns with a locked Game Director identity and personality.'
          }
        </p>
        <div class="actions">
          <a href="/account" data-link data-testid="home-account-link">Open Account</a>
          <a href="/characters" data-link data-testid="home-characters-link">Open the Character Vault</a>
          <a href="/campaigns" data-link data-testid="home-campaigns-link">Open Campaigns</a>
        </div>
        ${
          candidate?.publicSurface === 'gold_master'
            ? ''
            : `<p class="record-meta">
          <a href="/diagnostics" data-link data-testid="home-diagnostics-link">Local Arena diagnostics</a>
          (foundation write/read path for builders — not required for play; stripped from Gold Master artifacts).
        </p>`
        }
      </section>
      <section class="panel" aria-labelledby="browser-support-heading">
        <h2 id="browser-support-heading">Certified browsers and devices</h2>
        <p class="record-meta">
          Support is release-tested rather than assumed. A browser listed here as not yet certified
          is not a claim of Safari or tablet hardware evidence.
        </p>
        <ul class="support-matrix" data-testid="browser-support-matrix">
          ${BROWSER_SUPPORT_MATRIX.map(
            (entry) => `
            <li data-testid="browser-support-${escapeHtml(entry.id)}" data-support-status="${escapeHtml(entry.status)}">
              <strong>${escapeHtml(entry.label)}</strong>
              — ${escapeHtml(browserStatusLabel(entry))}
            </li>`,
          ).join('')}
        </ul>
      </section>
        ${
          isHostedPlayerSurface(candidate)
            ? ''
            : `<div class="candidate-strip" data-testid="candidate-strip">
        ${
          candidate === null
            ? 'Contacting the Local Arena server…'
            : `<span>Candidate <b data-testid="candidate-id">${escapeHtml(candidate.candidateId)}</b></span>
               <span>Environment <b data-testid="environment-class">${escapeHtml(candidate.environmentClass)}</b></span>
               <span>Surface <b data-testid="public-surface">${escapeHtml(candidate.publicSurface)}</b></span>
               <span>Blueprint <b>${escapeHtml(candidate.blueprintVersion)}</b></span>`
        }
      </div>`
        }
    </div>`;

  container
    .querySelector<HTMLButtonElement>('[data-testid="skip-intro"]')
    ?.addEventListener('click', () => {
      introAlreadyShown = true;
      container.querySelector('[data-testid="intro-overlay"]')?.remove();
      shell.announce('Introduction skipped.');
    });

  if (showIntro) {
    introAlreadyShown = true;
  }
}
