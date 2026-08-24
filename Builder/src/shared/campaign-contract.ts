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

import type { CampaignSettingsProjection } from './settings-contract.js';

/** Approved Game Director identities. Exactly one player-facing name each. */
export const DIRECTOR_IDENTITIES = ['veyra', 'garrick'] as const;
export type DirectorIdentity = (typeof DIRECTOR_IDENTITIES)[number];

export const DIRECTOR_IDENTITY_LABELS: Record<DirectorIdentity, string> = {
  veyra: 'Veyra',
  garrick: 'Garrick',
};

/**
 * Approved campaign-wide Director personalities. Seasoned Host may be
 * recommended in the UI; it must never be silently selected.
 */
export const DIRECTOR_PERSONALITIES = [
  'seasoned_host',
  'friendly_adventurer',
  'encouraging_guide',
  'sassy_companion',
  'dry_storyteller',
  'dramatic_chronicler',
] as const;
export type DirectorPersonality = (typeof DIRECTOR_PERSONALITIES)[number];

export const DIRECTOR_PERSONALITY_LABELS: Record<DirectorPersonality, string> = {
  seasoned_host: 'Seasoned Host',
  friendly_adventurer: 'Friendly Adventurer',
  encouraging_guide: 'Encouraging Guide',
  sassy_companion: 'Sassy Companion',
  dry_storyteller: 'Dry Storyteller',
  dramatic_chronicler: 'Dramatic Chronicler',
};

/** Plain-language summaries shown during campaign creation. */
export const DIRECTOR_PERSONALITY_SUMMARIES: Record<DirectorPersonality, string> = {
  seasoned_host:
    'Easy with classic table rhythms, lightly knowing humor, and the cadence experienced tables already recognize.',
  friendly_adventurer: 'Warm, clear, collaborative, lightly playful.',
  encouraging_guide: 'Supportive, patient, and steady when the table is unsure.',
  sassy_companion: 'Sharp wit and playful pushback without cruelty.',
  dry_storyteller: 'Understated, precise, and wry about outcomes.',
  dramatic_chronicler: 'Bold framing and heightened narrative presence.',
};

export const DIRECTOR_IDENTITY_SUMMARIES: Record<DirectorIdentity, string> = {
  veyra:
    'Woman; mid-thirties; warm olive complexion; dark hair half-up; amber eyes; lean build; traveler\'s coat, high collar, silver ear cuff. One player-facing name: Veyra.',
  garrick:
    'Man; early forties; fair weathered skin; short salt-and-pepper hair and trimmed beard; grey-blue eyes; solid build; waistcoat, rolled sleeves, leather bracer. One player-facing name: Garrick.',
};

/** Seasoned Host may be visually recommended; never auto-committed. */
export const RECOMMENDED_DIRECTOR_PERSONALITY: DirectorPersonality = 'seasoned_host';

/**
 * Phase 1 campaign-creation preview copy (Section 7.5). Static, approved text —
 * not AI narration. Shown only after identity and personality are both chosen.
 */
export const DIRECTOR_CREATION_PREVIEW: Record<
  DirectorPersonality,
  { readonly sampleScene: string; readonly playRhythm: string }
> = {
  seasoned_host: {
    sampleScene:
      'The door sticks for a beat everyone has felt before. The Director names the room cleanly, lets a familiar tension hang, then asks what the table does — without over-explaining the joke.',
    playRhythm:
      'Classic beats and lightly knowing asides. Fluent in patterns experienced tables recognize; never steals the players’ spotlight.',
  },
  friendly_adventurer: {
    sampleScene:
      'A lantern-lit doorway opens onto a quiet hall. The Director greets the table warmly, names what everyone can see, and invites the first careful look around.',
    playRhythm:
      'Steady scenes with clear choices. Light humor when it fits. Good for mixed-experience tables.',
  },
  encouraging_guide: {
    sampleScene:
      'At a scratched table map, the Director restates the goal in plain words, points out safe options, and waits for the party to decide together.',
    playRhythm:
      'Patient pacing with frequent orientation. Strong support when the table is unsure what to try next.',
  },
  sassy_companion: {
    sampleScene:
      'A smug merchant finishes a pitch. The Director lets the line hang, then offers a wry aside about the price — without stealing the players’ reply.',
    playRhythm:
      'Quicker banter and playful pushback. Wit stays directed at the fiction, never at the players.',
  },
  dry_storyteller: {
    sampleScene:
      'Rain ticks on stone. The Director reports what changed, what is still unknown, and asks for the next action without embroidery.',
    playRhythm:
      'Concise beats and understated humor. Outcomes arrive cleanly; flourish stays spare.',
  },
  dramatic_chronicler: {
    sampleScene:
      'Thunder answers a slammed gate. The Director frames the stakes in bold strokes, then returns control to the party for the next move.',
    playRhythm:
      'Higher tension and cinematic framing, still mechanically clear when rolls and costs matter.',
  },
};

/**
 * Adventure template at campaign creation. Only blank tables are supported —
 * an honest empty table for rules practice, never automated world generation.
 */
