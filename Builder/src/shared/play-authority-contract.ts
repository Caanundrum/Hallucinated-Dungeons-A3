/**
 * Play authority and structured intent — spike contract (TQA authority track).
 *
 * This module locks interfaces before play-truth PRs (A1–A3) and vertical slices
 * (DM scene / NPC). It is a combined UX + play-authority specification surface:
 * reproducible defects, usability requirements, and product architecture must
 * not be collapsed into one bug-shaped backlog.
 *
 * Authority summary:
 * - Players declare actions; they do not create world facts.
 * - The DM (Director) is the sole author of fictional world state.
 * - The mechanics engine validates DM directives against supported primitives.
 * - Players never receive a "Confirm scene" control.
 * - Reference markers remain non-mechanical until a later mechanics slice.
 */

import type { DoorState } from './map-contract.js';
import type { IntentDraftCommandType } from './intent-draft-contract.js';

/** Who may author which kind of fact. */
export const PLAY_AUTHORITY_ROLES = ['player', 'director', 'mechanics'] as const;
export type PlayAuthorityRole = (typeof PLAY_AUTHORITY_ROLES)[number];

/**
 * Door leaf position vs lock state are independent (A2 / TQA-034).
 *
 * A successful unlock produces leaf `closed` + lock `unlocked` unless the
 * resolving action clearly included both unlocking and opening.
 */
export const DOOR_LEAF_STATES = ['open', 'closed'] as const;
export type DoorLeafState = (typeof DOOR_LEAF_STATES)[number];

export const DOOR_LOCK_STATES = ['locked', 'unlocked', 'none'] as const;
export type DoorLockState = (typeof DOOR_LOCK_STATES)[number];

export interface DoorAuthorityState {
  readonly leaf: DoorLeafState;
  readonly lock: DoorLockState;
}

/** Map `DoorState` storage onto the leaf/lock model without inventing unlock. */
export function doorAuthorityFromStored(doorState: DoorState | null): DoorAuthorityState {
  if (doorState === 'open') {
    return { leaf: 'open', lock: 'unlocked' };
  }
  if (doorState === 'locked') {
    return { leaf: 'closed', lock: 'locked' };
  }
  if (doorState === 'unlocked') {
    return { leaf: 'closed', lock: 'unlocked' };
  }
  if (doorState === 'closed') {
    // Legacy storage: closed alone does not prove lock status.
    return { leaf: 'closed', lock: 'none' };
  }
  return { leaf: 'closed', lock: 'none' };
}

/** Persist leaf/lock back to the single stored `DoorState` field. */
export function storedDoorStateFromAuthority(state: DoorAuthorityState): DoorState {
  if (state.leaf === 'open') {
    return 'open';
  }
  if (state.lock === 'locked') {
    return 'locked';
  }
  if (state.lock === 'unlocked') {
    return 'unlocked';
  }
  return 'closed';
}

/**
 * After a successful unlock that did not also open the door.
 * Product rule: Door closed, Lock unlocked.
 */
export function doorStateAfterUnlockSuccess(options?: {
  readonly alsoOpened?: boolean;
}): DoorAuthorityState {
  if (options?.alsoOpened === true) {
    return { leaf: 'open', lock: 'unlocked' };
  }
  return { leaf: 'closed', lock: 'unlocked' };
}

/** Player-facing spatial label — must expose lock when known. */
export function formatDoorAuthorityLabel(state: DoorAuthorityState): string {
  if (state.leaf === 'open') {
    return 'Wooden door (open)';
  }
  if (state.lock === 'locked') {
    return 'Wooden door (closed, locked)';
  }
  if (state.lock === 'unlocked') {
    return 'Wooden door (closed, unlocked)';
  }
  return 'Wooden door (closed)';
}

