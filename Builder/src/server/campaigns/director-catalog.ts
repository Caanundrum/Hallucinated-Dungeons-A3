/**
 * Approved Game Director catalog for campaign creation.
 *
 * Blueprint ownership: Section 1.5.21. The client renders this catalog; it
 * never invents identity or personality ids. Phase 1 persists the choice as
 * real campaign configuration for the later AI-enabled table.
 */

import {
  DIRECTOR_IDENTITIES,
  DIRECTOR_IDENTITY_LABELS,
  DIRECTOR_IDENTITY_SUMMARIES,
  DIRECTOR_PERSONALITIES,
  DIRECTOR_PERSONALITY_LABELS,
  DIRECTOR_PERSONALITY_SUMMARIES,
  RECOMMENDED_DIRECTOR_PERSONALITY,
  type DirectorCatalog,
  type DirectorIdentity,
  type DirectorPersonality,
  directorAvatarKey,
} from '../../shared/campaign-contract.js';

export const DIRECTOR_CONFIGURATION_NOTICE =
  'This chooses the Game Director identity and personality for the later AI-enabled table. It does not activate AI narration in this Phase 1 build.';

export function buildDirectorCatalog(): DirectorCatalog {
  return {
    identities: DIRECTOR_IDENTITIES.map((id) => ({
      id,
      label: DIRECTOR_IDENTITY_LABELS[id],
      summary: DIRECTOR_IDENTITY_SUMMARIES[id],
    })),
    personalities: DIRECTOR_PERSONALITIES.map((id) => ({
      id,
      label: DIRECTOR_PERSONALITY_LABELS[id],
      summary: DIRECTOR_PERSONALITY_SUMMARIES[id],
      recommended: id === RECOMMENDED_DIRECTOR_PERSONALITY,
    })),
    configurationNotice: DIRECTOR_CONFIGURATION_NOTICE,
  };
}

export function resolveDirectorConfiguration(options: {
  readonly identity: DirectorIdentity;
  readonly personality: DirectorPersonality;
  readonly lockedAt: Date;
}): {
  readonly identity: DirectorIdentity;
  readonly personality: DirectorPersonality;
  readonly avatarKey: string;
  readonly lockedAt: Date;
} {
  return {
    identity: options.identity,
    personality: options.personality,
    avatarKey: directorAvatarKey(options.identity, options.personality),
    lockedAt: options.lockedAt,
  };
}
