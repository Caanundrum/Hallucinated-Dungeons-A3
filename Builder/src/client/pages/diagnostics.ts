/**
 * The Local Arena diagnostics page — the relocated Phase 0 foundation-check
 * journey.
 *
 * Blueprint ownership: Section 25 Phase 0 build scope originally, carried
 * forward per the Phase 1 execution pack: "The Phase 0 foundation-check
 * surface is scaffolding for the foundation proof, not a product feature.
 * Phase 1 may retire the player-facing page once a real shell exists, but it
 * must keep the smoke spine's canonical write/read segment working against
 * whatever replaces it." This page is that segment, now reachable at
 * `/diagnostics` inside the real shell instead of owning the whole site.
 *
 * Canonical Projection Binding (Section 1.2) still governs it: the recorded
 * list is always rendered from a server response, never a local echo.
 */

import {
  FOUNDATION_NOTE_MAX_LENGTH,
  ERROR_CODES,
  type DevelopmentIdentityProjection,
  type FoundationProjection,
} from '../../shared/contract.js';
import {
  ApiFailure,
  enterLocalArena,
  fetchProjection,
  fetchSession,
  leaveLocalArena,
  recordFoundationCheck,
} from '../api.js';
import { setAccountFromServer } from '../account-session.js';
import { escapeHtml } from '../dom-utils.js';
import type { PageHost } from './home.js';

interface DiagnosticsState {
  identity: DevelopmentIdentityProjection | null;
  projection: FoundationProjection | null;
  pendingRequestId: string | null;
  pendingNote: string;
  busy: boolean;
  error: { code: string; message: string } | null;
  notice: string | null;
  staleCandidate: boolean;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function mountDiagnosticsPage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Local Arena diagnostics');

  const state: DiagnosticsState = {
    identity: null,
    projection: null,
    pendingRequestId: null,
    pendingNote: '',
    busy: false,
    error: null,
    notice: null,
    staleCandidate: false,
  };

  function identityPanel(): string {
    if (state.identity === null) {
      return `
      <section class="panel" aria-labelledby="identity-heading">
        <h2 id="identity-heading">Enter the Local Arena</h2>
        <p>
          The server mints a temporary development identity for local testing. There is no password
          to create or store, and this route exists only in the Local Execution Environment.
        </p>
        <div class="actions">
          <button type="button" data-testid="enter-arena" aria-disabled="${state.busy}">
            ${state.busy ? 'Entering…' : 'Enter the Local Arena'}
          </button>
        </div>
      </section>`;
    }

    return `
      <section class="panel" aria-labelledby="identity-heading">
        <h2 id="identity-heading">Signed in for local testing</h2>
        <p>
          Account <b data-testid="account-id">${escapeHtml(state.identity.accountId)}</b>
          (${escapeHtml(state.identity.displayLabel)}), session expires
          ${escapeHtml(formatTimestamp(state.identity.expiresAt))}.
        </p>
        <div class="actions">
          <button type="button" class="secondary" data-testid="leave-arena" aria-disabled="${state.busy}">
            Leave the Local Arena
          </button>
        </div>
      </section>`;
  }

  function messageMarkup(): string {
    if (state.error !== null) {
      const retryable =
        state.pendingRequestId !== null && state.error.code === ERROR_CODES.UPSTREAM_UNAVAILABLE;
      return `
      <div class="message error" role="alert" tabindex="-1" data-testid="error-message" data-error-code="${escapeHtml(state.error.code)}">
        <span>${escapeHtml(state.error.message)}</span>
        ${
          retryable
            ? `<div class="actions message-actions">
                 <button type="button" data-testid="retry-submission" aria-disabled="${state.busy}">
                   Retry this submission
                 </button>
               </div>`
            : ''
        }
      </div>`;
    }
    if (state.notice !== null) {
      return `<div class="message success" tabindex="-1" data-testid="notice-message">${escapeHtml(state.notice)}</div>`;
    }
    return '';
  }

