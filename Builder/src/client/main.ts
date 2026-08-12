/**
 * Phase 0 Local Arena page.
 *
 * Blueprint ownership: Section 25 Phase 0 player journey — enter with a
 * development identity, cause a server-authorized emulator write, and see the
 * persisted result rendered back from the server projection.
 *
 * Two rules shape this file:
 *
 * - Canonical Projection Binding (Section 1.2): the recorded list is always
 *   rendered from a server response. Typing a note never adds a row, and a
 *   failed submission never leaves one behind.
 * - Section 1.1 completeness: every failure state is visible and explained,
 *   whatever the player was doing when it happened.
 */

import {
  FOUNDATION_NOTE_MAX_LENGTH,
  ERROR_CODES,
  type CandidateIdentity,
  type DevelopmentIdentityProjection,
  type FoundationProjection,
} from '../shared/contract.js';
import {
  ApiFailure,
  enterLocalArena,
  fetchCandidate,
  fetchProjection,
  fetchSession,
  leaveLocalArena,
  recordFoundationCheck,
} from './api.js';

interface PageState {
  candidate: CandidateIdentity | null;
  identity: DevelopmentIdentityProjection | null;
  projection: FoundationProjection | null;
  /**
   * The request identifier for the submission currently being attempted. It is
   * preserved across retries so a retry re-sends the same intent instead of
   * creating a second record.
   */
  pendingRequestId: string | null;
  pendingNote: string;
  busy: boolean;
  error: { code: string; message: string } | null;
  notice: string | null;
  staleCandidate: boolean;
}

const state: PageState = {
  candidate: null,
  identity: null,
  projection: null,
  pendingRequestId: null,
  pendingNote: '',
  busy: false,
  error: null,
  notice: null,
  staleCandidate: false,
};

const root = document.querySelector<HTMLDivElement>('#app');
if (root === null) {
  throw new Error('Page shell is missing its #app mount point.');
}

// Controls are marked busy with `aria-disabled` rather than the `disabled`
// attribute. A disabled control cannot hold focus, so disabling it during an
// in-flight request would drop a keyboard user back to the top of the page.
// Every handler guards on `state.busy`, so a click on a busy control does
// nothing either way.

// The shell is built once. The live region in particular must survive every
// re-render: an assistive technology cannot announce into an element that is
// destroyed and recreated between the update and the announcement.
root.innerHTML = `
  <div class="layout" id="hd-layout"></div>
  <div class="visually-hidden" role="status" aria-live="polite" data-testid="live-region"></div>`;

const layout = root.querySelector<HTMLDivElement>('#hd-layout');
const liveRegion = root.querySelector<HTMLDivElement>('[data-testid="live-region"]');
if (layout === null || liveRegion === null) {
  throw new Error('Page shell failed to initialize its layout and live region.');
}
const layoutRoot: HTMLDivElement = layout;
const liveRegionRoot: HTMLDivElement = liveRegion;

let lastAnnouncement = '';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function candidateStrip(): string {
  if (state.candidate === null) {
    return '<div class="candidate-strip" data-testid="candidate-strip">Contacting the Local Arena server…</div>';
  }
  const { candidateId, environmentClass, runtimeMode, firebaseProjectId, blueprintVersion } =
    state.candidate;
  return `
    <div class="candidate-strip" data-testid="candidate-strip">
      <span>Candidate <b data-testid="candidate-id">${escapeHtml(candidateId)}</b></span>
      <span>Environment <b data-testid="environment-class">${escapeHtml(environmentClass)}</b></span>
      <span>Mode <b data-testid="runtime-mode">${escapeHtml(runtimeMode)}</b></span>
      <span>Emulator project <b>${escapeHtml(firebaseProjectId)}</b></span>
      <span>Blueprint <b>${escapeHtml(blueprintVersion)}</b></span>
    </div>`;
}

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

/**
 * The message region is rendered independently of the record form so that a
 * failure which signs the player out is still explained on screen.
 */
