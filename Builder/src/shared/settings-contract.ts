/**
 * Campaign and player settings contract for Phase 1.
 *
 * Blueprint ownership: Sections 1.5.21 (initial campaign / presentation settings),
 * 4.4 (content profiles), 13.18 (Session Zero), and Phase 1 build scope:
 * expose only controls with real Phase 1 behavior; reserve speech/AI presentation
 * defaults without showing nonfunctional controls.
 */

export const CONTENT_PROFILES = ['adventure', 'tense', 'custom_restricted'] as const;
export type ContentProfile = (typeof CONTENT_PROFILES)[number];

export const CONTENT_PROFILE_LABELS: Record<ContentProfile, string> = {
  adventure: 'Adventure',
  tense: 'Tense',
  custom_restricted: 'Custom Restricted',
};

export const CONTENT_PROFILE_SUMMARIES: Record<ContentProfile, string> = {
  adventure: 'Non-graphic fantasy peril, mild language, no sexual content.',
  tense: 'Stronger fear and heavier themes; combat stays non-graphic.',
  custom_restricted:
    'Further reduces allowed themes. Never expands beyond platform policy — there is no unfiltered mode.',
};

export const GROUP_DECISION_POLICIES = [
  'majority_vote',
  'unanimous_consent',
  'designated_caller',
] as const;
export type GroupDecisionPolicy = (typeof GROUP_DECISION_POLICIES)[number];

export const GROUP_DECISION_POLICY_LABELS: Record<GroupDecisionPolicy, string> = {
  majority_vote: 'Majority vote',
  unanimous_consent: 'Unanimous consent',
  designated_caller: 'Designated caller',
};

export const GROUP_DECISION_POLICY_SUMMARIES: Record<GroupDecisionPolicy, string> = {
  majority_vote: 'Party-level logistics resolve when a majority of seated players agree.',
  unanimous_consent: 'Configured party logistics require every seated player to agree.',
  designated_caller:
    'One seated member calls party-level logistics. Never controls another character.',
};

/** Reaction window duration in seconds (approved range; default 12). */
export const REACTION_WINDOW_SECONDS_MIN = 8;
export const REACTION_WINDOW_SECONDS_MAX = 30;
export const REACTION_WINDOW_SECONDS_DEFAULT = 12;

export const RULES_TRANSPARENCY_LEVELS = ['standard'] as const;
export type RulesTransparencyLevel = (typeof RULES_TRANSPARENCY_LEVELS)[number];

export const RULES_TRANSPARENCY_LABELS: Record<RulesTransparencyLevel, string> = {
  standard: 'Standard explanations',
};

export const ENEMY_HEALTH_PRESENTATIONS = ['descriptive_bands', 'visible_damage'] as const;
export type EnemyHealthPresentation = (typeof ENEMY_HEALTH_PRESENTATIONS)[number];

export const ENEMY_HEALTH_PRESENTATION_LABELS: Record<EnemyHealthPresentation, string> = {
  descriptive_bands: 'Descriptive health bands',
  visible_damage: 'Visible damage without exact Hit Points',
};

export const SESSION_TONES = ['light', 'balanced', 'grim'] as const;
export type SessionTone = (typeof SESSION_TONES)[number];

export const SESSION_TONE_LABELS: Record<SessionTone, string> = {
  light: 'Light',
  balanced: 'Balanced',
  grim: 'Grim',
};

export const PVP_POLICIES = ['consent_required'] as const;
export type PvpPolicy = (typeof PVP_POLICIES)[number];

export const CHARACTER_CONFLICT_POLICIES = ['collaborative', 'allowed_with_consent'] as const;
export type CharacterConflictPolicy = (typeof CHARACTER_CONFLICT_POLICIES)[number];

export const CHARACTER_CONFLICT_POLICY_LABELS: Record<CharacterConflictPolicy, string> = {
  collaborative: 'Collaborative — party conflict stays light',
  allowed_with_consent: 'Allowed with consent',
};

export const ROMANCE_POLICIES = ['fade_to_black', 'none'] as const;
export type RomancePolicy = (typeof ROMANCE_POLICIES)[number];

export const ROMANCE_POLICY_LABELS: Record<RomancePolicy, string> = {
  fade_to_black: 'Fade to black',
  none: 'None',
};

