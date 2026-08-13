/**
 * Shared campaign, Director-configuration, membership, and seat contract.
 *
 * Blueprint ownership: Sections 1.5.4 / 1.5.21 (campaign owner and locked
 * Director identity/personality), 7.6 (invitations), 7.7 / 7.7.2 (ownership
 * and seats), and 25 Phase 1 build scope (campaign creation, invitations,
 * membership, seats — configuration for the later AI-enabled table, not fake
 * AI behavior).
 *
 * Terminology: Game Director identities are product names Veyra and Garrick.
 * Personality labels are the approved catalog names. Avatar is derived from
 * identity + personality; it is not a third independent choice.
 */

/** Approved Game Director identities. Exactly one player-facing name each. */
export const DIRECTOR_IDENTITIES = ['veyra', 'garrick'] as const;
export type DirectorIdentity = (typeof DIRECTOR_IDENTITIES)[number];

export const DIRECTOR_IDENTITY_LABELS: Record<DirectorIdentity, string> = {
  veyra: 'Veyra',
  garrick: 'Garrick',
};

/**
 * Approved campaign-wide Director personalities. Friendly Adventurer may be
 * recommended in the UI; it must never be silently selected.
 */
export const DIRECTOR_PERSONALITIES = [
  'friendly_adventurer',
  'encouraging_guide',
  'sassy_companion',
  'dry_storyteller',
  'dramatic_chronicler',
] as const;
export type DirectorPersonality = (typeof DIRECTOR_PERSONALITIES)[number];

export const DIRECTOR_PERSONALITY_LABELS: Record<DirectorPersonality, string> = {
  friendly_adventurer: 'Friendly Adventurer',
  encouraging_guide: 'Encouraging Guide',
  sassy_companion: 'Sassy Companion',
  dry_storyteller: 'Dry Storyteller',
  dramatic_chronicler: 'Dramatic Chronicler',
};

/** Plain-language summaries shown during campaign creation. */
export const DIRECTOR_PERSONALITY_SUMMARIES: Record<DirectorPersonality, string> = {
  friendly_adventurer: 'Warm, clear, collaborative, lightly playful.',
  encouraging_guide: 'Supportive, patient, and steady when the table is unsure.',
  sassy_companion: 'Sharp wit and playful pushback without cruelty.',
  dry_storyteller: 'Understated, precise, and wry about outcomes.',
  dramatic_chronicler: 'Bold framing and heightened narrative presence.',
};

export const DIRECTOR_IDENTITY_SUMMARIES: Record<DirectorIdentity, string> = {
  veyra: 'Female Game Director identity. One player-facing name: Veyra.',
  garrick: 'Male Game Director identity. One player-facing name: Garrick.',
};

/** Friendly Adventurer may be visually recommended; never auto-committed. */
export const RECOMMENDED_DIRECTOR_PERSONALITY: DirectorPersonality = 'friendly_adventurer';

/** Maximum length of a campaign title. */
export const CAMPAIGN_NAME_MAX_LENGTH = 80;

/** Maximum length of an optional campaign summary. */
export const CAMPAIGN_SUMMARY_MAX_LENGTH = 280;

export type CampaignMemberRole = 'owner' | 'player';

export type SeatRole = 'player';

/**
 * Deterministic avatar key from identity + personality. Later art attaches
 * without changing the campaign schema.
 */
export function directorAvatarKey(
  identity: DirectorIdentity,
  personality: DirectorPersonality,
): string {
  return `${identity}__${personality}`;
}

export function isDirectorIdentity(value: unknown): value is DirectorIdentity {
  return typeof value === 'string' && (DIRECTOR_IDENTITIES as readonly string[]).includes(value);
}

export function isDirectorPersonality(value: unknown): value is DirectorPersonality {
  return (
    typeof value === 'string' && (DIRECTOR_PERSONALITIES as readonly string[]).includes(value)
  );
}

/** Catalog the creation UI renders; never invent ids client-side. */
export interface DirectorCatalog {
  readonly identities: readonly {
    readonly id: DirectorIdentity;
    readonly label: string;
    readonly summary: string;
  }[];
  readonly personalities: readonly {
    readonly id: DirectorPersonality;
    readonly label: string;
    readonly summary: string;
    readonly recommended: boolean;
  }[];
  readonly configurationNotice: string;
}

export interface DirectorConfiguration {
  readonly identity: DirectorIdentity;
  readonly identityLabel: string;
  readonly personality: DirectorPersonality;
  readonly personalityLabel: string;
  readonly avatarKey: string;
  readonly lockedAt: string;
}

export interface CampaignProjection {
  readonly campaignId: string;
  readonly name: string;
  readonly summary: string;
  readonly ownerAccountId: string;
  readonly ownerDisplayLabel: string;
  readonly membershipRole: CampaignMemberRole;
  readonly director: DirectorConfiguration;
  readonly memberCount: number;
  readonly seatCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * True when this account owns the campaign. Owning a campaign never grants
   * ownership of another player's character.
   */
  readonly isCampaignOwner: boolean;
}

export interface CampaignListProjection {
  readonly accountId: string;
  readonly campaigns: readonly CampaignProjection[];
}

/** Bounded preview before authentication (Section 7.6 / 8.8). */
export interface InvitationPreview {
  readonly inviteCode: string;
  readonly campaignName: string;
  readonly hostDisplayLabel: string;
  readonly contentProfileSummary: string;
  readonly sessionStateLabel: string;
  readonly requiresSignIn: true;
  readonly directorIdentityLabel: string;
  readonly directorPersonalityLabel: string;
  readonly configurationNotice: string;
}

export interface InvitationCreatedProjection {
  readonly inviteCode: string;
  readonly invitePath: string;
  readonly campaignId: string;
  readonly createdAt: string;
}

export interface MembershipProjection {
  readonly membershipId: string;
  readonly campaignId: string;
  readonly accountId: string;
  readonly displayLabel: string;
  readonly role: CampaignMemberRole;
  readonly joinedAt: string;
}

export interface SeatProjection {
  readonly seatId: string;
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly characterId: string;
  readonly characterName: string;
  readonly role: SeatRole;
  readonly deviceSessionId: string;
  readonly createdAt: string;
  readonly renewedAt: string;
  readonly expiresAt: string;
  readonly lastAcknowledgedEventSequence: number;
}

export interface CampaignDetailProjection {
  readonly campaign: CampaignProjection;
  readonly members: readonly MembershipProjection[];
  readonly seats: readonly SeatProjection[];
  readonly openInvitation: InvitationCreatedProjection | null;
  readonly ownSeat: SeatProjection | null;
  readonly ownCharacters: readonly {
    readonly characterId: string;
    readonly name: string;
    readonly summary: string;
  }[];
}
