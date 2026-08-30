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
  'seat_left',
  'settings_updated',
  'session_zero_recorded',
  'session_suspended',
  'session_resumed',
  'chapter_closed',
  'scene_built',
  'door_opened',
  'token_moved',
  'play_declaration',
  'director_ruling',
  'play_resolved',
] as const;
export type ChronicleEntryKind = (typeof CHRONICLE_ENTRY_KINDS)[number];

/** Player-facing labels for Chronicle entry kinds (never show raw codes). */
export const CHRONICLE_ENTRY_KIND_LABELS: Record<ChronicleEntryKind, string> = {
  campaign_created: 'Campaign created',
  member_joined: 'Member joined',
  seat_created: 'Seat created',
  seat_left: 'Seat left',
  settings_updated: 'Settings updated',
  session_zero_recorded: 'Session Zero recorded',
  session_suspended: 'Session suspended',
  session_resumed: 'Session resumed',
  chapter_closed: 'Chapter closed',
  scene_built: 'Scene built',
  door_opened: 'Door opened',
  token_moved: 'Token moved',
  play_declaration: 'Declaration',
  director_ruling: 'Director narration',
  play_resolved: 'Resolved on table',
};

export interface ChronicleEntryProjection {
  readonly entryId: string;
  readonly campaignId: string;
  readonly kind: ChronicleEntryKind;
  readonly body: string;
  readonly createdAt: string;
  readonly sequence: number;
}

/**
 * Strip false "Table checkpoint 0 at suspend" diagnostics from Story so far
 * bodies (PQA-087). Applies to historical rows and any accidental new writes.
 */
