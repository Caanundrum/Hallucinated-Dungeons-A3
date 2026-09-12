/**
 * Core utterance understanding for Play declarations.
 *
 * Classifies speech acts and binding constraints *before* verb routing so the
 * Director does not need endless one-off phrase handlers. Downstream parsers
 * and the gateway must honor these decisions rather than re-guess from keywords.
 */

import type { DerivedCharacterSheet } from './character-contract.js';

/** High-level speech act — decided before action verbs are trusted. */
export type UtteranceSpeechAct =
  | 'question'
  | 'correction'
  | 'rules_query'
  | 'ooc_instruction'
  | 'action'
  | 'compound';

/**
 * Binding constraints extracted from the utterance.
 * When true, resolvers must not draft that effect.
 */
export interface UtteranceConstraints {
  readonly forbidMove: boolean;
  readonly forbidOpen: boolean;
  readonly forbidClose: boolean;
  readonly forbidTake: boolean;
  readonly forbidAttack: boolean;
  readonly forbidCombat: boolean;
  readonly forbidTouch: boolean;
  readonly withoutTaking: boolean;
  readonly listenOnly: boolean;
  /** "If closed, open; otherwise leave it" — evaluate against live state. */
  readonly openOnlyIfClosed: boolean;
  /** Draw/ready a weapon without starting a fight. */
  readonly prepareWithoutAttack: boolean;
}

export interface UtteranceUnderstanding {
  readonly speechAct: UtteranceSpeechAct;
  readonly constraints: UtteranceConstraints;
  readonly wantsKnowledgeRecap: boolean;
  readonly wantsContentsQuery: boolean;
  readonly primaryIntentLabel: string | null;
}

const EMPTY_CONSTRAINTS: UtteranceConstraints = {
  forbidMove: false,
  forbidOpen: false,
  forbidClose: false,
  forbidTake: false,
  forbidAttack: false,
  forbidCombat: false,
  forbidTouch: false,
  withoutTaking: false,
  listenOnly: false,
  openOnlyIfClosed: false,
  prepareWithoutAttack: false,
};

/** Soft question / recap probes that do not always end with `?` or a WH- opener. */
export function utteranceLooksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (/\?/.test(trimmed)) {
    return true;
  }
  if (
    /^(?:who|what|which|where|when|why|how|can|could|would|will|do|does|did|is|are|am|should|may|might)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  return (
    /\b(?:remind\s+me|tell\s+me|explain(?:\s+to\s+me)?|what\s+do\s+i\s+know|what\s+have\s+i\s+(?:learned|discovered|found)|recap|summarize|catch\s+me\s+up)\b/i.test(
      trimmed,
    ) ||
    /\b(?:why\s+(?:am|are)\s+i|why\s+we(?:'re|\s+are)\s+here|what(?:'s|\s+is)\s+inside|what\s+(?:do|can)\s+i\s+(?:see|hear|notice))\b/i.test(
      trimmed,
    )
  );
}

