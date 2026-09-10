/**
 * Site-contained confirmation dialog (replaces window.confirm).
 * Uses the shared .modal-backdrop / .modal-dialog styling.
 */

import { escapeHtml } from './dom-utils.js';

export interface ConfirmDialogOptions {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly testId?: string;
  /**
   * When set, Confirm stays disabled until the player types this phrase exactly
   * (trimmed comparison). Use the character or campaign name for destructive deletes.
   */
  readonly requireTypedPhrase?: string;
  readonly typedPhraseLabel?: string;
}

/**
 * Opens an in-app modal and resolves true when the player confirms.
 * Cancel, Escape, and backdrop click resolve false.
 */
export function confirmInApp(options: ConfirmDialogOptions): Promise<boolean> {
  const confirmLabel = options.confirmLabel ?? 'Continue';
  const cancelLabel = options.cancelLabel ?? 'Cancel';
  const testId = options.testId ?? 'confirm-dialog';
  const requiredPhrase = options.requireTypedPhrase?.trim() ?? '';
  const typedPhraseLabel =
    options.typedPhraseLabel ??
    (requiredPhrase.length > 0 ? `Type ${requiredPhrase} to confirm` : '');
  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.dataset.testid = testId;
    backdrop.setAttribute('role', 'presentation');
    const typedField =
      requiredPhrase.length > 0
        ? `<label class="field-label" for="${testId}-typed-phrase">${escapeHtml(typedPhraseLabel)}</label>
           <input id="${testId}-typed-phrase" type="text" autocomplete="off" spellcheck="false"
             data-testid="${testId}-typed-phrase" placeholder="${escapeHtml(requiredPhrase)}" />
           <p class="record-meta" data-testid="${testId}-typed-hint">Confirm stays locked until the name matches exactly.</p>`
        : '';
    backdrop.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true"
        aria-labelledby="${testId}-title" aria-describedby="${testId}-body" tabindex="-1">
        <h2 id="${testId}-title">${escapeHtml(options.title)}</h2>
        <p id="${testId}-body">${escapeHtml(options.body)}</p>
        ${typedField}
        <div class="modal-actions">
          <button type="button" class="secondary" data-testid="${testId}-cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="danger" data-testid="${testId}-confirm"
            ${requiredPhrase.length > 0 ? 'aria-disabled="true"' : ''}>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;

    const confirmButton = backdrop.querySelector<HTMLButtonElement>(
      `[data-testid="${testId}-confirm"]`,
    );
    const typedInput = backdrop.querySelector<HTMLInputElement>(
      `[data-testid="${testId}-typed-phrase"]`,
    );

    const phraseMatches = (): boolean => {
      if (requiredPhrase.length === 0) {
        return true;
      }
      return (typedInput?.value.trim() ?? '') === requiredPhrase;
    };

    const syncConfirmEnabled = () => {
      if (confirmButton === null || requiredPhrase.length === 0) {
        return;
      }
      confirmButton.setAttribute('aria-disabled', phraseMatches() ? 'false' : 'true');
    };

    const finish = (accepted: boolean) => {
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      previouslyFocused?.focus();
      resolve(accepted);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    };

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        finish(false);
      }
    });
    backdrop
      .querySelector<HTMLButtonElement>(`[data-testid="${testId}-cancel"]`)
      ?.addEventListener('click', () => finish(false));
    confirmButton?.addEventListener('click', () => {
      if (!phraseMatches()) {
        typedInput?.focus();
        return;
      }
      finish(true);
    });
    typedInput?.addEventListener('input', () => syncConfirmEnabled());
    typedInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (phraseMatches()) {
          finish(true);
        }
      }
    });

    document.addEventListener('keydown', onKeyDown, true);
    document.body.appendChild(backdrop);
    syncConfirmEnabled();
    if (typedInput !== null) {
      typedInput.focus();
    } else {
      confirmButton?.focus();
    }
  });
}

export interface WrongResolutionReportResult {
  readonly reason: string;
  readonly audience: 'public' | 'private';
}

/** Confirm + reason + audience for wrong-resolution reports. Cancel returns null. */
export function promptWrongResolutionReport(options: {
  readonly targetPreview: string;
  readonly testId?: string;
}): Promise<WrongResolutionReportResult | null> {
  const testId = options.testId ?? 'wrong-resolution-report';
  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.dataset.testid = testId;
    backdrop.setAttribute('role', 'presentation');
    backdrop.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true"
        aria-labelledby="${testId}-title" aria-describedby="${testId}-body" tabindex="-1">
        <h2 id="${testId}-title">Report wrong resolution</h2>
        <p id="${testId}-body">Describe what was wrong about this beat. Your note will help the Director correct the table.</p>
        <p class="record-meta" data-testid="${testId}-preview">${escapeHtml(options.targetPreview)}</p>
        <label class="field-label" for="${testId}-reason">What should have happened?</label>
        <textarea id="${testId}-reason" data-testid="${testId}-reason" rows="4"
          placeholder="Required — be specific about map state, roll, or narration."></textarea>
        <fieldset class="option-list compact" data-testid="${testId}-audience">
          <legend class="field-label">Where should this go?</legend>
          <label class="option selected">
            <input type="radio" name="${testId}-audience" value="private" checked
              data-testid="${testId}-audience-private" />
            <span class="option-label">Private to the Director</span>
            <span class="option-summary">Ask the Director dock only — not a public table beat.</span>
          </label>
          <label class="option">
            <input type="radio" name="${testId}-audience" value="public"
              data-testid="${testId}-audience-public" />
            <span class="option-label">Public table note</span>
            <span class="option-summary">Posts a system beat on the shared Play timeline.</span>
          </label>
        </fieldset>
        <p class="message error" hidden data-testid="${testId}-error" role="alert"></p>
        <div class="modal-actions">
          <button type="button" class="secondary" data-testid="${testId}-cancel">Cancel</button>
          <button type="button" data-testid="${testId}-confirm">Submit report</button>
        </div>
      </div>`;

    const reason = backdrop.querySelector<HTMLTextAreaElement>(`[data-testid="${testId}-reason"]`);
    const errorEl = backdrop.querySelector<HTMLElement>(`[data-testid="${testId}-error"]`);

    const finish = (result: WrongResolutionReportResult | null) => {
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      previouslyFocused?.focus();
      resolve(result);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      }
    };

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        finish(null);
      }
    });
    backdrop
      .querySelector<HTMLButtonElement>(`[data-testid="${testId}-cancel"]`)
      ?.addEventListener('click', () => finish(null));
    backdrop
      .querySelector<HTMLButtonElement>(`[data-testid="${testId}-confirm"]`)
      ?.addEventListener('click', () => {
        const text = reason?.value.trim() ?? '';
        if (text.length < 8) {
          if (errorEl !== null) {
            errorEl.hidden = false;
            errorEl.textContent = 'Add a short reason (at least a sentence) before submitting.';
          }
          reason?.focus();
          return;
        }
        const audienceInput = backdrop.querySelector<HTMLInputElement>(
          `input[name="${testId}-audience"]:checked`,
        );
        const audience = audienceInput?.value === 'public' ? 'public' : 'private';
        finish({ reason: text, audience });
      });

    document.addEventListener('keydown', onKeyDown, true);
    document.body.appendChild(backdrop);
    reason?.focus();
  });
}