export function scrubChronicleCheckpointZero(body: string): string {
  return body
    .replace(/\s*Table\s+checkpoint\s+0\s+at\s+suspend\.?/gi, '')
    .replace(/\s*Table\s+checkpoint\s*:\s*0\s*(at\s+suspend)?\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** True when a Story body still claims the broken checkpoint-0 suspend note. */
export function chronicleBodyClaimsCheckpointZero(body: string): boolean {
  return /Table\s+checkpoint\s*:?\s*0(\s+at\s+suspend)?/i.test(body);
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

/** Player-facing label for the declaration composer (PQA-163). */
export const PLAY_CHANNEL_LABEL = 'play channel';

/** Strip lightweight Markdown from Director prose before HTML escape (PQA-162). */
export function formatDirectorProse(body: string): string {
  return body
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*]\s+/gm, '• ')
    .trim();
}

/** Normalize Story/DM bodies for live vs chronicle equivalence checks. */
export function normalizeDmThreadBody(body: string): string {
  return formatDirectorProse(body).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** True when two Story bodies are the same beat (exact or containment for density variants). */
export function storyBodiesEquivalent(left: string, right: string): boolean {
  const a = normalizeDmThreadBody(left);
  const b = normalizeDmThreadBody(right);
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  return shorter.length > 24 && longer.includes(shorter);
}

/**
 * Drop optimistic DM rows already present in the chronicle-backed thread.
 * Fixes live Story duplicates when lastChronicleSyncCount already advanced.
 */
export function filterOptimisticDmDupes(
  fromChronicle: readonly DmThreadMessage[],
  optimistic: readonly DmThreadMessage[],
): DmThreadMessage[] {
  const chronicleDmBodies = fromChronicle
    .filter((message) => message.speaker === 'dm')
    .map((message) => message.body);
  return optimistic.filter((message) => {
    if (message.speaker !== 'dm') {
      return true;
    }
    return !chronicleDmBodies.some((body) => storyBodiesEquivalent(body, message.body));
  });
}

/**
 * Collapse duplicate DM speaker rows in a live play thread (optimistic+chronicle races).
 * Keeps the first occurrence of each equivalent body.
 */
export function collapseDuplicateDmMessages(
  messages: readonly DmThreadMessage[],
): DmThreadMessage[] {
  const seen: string[] = [];
  const collapsed: DmThreadMessage[] = [];
  for (const message of messages) {
    if (message.speaker !== 'dm') {
      collapsed.push(message);
      continue;
    }
    const duplicate = seen.some((body) => storyBodiesEquivalent(body, message.body));
    if (duplicate) {
      continue;
    }
    seen.push(message.body);
    collapsed.push(message);
  }
  return collapsed;
}

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

const PLAY_CHRONICLE_KINDS = new Set<ChronicleEntryKind>([
  'play_declaration',
  'director_ruling',
  'play_resolved',
  'scene_built',
  'door_opened',
  'token_moved',
]);

/** True when a timestamp is a Unix-epoch placeholder (TBL-QA-003 / PQA-158). */
export function isEpochPlaceholderTimestamp(iso: string): boolean {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms < 86_400_000;
}

/** Player-facing wall time; epoch placeholders never render as 1969/1970 dates. */
export function formatPlayerFacingTimestamp(iso: string, now: Date = new Date()): string {
  if (typeof iso !== 'string' || iso.trim().length === 0) {
    return 'Just now';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || isEpochPlaceholderTimestamp(iso)) {
    return 'Just now';
  }
  // Synthetic opening prompts should read as immediate, not a stale absolute clock.
  const ageMs = Math.abs(now.getTime() - date.getTime());
  if (ageMs < 60_000) {
    return 'Just now';
  }
  return date.toLocaleString();
}

function sanitizeThreadCreatedAt(iso: string, now: Date): string {
  if (typeof iso !== 'string' || iso.trim().length === 0 || isEpochPlaceholderTimestamp(iso)) {
    return now.toISOString();
  }
  return iso;
}

/** Rebuild the DM play thread from trusted Chronicle play beats (PQA-157/158/159). */
export function dmThreadFromChronicleEntries(options: {
  readonly entries: readonly ChronicleEntryProjection[];
  readonly directorLabel: string;
  readonly sceneBanner: string;
  /** Wall clock for synthetic opening prompts (defaults to now). */
  readonly now?: Date;
}): DmThreadMessage[] {
  const now = options.now ?? new Date();
  const playEntries = options.entries.filter((entry) => PLAY_CHRONICLE_KINDS.has(entry.kind));
  if (playEntries.length === 0) {
    const scene = options.sceneBanner.trim() || 'The table is ready.';
    return [
      {
        messageId: 'opening-prompt',
        speaker: 'dm',
        speakerLabel: options.directorLabel,
        body: `${scene} What do you do?`,
        // Always wall-clock; never emit Unix epoch (TBL-QA-003 / PQA-158).
        createdAt: now.toISOString(),
        kind: 'prompt',
      },
    ];
  }
  return playEntries.map((entry) => {
    const body = formatDirectorProse(scrubChronicleCheckpointZero(entry.body));
    const createdAt = sanitizeThreadCreatedAt(entry.createdAt, now);
    if (entry.kind === 'play_declaration') {
      return {
        messageId: entry.entryId,
        speaker: 'player',
        speakerLabel: 'You',
        body,
        createdAt,
        kind: 'declaration',
      };
    }
    if (entry.kind === 'director_ruling') {
      return {
        messageId: entry.entryId,
        speaker: 'dm',
        speakerLabel: options.directorLabel,
        body,
        createdAt,
        kind: 'ruling_hint',
      };
    }
    return {
      messageId: entry.entryId,
      speaker: 'system',
      speakerLabel: 'Table',
      body,
      createdAt,
      kind: 'mechanics',
    };
  });
}

export function isDockTab(value: unknown): value is DockTab {
  return typeof value === 'string' && (DOCK_TABS as readonly string[]).includes(value);
}

export function isPartyChatMode(value: unknown): value is PartyChatMode {
  return typeof value === 'string' && (PARTY_CHAT_MODES as readonly string[]).includes(value);
}