export const LETHALITY_PREFERENCES = ['standard', 'careful', 'deadly'] as const;
export type LethalityPreference = (typeof LETHALITY_PREFERENCES)[number];

export const LETHALITY_PREFERENCE_LABELS: Record<LethalityPreference, string> = {
  standard: 'Standard',
  careful: 'Careful',
  deadly: 'Deadly',
};

export const DIRECTOR_DISCRETION_LEVELS = ['moderate_bounded'] as const;
export type DirectorDiscretionLevel = (typeof DIRECTOR_DISCRETION_LEVELS)[number];

export const DROP_IN_OUT_POLICIES = ['flexible', 'session_committed'] as const;
export type DropInOutPolicy = (typeof DROP_IN_OUT_POLICIES)[number];

export const DROP_IN_OUT_POLICY_LABELS: Record<DropInOutPolicy, string> = {
  flexible: 'Flexible drop-in / drop-out',
  session_committed: 'Session-committed attendance',
};

export const CONTENT_SOURCE_FLAGS = ['original', 'homebrew_allowed'] as const;
export type ContentSourceFlag = (typeof CONTENT_SOURCE_FLAGS)[number];

export const CONTENT_SOURCE_FLAG_LABELS: Record<ContentSourceFlag, string> = {
  original: 'Original campaign content',
  homebrew_allowed: 'Homebrew allowed',
};

export const SAFETY_BOUNDARIES_MAX_LENGTH = 600;
export const ACCESSIBILITY_NOTES_MAX_LENGTH = 400;
export const EXTERNAL_VOICE_NOTE_MAX_LENGTH = 200;
export const EXPECTED_SESSION_LENGTH_MAX_LENGTH = 80;

/** Narration density and dice presentation remain player prefs. */
export const NARRATION_DENSITIES = ['concise', 'balanced', 'cinematic'] as const;
export type NarrationDensity = (typeof NARRATION_DENSITIES)[number];

export const DICE_PRESENTATIONS = ['fast', 'standard'] as const;
export type DicePresentation = (typeof DICE_PRESENTATIONS)[number];

/**
 * Phase 4 speech prefs — player-optional. Defaults off. TTS speaks only
 * already-visible text; STT fills editable unsent drafts only.
 */
export interface PlayerSpeechSettings {
  readonly textToSpeechEnabled: boolean;
  readonly chronicleAutoplay: boolean;
  readonly privateDirectorAutoplay: boolean;
  readonly speechToTextEnabled: boolean;
}

export interface ReservedPlayerPresentationSettings extends PlayerSpeechSettings {
  readonly narrationDensity: NarrationDensity;
  readonly dicePresentation: DicePresentation;
}

export const RESERVED_PLAYER_PRESENTATION_DEFAULTS: ReservedPlayerPresentationSettings = {
  textToSpeechEnabled: false,
  chronicleAutoplay: false,
  privateDirectorAutoplay: false,
  speechToTextEnabled: false,
  narrationDensity: 'balanced',
  dicePresentation: 'standard',
};

/** Honest player preferences that already affect the page (Phase 1–4). */
export interface PlayerPresentationSettingsProjection {
  readonly accountId: string;
  readonly reducedMotion: boolean;
  /** Flattens tactical atmospheric effects on the table stage (Phase 2). */
  readonly lowEffects: boolean;
  readonly reserved: ReservedPlayerPresentationSettings;
  readonly updatedAt: string;
}

export interface SessionZeroProjection {
  readonly completed: boolean;
  readonly completedAt: string | null;
  readonly tone: SessionTone;
  readonly pvpPolicy: PvpPolicy;
  readonly characterConflictPolicy: CharacterConflictPolicy;
  readonly romancePolicy: RomancePolicy;
  readonly lethalityPreference: LethalityPreference;
  readonly directorDiscretionLevel: DirectorDiscretionLevel;
  readonly expectedSessionLength: string;
  readonly dropInOutPolicy: DropInOutPolicy;
  readonly textChatExpectations: string;
  readonly externalVoiceNote: string;
  readonly accessibilityNeeds: string;
  readonly contentSource: ContentSourceFlag;
}

