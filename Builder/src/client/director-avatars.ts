/**
 * Director avatar asset lookup — Phase 5.
 *
 * Blueprint ownership: Section 25 Phase 5 build scope item 3 ("final
 * personality-specific Director avatar set (6× Veyra + 6× Garrick = 12)").
 * Avatar art is identity × personality, matching `directorAvatarKey()` in
 * `campaign-contract.ts`. Pages must still render an accessible text fallback
 * (name + personality) if an asset fails to load — this module never invents
 * a substitute image.
 */

import veyraSeasonedHost from './assets/directors/veyra__seasoned_host.svg';
import veyraFriendlyAdventurer from './assets/directors/veyra__friendly_adventurer.svg';
import veyraEncouragingGuide from './assets/directors/veyra__encouraging_guide.svg';
import veyraSassyCompanion from './assets/directors/veyra__sassy_companion.svg';
import veyraDryStoryteller from './assets/directors/veyra__dry_storyteller.svg';
import veyraDramaticChronicler from './assets/directors/veyra__dramatic_chronicler.svg';
import garrickSeasonedHost from './assets/directors/garrick__seasoned_host.svg';
import garrickFriendlyAdventurer from './assets/directors/garrick__friendly_adventurer.svg';
import garrickEncouragingGuide from './assets/directors/garrick__encouraging_guide.svg';
import garrickSassyCompanion from './assets/directors/garrick__sassy_companion.svg';
import garrickDryStoryteller from './assets/directors/garrick__dry_storyteller.svg';
import garrickDramaticChronicler from './assets/directors/garrick__dramatic_chronicler.svg';

const DIRECTOR_AVATAR_ASSETS: Readonly<Record<string, string>> = {
  veyra__seasoned_host: veyraSeasonedHost,
  veyra__friendly_adventurer: veyraFriendlyAdventurer,
  veyra__encouraging_guide: veyraEncouragingGuide,
  veyra__sassy_companion: veyraSassyCompanion,
  veyra__dry_storyteller: veyraDryStoryteller,
  veyra__dramatic_chronicler: veyraDramaticChronicler,
  garrick__seasoned_host: garrickSeasonedHost,
  garrick__friendly_adventurer: garrickFriendlyAdventurer,
  garrick__encouraging_guide: garrickEncouragingGuide,
  garrick__sassy_companion: garrickSassyCompanion,
  garrick__dry_storyteller: garrickDryStoryteller,
  garrick__dramatic_chronicler: garrickDramaticChronicler,
};

/** Asset URL for a `directorAvatarKey()` value, or null when no art is defined. */
export function directorAvatarAssetPath(avatarKey: string): string | null {
  return DIRECTOR_AVATAR_ASSETS[avatarKey] ?? null;
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
  return `<img class="${className}" data-testid="${options.testId}" src="${escapeAttribute(assetPath)}" alt="${escapeAttribute(options.label)}" />`;
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