/** Structured parse of a player declaration — not a fixed keyword precedence list. */
export const DECLARATION_ACTION_KINDS = [
  'dialogue',
  'move',
  'open_door',
  'unlock_door',
  'inspect',
  'attack',
  'cast',
  'use_item',
  'rest',
  'introduce_npc_request',
  'scene_rule_request',
  'clarify',
  'other',
] as const;
export type DeclarationActionKind = (typeof DECLARATION_ACTION_KINDS)[number];

export interface DeclarationActionStep {
  readonly kind: DeclarationActionKind;
  readonly targetRef: string | null;
  readonly outcomeHint: string | null;
}

export interface PlayerAssertedWorldFact {
  readonly kind: 'place' | 'npc' | 'object' | 'rule' | 'other';
  readonly text: string;
}

export interface CanonicalReference {
  readonly kind: 'door' | 'npc' | 'marker' | 'token' | 'scene' | 'other';
  readonly id: string;
  readonly label: string;
}

/**
 * Full structured interpretation of one declaration.
 * A1 implements parsers that fill this shape; authority rules consume it.
 */
export interface StructuredDeclarationParse {
  readonly rawText: string;
  readonly speaker: 'player_character' | 'unknown';
  readonly addressee: string | null;
  readonly intendedActions: readonly DeclarationActionStep[];
  readonly primaryTarget: string | null;
  readonly requestedOutcome: string | null;
  readonly actionSequence: readonly DeclarationActionStep[];
  readonly playerAssertedWorldFacts: readonly PlayerAssertedWorldFact[];
  readonly knownCanonicalReferences: readonly CanonicalReference[];
  readonly isInterrogative: boolean;
}

export type IntentAuthorityDisposition =
  | 'propose_command'
  | 'clarify'
  | 'director_narrate_only'
  | 'reject_world_authorship';

export interface IntentAuthorityResolution {
  readonly disposition: IntentAuthorityDisposition;
  /** Ordered real actions remaining after stripping invented world facts. */
  readonly actionSequence: readonly DeclarationActionStep[];
  /** Facts the player asserted that must not become canon. */
  readonly ignoredWorldFacts: readonly PlayerAssertedWorldFact[];
  readonly clarificationPrompt: string | null;
  readonly summary: string;
  readonly proposedCommandType: IntentDraftCommandType | null;
}

/**
 * Authority rules — applied to a structured parse.
 * Do not replace this with dialogue > skill > door > move keyword precedence.
 */