export interface CampaignSettingsProjection {
  readonly campaignId: string;
  readonly contentProfile: ContentProfile;
  readonly contentProfileLabel: string;
  readonly contentProfileSummary: string;
  readonly safetyBoundaries: string;
  readonly groupDecisionPolicy: GroupDecisionPolicy;
  readonly groupDecisionPolicyLabel: string;
  readonly designatedCallerAccountId: string | null;
  readonly reactionWindowSeconds: number;
  readonly rulesTransparency: RulesTransparencyLevel;
  readonly rulesTransparencyLabel: string;
  readonly enemyHealthPresentation: EnemyHealthPresentation;
  readonly enemyHealthPresentationLabel: string;
  readonly sessionZero: SessionZeroProjection;
  readonly configurationNotice: string;
  readonly updatedAt: string;
}

export const CAMPAIGN_SETTINGS_CONFIGURATION_NOTICE =
  'These settings are durable campaign configuration for the later AI-enabled table. Phase 1 records and recovers them; the Game Director does not enforce them as live AI behavior in this build.';

export function isContentProfile(value: unknown): value is ContentProfile {
  return typeof value === 'string' && (CONTENT_PROFILES as readonly string[]).includes(value);
}

export function isGroupDecisionPolicy(value: unknown): value is GroupDecisionPolicy {
  return (
    typeof value === 'string' && (GROUP_DECISION_POLICIES as readonly string[]).includes(value)
  );
}

export function isEnemyHealthPresentation(value: unknown): value is EnemyHealthPresentation {
  return (
    typeof value === 'string' &&
    (ENEMY_HEALTH_PRESENTATIONS as readonly string[]).includes(value)
  );
}

export function isSessionTone(value: unknown): value is SessionTone {
  return typeof value === 'string' && (SESSION_TONES as readonly string[]).includes(value);
}

export function isCharacterConflictPolicy(value: unknown): value is CharacterConflictPolicy {
  return (
    typeof value === 'string' &&
    (CHARACTER_CONFLICT_POLICIES as readonly string[]).includes(value)
  );
}

export function isRomancePolicy(value: unknown): value is RomancePolicy {
  return typeof value === 'string' && (ROMANCE_POLICIES as readonly string[]).includes(value);
}

export function isLethalityPreference(value: unknown): value is LethalityPreference {
  return (
    typeof value === 'string' && (LETHALITY_PREFERENCES as readonly string[]).includes(value)
  );
}

export function isDropInOutPolicy(value: unknown): value is DropInOutPolicy {
  return typeof value === 'string' && (DROP_IN_OUT_POLICIES as readonly string[]).includes(value);
}

export function isContentSourceFlag(value: unknown): value is ContentSourceFlag {
  return typeof value === 'string' && (CONTENT_SOURCE_FLAGS as readonly string[]).includes(value);
}

export function defaultCampaignSettingsFields(): Omit<
  CampaignSettingsProjection,
  'campaignId' | 'updatedAt'
> {
  return {
    contentProfile: 'adventure',
    contentProfileLabel: CONTENT_PROFILE_LABELS.adventure,
    contentProfileSummary: CONTENT_PROFILE_SUMMARIES.adventure,
    safetyBoundaries: '',
    groupDecisionPolicy: 'majority_vote',
    groupDecisionPolicyLabel: GROUP_DECISION_POLICY_LABELS.majority_vote,
    designatedCallerAccountId: null,
    reactionWindowSeconds: REACTION_WINDOW_SECONDS_DEFAULT,
    rulesTransparency: 'standard',
    rulesTransparencyLabel: RULES_TRANSPARENCY_LABELS.standard,
    enemyHealthPresentation: 'descriptive_bands',
    enemyHealthPresentationLabel: ENEMY_HEALTH_PRESENTATION_LABELS.descriptive_bands,
    sessionZero: {
      completed: false,
      completedAt: null,
      tone: 'balanced',
      pvpPolicy: 'consent_required',
      characterConflictPolicy: 'collaborative',
      romancePolicy: 'fade_to_black',
      lethalityPreference: 'standard',
      directorDiscretionLevel: 'moderate_bounded',
      expectedSessionLength: '3–5 sessions',
      dropInOutPolicy: 'flexible',
      textChatExpectations: 'Party Chat is the in-product table talk surface.',
      externalVoiceNote: '',
      accessibilityNeeds: '',
      contentSource: 'original',
    },
    configurationNotice: CAMPAIGN_SETTINGS_CONFIGURATION_NOTICE,
  };
}
