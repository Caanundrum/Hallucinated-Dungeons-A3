/**
 * Director avatar asset lookup — Phase 5 + Phase 2 painted portraits.
 *
 * Blueprint ownership: Section 25 Phase 5 build scope item 3 ("final
 * personality-specific Director avatar set (6× Veyra + 6× Garrick = 12)").
 * Avatar art is identity × personality, matching `directorAvatarKey()` in
 * `campaign-contract.ts`. Painted identity portraits supersede the earlier
 * silhouette SVGs for lobby and selection chrome. Pages must still render an
 * accessible text fallback (name + personality) if an asset fails to load —
 * this module never invents a substitute image.
 */

import type { DirectorIdentity } from '../shared/campaign-contract.js';
import { DIRECTOR_IDENTITY_LABELS, isDirectorIdentity } from '../shared/campaign-contract.js';

import veyraPainted from './assets/directors/veyra-painted.webp';
import garrickPainted from './assets/directors/garrick-painted.webp';

/** Painted identity portraits used across lobby, create, and campaign detail. */
const DIRECTOR_PAINTED_PORTRAITS: Readonly<Record<DirectorIdentity, string>> = {
  veyra: veyraPainted,
  garrick: garrickPainted,
};

/** Resolve painted portrait URL for an identity id. */
export function directorPaintedPortraitPath(identity: DirectorIdentity): string {
  return DIRECTOR_PAINTED_PORTRAITS[identity];
}

/** Map a player-facing identity label (or avatar key) to an identity id. */
export function directorIdentityFromLabelOrKey(value: string): DirectorIdentity | null {
  const trimmed = value.trim();
  if (isDirectorIdentity(trimmed)) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('veyra')) {
    return 'veyra';
  }
  if (lower.startsWith('garrick')) {
    return 'garrick';
  }
  for (const [id, label] of Object.entries(DIRECTOR_IDENTITY_LABELS) as [
    DirectorIdentity,
    string,
  ][]) {
    if (label.toLowerCase() === lower) {
      return id;
    }
  }
  return null;
}

/** Asset URL for a `directorAvatarKey()` value, or null when no art is defined. */
export function directorAvatarAssetPath(avatarKey: string): string | null {
  const identity = directorIdentityFromLabelOrKey(avatarKey);
  if (identity === null) {
    return null;
  }
  return DIRECTOR_PAINTED_PORTRAITS[identity];
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Markup for one Director avatar. When no asset exists for `avatarKey` this
 * renders the accessible text fallback directly — never a synthesized image.
 */
export function directorAvatarMarkup(options: {
  readonly avatarKey: string;
  readonly label: string;
  readonly testId: string;
  readonly className?: string;
}): string {
  const assetPath = directorAvatarAssetPath(options.avatarKey);
  const className = options.className ?? 'director-avatar';
  if (assetPath === null) {
    return `<span class="${className} director-avatar-fallback" data-testid="${options.testId}-fallback">${escapeAttribute(options.label)}</span>`;
  }
  return `<img class="${className}" data-testid="${options.testId}" src="${escapeAttribute(assetPath)}" alt="${escapeAttribute(options.label)}" width="128" height="128" loading="lazy" decoding="async" />`;
}

/** Compact portrait chip for lobby rows and identity radio cards. */
export function directorPortraitChipMarkup(options: {
  readonly identity: DirectorIdentity;
  readonly label?: string;
  readonly testId: string;
  readonly className?: string;
}): string {
  const label = options.label ?? DIRECTOR_IDENTITY_LABELS[options.identity];
  return directorAvatarMarkup({
    avatarKey: options.identity,
    label,
    testId: options.testId,
    className: options.className ?? 'director-avatar director-avatar-chip',
  });
}

/**
 * Wires a runtime fallback for an avatar `<img>` that fails to load (for
 * example a build where the asset was not copied). Swaps the image for the
 * same accessible text fallback `directorAvatarMarkup` would have rendered.
 */
export function bindDirectorAvatarFallback(container: ParentNode, testId: string, label: string): void {
  const image = container.querySelector<HTMLImageElement>(`[data-testid="${testId}"]`);
  if (image === null) {
    return;
  }
  image.addEventListener(
    'error',
    () => {
      const fallback = document.createElement('span');
      fallback.className = `${image.className} director-avatar-fallback`;
      fallback.dataset.testid = `${testId}-fallback`;
      fallback.textContent = label;
      image.replaceWith(fallback);
    },
    { once: true },
  );
}
