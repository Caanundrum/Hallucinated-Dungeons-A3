/**
 * Shared modal / drawer presentation helpers for the table cockpit.
 * Focus trap + Esc/backdrop dismiss for Gemini Phase 1 visualization.
 */

export interface OverlayDismissOptions {
  readonly onClose: () => void;
  readonly restoreFocusTo?: HTMLElement | null;
}

/** Trap Tab within `dialog` and close on Escape. Returns cleanup. */
export function bindModalChrome(
  backdrop: HTMLElement,
  dialog: HTMLElement,
  options: OverlayDismissOptions,
): () => void {
  const previouslyFocused =
    options.restoreFocusTo ??
    (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  const focusables = (): HTMLElement[] =>
    [
      ...dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      options.onClose();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const nodes = focusables();
    if (nodes.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onBackdrop = (event: MouseEvent): void => {
    if (event.target === backdrop) {
      options.onClose();
    }
  };

  backdrop.addEventListener('click', onBackdrop);
  document.addEventListener('keydown', onKeyDown);
  const nodes = focusables();
  (nodes[0] ?? dialog).focus();

  return () => {
    backdrop.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKeyDown);
    previouslyFocused?.focus();
  };
}
