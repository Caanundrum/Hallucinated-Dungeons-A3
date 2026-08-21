/**
 * Communication Dock and Action Composer structural contract.
 *
 * Blueprint ownership: Sections 1.5.2.1–1.5.2.5 and Phase 2 Action Composer
 * plumbing (chunk 2a). Chronicle, Party Chat, and Rules Desk are peer
 * destinations. The Action Composer stays visually and behaviorally separate.
 * Phase 2a enables seated `table.sync` commits; Interpret Action remains gated
 * until Timing Authority arrives.
 */

export const DOCK_TABS = ['chronicle', 'party_chat', 'rules_desk', 'director_address'] as const;
export type DockTab = (typeof DOCK_TABS)[number];

export const DOCK_TAB_LABELS: Record<DockTab, string> = {
  chronicle: 'Story so far',
  party_chat: 'Chat',
  rules_desk: 'Rules',
  director_address: 'Ask the Game Director',
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
    'Move freely until the DM calls for initiative. On your turn, describe what you do in your own words — no menus required.',
  tableSyncLabel: 'Sync table',
  interpretActionLabel: 'Plan action',
  interpretActionNotice:
    'Training-only: translate a plain-language description into a draft command you can confirm.',
};

export const RULES_DESK_NOTICE =
  'Look up how a rule works. This explains mechanics only — it does not change the game or make rulings for you.';

export const DIRECTOR_ADDRESS_NOTICE =
  'Ask the Game Director a question or describe what you want to happen in the story. Only you see this reply; the Game Director never moves pieces or rolls dice for you.';

export const DIRECTOR_ADDRESS_MESSAGE_MAX_LENGTH = 500;

export function isDockTab(value: unknown): value is DockTab {
  return typeof value === 'string' && (DOCK_TABS as readonly string[]).includes(value);
}

export function isPartyChatMode(value: unknown): value is PartyChatMode {
  return typeof value === 'string' && (PARTY_CHAT_MODES as readonly string[]).includes(value);
}