export function resolveIntentAuthority(
  parsed: StructuredDeclarationParse,
): IntentAuthorityResolution {
  const ignoredWorldFacts = [...parsed.playerAssertedWorldFacts];
  const sequence = [...parsed.actionSequence];

  // Directly addressing a known NPC makes dialogue the primary intent.
  const addresseeIsNpc =
    parsed.addressee !== null &&
    parsed.knownCanonicalReferences.some(
      (ref) =>
        ref.kind === 'npc' &&
        (ref.label.toLowerCase() === parsed.addressee!.toLowerCase() ||
          ref.id === parsed.addressee),
    );

  if (addresseeIsNpc || (parsed.isInterrogative && parsed.addressee !== null)) {
    return {
      disposition: 'director_narrate_only',
      actionSequence: [{ kind: 'dialogue', targetRef: parsed.addressee, outcomeHint: null }],
      ignoredWorldFacts,
      clarificationPrompt: null,
      summary:
        parsed.addressee !== null
          ? `Ask ${parsed.addressee} — this is dialogue, not a map action.`
          : 'That sounds like a question for someone at the table — name who you address.',
      proposedCommandType: 'table.sync',
    };
  }

  // Interrogative about a door ("which door…") is not a door action.
  if (
    parsed.isInterrogative &&
    sequence.some((step) => step.kind === 'open_door' || step.kind === 'unlock_door')
  ) {
    return {
      disposition: 'clarify',
      actionSequence: [],
      ignoredWorldFacts,
      clarificationPrompt:
        'Are you asking about a door, or trying to open or unlock one? Say who you ask, or name the door action.',
      summary: 'That reads as a question, not a door action.',
      proposedCommandType: null,
    };
  }

  const actionable = sequence.filter(
    (step) =>
      step.kind !== 'introduce_npc_request' &&
      step.kind !== 'scene_rule_request' &&
      step.kind !== 'clarify',
  );

  // Player-only NPC/scene authorship requests — preserve any real action, ignore invented authority.
  const authorshipRequests = sequence.filter(
    (step) => step.kind === 'introduce_npc_request' || step.kind === 'scene_rule_request',
  );
  if (authorshipRequests.length > 0 && actionable.length === 0) {
    return {
      disposition: 'reject_world_authorship',
      actionSequence: [],
      ignoredWorldFacts,
      clarificationPrompt: null,
      summary:
        'Only the Game Director can establish new places, NPCs, or scene rules. Declare what your character does next.',
      proposedCommandType: 'table.sync',
    };
  }

  if (actionable.length === 0) {
    return {
      disposition: 'clarify',
      actionSequence: [],
      ignoredWorldFacts,
      clarificationPrompt: 'What is your character attempting to do?',
      summary: 'I heard your declaration. Say the action you want to resolve.',
      proposedCommandType: null,
    };
  }

  if (actionable.length > 1) {
    const labels = actionable.map((step) => step.kind.replace(/_/g, ' ')).join(', then ');
    return {
      disposition: 'clarify',
      actionSequence: actionable,
      ignoredWorldFacts,
      clarificationPrompt: `I see more than one action (${labels}). Confirm the order, or take them one at a time.`,
      summary: `Multiple actions: ${labels}. Confirm the sequence to continue.`,
      proposedCommandType: null,
    };
  }

  const only = actionable[0]!;
  const proposedCommandType = commandTypeForActionKind(only.kind);
  return {
    disposition: proposedCommandType === null ? 'clarify' : 'propose_command',
    actionSequence: [only],
    ignoredWorldFacts,
    clarificationPrompt:
      proposedCommandType === null ? 'That action is not supported yet — try a simpler declaration.' : null,
    summary: summaryForActionStep(only),
    proposedCommandType,
  };
}

function commandTypeForActionKind(kind: DeclarationActionKind): IntentDraftCommandType | null {
  switch (kind) {
    case 'move':
      return 'table.move';
    case 'open_door':
      return 'table.open_door';
    case 'unlock_door':
      // Unlock is a skill/table.sync path until a dedicated command exists.
      return 'table.sync';
    case 'inspect':
    case 'dialogue':
    case 'other':
      return 'table.sync';
    case 'attack':
      return 'combat.attack';
    case 'cast':
      return 'combat.cast_spell';
    case 'use_item':
      return 'inventory.use_item';
    case 'rest':
      return 'combat.short_rest';
    default:
      return null;
  }
}

function summaryForActionStep(step: DeclarationActionStep): string {
  switch (step.kind) {
    case 'open_door':
      return 'Ready to open the door. Confirm to commit.';
    case 'unlock_door':
      return 'Ready to attempt unlocking the door. Confirm to roll.';
    case 'move':
      return 'Ready to move toward the marked destination. Confirm to commit the step.';
    case 'dialogue':
      return step.targetRef !== null
        ? `Speak with ${step.targetRef} — the Game Director answers in the play thread.`
        : 'Speak — the Game Director answers in the play thread.';
    default:
      return 'Ready to resolve that action. Confirm to continue.';
  }
}

/**
 * Heuristic helpers for A1 tests — detect lock-picking language vs unlocked-state references.
 * Full NL parsing lives in the Director gateway; these encode product examples.
 */
export function textReferencesUnlockedDoorState(text: string): boolean {
  return /\bunlocked\s+door\b/i.test(text) || /\bdoor\s+(?:is|was|remains)\s+unlocked\b/i.test(text);
}

