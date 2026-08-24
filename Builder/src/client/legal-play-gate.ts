/**
 * Legal acceptance gate for play surfaces.
 *
 * Play (table, campaign create, character create, vault play actions) requires
 * acceptance of every current legal document. Viewing the Character Vault
 * remains allowed; creating or resuming characters is gated here on the client
 * and enforced again on sensitive server routes.
 */

import type { CandidateIdentity } from '../shared/contract.js';
import { LEGAL_ROUTES } from '../shared/routes.js';
import {
  acceptLegalDocument,
  fetchLegalAcceptance,
  type LegalAcceptanceProjection,
} from './api.js';
import { escapeHtml } from './dom-utils.js';
import type { ShellHandle } from './shell.js';

export type { LegalAcceptanceProjection } from './api.js';

const LEGAL_LABELS: Record<string, string> = {
  '/legal/terms': 'Terms of Service',
  '/legal/privacy': 'Privacy Notice',
  '/legal/alpha-participation': 'Alpha Participation Terms',
  '/legal/content-and-safety': 'Content and Safety Notice',
};

export function isLegalPlayBlocked(acceptance: LegalAcceptanceProjection | null): boolean {
  return acceptance === null || !acceptance.allCurrentAccepted;
}

export async function loadLegalPlayAcceptance(): Promise<LegalAcceptanceProjection | null> {
  try {
    return await fetchLegalAcceptance();
  } catch {
    return null;
  }
}

export function renderLegalPlayGatePage(options: {
  readonly title: string;
  readonly body: string;
  readonly acceptance: LegalAcceptanceProjection | null;
  readonly candidate: CandidateIdentity | null;
  readonly busy: boolean;
  readonly error: string | null;
}): string {
  const acceptance = options.acceptance;
  return `
    <div class="page">
      <h1 data-testid="legal-play-gate-heading">${escapeHtml(options.title)}</h1>
      <section class="panel account-gate" aria-labelledby="legal-play-gate-panel-heading">
        <h2 id="legal-play-gate-panel-heading">Legal acceptance required</h2>
        <p>${escapeHtml(options.body)}</p>
        <p class="record-meta">
          Record acceptance for each current document below, or open
          <a href="/account" data-link data-testid="legal-play-gate-account-link">Account</a>
          to review them together.
        </p>
        ${
          options.error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="legal-play-gate-error">${escapeHtml(options.error)}</div>`
        }
        <ul data-testid="legal-play-gate-list">
          ${
            acceptance === null
              ? '<li>Acceptance status has not been loaded yet.</li>'
              : acceptance.documents
                  .map(
                    (document) => `
              <li data-testid="legal-play-gate-${escapeHtml(document.route.replace(/\//g, '-'))}">
                <a href="${escapeHtml(document.route)}" target="_blank" rel="noopener noreferrer">${escapeHtml(document.title)}</a>
                — ${escapeHtml(document.version)}
                ${document.accepted ? 'accepted' : 'not yet accepted'}
                <button type="button" class="secondary" data-legal-route="${escapeHtml(document.route)}"
                  data-testid="legal-play-accept-${escapeHtml(document.route.replace(/\//g, '-'))}"
                  aria-label="${document.accepted ? `Accepted ${escapeHtml(document.title)}` : `Record acceptance of ${escapeHtml(document.title)}`}"
                  aria-disabled="${options.busy || document.accepted}">
                  ${document.accepted ? 'Accepted' : 'Record acceptance'}
                </button>
              </li>`,
                  )
                  .join('')
          }
        </ul>
        <p class="record-meta" data-testid="legal-play-gate-summary">
          ${
            acceptance === null
              ? ''
              : acceptance.allCurrentAccepted
                ? 'All current legal documents are accepted. Reload or continue when the page updates.'
                : 'One or more current legal documents still need acceptance before play opens.'
          }
        </p>
        <div class="actions">
          <a href="/account" data-link data-testid="legal-play-gate-open-account">Open Account</a>
        </div>
      </section>
      <p class="record-meta">
        Read each document in full before recording acceptance:
        ${LEGAL_ROUTES.map(
          (route) =>
            `<a href="${route}" target="_blank" rel="noopener noreferrer">${escapeHtml(LEGAL_LABELS[route] ?? route)}</a>`,
        ).join(' · ')}
      </p>
    </div>`;
}

export function renderLegalVaultPlayBarrier(acceptance: LegalAcceptanceProjection | null): string {
  if (!isLegalPlayBlocked(acceptance)) {
    return '';
  }
  return `
    <div class="message notice" role="region" aria-labelledby="legal-vault-barrier-heading"
      data-testid="legal-vault-play-barrier">
      <p id="legal-vault-barrier-heading">
        Character creation and draft resume stay closed until every current legal document is accepted.
      </p>
      <div class="message-actions">
        <a href="/account" data-link data-testid="legal-vault-open-account">Review legal acceptance on Account</a>
      </div>
    </div>`;
}

export function bindLegalPlayGatePage(options: {
  readonly container: HTMLElement;
  readonly shell: ShellHandle;
  readonly candidate: CandidateIdentity | null;
  readonly getAcceptance: () => LegalAcceptanceProjection | null;
  readonly setAcceptance: (next: LegalAcceptanceProjection) => void;
  readonly onUnblocked: () => void;
  readonly setBusy: (busy: boolean) => void;
  readonly setError: (message: string | null) => void;
  readonly render: () => void;
}): void {
  options.container.querySelectorAll<HTMLButtonElement>('[data-legal-route]').forEach((button) => {
    button.addEventListener('click', () => {
      void (async () => {
        if (options.candidate === null || button.getAttribute('aria-disabled') === 'true') {
          return;
        }
        const route = button.dataset.legalRoute;
        if (route === undefined || route.length === 0) {
          return;
        }
        options.setBusy(true);
        options.setError(null);
        options.render();
        try {
          const next = await acceptLegalDocument(options.candidate.candidateId, route);
          options.setAcceptance(next);
          options.shell.announce(`Recorded acceptance of ${route}.`);
          if (next.allCurrentAccepted) {
            options.onUnblocked();
          }
        } catch {
          options.setError('Legal acceptance could not be recorded. Try again from Account.');
        } finally {
          options.setBusy(false);
          options.render();
        }
      })();
    });
  });
}
