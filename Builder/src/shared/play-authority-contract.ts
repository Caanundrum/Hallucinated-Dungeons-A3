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
import { expandNpcNameVariants, npcNamesMatch } from './campaign-facts.js';
import { declarationNegatesDoorOpen } from './resolved-action-receipt.js';
import {
  actionableDirectorFallback,
  classifyClause,
  filterActionsByConstraints,
  isDialogueDeclaration,
  isDocumentOpenOrReadDeclaration,
  isWholeContainerLootDeclaration,
  splitPrimaryTargetFromLocative,
  stripQuotedSpeech,
  understandUtterance,
  utteranceLooksLikeQuestion,
} from './utterance-understanding.js';

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

/** Compact door state suffix — closed / open / locked — for map chips and a11y. */
export function formatDoorAuthorityStateSuffix(state: DoorAuthorityState): string {
  if (state.leaf === 'open') {
    return 'open';
  }
  if (state.lock === 'locked') {
    return 'closed, locked';
  }
  if (state.lock === 'unlocked') {
    return 'closed, unlocked';
  }
  return 'closed';
}

/** Strip baked door-state suffixes from exit/door labels (longer forms first). */
export function stripDoorStateLabelSuffix(label: string): string {
  return label
    .replace(
      /\s*[—-]\s*(?:closed,\s*locked|closed,\s*unlocked|open|closed|locked|unlocked)\b/gi,
      '',
    )
    .replace(/\s*,\s*(?:locked|unlocked)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Player-facing door name used on map chips, a11y, and detail copy.
 * One canonical pattern: `Wooden doorway east — closed` (state appended, not renamed).
 */
export function formatDoorPlayerFacingLabel(
  state: DoorAuthorityState,
  facing: string,
): string {
  return `Wooden doorway ${facing} — ${formatDoorAuthorityStateSuffix(state)}`;
}

/** Normalize exit/door labels so doorway vs door + state suffixes collapse to one key. */
export function canonicalDoorFeatureKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/—/g, '-')
    .replace(/\s*\((?:open|closed|locked|unlocked)[^)]*\)\s*/gi, ' ')
    .replace(/\s*-\s*(?:open|closed|locked|unlocked).*$/i, ' ')
    .replace(/\bdoorways?\b/g, 'door')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Player-facing spatial label — must expose lock when known. */
export function formatDoorAuthorityLabel(state: DoorAuthorityState): string {
  const suffix = formatDoorAuthorityStateSuffix(state);
  if (state.leaf === 'open') {
    return 'Wooden doorway (open)';
  }
  if (state.lock === 'locked') {
    return 'Wooden doorway (closed, locked)';
  }
  if (state.lock === 'unlocked') {
    return 'Wooden doorway (closed, unlocked)';
  }
  return `Wooden doorway (${suffix})`;
}

