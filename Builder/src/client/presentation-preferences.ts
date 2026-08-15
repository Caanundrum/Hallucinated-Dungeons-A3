/**
 * Applies account presentation preferences to the document root.
 *
 * Blueprint ownership: Phase 2 table a11y — reduced motion and low-effects must
 * reach the tactical table, not only the Account page after a visit.
 */

export function applyPresentationPreferences(options: {
  readonly reducedMotion: boolean;
  readonly lowEffects: boolean;
}): void {
  document.documentElement.classList.toggle('hd-reduced-motion', options.reducedMotion);
  document.documentElement.classList.toggle('hd-low-effects', options.lowEffects);
  document.documentElement.dataset.reducedMotion = options.reducedMotion ? 'true' : 'false';
  document.documentElement.dataset.lowEffects = options.lowEffects ? 'true' : 'false';
}

export function clearPresentationPreferences(): void {
  applyPresentationPreferences({ reducedMotion: false, lowEffects: false });
}