export function textRequestsLockPicking(text: string): boolean {
  return (
    /\b(?:pick|picking|picked)\b/i.test(text) ||
    /\bthieves['’]?\s*tools\b/i.test(text) ||
    /\b(?:force|bypass|break)\s+(?:the\s+)?lock\b/i.test(text) ||
    (/\bunlock(?:ing|ed)?\b/i.test(text) && !textReferencesUnlockedDoorState(text))
  );
}

export function textIsInterrogative(text: string): boolean {
  const trimmed = text.trim();
  return (
    /\?/.test(trimmed) ||
    /^(?:who|what|which|where|when|why|how|can|could|would|will|do|does|did|is|are)\b/i.test(
      trimmed,
    )
  );
}

export interface ParsePlayerDeclarationOptions {
  readonly knownNpcs?: readonly { readonly id: string; readonly label: string }[];
}

/**
 * Heuristic structured parse for A1 — feeds `resolveIntentAuthority`.
 * Not a fixed dialogue > skill > door > move precedence list.
 */
export function parsePlayerDeclaration(
  rawText: string,
  options: ParsePlayerDeclarationOptions = {},
): StructuredDeclarationParse {
  const trimmed = rawText.trim();
  const knownNpcs = options.knownNpcs ?? [];
  const knownCanonicalReferences: CanonicalReference[] = knownNpcs.map((npc) => ({
    kind: 'npc',
    id: npc.id,
    label: npc.label,
  }));

  let addressee: string | null = null;
  for (const npc of knownNpcs) {
    const escaped = npc.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (
      new RegExp(`^@?${escaped}\\s*[,:]`, 'i').test(trimmed) ||
      new RegExp(`^(?:hey|hi|ask)\\s+${escaped}\\b`, 'i').test(trimmed) ||
      new RegExp(`\\b(?:ask|tell)\\s+${escaped}\\b`, 'i').test(trimmed)
    ) {
      addressee = npc.label;
      break;
    }
  }
  if (addressee === null) {
    const leading = /^@?([A-Z][a-zA-Z'-]{1,24})\s*[,:]/.exec(trimmed);
    if (leading !== null) {
      addressee = leading[1]!;
    }
  }

  const isInterrogative = textIsInterrogative(trimmed);
  const actionSequence: DeclarationActionStep[] = [];
  const playerAssertedWorldFacts: PlayerAssertedWorldFact[] = [];

  const appearsNamed =
    /\b(?:a|an)\s+[a-z][\w' -]{0,40}\s+named\s+[A-Z][\w'-]+/i.test(trimmed) &&
    /\b(?:appear|appears|walks?\s+up|comes?\s+forward|introduce)/i.test(trimmed);
  if (appearsNamed) {
    actionSequence.push({
      kind: 'introduce_npc_request',
      targetRef: addressee,
      outcomeHint: null,
    });
    playerAssertedWorldFacts.push({ kind: 'npc', text: trimmed.slice(0, 120) });
  }

  const wantsUnlock = textRequestsLockPicking(trimmed);
  const refsUnlocked = textReferencesUnlockedDoorState(trimmed);
  const wantsOpenDoor =
    !wantsUnlock &&
    (/(?:open|push\s+open|swing\s+open)\b/i.test(trimmed) &&
      /\b(?:door|gate|entry(?:way)?)\b/i.test(trimmed));

  if (wantsUnlock) {
    actionSequence.push({ kind: 'unlock_door', targetRef: null, outcomeHint: null });
  }
  if (wantsOpenDoor) {
    actionSequence.push({ kind: 'open_door', targetRef: null, outcomeHint: null });
  }
  // Interrogative door mention without an unlock/open verb — surface for authority clarify.
  if (
    isInterrogative &&
    /\b(?:door|gate|entry(?:way)?)\b/i.test(trimmed) &&
    !wantsUnlock &&
    !wantsOpenDoor
  ) {
    actionSequence.push({ kind: 'open_door', targetRef: null, outcomeHint: null });
  }

  if (addressee !== null) {
    actionSequence.unshift({
      kind: 'dialogue',
      targetRef: addressee,
      outcomeHint: null,
    });
  }

  if (
    actionSequence.length === 0 &&
    refsUnlocked &&
    /\b(?:see|look|peer|glance|beyond|through)\b/i.test(trimmed)
  ) {
    actionSequence.push({ kind: 'inspect', targetRef: null, outcomeHint: 'unlocked door' });
  }

  if (/(?:\bmove\b|\bwalk\b|\bgo\b|\bstep\b|\bapproach\b)/i.test(trimmed) && !wantsUnlock) {
    if (!actionSequence.some((step) => step.kind === 'move')) {
      actionSequence.push({ kind: 'move', targetRef: null, outcomeHint: null });
    }
  }

  return {
    rawText: trimmed,
    speaker: 'player_character',
    addressee,
    intendedActions: actionSequence,
    primaryTarget: addressee,
    requestedOutcome: null,
    actionSequence,
    playerAssertedWorldFacts,
    knownCanonicalReferences,
    isInterrogative,
  };
}

/**
 * Minimum DM-owned scene directive (vertical-slice interface).
 * Validated by mechanics before map display. Players never confirm this.
 */
export interface DmSceneDirective {
  readonly schemaVersion: 'play-authority-scene-v1';
  readonly sceneId: string;
  readonly revision: number;
  readonly title: string;
  readonly displayMode: 'ambient' | 'exploration' | 'combat';
  readonly bounds: { readonly columns: number; readonly rows: number };
  readonly causeActionId: string | null;
  readonly continuity: {
    readonly previousSceneId: string | null;
    readonly boundaryCrossed: boolean;
  };
  /** Supported primitives only — never raw player prose. */
  readonly structure: {
    readonly edges: readonly {
      readonly edgeId: string;
      readonly leaf: DoorLeafState | null;
      readonly lock: DoorLockState | null;
      readonly kind: 'wall' | 'door';
    }[];
  };
  readonly markers: readonly {
    readonly markerId: string;
    readonly column: number;
    readonly row: number;
    readonly label: string;
    readonly referenceKind: 'lighting' | 'hazard' | 'cover' | 'prop' | 'landmark' | 'exit' | 'objective';
  }[];
  readonly entities: readonly {
    readonly entityId: string;
    readonly kind: 'party' | 'npc' | 'creature' | 'object';
    readonly label: string;
    readonly column: number;
    readonly row: number;
  }[];
  readonly visibility: 'public' | 'discovered' | 'hidden' | 'dm_only';
  readonly rejectedMechanics: readonly string[];
}

/**
 * Minimum DM-owned NPC directive (vertical-slice interface).
 * Only the Director establishes NPCs; players never impersonate them.
 */
export interface DmNpcDirective {
  readonly schemaVersion: 'play-authority-npc-v1';
  readonly npcId: string;
  readonly name: string;
  readonly publicDescription: string;
  readonly disposition: 'friendly' | 'wary' | 'neutral' | 'hostile' | 'allied' | 'unknown';
  readonly location: { readonly column: number; readonly row: number } | null;
  readonly placeToken: boolean;
  readonly firstDialogue: string | null;
  readonly audience: 'public' | 'private';
  readonly causeActionId: string | null;
}

export const PLAY_AUTHORITY_SPIKE = {
  schemaVersions: {
    scene: 'play-authority-scene-v1',
    npc: 'play-authority-npc-v1',
  },
  rules: {
    playersDoNotCreateWorldFacts: true,
    directorOwnsFiction: true,
    mechanicsValidateDirectives: true,
    noPlayerConfirmSceneControl: true,
    referenceMarkersNonMechanical: true,
    unlockLeavesDoorClosedUnlessAlsoOpened: true,
    noFixedIntentKeywordPrecedence: true,
  },
} as const;