  function recordPanel(): string {
    if (state.identity === null) {
      return '';
    }

    const projection = state.projection;
    const checks = projection?.checks ?? [];
    const totalCount = projection?.totalCount ?? checks.length;
    const truncated = totalCount > checks.length;

    const list =
      checks.length === 0
        ? '<p class="empty-state" data-testid="empty-state">No foundation checks are stored for this account yet.</p>'
        :         `<ul class="record-list" data-testid="record-list">
            ${checks
              .map(
                (check) => `
              <li data-testid="record-item">
                <span class="record-note" data-testid="record-note">${escapeHtml(check.note)}</span>
                <span class="record-meta">Sequence ${check.sequence} · recorded ${escapeHtml(
                  formatTimestamp(check.recordedAt),
                )} · id ${escapeHtml(check.checkId)}</span>
              </li>`,
              )
              .join('')}
          </ul>`;

    return `
      <section class="panel" aria-labelledby="record-heading">
        <h2 id="record-heading">Record a foundation check</h2>
        <p>
          Recording a check sends your note to the local server, which authorizes it, writes it to
          the Firestore emulator, and returns the stored projection. The list below is always the
          server's answer, never a local copy of what you typed.
        </p>
        <form data-testid="record-form" novalidate>
          <label for="note-input">Foundation check note</label>
          <input
            id="note-input"
            data-testid="note-input"
            type="text"
            maxlength="${FOUNDATION_NOTE_MAX_LENGTH * 2}"
            autocomplete="off"
            value="${escapeHtml(state.pendingNote)}"
            aria-describedby="note-hint"
          />
          <p class="field-hint" id="note-hint">
            Up to ${FOUNDATION_NOTE_MAX_LENGTH} characters. Submitting the same attempt twice
            returns the original record instead of writing a second one.
          </p>
          <div class="actions">
            <button type="submit" data-testid="record-submit" aria-disabled="${state.busy}">
              ${state.busy ? 'Recording…' : 'Record foundation check'}
            </button>
            <button type="button" class="secondary" data-testid="refresh-projection" aria-disabled="${state.busy}">
              Reload from server
            </button>
          </div>
        </form>
      </section>

      <section class="panel" aria-labelledby="stored-heading">
        <h2 id="stored-heading">Stored for this account</h2>
        <p>
          Projection version
          <b data-testid="projection-version">${projection?.projectionVersion ?? 0}</b>.
          ${
            truncated
              ? `<span data-testid="truncation-notice">Showing the ${checks.length} most recent of ${totalCount} stored checks.</span>`
              : ''
          }
        </p>
        ${list}
      </section>`;
  }

  function staleBanner(): string {
    if (!state.staleCandidate) {
      return '';
    }
    return `
      <div class="message error" role="alert" data-testid="stale-candidate-banner">
        This page was loaded from a different candidate than the server is now running. Reload the
        page before recording anything else.
      </div>`;
  }