export const ADVENTURE_TEMPLATES = ['blank'] as const;
export type AdventureTemplate = (typeof ADVENTURE_TEMPLATES)[number];

export const ADVENTURE_TEMPLATE_LABELS: Record<AdventureTemplate, string> = {
  blank: 'Blank table (no starter adventure)',
};

export const ADVENTURE_TEMPLATE_SUMMARIES: Record<AdventureTemplate, string> = {
  blank:
    'An empty table with no seeded chapters, NPCs, or map presentation. You can improvise chambers during play, but there is no automated world generation.',
};

/** Default on the creation form; blank is the only supported template. */
export const RECOMMENDED_ADVENTURE_TEMPLATE: AdventureTemplate = 'blank';

export function isAdventureTemplate(value: unknown): value is AdventureTemplate {
  return typeof value === 'string' && (ADVENTURE_TEMPLATES as readonly string[]).includes(value);
}

/** Maximum concurrent active player seats at one table. */
export const MAX_ACTIVE_PLAYERS = 4;

/** Table visibility: public tables appear in the open lobby; private tables are invite-only. */
export const CAMPAIGN_VISIBILITY = ['public', 'private'] as const;
export type CampaignVisibility = (typeof CAMPAIGN_VISIBILITY)[number];

export const CAMPAIGN_VISIBILITY_LABELS: Record<CampaignVisibility, string> = {
  public: 'Public',
  private: 'Private (invite only)',
};

/** Optional join password for public tables (plain text max length before hashing). */
export const JOIN_PASSWORD_MAX_LENGTH = 64;

export function isCampaignVisibility(value: unknown): value is CampaignVisibility {
  return typeof value === 'string' && (CAMPAIGN_VISIBILITY as readonly string[]).includes(value);
}

/** Maximum length of a campaign title. */
export const CAMPAIGN_NAME_MAX_LENGTH = 80;

/** Maximum length of an optional campaign summary. */
export const CAMPAIGN_SUMMARY_MAX_LENGTH = 280;

/** Invitation lifetime after creation (Section 7.6 — invites must expire). */
export const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;

/** Max invitation mint attempts per account per rolling window (Section 7.6 rate limit). */
export const INVITATION_RATE_LIMIT_MAX = 8;
export const INVITATION_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

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
  readonly activeSeatCount: number;
  readonly visibility: CampaignVisibility;
  /** True when a public table requires a password to join. */
  readonly passwordProtected: boolean;
  /** Starter pack this campaign was created from, or null for a blank table. */
  readonly adventureTemplateId: string | null;
  readonly adventurePackVersion: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Not started until Session Zero is recorded; then Active or Suspended. */
  readonly sessionStatusLabel?: string;
  /**
   * True when this account owns the campaign. Owning a campaign never grants
   * ownership of another player's character.
   */
  readonly isCampaignOwner: boolean;
}

/** Bounded public lobby row — no secrets, no membership-only fields. */
export interface PublicTableProjection {
  readonly campaignId: string;
  readonly name: string;
  readonly summary: string;
  readonly ownerDisplayLabel: string;
  readonly directorIdentityLabel: string;
  readonly directorPersonalityLabel: string;
  readonly activeSeatCount: number;
  readonly maxActivePlayers: typeof MAX_ACTIVE_PLAYERS;
  readonly passwordProtected: boolean;
  readonly updatedAt: string;
}

export interface PublicTableListProjection {
  readonly tables: readonly PublicTableProjection[];
}

/** Where this account is actively seated right now, if anywhere. */
export interface ActiveSeatedTableProjection {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly seatId: string;
  readonly characterId: string;
  readonly characterName: string;
}

/** Result of joining a table: membership ensured, seat created, ready for /table. */
export interface JoinTableResponse {
  readonly campaign: CampaignProjection;
  readonly seat: SeatProjection;
  readonly switchedFromCampaignId: string | null;
}

export interface TablesHubProjection {
  readonly accountId: string;
  readonly myTables: readonly CampaignProjection[];
  readonly openTables: readonly PublicTableProjection[];
  readonly activeSeat: ActiveSeatedTableProjection | null;
}

export interface CampaignListProjection {
  readonly accountId: string;
  readonly campaigns: readonly CampaignProjection[];
}

/** Bounded preview before authentication (Section 7.6 / 8.8). */
export interface InvitationPreview {
  readonly inviteCode: string;
  /** Present so already-members can open the campaign without a second lookup. */
  readonly campaignId: string;
  readonly campaignName: string;
  readonly hostDisplayLabel: string;
  readonly contentProfileSummary: string;
  readonly sessionStateLabel: string;
  readonly requiresSignIn: true;
  readonly directorIdentityLabel: string;
  readonly directorPersonalityLabel: string;
  readonly configurationNotice: string;
  readonly expiresAt: string;
}

export interface InvitationCreatedProjection {
  readonly inviteCode: string;
  readonly invitePath: string;
  readonly campaignId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
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
  readonly settings: CampaignSettingsProjection;
}