/** Structured parse of a player declaration — not a fixed keyword precedence list. */
export const DECLARATION_ACTION_KINDS = [
  'dialogue',
  'move',
  'open_door',
  'close_door',
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
  const inventIgnoredNote =
    ignoredWorldFacts.length > 0
      ? ' Player-authored places, NPCs, or rules were ignored — only the Game Director establishes those.'
      : '';
  const understanding = understandUtterance(parsed.rawText);
  const sequence = filterActionsByConstraints(
    [...parsed.actionSequence],
    understanding.constraints,
  );

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

  // Knowledge/recap/rules questions with no concrete dialogue/door-sense step.
  // Do not steal NPC dialogue or ordinary door-state / scene surveys.
  const hasConcreteSense = sequence.some(
    (step) =>
      step.kind === 'dialogue' ||
      (step.kind === 'inspect' &&
        (step.outcomeHint === 'door_state' ||
          step.outcomeHint === 'listen' ||
          step.outcomeHint === 'scene_perception' ||
          step.outcomeHint === 'who_is_present' ||
          step.outcomeHint === 'map_state_correction' ||
          step.outcomeHint === 'trap_search')),
  );
  if (
    !hasConcreteSense &&
    (understanding.wantsKnowledgeRecap ||
      understanding.wantsContentsQuery ||
      understanding.speechAct === 'rules_query' ||
      (understanding.speechAct === 'question' &&
        !sequence.some((step) => step.kind === 'open_door' || step.kind === 'unlock_door')))
  ) {
    return {
      disposition: 'director_narrate_only',
      actionSequence: [
        {
          kind: 'inspect',
          targetRef: null,
          outcomeHint: understanding.wantsContentsQuery
            ? 'contents_query'
            : understanding.wantsKnowledgeRecap
              ? 'knowledge_recap'
              : understanding.speechAct === 'rules_query'
                ? 'rules_query'
                : 'scene_perception',
        },
      ],
      ignoredWorldFacts,
      clarificationPrompt: null,
      summary: actionableDirectorFallback(understanding),
      proposedCommandType: 'table.sync',
    };
  }

  if (
    understanding.constraints.prepareWithoutAttack &&
    !sequence.some((step) => step.kind === 'attack' || step.kind === 'cast')
  ) {
    return {
      disposition: 'director_narrate_only',
      actionSequence: [{ kind: 'other', targetRef: null, outcomeHint: 'prepare_weapon' }],
      ignoredWorldFacts,
      clarificationPrompt: null,
      summary: actionableDirectorFallback(understanding),
      proposedCommandType: 'table.sync',
    };
  }

  // Conditional open-if-closed: never propose step-through movement from authority alone.
  if (
    understanding.constraints.openOnlyIfClosed &&
    sequence.some((step) => step.kind === 'open_door')
  ) {
    return {
      disposition: 'propose_command',
      actionSequence: sequence.filter((step) => step.kind === 'open_door'),
      ignoredWorldFacts,
      clarificationPrompt: null,
      summary:
        'Conditional door check — open only if closed; leave it unchanged if already open. The table evaluates the live leaf before any draft commits.' +
        (ignoredWorldFacts.length > 0
          ? ' Player-authored places were ignored; only the Game Director establishes those.'
          : ''),
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
    // Free exploration & semantic intent translation: any non-empty player declaration
    // (including imperative phrasing) routes to the Game Director rather than a refusal lecture.
    const looksLikeExplorationProse =
      /\b(?:examin(?:e|es|ing)|inspect(?:s|ing)?|look(?:s|ing)?|listen(?:s|ing)?|peer(?:s|ing)?|search(?:es|ing)?|observe(?:s|ing)?|notice(?:s|ing)?|study|studying|read(?:s|ing)?|perus(?:e|es|ing)|decipher(?:s|ing)?|scan(?:s|ning)?|feel(?:s|ing)?|touch(?:es|ing)?|tap(?:s|ping)?|smell(?:s|ing)?|sniff(?:s|ing)?|taste(?:s|ing)?|whisper(?:s|ing)?|murmur(?:s|ing)?|investigat(?:e|es|ing)?|hide|hiding|hid|conceal(?:s|ing|ed)?|take\s+cover)\b/i.test(
        parsed.rawText,
      ) &&
      !/\b(?:attack|strike|cast|fireball|unlock|pick\s+the\s+lock)\b/i.test(parsed.rawText);
    if (looksLikeExplorationProse || parsed.rawText.trim().length > 0) {
      return {
        disposition: 'director_narrate_only',
        actionSequence: [
          {
            kind: 'inspect',
            targetRef: null,
            outcomeHint: looksLikeExplorationProse ? 'sensory_sequence' : 'roleplay_action',
          },
        ],
        ignoredWorldFacts,
        clarificationPrompt: null,
        summary:
          (looksLikeExplorationProse
            ? 'You look and listen — the Game Director narrates what you perceive. No move or attack is prepared.'
            : 'You act within the scene — the Game Director narrates what unfolds from your action.') +
          inventIgnoredNote,
        proposedCommandType: 'table.sync',
      };
    }
    const fallback = actionableDirectorFallback(understanding);
    return {
      disposition: 'clarify',
      actionSequence: [],
      ignoredWorldFacts,
      clarificationPrompt: fallback,
      summary: fallback,
      proposedCommandType: null,
    };
  }

  // Sensory / perception compounds resolve as one Director-narrated beat.
  const sensoryOnly = actionable.every(
    (step) =>
      step.kind === 'inspect' &&
      (step.outcomeHint === 'listen' ||
        step.outcomeHint === 'door_state' ||
        step.outcomeHint === 'scene_perception' ||
        step.outcomeHint === 'sensory_sequence' ||
        step.outcomeHint === 'read_text' ||
        step.outcomeHint === 'roleplay_action' ||
        step.outcomeHint === 'stay_put' ||
        step.outcomeHint === 'who_is_present' ||
        step.outcomeHint === 'map_state_correction' ||
        step.outcomeHint === null),
  );
  if (actionable.length > 1 && sensoryOnly) {
    return {
      disposition: 'director_narrate_only',
      actionSequence: [
        {
          kind: 'inspect',
          targetRef: null,
          outcomeHint: 'sensory_sequence',
        },
      ],
      ignoredWorldFacts,
      clarificationPrompt: null,
      summary:
        'You look and listen — the Game Director narrates what you perceive. No move or attack is prepared.',
      proposedCommandType: 'table.sync',
    };
  }

  if (actionable.length > 1) {
    // Prefer an active skill check or concrete table action; Director narration can carry flavor.
    const skillCheckStep = actionable.find(
      (step) =>
        step.kind === 'inspect' &&
        (step.outcomeHint === 'trap_search' ||
          step.outcomeHint === 'investigate_mark' ||
          step.outcomeHint === 'active_search' ||
          step.outcomeHint === 'stealth_hide'),
    );
    if (skillCheckStep !== undefined) {
      return {
        disposition: 'propose_command',
        actionSequence: [skillCheckStep],
        ignoredWorldFacts,
        clarificationPrompt: null,
        summary:
          skillCheckStep.outcomeHint === 'stealth_hide'
            ? 'Ready to hide. Confirm to roll Stealth check on the table.' + inventIgnoredNote
            : skillCheckStep.outcomeHint === 'investigate_mark'
              ? 'Ready to inspect the mark. Confirm to roll Investigation check on the table.' + inventIgnoredNote
              : skillCheckStep.outcomeHint === 'active_search'
                ? 'Ready to search carefully. Confirm to roll Investigation check on the table.' + inventIgnoredNote
                : 'Ready to search carefully for traps. Confirm to roll Investigation against the named target.' + inventIgnoredNote,
        proposedCommandType: 'table.sync',
      };
    }
    const primaryStep =
      actionable.find(
        (step) =>
          step.kind === 'move' ||
          step.kind === 'open_door' ||
          step.kind === 'close_door' ||
          step.kind === 'unlock_door' ||
          step.kind === 'attack' ||
          step.kind === 'cast',
      ) ?? null;
    if (
      primaryStep !== null &&
      (primaryStep.kind === 'move' ||
        primaryStep.kind === 'open_door' ||
        primaryStep.kind === 'close_door')
    ) {
      const proposedCommandType = commandTypeForActionKind(primaryStep.kind);
      return {
        disposition: proposedCommandType === null ? 'clarify' : 'propose_command',
        actionSequence: [primaryStep],
        ignoredWorldFacts,
        clarificationPrompt:
          proposedCommandType === null
            ? 'That action is not supported yet — try a simpler declaration.'
            : null,
        summary: summaryForActionStep(primaryStep),
        proposedCommandType,
      };
    }
    const labels = actionable.map((step) => step.kind.replace(/_/g, ' '));
    const primary = labels[0]!;
    const rest = labels.slice(1).join(', then ');
    return {
      disposition: 'clarify',
      actionSequence: actionable,
      ignoredWorldFacts,
      clarificationPrompt: `Primary intent is ${primary}${rest ? `, then ${rest}` : ''}. Confirm that order, or declare one action at a time.`,
      summary: `Primary: ${primary}. Next: ${rest || 'none'}. Confirm the sequence or take them one at a time.`,
      proposedCommandType: null,
    };
  }

  const only = actionable[0]!;

  // Perception / presence checks are Director narration, never map or combat commands.
  // Trap / hazard searches are confirmable skill-check drafts (not casual prose).
  if (only.kind === 'inspect') {
    if (
      only.outcomeHint === 'trap_search' ||
      only.outcomeHint === 'investigate_mark' ||
      only.outcomeHint === 'active_search' ||
      only.outcomeHint === 'stealth_hide'
    ) {
      return {
        disposition: 'propose_command',
        actionSequence: [only],
        ignoredWorldFacts,
        clarificationPrompt: null,
        summary:
          only.outcomeHint === 'stealth_hide'
            ? 'Ready to hide. Confirm to roll Stealth check on the table.' + inventIgnoredNote
            : only.outcomeHint === 'investigate_mark'
              ? 'Ready to inspect the mark. Confirm to roll Investigation check on the table.' + inventIgnoredNote
              : only.outcomeHint === 'active_search'
                ? 'Ready to search carefully. Confirm to roll Investigation check on the table.' + inventIgnoredNote
                : 'Ready to search carefully for traps. Confirm to roll Investigation against the named target.' + inventIgnoredNote,
        proposedCommandType: 'table.sync',
      };
    }
    if (only.outcomeHint === 'take_container') {
      return {
        disposition: 'propose_command',
        actionSequence: [only],
        ignoredWorldFacts,
        clarificationPrompt: null,
        summary:
          'Ready to take that portable container into your inventory. Confirm to stow it and remove it from the map.' +
          inventIgnoredNote,
        proposedCommandType: 'table.take_scene_prop',
      };
    }
    if (only.outcomeHint === 'take_item' || only.outcomeHint === 'take_from_container') {
      return {
        disposition: 'director_narrate_only',
        actionSequence: [only],
        ignoredWorldFacts,
        clarificationPrompt: null,
        summary:
          (only.outcomeHint === 'take_from_container'
            ? 'You try to take something from that container — the Game Director answers from authored contents and inventory rules. No invented loot is prepared.'
            : 'You try to take that prop — the Game Director answers from authored contents and inventory rules. No invented loot is prepared.') +
          inventIgnoredNote,
        proposedCommandType: 'table.sync',
      };
    }
    const seekingPresence = only.outcomeHint === 'who_is_present';
    const doorState =
      only.outcomeHint === 'door_state' || only.outcomeHint === 'listen' || only.outcomeHint === 'sensory_sequence';
    const mapCorrection = only.outcomeHint === 'map_state_correction';
    return {
      disposition: 'director_narrate_only',
      actionSequence: [only],
      ignoredWorldFacts,
      clarificationPrompt: null,
      summary:
        (seekingPresence
          ? 'You are looking for who is present — the Game Director will answer in fiction.'
          : mapCorrection
            ? 'You are correcting visible map state — the Game Director will reconcile the live door summary.'
          : doorState
            ? only.outcomeHint === 'sensory_sequence'
              ? /\b(?:hide|conceal|crouch|kneel|hunker|duck\s+behind|take\s+cover)\b/i.test(parsed.rawText)
                ? 'You listen from cover — the Game Director narrates what you perceive. Crouching does not establish a Hide on the table; no move or attack is prepared.'
                : /\b(?:wait|hold\s+(?:still|position)|pause|minute)\b/i.test(parsed.rawText)
                ? 'You wait a beat and listen — the Game Director narrates what you perceive after that short pause. No move or attack is prepared.'
                : 'You hold still and listen — the Game Director narrates what you perceive. No move or attack is prepared.'
              : only.outcomeHint === 'listen'
              ? 'You listen at the doorway — the Game Director narrates what you hear. No open or move is prepared.'
              : 'You check the doorway without opening it — the Game Director narrates its visible state. No open or move is prepared.'
            : 'You look and listen — the Game Director narrates what is perceptible.') + inventIgnoredNote,
      proposedCommandType: 'table.sync',
    };
  }

  if (only.kind === 'dialogue' || only.kind === 'other') {
    return {
      disposition: 'director_narrate_only',
      actionSequence: [only],
      ignoredWorldFacts,
      clarificationPrompt: null,
      summary: summaryForActionStep(only) + inventIgnoredNote,
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
    case 'close_door':
      return 'table.close_door';
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
    case 'close_door':
      return 'Ready to close the door. Confirm to commit.';
    case 'unlock_door':
      return 'Ready to attempt unlocking the door. Confirm to roll.';
    case 'move':
      return 'Ready to move. Confirm to commit the step.';
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
  // "Pick up / picking up" is inventory language — never a lock attempt (VDM-005).
  // Also strip negated lock/unlock clauses ("without opening or unlocking it", "not unlocking") (R26-02).
  const withoutPickUp = text
    .replace(/\bpick(?:ing|ed)?\s+up\b/gi, ' ')
    .replace(
      /\b(?:without|not|never|do\s+not|don't|dont)\s+(?:(?:opening|touching|forcing|breaking|disturbing)\s+(?:or|and)\s+)?(?:unlock(?:ing)?|pick(?:ing)?(?:\s+(?:the\s+)?lock)?)\b/gi,
      ' ',
    );
  const picksLockOrDoor =
    /\bpick(?:ing|ed)?\s+(?:the\s+)?(?:lock|door|doorway|gate|entry(?:way)?)\b/i.test(
      withoutPickUp,
    ) ||
    (/\b(?:pick|picking|picked)\b/i.test(withoutPickUp) &&
      /\b(?:lock|door|doorway|gate|entry(?:way)?)\b/i.test(withoutPickUp));
  // "Unlocked door/doorway" is leaf/lock state, never a pick attempt (hosted recheck).
  if (textReferencesUnlockedDoorState(withoutPickUp) || /\bunlocked\b/i.test(withoutPickUp)) {
    // Allow explicit pick-the-lock language even when the door is described as unlocked.
    return (
      picksLockOrDoor ||
      /\bthieves['’]?\s*tools\b/i.test(withoutPickUp) ||
      /\b(?:force|bypass|break)\s+(?:the\s+)?lock\b/i.test(withoutPickUp)
    );
  }
  return (
    picksLockOrDoor ||
    /\bthieves['’]?\s*tools\b/i.test(withoutPickUp) ||
    /\b(?:force|bypass|break)\s+(?:the\s+)?lock\b/i.test(withoutPickUp) ||
    /\bunlock(?:s|ing)?\b/i.test(withoutPickUp)
  );
}

export function textIsInterrogative(text: string): boolean {
  return utteranceLooksLikeQuestion(text);
}

export interface ParsePlayerDeclarationOptions {
  readonly knownNpcs?: readonly { readonly id: string; readonly label: string }[];
  readonly presentNpcs?: readonly { readonly id: string; readonly label: string }[];
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

  // Strip quoted speech when looking for the addressee and physical action verbs so mentions inside dialogue aren't mistaken for actions (`CV-01`).
  const outsideQuotes = stripQuotedSpeech(trimmed);
  const searchScope = outsideQuotes.length > 0 ? outsideQuotes : trimmed;

  let addressee: string | null = null;
  // 1. Direct speech targeting on known NPCs: "ask Warden Elira", "speaking to Elira", "@Elira,"
  for (const npc of knownNpcs) {
    const nameVariants = expandNpcNameVariants(npc.label);
    for (const variant of nameVariants) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (
        new RegExp(`^@?${escaped}\\s*[,:]`, 'i').test(searchScope) ||
        new RegExp(`^(?:hey|hi)\\s+${escaped}\\b`, 'i').test(searchScope) ||
        new RegExp(
          `\\b(?:asks?|tells?|speaking\\s+to|talk(?:s|ing)?\\s+(?:to|with)|speaks?\\s+(?:to|with)|question(?:s|ing)?|inquir(?:e|es|ing)\\s+of|greets?|address(?:es|ing)?|says?\\s+to)\\s+(?:the\\s+)?(?:[a-z]+\\s+)?${escaped}\\b`,
          'i',
        ).test(searchScope)
      ) {
        addressee = npc.label;
        break;
      }
    }
    if (addressee !== null) break;
  }

  // Unknown named addressee stop-words — never treat common verbs, adverbs, pronouns, or interjections as NPC names.
  const NPC_CANDIDATE_STOP_WORDS =
    /^(?:The|This|That|What|Which|Where|When|Why|How|Who|Whom|Whose|Director|Garrick|Veyra|In|At|On|For|From|With|By|About|Of|A|An|If|Whether|Then|First|Softly|Quietly|Loudly|Low|Now|Wait|Look|Listen|Here|There|Well|Hold|Stop|Sure|Okay|Yes|No|Fine|Hm|Hmm|Oh|Ah|Quick|Slowly|Carefully|Suddenly|Cautiously|Silently|Gently|Meanwhile|Next|Finally)$/i;

  // 2. Check leading addressee format: "Orin: ...", "@Orin, ..."
  if (addressee === null) {
    const leading = /^@?([A-Z][a-zA-Z'-]{1,24}(?:\s+[A-Z][a-zA-Z'-]{1,24})?)\s*[,:]/.exec(searchScope);
    if (leading !== null) {
      const candidate = leading[1]!;
      const matchKnown = knownNpcs.find(
        (n) =>
          n.label.toLowerCase() === candidate.toLowerCase() ||
          npcNamesMatch(n.label, candidate),
      );
      if (matchKnown !== undefined) {
        addressee = matchKnown.label;
      } else if (!NPC_CANDIDATE_STOP_WORDS.test(candidate) && !/ly$/i.test(candidate)) {
        addressee = candidate;
      }
    }
  }

  // 3. Unknown named addressee with explicit speech verb: "asks Nib", "ask Nib,", "speaking to Nib"
  // Multi-word support; NO /i flag so lowercase words like "in", "softly", "about" are never treated as NPC names.
  if (addressee === null) {
    // Strip adverbial or prepositional speech phrases like "in a low voice", "in a whisper", "softly", "quietly"
    const cleanedSearch = searchScope.replace(
      /\b(?:in\s+a\s+(?:low|quiet|hushed|soft)\s+voice|in\s+a\s+whisper|softly|quietly|aloud)\b/gi,
      '',
    );
    const asked =
      /\b(?:asks?|tells?|speaking\s+to|talk(?:s|ing)?\s+to|speaks?\s+to|question(?:s|ing)?)\s+(?:the\s+)?([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)*)\b/.exec(
        cleanedSearch,
      );
    if (asked !== null) {
      const candidate = asked[1]!.trim();
      if (!NPC_CANDIDATE_STOP_WORDS.test(candidate)) {
        const matchKnown = knownNpcs.find(
          (n) =>
            n.label.toLowerCase() === candidate.toLowerCase() ||
            n.label.toLowerCase().startsWith(candidate.toLowerCase() + ' ') ||
            n.label.toLowerCase().endsWith(' ' + candidate.toLowerCase()) ||
            npcNamesMatch(n.label, candidate),
        );
        addressee = matchKnown ? matchKnown.label : candidate;
      }
    }
  }

  // 4. Fallback: known NPC mentioned outside quotes alongside a speaking verb
  if (addressee === null) {
    for (const npc of knownNpcs) {
      const variants = expandNpcNameVariants(npc.label);
      const matchedVariant = variants.some((variant) => {
        const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(searchScope);
      });
      if (
        matchedVariant &&
        /\b(?:speaks?|talking|talks?|greets?|questions?|inquires?|says?|approach(?:es|ing)?|address(?:es|ing)?)\b/i.test(
          searchScope,
        )
      ) {
        addressee = npc.label;
        break;
      }
    }
  }

  // 5. Fallback: interpersonal speech / question directed at the present room NPC without naming them explicitly (F26-02)
  // e.g. "I lean across the counter and ask in a low voice, 'Who was the last patron seen entering the backroom with the masked courier?'"
  if (addressee === null) {
    const presentTargets = options.presentNpcs ?? (knownNpcs.length === 1 ? knownNpcs : []);
    if (
      presentTargets.length > 0 &&
      !/\b(?:director|dm|game\s*master)\b/i.test(searchScope) &&
      /\b(?:asks?|tells?|says?\s+to|speaks?\s+(?:to|with)|talk(?:s|ing)?\s+(?:to|with)|whispers?(?:\s+to)?|inquir(?:e|es|ing)|question(?:s|ing)?|greets?|address(?:es|ing)?)\b/i.test(
        searchScope,
      ) &&
      (/"[^"]+"|[“”][^“”]+[“”]|'[A-Z][^']*'/u.test(trimmed) ||
        /\b(?:counter|bar|barkeep|tavernkeep(?:er)?|innkeep(?:er)?|warden|guard|patron|host|merchant|keeper|clerk|stranger|her|him|them)\b/i.test(
          searchScope,
        ) ||
        /\b(?:asks?|inquir(?:e|es|ing)|question(?:s|ing)?)\b[\s\S]{0,40}\b(?:who|what|where|when|why|how|which|whether|if)\b/i.test(
          trimmed,
        ))
    ) {
      addressee = presentTargets[0]!.label;
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
    /\b(?:survey(?:s|ing)?|look(?:s|ing)?\s+and\s+listen|listen(?:s|ing)?\s+carefully|look(?:s|ing)?\s+carefully|peer(?:s|ing)?\s+around|look(?:s|ing)?\s+around(?:\s+(?:me|here))?|take(?:s|ing)?\s+(?:a\s+)?look\s+around|see(?:s|ing)?\s+around(?:\s+(?:me|here))?|describe\s+only\s+what)\b/i.test(
      trimmed,
    ) ||
    // Ordinary sensory questions about the current place ("What do I see around me?").
    (/\bwhat\s+(?:do|can)\s+i\s+(?:see|notice|observe|perceive|hear)\b/i.test(trimmed) &&
      !/\b(?:door|doorway|gate|lock|trap)\b/i.test(trimmed)) ||
    /\bwhat(?:'s|s|\s+is)\s+(?:around\s+(?:me|here)|nearby|in\s+(?:this\s+)?(?:room|chamber|area|scene)|here)\b/i.test(
      trimmed,
    ) ||
    // Broad examine/search/investigate/see of the scene — not a targeted prop roll.
    (/\b(?:examin(?:e|es|ing)|search(?:es|ing)?|investigat(?:e|es|ing)|inspect(?:s|ing)?|look(?:s|ing)?|listen(?:s|ing)?|see(?:s|ing)?|notice(?:s|ing)?|observe(?:s|ing)?)\b/i.test(
      trimmed,
    ) &&
      /\b(?:chamber|room|scene|surroundings|area|here|around|nearby)\b/i.test(trimmed) &&
      !/\b(?:door|doorway|gate|lock|lamp|bench|crate|counter|trap)\b/i.test(trimmed) &&
      !/\b(?:unlock|attack|strike|cast|open|opens|opening)\b/i.test(trimmed));

  // Strip subordinate observation clauses mentioning a door/doorway ("keeping an eye on the closed east doorway",
  // "while watching the doorway") and secondary locative qualifiers ("near the eastern doorway") so primary
  // movement/prop/clue intent is not hijacked by door state/approach (F26-01, RS-03, CV-01).
  const { primaryClause: withoutLocativeClause } = splitPrimaryTargetFromLocative(searchScope);
  const primaryActionText = withoutLocativeClause
    .replace(
      /(?:,\s*|\s+)(?:while\s+|whilst\s+|as\s+i\s+)?(?:keeping\s+(?:an\s+eye|watch|my\s+eyes?)\s+on|watching|eyeing|glancing\s+(?:at|toward)|looking\s+toward|staying\s+wary\s+of|mindful\s+of)\s+(?:the\s+)?(?:[a-z-]+\s+){0,4}(?:door|doorway|gate|entry(?:way)?|threshold|exit)\b[^.?!]*/gi,
      '',
    )
    .trim();
  const doorScopeText = (primaryActionText.length > 0 ? primaryActionText : searchScope).replace(
    /\b(?:door|doorway|gate)\s+(?:lever|switch|mechanism|winch|crank|pulley|chain|valve|dial|key)s?\b/gi,
    'mechanism',
  );

  const wantsUnlock = textRequestsLockPicking(doorScopeText);
  const refsUnlocked = textReferencesUnlockedDoorState(doorScopeText);
  // Negation / exclusion: "without opening", "do not open" — never draft open_door.
  const negatesOpen = declarationNegatesDoorOpen(doorScopeText);
  // Adjectival "open/opened wooden door" is door state, not an open-door verb.
  const withoutOpenDoorNoun = doorScopeText.replace(
    /\bopen(?:ed)?\s+(?:wooden\s+)?(?:door|doorway|gate|entry(?:way)?)s?\b/gi,
    'doorway',
  );
  const stepThroughPassage =
    !negatesOpen &&
    (/\b(?:steps?|stepping|walks?|walking|goes?|going)\s+through\b/i.test(doorScopeText) ||
      /\bthrough\s+(?:the\s+)?(?:open(?:ed)?\s+)?(?:wooden\s+)?(?:door|doorway|gate|entry(?:way)?)\b/i.test(
        doorScopeText,
      ) ||
      /\b(?:into|enter(?:s|ing)?)\s+(?:the\s+)?(?:room|chamber)\s+beyond\b/i.test(doorScopeText) ||
      /\benter(?:s|ing)?\s+(?:the\s+)?(?:room|chamber|passage)\b/i.test(doorScopeText));
  const openDoorVerb =
    !negatesOpen &&
    /\b(?:opens?|opening|push(?:es|ing)?\s+open|swing(?:s|ing)?\s+open)\b/i.test(withoutOpenDoorNoun) &&
    /\b(?:door|doorway|gate|entry(?:way)?)\b/i.test(withoutOpenDoorNoun) &&
    // "already open" / "is open" is state description, not an open action.
    !/\b(?:already\s+open|is\s+open|says?\s+closed|still\s+closed)\b/i.test(doorScopeText);
  const wantsOpenDoor =
    !wantsUnlock &&
    !negatesOpen &&
    (openDoorVerb ||
      // Passage language against an already-unlocked doorway is open/transit, not lock-picking.
      (refsUnlocked && (stepThroughPassage || /\benter(?:s|ing)?\b/i.test(doorScopeText))));

  const wantsCloseDoor =
    !wantsUnlock &&
    !wantsOpenDoor &&
    /\b(?:closes?|closing|shut(?:s|ting)?)\b/i.test(doorScopeText) &&
    /\b(?:door|doorway|gate|entry(?:way)?)\b/i.test(doorScopeText);

  // Door state / listen / lock-check without opening — Perception/fiction, not move/open.
  // Bare negation with an explicit move verb is movement only (not inspect+move).
  // Trap / disarm / careful search is a skill check — never a casual door-state read.
  const wantsTrapOrHazardSearch =
    /\b(?:traps?|disarm|search\s+for|look\s+for\s+traps?)\b/i.test(doorScopeText);
  const doorSenseVerb =
    /\b(?:listen(?:s|ing)?|check(?:s|ing)?|inspect(?:s|ing)?|examin(?:e|es|ing)|look(?:s|ing)?\s+at|study)\b/i.test(
      doorScopeText,
    ) ||
    (/\block(?:ed)?\b/i.test(doorScopeText) &&
      /\b(?:check|see|whether|if|inspect|examin)\b/i.test(doorScopeText)) ||
    /\b(?:whether|if)\s+(?:the\s+)?(?:door|doorway|gate|lock)/i.test(doorScopeText) ||
    // "Is the door locked?" / "Is it locked?" — state query, not open.
    /\bis\s+(?:the\s+)?(?:door|doorway|gate|lock)\s+locked\b/i.test(doorScopeText) ||
    /\bis\s+it\s+locked\b/i.test(doorScopeText);
  const explicitMoveVerb =
    /\b(?:walks?|walking|moves?|moving|goes?|going|steps?|stepping|approaches?)\b/i.test(doorScopeText);
  const wantsDoorStateRead =
    !wantsTrapOrHazardSearch &&
    /\b(?:door|doorway|gate|entry(?:way)?)\b/i.test(doorScopeText) &&
    !wantsUnlock &&
    !wantsOpenDoor &&
    (doorSenseVerb || (negatesOpen && !explicitMoveVerb));

  // Approach / stand beside a doorway is door-adjacent movement, not free mark-square.
  // Preposition must bind directly to the door so "beside the counter watching the doorway" is NOT a door approach.
  const wantsBesideDoor =
    /\b(?:beside|next\s+to|adjacent\s+to|up\s+to)\s+(?:the\s+)?(?:[a-z-]+\s+){0,3}(?:door|doorway|gate|entry(?:way)?)\b/i.test(
      doorScopeText,
    ) ||
    (/\b(?:door|doorway|gate|entry(?:way)?)\b/i.test(doorScopeText) &&
      /\b(?:(?:stop|stand|halt|wait|pause)s?\s+(?:right\s+)?(?:beside|next\s+to|by|at|before|in\s+front\s+of)\s+it|(?:move|walk|step|go|head)s?\s+(?:[a-z0-9-]+\s+){0,4}to\s+(?:the\s+)?(?:[a-z-]+\s+){0,3}(?:door|doorway|gate|entry(?:way)?)\b[\s\S]{0,40}\bwithout\s+(?:opening|crossing|entering|stepping\s+through))\b/i.test(
        doorScopeText,
      ));

  if (wantsUnlock) {
    actionSequence.push({ kind: 'unlock_door', targetRef: null, outcomeHint: null });
  }
  if (wantsTrapOrHazardSearch && !wantsUnlock) {
    actionSequence.push({
      kind: 'inspect',
      targetRef: null,
      outcomeHint: 'trap_search',
    });
  } else if (wantsDoorStateRead) {
    const listenHint = /\blisten\b/i.test(trimmed) ? 'listen' : 'door_state';
    actionSequence.push({ kind: 'inspect', targetRef: null, outcomeHint: listenHint });
  } else if (stepThroughPassage && !openDoorVerb && !refsUnlocked) {
    // "Through the open door" with no open verb is transit/move, not open_door.
    if (!actionSequence.some((step) => step.kind === 'move')) {
      actionSequence.push({ kind: 'move', targetRef: null, outcomeHint: null });
    }
  } else if (wantsOpenDoor) {
    actionSequence.push({ kind: 'open_door', targetRef: null, outcomeHint: null });
  } else if (wantsCloseDoor) {
    actionSequence.push({ kind: 'close_door', targetRef: null, outcomeHint: null });
  }

  // Compound sensory staging: hide / sneak / wait / listen
  const wantsSneak =
    /\b(?:sneak(?:s|ing)?|slip(?:s|ping)?|slink(?:s|ing)?)\b/i.test(trimmed);
  const wantsHide =
    /\b(?:hide|hiding|conceal(?:\s+myself)?|crouch(?:\s+behind)?|kneel(?:\s+behind)?|hunker(?:\s+down)?|duck\s+behind|take\s+cover(?:\s+behind)?)\b/i.test(
      trimmed,
    );
  const wantsWait = /\b(?:wait|hold\s+(?:still|position)|pause)\b/i.test(trimmed);
  const wantsListen = /\blisten\b/i.test(trimmed);

  if (wantsSneak) {
    actionSequence.push({
      kind: 'inspect',
      targetRef: null,
      outcomeHint: 'stealth_hide',
    });
  } else if ((wantsHide || wantsWait) && wantsListen) {
    const withoutMove = actionSequence.filter((step) => step.kind !== 'move');
    actionSequence.length = 0;
    actionSequence.push({
      kind: 'inspect',
      targetRef: null,
      outcomeHint: 'sensory_sequence',
    });
    for (const step of withoutMove) {
      if (step.kind === 'inspect' && (step.outcomeHint === 'listen' || step.outcomeHint === 'door_state')) {
        continue;
      }
      if (step.kind !== 'inspect' || step.outcomeHint !== 'sensory_sequence') {
        actionSequence.push(step);
      }
    }
  } else if (wantsHide && actionSequence.length === 0) {
    actionSequence.push({
      kind: 'inspect',
      targetRef: null,
      outcomeHint: 'stealth_hide',
    });
  }
  // Interrogative door mention without an unlock/open verb — surface for authority clarify.
  // Skip when a named addressee is already present (dialogue / unknown-NPC path owns it).
  // Skip scene surveys that only mention doorway as location ("look around from past the doorway").
  if (
    addressee === null &&
    isInterrogative &&
    /\b(?:door|doorway|gate|entry(?:way)?)\b/i.test(doorScopeText) &&
    !wantsUnlock &&
    !wantsOpenDoor &&
    !wantsDoorStateRead &&
    !wantsTrapOrHazardSearch &&
    !observingScene
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

  const wantsInvestigation =
    /\b(?:investigat(?:e|es|ing)?|decipher(?:s|ing)?|translat(?:e|es|ing)|using\s+(?:my\s+)?investigation)\b/i.test(
      searchScope,
    ) ||
    (/\b(?:inspect(?:s|ing)?|examin(?:e|es|ing)?|check(?:s|ing)?|feel(?:s|ing)?|probe|probing)\b/i.test(
      searchScope,
    ) &&
      /\b(?:hidden|secret|false|concealed|latches?|compartments?|panels?|mechanisms?|hollow|seams?)\b/i.test(
        searchScope,
      ));
  const wantsSearch = /\bsearch(?:es|ing)?\b/i.test(searchScope) && !observingScene;
  const wantsRead =
    /\b(?:read(?:s|ing)?|perus(?:e|es|ing)|scan(?:s|ning)?|por(?:e|es|ing)\s+over|leaf(?:s|ing)?\s+through)\b/i.test(
      searchScope,
    ) || isDocumentOpenOrReadDeclaration(trimmed);

  // Targeted prop examine / read / listen — Director narrates or routes to object/skill check.
  if (
    actionSequence.length === 0 &&
    (wantsRead ||
      /\b(?:examin(?:e|es|ing)|inspect(?:s|ing)?|look(?:s|ing)?(?:\s+closely)?\s+at|listen(?:s|ing)?|eavesdrop(?:s|ping)?|peer(?:s|ing)?|study|studies|studying|read(?:s|ing)?|perus(?:e|es|ing)|decipher(?:s|ing)?|translat(?:e|es|ing)|scan(?:s|ning)?|por(?:e|es|ing)\s+over|leaf(?:s|ing)?\s+through|smell(?:s|ing)?|sniff(?:s|ing)?|feel(?:s|ing)?|touch(?:es|ing)?|tap(?:s|ping)?|test(?:s|ing)?|investigat(?:e|es|ing)?|search(?:es|ing)?)\b/i.test(
        searchScope,
      )) &&
    !/\b(?:attack|strike|cast|unlock|pick\s+the\s+lock)\b/i.test(searchScope) &&
    !wantsOpenDoor &&
    !wantsCloseDoor &&
    !wantsUnlock
  ) {
    const listenMentionsDoor =
      /\blisten\b/i.test(searchScope) &&
      /\b(?:door|doorway|gate|entry(?:way)?|threshold|passage)\b/i.test(searchScope);
    actionSequence.push({
      kind: 'inspect',
      targetRef: null,
      // Door-ear listen only when the text names a door/threshold. Window / lantern /
      // room listens stay scene perception so Director narrates the declared props.
      outcomeHint: listenMentionsDoor
        ? 'listen'
        : /\b(?:listen|eavesdrop)\b/i.test(searchScope)
          ? 'sensory_sequence'
          : wantsInvestigation
            ? 'investigate_mark'
            : wantsSearch
              ? 'active_search'
              : wantsRead
                ? 'read_text'
                : 'scene_perception',
    });
  }

  // Take / pick up / carry — container prop vs item from inside (VDM-005).
  const isRestOrIdiomTake =
    /\b(?:short\s*rest|long\s*rest)\b/i.test(searchScope) ||
    /\btake(?:s|ing)?\s+(?:a\s+)?(?:short\s+rest|long\s+rest|rest|cover|look|breath|step|moment|seat|turn|aim)\b/i.test(
      searchScope,
    );
  const takeVerb =
    !isRestOrIdiomTake &&
    (isWholeContainerLootDeclaration(trimmed) ||
      /\b(?:take|grab|pocket|stow|carry|lift|loot|empty|plunder|ransack|retrieve|collect|pick(?:ing|ed)?\s+up)\b/i.test(
        searchScope,
      ));
  const negatesTakeFrom =
    /\b(?:(?:do\s+not|don't|dont|not)\s+tak(?:e|ing)|without\s+tak(?:e|ing))\b[\s\S]{0,40}\b(?:from|inside|contents?)\b/i.test(
      searchScope,
    ) ||
    /\bnot\s+taking\s+anything\s+from\b/i.test(searchScope);
  if (actionSequence.length === 0 && takeVerb && !wantsOpenDoor && !wantsCloseDoor && !wantsUnlock) {
    const containerNoun =
      /\b(?:courier\s+satchel|satchel|pack|bag|crate|chest|[a-z]*box|[a-z]*locker|barrel|urn|pouch|coffer|trunk|cabinet|reliquary|cache|hamper)\b/i.test(
        searchScope,
      );
    const takeFromContainer =
      containerNoun &&
      !negatesTakeFrom &&
      (isWholeContainerLootDeclaration(trimmed) ||
        /\b(?:take|grab|pocket|stow|loot|empty|plunder|ransack|retrieve|collect)\b[\s\S]{0,48}\bfrom\b[\s\S]{0,32}\b(?:courier\s+satchel|satchel|pack|bag|crate|chest|[a-z]*box|[a-z]*locker|barrel|urn|pouch|coffer|trunk|cabinet|reliquary|cache|hamper)\b/i.test(
          searchScope,
        ));
    const takeContainer =
      containerNoun &&
      !takeFromContainer &&
      !/\b(?:letter|key|item|object|contents?)\b/i.test(
        searchScope
          .replace(/\bopen\b/i, '')
          .replace(/\bnot\s+taking\s+anything\s+from\b[\s\S]*/i, '')
          .replace(/\binside\s+it\b/gi, ''),
      );
    actionSequence.push({
      kind: 'inspect',
      targetRef: null,
      outcomeHint: takeFromContainer
        ? 'take_from_container'
        : takeContainer
          ? 'take_container'
          : 'take_item',
    });
  }

  // Named spell cast — capability check owns refusal (not empty clarify).
  if (
    actionSequence.length === 0 &&
    !/\b(?:arcane\s+recovery|short\s*rest|long\s*rest|spell\s+slots?)\b/i.test(searchScope) &&
    /\b(?:cast|spell|fireball|fire\s*bolt|burning\s*hands|sacred\s*flame|guiding\s*bolt|cure\s*wounds)\b/i.test(
      searchScope,
    )
  ) {
    actionSequence.push({ kind: 'cast', targetRef: null, outcomeHint: null });
  }

  // "Map still says closed" / summary corrections — Director narrates live edge truth.
  if (
    actionSequence.length === 0 &&
    ((/\b(summary|routes?|map)\b/i.test(searchScope) &&
      /\b(closed|open|wrong|still|says?|show|showing|fix|correct|update)\b/i.test(searchScope)) ||
      (/\b(door|doorway)\b/i.test(searchScope) &&
        /\b(already\s+open|is\s+open|says?\s+closed|still\s+closed|summary)\b/i.test(searchScope)))
  ) {
    actionSequence.push({ kind: 'inspect', targetRef: null, outcomeHint: 'map_state_correction' });
  }

  const unquotedActionText = searchScope;
  const isQuotedSpeechOrAsk =
    isDialogueDeclaration(
      trimmed,
      knownNpcs.map((n) => n.label),
    ) ||
    (/"[^"]+"|[“”][^“”]+[“”]|(?:^|[\s,;:(\[])'[^']+'(?=$|[\s.,!?;:)\]])|(?:^|[\s,;:(\[])‘[^’]+’(?=$|[\s.,!?;:)\]])/u.test(
      trimmed,
    ) &&
      /\b(?:ask(?:s|ing)?|say(?:s|ing)?|speak(?:s|ing)?|talk(?:s|ing)?|tell(?:s|ing)?|whisper(?:s|ing)?|inquir(?:e|es|ing)|call(?:s|ing)?|greet(?:s|ing)?|question(?:s|ing)?|address(?:es|ing)?)\b/i.test(
        unquotedActionText,
      ));
  if (isQuotedSpeechOrAsk && !actionSequence.some((step) => step.kind === 'dialogue')) {
    actionSequence.unshift({
      kind: 'dialogue',
      targetRef: addressee,
      outcomeHint: null,
    });
  }

  const wantsMove =
    !isQuotedSpeechOrAsk &&
    (/(\bmoves?\b|\bwalks?\b|\bgoes?\b|\bsteps?\b|\bapproaches?\b|\benters?\b|\bheading\b|\bheads?\b|\bproceeds?\b|\bproceeding\b|\bfollows?\b|\bfollowing\b|\btraces?\b|\btracing\b|\bclimbs?\b|\bclimbing\b|\bdescends?\b|\bascends?\b|\bcross(?:es|ing)?\s+into\b|\bventur(?:e|es|ing)\s+into\b|\bleav(?:e|es|ing)\s+toward\b|\breturns?\b|\bretreats?\b|\bhead\s+back\b|\bgo\s+back\b)/i.test(
      unquotedActionText,
    ) ||
      wantsBesideDoor) &&
    !wantsUnlock &&
    !wantsTrapOrHazardSearch &&
    !wantsInvestigation &&
    !wantsSearch &&
    !wantsRead &&
    !wantsHide;
  if (wantsMove) {
    if (!actionSequence.some((step) => step.kind === 'move')) {
      actionSequence.push({
        kind: 'move',
        targetRef: null,
        outcomeHint: wantsBesideDoor ? 'beside_door' : null,
      });
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

  // Core understanding: binding constraints and speech-act routing beat verb guesses.
  const understanding = understandUtterance(trimmed);
  const constraints = understanding.constraints;
  let bounded = filterActionsByConstraints(actionSequence, constraints);

  // Knowledge / recap / contents questions are perception — never movement drafts.
  if (
    (understanding.wantsKnowledgeRecap ||
      understanding.wantsContentsQuery ||
      understanding.speechAct === 'question' ||
      understanding.speechAct === 'rules_query') &&
    !bounded.some(
      (step) =>
        step.kind === 'inspect' ||
        step.kind === 'dialogue' ||
        step.kind === 'open_door' ||
        step.kind === 'unlock_door',
    )
  ) {
    bounded = [
      {
        kind: 'inspect',
        targetRef: null,
        outcomeHint: understanding.wantsContentsQuery
          ? 'contents_query'
          : understanding.wantsKnowledgeRecap
            ? 'knowledge_recap'
            : understanding.speechAct === 'rules_query'
              ? 'rules_query'
              : 'scene_perception',
      },
      ...bounded.filter((step) => step.kind !== 'move' && step.kind !== 'open_door'),
    ];
  }

  // Prepare weapon without attacking is inspect/other staging — not combat.
  if (constraints.prepareWithoutAttack) {
    bounded = bounded.filter((step) => step.kind !== 'attack' && step.kind !== 'cast');
    if (!bounded.some((step) => step.kind === 'inspect' || step.kind === 'other')) {
      bounded = [
        { kind: 'other', targetRef: null, outcomeHint: 'prepare_weapon' },
        ...bounded,
      ];
    }
  }

  // OOC / stay-put instructions with no remaining action become a stay-put inspect.
  if (
    bounded.length === 0 &&
    (constraints.forbidMove || understanding.speechAct === 'ooc_instruction')
  ) {
    bounded = [{ kind: 'inspect', targetRef: null, outcomeHint: 'stay_put' }];
  }

  // Semantic-to-primitive fallback (handles imperative phrasing, physical object manipulation,
  // consumable usage, pursuit/transitions, and roleplay declarations).
  if (bounded.length === 0 && trimmed.length > 0) {
    const classified = classifyClause(trimmed);
    switch (classified.kind) {
      case 'open_door':
        bounded = [{ kind: 'open_door', targetRef: null, outcomeHint: classified.outcomeHint }];
        break;
      case 'close_door':
        bounded = [{ kind: 'close_door', targetRef: null, outcomeHint: classified.outcomeHint }];
        break;
      case 'unlock_door':
        bounded = [{ kind: 'unlock_door', targetRef: null, outcomeHint: classified.outcomeHint }];
        break;
      case 'travel':
      case 'move':
        bounded = [{ kind: 'move', targetRef: null, outcomeHint: classified.outcomeHint }];
        break;
      case 'attack':
        bounded = [{ kind: 'attack', targetRef: null, outcomeHint: null }];
        break;
      case 'cast':
        bounded = [{ kind: 'cast', targetRef: null, outcomeHint: null }];
        break;
      case 'use_item':
        bounded = [{ kind: 'use_item', targetRef: null, outcomeHint: classified.outcomeHint }];
        break;
      case 'rest':
        bounded = [{ kind: 'rest', targetRef: null, outcomeHint: null }];
        break;
      case 'speak':
        bounded = [{ kind: 'dialogue', targetRef: addressee, outcomeHint: null }];
        break;
      case 'take_item':
        bounded = [{ kind: 'inspect', targetRef: null, outcomeHint: 'take_item' }];
        break;
      case 'interact':
        bounded = [
          {
            kind: 'inspect',
            targetRef: null,
            outcomeHint: classified.outcomeHint ?? 'interact_object',
          },
        ];
        break;
      case 'inspect':
      case 'narrate_only':
      default:
        bounded = [
          {
            kind: 'inspect',
            targetRef: null,
            outcomeHint: classified.outcomeHint ?? 'roleplay_action',
          },
        ];
        break;
    }
    bounded = filterActionsByConstraints(bounded, constraints);
    if (bounded.length === 0) {
      bounded = [{ kind: 'inspect', targetRef: null, outcomeHint: 'roleplay_action' }];
    }
  }

  actionSequence.length = 0;
  actionSequence.push(...bounded);

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
    isInterrogative: isInterrogative || understanding.speechAct === 'question',
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