  function captureFocus(): { testId: string; selectionStart: number | null } | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) {
      return null;
    }
    const testId = active.dataset.testid;
    if (testId === undefined) {
      return null;
    }
    const selectionStart =
      active instanceof HTMLInputElement && active.type === 'text' ? active.selectionStart : null;
    return { testId, selectionStart };
  }

  function restoreFocus(captured: { testId: string; selectionStart: number | null } | null): void {
    if (captured === null) {
      return;
    }
    const target = container.querySelector<HTMLElement>(`[data-testid="${captured.testId}"]`);
    if (target !== null) {
      target.focus();
      if (target instanceof HTMLInputElement && captured.selectionStart !== null) {
        const position = Math.min(captured.selectionStart, target.value.length);
        target.setSelectionRange(position, position);
      }
      return;
    }

    const fallbackSelectors = [
      '[data-testid="error-message"]',
      '[data-testid="notice-message"]',
      '[data-testid="enter-arena"]',
      '[data-testid="record-submit"]',
    ];
    for (const selector of fallbackSelectors) {
      const fallback = container.querySelector<HTMLElement>(selector);
      if (fallback !== null) {
        fallback.focus();
        return;
      }
    }
  }

  function render(): void {
    const captured = captureFocus();

    container.innerHTML = `
      <div class="page">
        <h1 data-testid="diagnostics-heading">Local Arena diagnostics</h1>
        <p class="tagline">
          This page proves the browser, local server, and Firebase emulators form one
          authenticated write and read path. It is Phase 0 evidence kept alive as regression
          coverage, not a player-facing feature of the finished game.
        </p>
        <div class="candidate-strip" data-testid="candidate-strip">
          ${
            candidate === null
              ? 'Contacting the Local Arena server…'
              : `<span>Candidate <b data-testid="candidate-id">${escapeHtml(candidate.candidateId)}</b></span>
                 <span>Environment <b data-testid="environment-class">${escapeHtml(candidate.environmentClass)}</b></span>
                 <span>Mode <b data-testid="runtime-mode">${escapeHtml(candidate.runtimeMode)}</b></span>
                 <span>Emulator project <b>${escapeHtml(candidate.firebaseProjectId)}</b></span>
                 <span>Blueprint <b>${escapeHtml(candidate.blueprintVersion)}</b></span>`
          }
        </div>
        ${staleBanner()}
        ${identityPanel()}
        ${messageMarkup()}
        ${recordPanel()}
      </div>`;

    bindEvents();
    restoreFocus(captured);
    shell.announce(state.error?.message ?? state.notice ?? '');
  }

  function bindEvents(): void {
    container
      .querySelector<HTMLButtonElement>('[data-testid="enter-arena"]')
      ?.addEventListener('click', () => void handleEnter());

    container
      .querySelector<HTMLButtonElement>('[data-testid="leave-arena"]')
      ?.addEventListener('click', () => void handleLeave());

    container
      .querySelector<HTMLButtonElement>('[data-testid="refresh-projection"]')
      ?.addEventListener('click', () => void handleRefresh());

    container
      .querySelector<HTMLButtonElement>('[data-testid="retry-submission"]')
      ?.addEventListener('click', () => void handleSubmit(state.pendingNote, true));

    const form = container.querySelector<HTMLFormElement>('[data-testid="record-form"]');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = container.querySelector<HTMLInputElement>('[data-testid="note-input"]');
      void handleSubmit(input?.value ?? '', false);
    });

    const input = container.querySelector<HTMLInputElement>('[data-testid="note-input"]');
    input?.addEventListener('input', () => {
      state.pendingNote = input.value;
    });
  }

  function applyFailure(failure: unknown): void {
    state.notice = null;

    if (failure instanceof ApiFailure) {
      state.error = { code: failure.code, message: failure.message };
      if (failure.code === ERROR_CODES.CANDIDATE_MISMATCH) {
        state.staleCandidate = true;
      }
      if (
        failure.code === ERROR_CODES.NOT_AUTHENTICATED ||
        failure.code === ERROR_CODES.SESSION_EXPIRED
      ) {
        state.identity = null;
        setAccountFromServer(null);
        state.projection = null;
        state.pendingRequestId = null;
      }
      return;
    }
    const message = failure instanceof Error ? failure.message : String(failure);
    state.error = { code: ERROR_CODES.UPSTREAM_UNAVAILABLE, message };
  }

  async function handleEnter(): Promise<void> {
    if (candidate === null || state.busy) {
      return;
    }
    state.busy = true;
    state.error = null;
    state.notice = null;
    render();

    try {
      state.identity = await enterLocalArena(candidate.candidateId);
      setAccountFromServer(state.identity);
      state.projection = await fetchProjection();
      state.notice = `Signed in as ${state.identity.accountId}.`;
    } catch (failure) {
      applyFailure(failure);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function handleLeave(): Promise<void> {
    if (candidate === null || state.busy) {
      return;
    }
    state.busy = true;
    state.error = null;
    state.notice = null;
    render();

    try {
      await leaveLocalArena(candidate.candidateId);
      state.identity = null;
      setAccountFromServer(null);
      state.projection = null;
      state.pendingRequestId = null;
      state.pendingNote = '';
      state.notice = 'Session ended. The stored records remain owned by that account.';
    } catch (failure) {
      applyFailure(failure);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function handleRefresh(): Promise<void> {
    if (state.busy) {
      return;
    }
    state.busy = true;
    state.error = null;
    state.notice = null;
    render();

    try {
      state.projection = await fetchProjection();
      state.notice = 'Reloaded the stored projection from the server.';
    } catch (failure) {
      applyFailure(failure);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function handleSubmit(note: string, isRetry: boolean): Promise<void> {
    if (candidate === null || state.busy) {
      return;
    }

    state.pendingNote = note;
    if (!isRetry || state.pendingRequestId === null) {
      state.pendingRequestId = crypto.randomUUID();
    }
    const requestId = state.pendingRequestId;

    state.busy = true;
    state.error = null;
    state.notice = null;
    render();

    try {
      const result = await recordFoundationCheck({
        candidateId: candidate.candidateId,
        requestId,
        note,
      });
      state.projection = await fetchProjection();
      state.notice = result.duplicate
        ? `That attempt was already recorded as sequence ${result.check.sequence}. Nothing was written twice.`
        : `Recorded sequence ${result.check.sequence}.`;
      state.pendingRequestId = null;
      state.pendingNote = '';
    } catch (failure) {
      applyFailure(failure);
    } finally {
      state.busy = false;
      render();
    }
  }

  render();

  void (async () => {
    try {
      state.identity = await fetchSession();
      setAccountFromServer(state.identity);
      state.projection = await fetchProjection();
      render();
    } catch (failure) {
      if (!(failure instanceof ApiFailure) || failure.code !== ERROR_CODES.NOT_AUTHENTICATED) {
        applyFailure(failure);
        render();
      }
    }
  })();
}
