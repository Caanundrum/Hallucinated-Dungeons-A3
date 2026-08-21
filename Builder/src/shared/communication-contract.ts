/**
 * Communication Dock and Action Composer structural contract.
 *
 * Blueprint ownership: Sections 1.5.2.1–1.5.2.5 and Phase 2 Action Composer
 * plumbing (chunk 2a). Chronicle, Party Chat, and Rules are peer destinations.
 * The Action Composer (DM play thread) stays visually and behaviorally separate.
 * Phase 2a enables seated `table.sync` commits; Interpret Action remains gated
 * until Timing Authority arrives.
 */

export const DOCK_TABS = ['chronicle', 'party_chat', 'rules_desk', 'director_address'] as const;
export type DockTab = (typeof DOCK_TABS)[number];

export const DOCK_TAB_LABELS: Record<DockTab, string> = {
  chronicle: 'Story so far',
  party_chat: 'Chat',
  rules_desk: 'Rules',
  director_address: 'Ask the Director',
};

/** Player-first tab order: social and help surfaces before the audit log. */
export const PLAYER_DOCK_TAB_ORDER: readonly DockTab[] = [
  'party_chat',
  'director_address',
  'rules_desk',
  'chronicle',
];

export const PARTY_CHAT_MODES = ['table_talk', 'speak_as_character'] as const;
export type PartyChatMode = (typeof PARTY_CHAT_MODES)[number];

export const PARTY_CHAT_MODE_LABELS: Record<PartyChatMode, string> = {
  table_talk: 'Table Talk',
  speak_as_character: 'Speak as Character',
};

export const PARTY_CHAT_MESSAGE_MAX_LENGTH = 500;

export const CHRONICLE_ENTRY_KINDS = [
  'campaign_created',
  'member_joined',
  'seat_created',
  'settings_updated',
  'session_zero_recorded',
  'session_suspended',
  'session_resumed',
  'chapter_closed',
] as const;
export type ChronicleEntryKind = (typeof CHRONICLE_ENTRY_KINDS)[number];

/** Player-facing labels for Chronicle entry kinds (never show raw codes). */
export const CHRONICLE_ENTRY_KIND_LABELS: Record<ChronicleEntryKind, string> = {
  campaign_created: 'Campaign created',
  member_joined: 'Member joined',
  seat_created: 'Seat created',
  settings_updated: 'Settings updated',
  session_zero_recorded: 'Session Zero recorded',
  session_suspended: 'Session suspended',
  session_resumed: 'Session resumed',
  chapter_closed: 'Chapter closed',
};

export interface ChronicleEntryProjection {
  readonly entryId: string;
  readonly campaignId: string;
  readonly kind: ChronicleEntryKind;
  readonly body: string;
  readonly createdAt: string;
  readonly sequence: number;
}

export interface ChronicleFeedProjection {
  readonly campaignId: string;
  readonly entries: readonly ChronicleEntryProjection[];
}

export interface PartyChatMessageProjection {
  readonly messageId: string;
  readonly campaignId: string;
  readonly senderAccountId: string;
  readonly senderDisplayLabel: string;
  readonly mode: PartyChatMode;
  readonly body: string;
  readonly createdAt: string;
  readonly addressedNpcId?: string;
  readonly addressedNpcName?: string;
}

export interface PartyChatFeedProjection {
  readonly campaignId: string;
  readonly messages: readonly PartyChatMessageProjection[];
}

export interface ActionComposerProjection {
  readonly available: true;
  readonly heading: string;
  readonly notice: string;
  readonly tableSyncLabel: string;
  readonly interpretActionLabel: string;
  readonly interpretActionNotice: string;
}

export const ACTION_COMPOSER_STRUCTURE: ActionComposerProjection = {
  available: true,
  heading: 'At the table',
  notice:
    'This is the Game Director play thread. Move freely until initiative is called. Describe what you do; the selected Game Director narrates from resolved table state.',
  tableSyncLabel: 'Sync table',
  interpretActionLabel: 'Plan action',
  interpretActionNotice:
    'Training-only: translate a plain-language description into a draft command you can confirm.',
};

export const RULES_DESK_NOTICE =
  'Browse the SRD 5.2.1 reference for this Alpha. Looking up a rule never changes the table — ask the Game Director when you need a ruling for your character and scene.';

export const DIRECTOR_ADDRESS_NOTICE =
  'Ask the Game Director whether a plan is legal or feasible — action economy, skills, spells on your sheet, and what the scene allows. Only you see this consult. The Game Director never moves pieces or rolls dice from here.';

export const DIRECTOR_ADDRESS_MESSAGE_MAX_LENGTH = 500;

/** Local rolling DM play-thread message kinds (Action Composer). */
export const DM_THREAD_SPEAKERS = ['dm', 'player', 'system'] as const;
export type DmThreadSpeaker = (typeof DM_THREAD_SPEAKERS)[number];

export interface DmThreadMessage {
  readonly messageId: string;
  readonly speaker: DmThreadSpeaker;
  readonly speakerLabel: string;
  readonly body: string;
  readonly createdAt: string;
  readonly kind: 'prompt' | 'declaration' | 'ruling_hint' | 'narration' | 'mechanics' | 'system';
}

export function isDockTab(value: unknown): value is DockTab {
  return typeof value === 'string' && (DOCK_TABS as readonly string[]).includes(value);
}

export function isPartyChatMode(value: unknown): value is PartyChatMode {
  return typeof value === 'string' && (PARTY_CHAT_MODES as readonly string[]).includes(value);
}
