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
}

/**
 * Opens an in-app modal and resolves true when the player confirms.
 * Cancel, Escape, and backdrop click resolve false.
 */
export function confirmInApp(options: ConfirmDialogOptions): Promise<boolean> {
  const confirmLabel = options.confirmLabel ?? 'Continue';
  const cancelLabel = options.cancelLabel ?? 'Cancel';
  const testId = options.testId ?? 'confirm-dialog';
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
        <h2 id="${testId}-title">${escapeHtml(options.title)}</h2>
        <p id="${testId}-body">${escapeHtml(options.body)}</p>
        <div class="modal-actions">
          <button type="button" class="secondary" data-testid="${testId}-cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" data-testid="${testId}-confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;

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
    backdrop
      .querySelector<HTMLButtonElement>(`[data-testid="${testId}-confirm"]`)
      ?.addEventListener('click', () => finish(true));

    document.addEventListener('keydown', onKeyDown, true);
    document.body.appendChild(backdrop);
    backdrop.querySelector<HTMLButtonElement>(`[data-testid="${testId}-confirm"]`)?.focus();
  });
}