export function utteranceWantsKnowledgeRecap(text: string): boolean {
  return /\b(?:remind\s+me|recap|what\s+do\s+i\s+know|what\s+have\s+i\s+(?:learned|discovered|found)|catch\s+me\s+up|why\s+(?:am|are)\s+i\s+here|why\s+we(?:'re|\s+are)\s+here|missing\s+courier|established\s+facts)\b/i.test(
    text,
  );
}

export function utteranceWantsContentsQuery(text: string): boolean {
  return /\b(?:what(?:'s|\s+is)\s+inside|look\s+inside|search\s+inside|contents?\b)\b/i.test(text);
}

export function extractUtteranceConstraints(text: string): UtteranceConstraints {
  const t = text.trim();
  if (t.length === 0) {
    return EMPTY_CONSTRAINTS;
  }

  const forbidMove =
    /\b(?:do(?:es)?\s+not|don't|dont|never)\s+(?:move|walk|step|go|approach)\b/i.test(t) ||
    /\b(?:do(?:es)?\s+not|don't|dont)\s+move\s+me\b/i.test(t) ||
    /\bwithout\s+(?:moving|walking|stepping|leaving|approaching)\b/i.test(t) ||
    /\bstay(?:ing)?\s+(?:put|here|where\s+i\s+am)\b/i.test(t);

  const forbidOpen =
    /\b(?:do(?:es)?\s+not|don't|dont|never|without)\s+(?:open(?:ing)?|push(?:ing)?\s+open|swing(?:ing)?\s+open)\b/i.test(
      t,
    );

  const forbidClose =
    /\b(?:do(?:es)?\s+not|don't|dont|never|without)\s+(?:close|shut|closing|shutting)\b/i.test(t);

  const forbidTake =
    /\b(?:do(?:es)?\s+not|don't|dont|never|without)\s+(?:take|taking|grab|grabbing|loot|looting|steal|stealing|pocket)\b/i.test(
      t,
    ) || /\bwithout\s+taking\s+anything\b/i.test(t);

  const forbidAttack =
    /\b(?:do(?:es)?\s+not|don't|dont|never)\s+(?:attack|strike|hit|fight|stab|slash|shoot)\b/i.test(
      t,
    ) ||
    /\bwithout\s+(?:attacking|striking|hitting|fighting)\b/i.test(t) ||
    /\bdo\s+not\s+(?:attack|start\s+a\s+fight|start\s+combat)\b/i.test(t);

  const forbidCombat =
    forbidAttack ||
    /\b(?:do(?:es)?\s+not|don't|dont|never)\s+(?:start\s+(?:a\s+)?(?:fight|combat)|roll\s+initiative|begin\s+(?:a\s+)?(?:fight|combat|encounter))\b/i.test(
      t,
    );

  const forbidTouch =
    /\b(?:do(?:es)?\s+not|don't|dont|never)\s+(?:touch|open|take)\b/i.test(t) ||
    /\bhands[-\s]?off\b/i.test(t) ||
    /\bwithout\s+(?:touching|handling)\b/i.test(t);

  const withoutTaking = forbidTake || /\bwithout\s+taking\b/i.test(t);

  const listenOnly =
    /\blisten\b/i.test(t) &&
    (forbidMove ||
      forbidOpen ||
      forbidTouch ||
      /\bonly\s+listen\b/i.test(t) ||
      /\bfrom\s+where\s+i\s+stand\b/i.test(t));

  const openOnlyIfClosed =
    /\bif\s+(?:(?:it|the\s+door(?:way)?)\s+is\s+)?closed\b/i.test(t) &&
    /\bopen\b/i.test(t) &&
    /\b(?:otherwise|else|if\s+(?:already\s+)?open)\b/i.test(t);

  const prepareWithoutAttack =
    /\b(?:draw|unsheathe|ready|prepare|hold)\b/i.test(t) &&
    /\b(?:dagger|sword|weapon|blade|bow|crossbow|axe|mace|hammer)\b/i.test(t) &&
    (forbidAttack ||
      forbidCombat ||
      /\b(?:but\s+)?(?:do\s+not|don't|dont)\s+(?:attack|fight|strike)\b/i.test(t));

  return {
    forbidMove,
    forbidOpen,
    forbidClose,
    forbidTake,
    forbidAttack,
    forbidCombat,
    forbidTouch,
    withoutTaking,
    listenOnly,
    openOnlyIfClosed,
    prepareWithoutAttack,
  };
}

export function classifyUtteranceSpeechAct(text: string): UtteranceSpeechAct {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 'action';
  }

  if (
    /\b(?:map\s+(?:still\s+)?says?|summary\s+says?|that(?:'s|\s+is)\s+wrong|already\s+(?:through|open|closed)|i\s+am\s+already|correction)\b/i.test(
      trimmed,
    )
  ) {
    return 'correction';
  }

  if (
    /\b(?:can\s+i\s+cast|do\s+i\s+have|am\s+i\s+able|spell\s+slot|action\s+economy|is\s+that\s+legal|rules\s+as\s+written)\b/i.test(
      trimmed,
    )
  ) {
    return 'rules_query';
  }

  if (
    /\b(?:do\s+not\s+move\s+me|ooc\b|out\s+of\s+character|as\s+a\s+reminder\s+to\s+the\s+(?:dm|director))\b/i.test(
      trimmed,
    )
  ) {
    return 'ooc_instruction';
  }

  const constraints = extractUtteranceConstraints(trimmed);
  const looksQuestion = utteranceLooksLikeQuestion(trimmed);
  const hasActionVerb =
    /\b(?:i\s+)?(?:open|close|move|walk|step|attack|cast|search|inspect|examine|take|hide|wait|listen|draw|unlock|pick|rest|strike|hit)\b/i.test(
      trimmed,
    );

  if (looksQuestion && !hasActionVerb) {
    return 'question';
  }
  if (looksQuestion && hasActionVerb) {
    if (/^(?:can|could|may|should|would)\b/i.test(trimmed) || /\bcan\s+i\b/i.test(trimmed)) {
      return 'rules_query';
    }
    return 'compound';
  }

  if (
    (constraints.forbidMove ||
      constraints.forbidAttack ||
      constraints.forbidCombat ||
      constraints.forbidOpen ||
      constraints.forbidTake ||
      constraints.forbidTouch) &&
    hasActionVerb
  ) {
    return 'compound';
  }

  return 'action';
}

export function understandUtterance(text: string): UtteranceUnderstanding {
  const speechAct = classifyUtteranceSpeechAct(text);
  const constraints = extractUtteranceConstraints(text);
  const wantsKnowledgeRecap = utteranceWantsKnowledgeRecap(text);
  const wantsContentsQuery = utteranceWantsContentsQuery(text);

  let primaryIntentLabel: string | null = null;
  if (wantsKnowledgeRecap) {
    primaryIntentLabel = 'knowledge_recap';
  } else if (wantsContentsQuery) {
    primaryIntentLabel = 'contents_query';
  } else if (constraints.listenOnly) {
    primaryIntentLabel = 'listen';
  } else if (constraints.prepareWithoutAttack) {
    primaryIntentLabel = 'prepare_weapon';
  } else if (speechAct === 'question') {
    primaryIntentLabel = 'question';
  } else if (speechAct === 'correction') {
    primaryIntentLabel = 'state_correction';
  } else if (speechAct === 'rules_query') {
    primaryIntentLabel = 'rules_query';
  }

  return {
    speechAct,
    constraints,
    wantsKnowledgeRecap,
    wantsContentsQuery,
    primaryIntentLabel,
  };
}

/** Drop action kinds that violate binding constraints. */
export function filterActionsByConstraints<T extends { readonly kind: string }>(
  actions: readonly T[],
  constraints: UtteranceConstraints,
): T[] {
  return actions.filter((step) => {
    const kind = step.kind;
    if (constraints.forbidMove && kind === 'move') {
      return false;
    }
    if (constraints.forbidOpen && kind === 'open_door') {
      return false;
    }
    if (constraints.forbidClose && kind === 'close_door') {
      return false;
    }
    if (constraints.forbidAttack && (kind === 'attack' || kind === 'cast')) {
      return false;
    }
    if (constraints.forbidCombat && (kind === 'attack' || kind === 'cast')) {
      return false;
    }
    if (constraints.listenOnly && kind !== 'inspect' && kind !== 'dialogue') {
      return false;
    }
    if (constraints.forbidTouch && (kind === 'open_door' || kind === 'use_item')) {
      return false;
    }
    return true;
  });
}

export interface CharacterCapabilityVerdict {
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly suggestion: string | null;
}

/**
 * Validate a proposed magical/combat draft against the seated sheet.
 * Shared by Play interpret and Ask the Director so both channels agree.
 */
export function evaluateCharacterCapability(
  sheet: DerivedCharacterSheet | null | undefined,
  options: {
    readonly wantsCast: boolean;
    readonly spellId?: string | null;
    readonly spellLabel?: string | null;
    readonly prepareWithoutAttack?: boolean;
  },
): CharacterCapabilityVerdict {
  if (options.prepareWithoutAttack === true) {
    return {
      allowed: false,
      reason:
        'You can ready a weapon without starting a fight. Say how you hold or draw it; do not open combat unless you mean to attack.',
      suggestion: 'Declare a ready/draw action, or name a foe only when you intend to attack.',
    };
  }

  if (!options.wantsCast) {
    return { allowed: true, reason: null, suggestion: null };
  }

  if (sheet === null || sheet === undefined) {
    return {
      allowed: false,
      reason: 'No seated character sheet is available to verify spells.',
      suggestion: 'Seat a character, then declare again.',
    };
  }

  if (sheet.spellcasting === null) {
    return {
      allowed: false,
      reason: 'This character has no spellcasting at this level, so that spell cannot be cast.',
      suggestion:
        'Use a weapon, skill, or feature from your sheet — or ask the Director what options you have right now.',
    };
  }

  const spellId = (options.spellId ?? '').toLowerCase().replace(/\s+/g, '-');
  const spellLabel = (options.spellLabel ?? '').toLowerCase();
  if (spellId.length === 0 && spellLabel.length === 0) {
    return {
      allowed: false,
      reason: 'Name which prepared or known spell you cast.',
      suggestion: listKnownSpellsSuggestion(sheet),
    };
  }

  const known = [
    ...sheet.spellcasting.cantrips,
    ...sheet.spellcasting.spells,
    ...sheet.spellcasting.spellbook,
  ];
  const match = known.find((entry) => {
    const id = entry.id.toLowerCase();
    const name = entry.name.toLowerCase();
    return (
      (spellId.length > 0 &&
        (id === spellId || id.replace(/-/g, ' ') === spellId.replace(/-/g, ' '))) ||
      (spellLabel.length > 0 &&
        (name === spellLabel || name.includes(spellLabel) || spellLabel.includes(name)))
    );
  });

  if (match === undefined) {
    return {
      allowed: false,
      reason: `That spell is not on your sheet${spellLabel ? ` (${spellLabel})` : ''}.`,
      suggestion: listKnownSpellsSuggestion(sheet),
    };
  }

  const isCantrip = sheet.spellcasting.cantrips.some((entry) => entry.id === match.id);
  if (!isCantrip && sheet.spellcasting.level1SlotsRemaining <= 0) {
    return {
      allowed: false,
      reason: `No level-1 spell slots remain for ${match.name}.`,
      suggestion: 'Take a Long Rest, use Arcane Recovery if available, or cast a cantrip you know.',
    };
  }

  return { allowed: true, reason: null, suggestion: null };
}

function listKnownSpellsSuggestion(sheet: DerivedCharacterSheet): string {
  if (sheet.spellcasting === null) {
    return 'This character has no spells. Use weapons, skills, or features from the sheet.';
  }
  const names = [
    ...sheet.spellcasting.cantrips.map((entry) => entry.name),
    ...sheet.spellcasting.spells.map((entry) => entry.name),
  ].slice(0, 6);
  if (names.length === 0) {
    return 'No spells are prepared. Choose a non-magical action from your sheet.';
  }
  return `Available now: ${names.join(', ')}.`;
}

/**
 * Conditional door open: if the door is already open, the declaration is a no-op.
 * Callers pass live leaf state from the map — never invent it here.
 */
export function resolveConditionalDoorIntent(options: {
  readonly constraints: UtteranceConstraints;
  readonly doorLeaf: 'open' | 'closed' | 'unknown';
}): 'open' | 'noop' | 'unchanged' {
  if (!options.constraints.openOnlyIfClosed) {
    return 'unchanged';
  }
  if (options.doorLeaf === 'open') {
    return 'noop';
  }
  if (options.doorLeaf === 'closed') {
    return 'open';
  }
  return 'unchanged';
}

/** Player-facing fallback that always names a next step. */
export function actionableDirectorFallback(understanding: UtteranceUnderstanding): string {
  if (understanding.wantsKnowledgeRecap) {
    return 'Ask the Director for a short recap of what your character already knows, or declare one concrete action in the scene.';
  }
  if (understanding.wantsContentsQuery) {
    return 'Say which container you examine and whether you only look, search inside, or take something.';
  }
  if (understanding.speechAct === 'question' || understanding.speechAct === 'rules_query') {
    return 'Ask the Director that question in Ask the Director, or rephrase as a single in-world action to resolve on the table.';
  }
  if (understanding.constraints.prepareWithoutAttack) {
    return 'You can ready a weapon without opening combat. Confirm a ready/draw declaration, or name a foe only when you mean to attack.';
  }
  if (understanding.constraints.forbidMove) {
    return 'Staying put. Say what you do from where you stand — look, listen, speak, or interact — without moving.';
  }
  return 'Say one clear action your character attempts (move, open, inspect, speak, attack), or ask the Director a question in Ask the Director.';
}