function messageMarkup(): string {
  if (state.error !== null) {
    // Retrying only makes sense when the outcome of the attempt is unknown. A
    // rejected note or an expired session needs a different action, not a
    // repeat of the same request.
    const retryable =
      state.pendingRequestId !== null && state.error.code === ERROR_CODES.UPSTREAM_UNAVAILABLE;
    return `
      <div class="message error" role="alert" data-testid="error-message" data-error-code="${escapeHtml(state.error.code)}">
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
    return `<div class="message success" data-testid="notice-message">${escapeHtml(state.notice)}</div>`;
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
      : `<ul class="record-list" data-testid="record-list">
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
        Recording a check sends your note to the local server, which authorizes it, writes it to the
        Firestore emulator, and returns the stored projection. The list below is always the server's
        answer, never a local copy of what you typed.
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
          Up to ${FOUNDATION_NOTE_MAX_LENGTH} characters. Submitting the same attempt twice returns
          the original record instead of writing a second one.
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

/**
 * Captures which control had focus, and where the caret was, so a re-render
 * does not drop a keyboard user back to the top of the document.
 */
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
  const target = layoutRoot.querySelector<HTMLElement>(`[data-testid="${captured.testId}"]`);
  if (target === null) {
    return;
  }
  target.focus();
  if (target instanceof HTMLInputElement && captured.selectionStart !== null) {
    const position = Math.min(captured.selectionStart, target.value.length);
    target.setSelectionRange(position, position);
  }
}

/** Announces only when the message actually changes. */
function announce(message: string): void {
  if (message === lastAnnouncement) {
    return;
  }
  lastAnnouncement = message;
  liveRegionRoot.textContent = message;
}

function render(): void {
  const captured = captureFocus();

  layoutRoot.innerHTML = `
    <header>
      <h1>Hallucinated Dungeons — Local Arena</h1>
      <p class="tagline">
        Phase 0 greenfield foundation. This page proves the browser, local server, and Firebase
        emulators form one authenticated write and read path. It is not the game: characters,
        campaigns, the tactical map, and the AI Game Director are built in later phases.
      </p>
    </header>
    ${candidateStrip()}
    ${staleBanner()}
    <main id="main">
      ${identityPanel()}
      ${messageMarkup()}
      ${recordPanel()}
    </main>
    <footer>
      Local Execution Environment only. Canonical state lives in the Firebase Emulator Suite and
      is disposable.
    </footer>`;

  bindEvents();
  restoreFocus(captured);
  announce(state.error?.message ?? state.notice ?? '');
}

function bindEvents(): void {
  layoutRoot
    .querySelector<HTMLButtonElement>('[data-testid="enter-arena"]')
    ?.addEventListener('click', () => void handleEnter());

  layoutRoot
    .querySelector<HTMLButtonElement>('[data-testid="leave-arena"]')
    ?.addEventListener('click', () => void handleLeave());

  layoutRoot
    .querySelector<HTMLButtonElement>('[data-testid="refresh-projection"]')
    ?.addEventListener('click', () => void handleRefresh());

  layoutRoot
    .querySelector<HTMLButtonElement>('[data-testid="retry-submission"]')
    ?.addEventListener('click', () => void handleSubmit(state.pendingNote, true));

  const form = layoutRoot.querySelector<HTMLFormElement>('[data-testid="record-form"]');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = layoutRoot.querySelector<HTMLInputElement>('[data-testid="note-input"]');
    void handleSubmit(input?.value ?? '', false);
  });

  const input = layoutRoot.querySelector<HTMLInputElement>('[data-testid="note-input"]');
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
      // The session is gone, so the identity and projection on screen are no
      // longer true. The typed note is kept so the player does not lose it.
      state.identity = null;
      state.projection = null;
      state.pendingRequestId = null;
    }
    return;
  }

  const message = failure instanceof Error ? failure.message : String(failure);
  state.error = { code: ERROR_CODES.UPSTREAM_UNAVAILABLE, message };
}

async function handleEnter(): Promise<void> {
  if (state.candidate === null || state.busy) {
    return;
  }
  state.busy = true;
  state.error = null;
  state.notice = null;
  render();

  try {
    state.identity = await enterLocalArena(state.candidate.candidateId);
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
  if (state.candidate === null || state.busy) {
    return;
  }
  state.busy = true;
  state.error = null;
  state.notice = null;
  render();

  try {
    await leaveLocalArena(state.candidate.candidateId);
    state.identity = null;
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
  if (state.candidate === null || state.busy) {
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
      candidateId: state.candidate.candidateId,
      requestId,
      note,
    });
    // Re-read rather than trusting the write response so the list on screen is
    // the server's current projection.
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

async function start(): Promise<void> {
  render();
  try {
    state.candidate = await fetchCandidate();
  } catch (failure) {
    applyFailure(failure);
    render();
    return;
  }

  try {
    state.identity = await fetchSession();
    state.projection = await fetchProjection();
  } catch (failure) {
    // A missing session is the ordinary first-visit state, not an error to show.
    if (!(failure instanceof ApiFailure) || failure.code !== ERROR_CODES.NOT_AUTHENTICATED) {
      applyFailure(failure);
    }
  }

  render();
}

void start();
