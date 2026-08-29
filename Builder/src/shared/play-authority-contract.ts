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

  if (addresseeIsNpc) {
    return {
      disposition: 'director_narrate_only',
      actionSequence: [{ kind: 'dialogue', targetRef: parsed.addressee, outcomeHint: null }],
      ignoredWorldFacts,
      clarificationPrompt: null,
      summary: `Ask ${parsed.addressee} — this is dialogue, not a map action.`,
      proposedCommandType: 'table.sync',
    };
  }

  // Named addressee who is not in campaign memory — do not treat as dialogue or door action.
  if (parsed.addressee !== null && !addresseeIsNpc) {
    return {
      disposition: 'clarify',
      actionSequence: [],
      ignoredWorldFacts,
      clarificationPrompt: `${parsed.addressee} is not an established NPC at this table yet. Only the Game Director can introduce someone new — declare what your character does, or ask the Director who is present.`,
      summary: `${parsed.addressee} is not established here — the Game Director introduces NPCs.`,
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
  const inventIgnoredNote =
    ignoredWorldFacts.length > 0
      ? ' Player-authored places, NPCs, or rules were ignored — only the Game Director establishes those.'
      : '';

  // Perception / presence checks are Director narration, never map or combat commands.
  if (only.kind === 'inspect') {
    const seekingPresence = only.outcomeHint === 'who_is_present';
    return {
      disposition: 'director_narrate_only',
      actionSequence: [only],
      ignoredWorldFacts,
      clarificationPrompt: null,
      summary:
        (seekingPresence
          ? 'You are looking for who is present — the Game Director will answer in fiction.'
          : 'You look and listen — the Game Director narrates what is perceptible.') + inventIgnoredNote,
      proposedCommandType: 'table.sync',
    };
  }

  const proposedCommandType = commandTypeForActionKind(only.kind);
  return {
    disposition: proposedCommandType === null ? 'clarify' : 'propose_command',
    actionSequence: [only],
    ignoredWorldFacts,
    clarificationPrompt:
      proposedCommandType === null ? 'That action is not supported yet — try a simpler declaration.' : null,
    summary: summaryForActionStep(only) + inventIgnoredNote,
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
  return (
    /\bunlocked\s+(?:door|doorway|gate|entry(?:way)?)\b/i.test(text) ||
    /\b(?:door|doorway|gate|entry(?:way)?)\s+(?:is|was|remains)\s+unlocked\b/i.test(text) ||
    /\b(?:door|doorway|gate|entry(?:way)?)\b[^.?!,;]{0,24}\bunlocked\b/i.test(text)
  );
}

export function textRequestsLockPicking(text: string): boolean {
  // "Unlocked door/doorway" is leaf/lock state, never a pick attempt (hosted recheck).
  if (textReferencesUnlockedDoorState(text) || /\bunlocked\b/i.test(text)) {
    // Allow explicit pick language even when the door is described as unlocked.
    return (
      /\b(?:pick|picking|picked)\b/i.test(text) ||
      /\bthieves['’]?\s*tools\b/i.test(text) ||
      /\b(?:force|bypass|break)\s+(?:the\s+)?lock\b/i.test(text)
    );
  }
  return (
    /\b(?:pick|picking|picked)\b/i.test(text) ||
    /\bthieves['’]?\s*tools\b/i.test(text) ||
    /\b(?:force|bypass|break)\s+(?:the\s+)?lock\b/i.test(text) ||
    /\bunlock(?:s|ing)?\b/i.test(text)
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
      new RegExp(`\\b(?:asks?|tells?)\\s+${escaped}\\b`, 'i').test(trimmed)
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
  // Unknown named addressee: "asks Nib", "ask Nib,", "speaking to Nib" — even when not in memory.
  if (addressee === null) {
    const asked = /\b(?:asks?|tells?|speaking\s+to|talk(?:s|ing)?\s+to)\s+([A-Z][a-zA-Z'-]{1,24})\b/.exec(
      trimmed,
    );
    if (asked !== null) {
      const candidate = asked[1]!;
      // Skip common false positives that are not personal names.
      if (!/^(?:The|This|That|What|Which|Where|When|Why|How|Director|Garrick|Veyra)$/i.test(candidate)) {
        addressee = candidate;
      }
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

  const inventsPlace =
    /\b(?:flooded\s+crypt|secret\s+(?:room|passage|chamber)|hidden\s+(?:room|passage|chamber))\b/i.test(
      trimmed,
    ) ||
    (/\b(?:appears|materializes|opens\s+up|springs\s+into\s+being)\b/i.test(trimmed) &&
      /\b(?:room|chamber|crypt|passage|hallway|corridor)\b/i.test(trimmed)) ||
    (/\b(?:reveal|reveals|revealing)\s+(?:a|an|the)\s+[\w\s-]{0,40}\b(?:room|chamber|crypt|passage|hallway|corridor)\b/i.test(
      trimmed,
    ) ||
      /\bthere\s+is\s+now\s+(?:a|an|the)\s+[\w\s-]{0,40}\b(?:room|chamber|crypt|passage|hallway|corridor)\b/i.test(
        trimmed,
      ));
  if (inventsPlace) {
    actionSequence.push({
      kind: 'scene_rule_request',
      targetRef: null,
      outcomeHint: 'invented_place',
    });
    playerAssertedWorldFacts.push({ kind: 'place', text: trimmed.slice(0, 120) });
  }

  const seekingPresence =
    /\b(?:call(?:s|ed|ing)?\s+(?:out|into)|is\s+anyone(?:\s+there|\s+here)?|anyone\s+(?:there|here)|who(?:'s|\s+is)\s+(?:there|here|present)|look(?:ing)?\s+for\s+(?:anyone|anybody|somebody|someone|a\s+person|people)|wait(?:s|ing)?\s+for\s+(?:whoever|someone|anyone|anybody))\b/i.test(
      trimmed,
    );

  const observingScene =
    /\b(?:survey(?:s|ing)?|look(?:s|ing)?\s+and\s+listen|listen(?:s|ing)?\s+carefully|look(?:s|ing)?\s+carefully|peer(?:s|ing)?\s+around|take(?:s|ing)?\s+(?:a\s+)?look\s+around|describe\s+only\s+what)\b/i.test(
      trimmed,
    ) ||
    (/\b(?:look(?:s|ing)?|listen(?:s|ing)?)\b/i.test(trimmed) &&
      /\b(?:chamber|room|scene|surroundings|area)\b/i.test(trimmed) &&
      !/\b(?:open|opens|opening|unlock|attack|strike|cast)\b/i.test(trimmed));

  const wantsUnlock = textRequestsLockPicking(trimmed);
  const refsUnlocked = textReferencesUnlockedDoorState(trimmed);
  const stepThroughPassage =
    /\b(?:steps?|stepping|walks?|walking|goes?|going)\s+through\b/i.test(trimmed) ||
    /\bthrough\s+(?:the\s+)?(?:door|doorway|gate|entry(?:way)?)\b/i.test(trimmed) ||
    /\b(?:into|enter(?:s|ing)?)\s+(?:the\s+)?(?:room|chamber)\s+beyond\b/i.test(trimmed) ||
    /\benter(?:s|ing)?\s+(?:the\s+)?(?:room|chamber|passage)\b/i.test(trimmed);
  const wantsOpenDoor =
    !wantsUnlock &&
    ((/(?:opens?|opening|push(?:es|ing)?\s+open|swing(?:s|ing)?\s+open)\b/i.test(trimmed) &&
      /\b(?:door|doorway|gate|entry(?:way)?)\b/i.test(trimmed)) ||
      // Passage language against an already-unlocked doorway is open/transit, not lock-picking.
      (refsUnlocked && (stepThroughPassage || /\benter(?:s|ing)?\b/i.test(trimmed))));

  if (wantsUnlock) {
    actionSequence.push({ kind: 'unlock_door', targetRef: null, outcomeHint: null });
  }
  if (wantsOpenDoor) {
    actionSequence.push({ kind: 'open_door', targetRef: null, outcomeHint: null });
  }
  // Interrogative door mention without an unlock/open verb — surface for authority clarify.
  // Skip when a named addressee is already present (dialogue / unknown-NPC path owns it).
  if (
    addressee === null &&
    isInterrogative &&
    /\b(?:door|doorway|gate|entry(?:way)?)\b/i.test(trimmed) &&
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

  // Perception of what lies beyond an unlocked door — only when no open/transit action.
  if (
    actionSequence.length === 0 &&
    refsUnlocked &&
    /\b(?:see|look|peer|glance)\b/i.test(trimmed) &&
    !stepThroughPassage &&
    !/\benter(?:s|ing)?\b/i.test(trimmed)
  ) {
    actionSequence.push({ kind: 'inspect', targetRef: null, outcomeHint: 'unlocked door' });
  }

  if (actionSequence.length === 0 && seekingPresence) {
    actionSequence.push({ kind: 'inspect', targetRef: null, outcomeHint: 'who_is_present' });
  }

  if (actionSequence.length === 0 && observingScene) {
    actionSequence.push({ kind: 'inspect', targetRef: null, outcomeHint: 'scene_perception' });
  }

  const wantsMove =
    /(?:\bmoves?\b|\bwalks?\b|\bgoes?\b|\bsteps?\b|\bapproaches?\b|\benters?\b|\bheading\b)/i.test(
      trimmed,
    ) && !wantsUnlock;
  if (wantsMove) {
    if (!actionSequence.some((step) => step.kind === 'move')) {
      actionSequence.push({ kind: 'move', targetRef: null, outcomeHint: null });
    }
  }

  // Open/step-through (or enter beyond an unlocked door) is one passage action.
  if (
    actionSequence.some((step) => step.kind === 'open_door') &&
    actionSequence.some((step) => step.kind === 'move') &&
    (stepThroughPassage || refsUnlocked || /\benter(?:s|ing)?\b/i.test(trimmed))
  ) {
    const collapsed = actionSequence.filter((step) => step.kind !== 'move');
    actionSequence.length = 0;
    actionSequence.push(...collapsed);
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

/**
 * Minimum validation for a DM scene directive before any map apply (vertical-slice gate).
 * Does not mutate state — callers apply only after this returns ok.
 */
export function validateDmSceneDirective(directive: DmSceneDirective): {
  readonly ok: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];
  if (directive.schemaVersion !== PLAY_AUTHORITY_SPIKE.schemaVersions.scene) {
    errors.push('Unsupported scene directive schemaVersion.');
  }
  if (directive.sceneId.trim().length === 0) {
    errors.push('sceneId is required.');
  }
  if (directive.revision < 1) {
    errors.push('revision must be >= 1.');
  }
  if (directive.bounds.columns < 1 || directive.bounds.rows < 1) {
    errors.push('bounds must be positive.');
  }
  if (directive.title.trim().length === 0) {
    errors.push('title is required.');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Minimum validation for a DM NPC directive before memory apply.
 */
export function validateDmNpcDirective(directive: DmNpcDirective): {
  readonly ok: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];
  if (directive.schemaVersion !== PLAY_AUTHORITY_SPIKE.schemaVersions.npc) {
    errors.push('Unsupported NPC directive schemaVersion.');
  }
  if (directive.npcId.trim().length === 0) {
    errors.push('npcId is required.');
  }
  if (directive.name.trim().length === 0) {
    errors.push('name is required.');
  }
  return { ok: errors.length === 0, errors };
}
