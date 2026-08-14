/**
 * Communication Dock and Action Composer structural contract.
 *
 * Blueprint ownership: Sections 1.5.2.1–1.5.2.5 and Phase 2 Action Composer
 * plumbing (chunk 2a). Chronicle, Party Chat, and Rules Desk are peer
 * destinations. The Action Composer stays visually and behaviorally separate.
 * Phase 2a enables seated `table.sync` commits; Interpret Action remains gated
 * until Timing Authority arrives.
 */

export const DOCK_TABS = ['chronicle', 'party_chat', 'rules_desk'] as const;
export type DockTab = (typeof DOCK_TABS)[number];

export const DOCK_TAB_LABELS: Record<DockTab, string> = {
  chronicle: 'Chronicle',
  party_chat: 'Party Chat',
  rules_desk: 'Rules Desk',
};

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
  heading: 'Declare Action',
  notice:
    'This panel stays separate from Party Chat so a sentence typed as talk cannot become a command. Seated members can commit a table sync through the command gateway; Interpret Action stays gated until Timing Authority arrives.',
  tableSyncLabel: 'Commit table sync',
  interpretActionLabel: 'Interpret Action',
  interpretActionNotice:
    'Natural-language Interpret Action unlocks with Timing Authority in a later Phase 2 slice. It cannot spend resources yet.',
};

export const RULES_DESK_NOTICE =
  'The Rules Desk will explain approved rules and visible modifiers when the rules engine and Director answers arrive in later phases. In Phase 1 it is a peer dock destination with honest guidance only — it cannot grant rulings or submit actions.';

export function isDockTab(value: unknown): value is DockTab {
  return typeof value === 'string' && (DOCK_TABS as readonly string[]).includes(value);
}

export function isPartyChatMode(value: unknown): value is PartyChatMode {
  return typeof value === 'string' && (PARTY_CHAT_MODES as readonly string[]).includes(value);
}
