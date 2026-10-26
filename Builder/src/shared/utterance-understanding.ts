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
  return /\b(?:remind\s+me|recap|what\s+do\s+i\s+know|what\s+have\s+i\s+(?:learned|discovered|found)|catch\s+me\s+up|why\s+(?:am|are)\s+i\s+here|why\s+(?:is|are)\s+\w+\s+here|ask\s+why\s+.{0,40}\bhere\b|why\s+we(?:'re|\s+are)\s+here|missing\s+courier|what\s+remains\s+unproven|established\s+facts)\b/i.test(
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

  // Allow material + orientation (e.g. "wooden doorway east") between the/it and closed.
  const openOnlyIfClosed =
    (/\bif\s+(?:it|the)\b[\s\S]{0,64}?\b(?:door|doorway|gate|entry(?:way)?)\b[\s\S]{0,48}?\bis\s+closed\b/i.test(
      t,
    ) ||
      /\bif\s+(?:it|the(?:\s+\w+){0,6}\s+door(?:way)?)\s+is\s+closed\b/i.test(t) ||
      (/\bif\b/i.test(t) && /\bis\s+closed\b/i.test(t) && /\b(?:door|doorway)\b/i.test(t))) &&
    /\bopen\b/i.test(t) &&
    (/\b(?:otherwise|else|if\s+(?:already\s+)?open)\b/i.test(t) ||
      /\bleave\s+it\b/i.test(t) ||
      /\bexactly\s+as\s+it\s+is\b/i.test(t));

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
    !/\b(?:short\s*rest|long\s*rest|arcane\s+recovery)\b/i.test(trimmed) &&
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
    /\b(?:i\s+)?(?:open|close|move|walk|step|attack|cast|search|inspect|examine|take|hide|wait|listen|draw|unlock|pick|rest|strike|hit|sneak|sneaks|sneaking|slip|slips|slipping|return|returns|returning|retreat|retreats|read|reads|reading|peruse|peruses|perusing|decipher|deciphers|deciphering|translate|translates|translating|study|studies|studying|scan|scans|scanning|smell|smells|smelling|sniff|sniffs|sniffing|peer|peers|peering|check|checks|checking|feel|feels|feeling|touch|touches|touching|tap|taps|tapping|test|tests|testing|pry|pries|prying|force|forces|forcing|wedge|smash|smashes|break|breaks|pull|pulls|push|pushes|flip|flips|turn|turns|rotate|rotates|twist|twists|press|presses|light|lights|ignite|ignites|extinguish|extinguishes|douse|douses|grab|grabs|loot|loots|follow|follows|following|trace|traces|tracing|head|heads|heading|proceed|proceeds|proceeding|continue|continues|enter|enters|entering|leave|leaves|leaving|climb|climbs|climbing|cross|crosses|crossing|drink|drinks|drinking|quaff|quaffs|consume|consumes|use|uses|using|unseal|unseals|unlatch|unlatches)\b/i.test(
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
    // Conditional open-if-closed must never draft movement/step-through from the false branch.
    if (constraints.openOnlyIfClosed && kind === 'move') {
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
    readonly classLabel?: string | null;
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
    const classBit =
      typeof options.classLabel === 'string' && options.classLabel.trim().length > 0
        ? `Your level-${sheet.level} ${options.classLabel.trim()}`
        : 'This character';
    const spellBit =
      typeof options.spellLabel === 'string' && options.spellLabel.trim().length > 0
        ? options.spellLabel.trim()
        : 'that spell';
    return {
      allowed: false,
      reason: `${classBit} cannot cast ${spellBit} (no spellcasting).`,
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

export type SemanticIntentPrimitive =
  | 'inspect'
  | 'interact'
  | 'open_door'
  | 'close_door'
  | 'unlock_door'
  | 'take_item'
  | 'travel'
  | 'move'
  | 'speak'
  | 'attack'
  | 'cast'
  | 'use_item'
  | 'rest'
  | 'narrate_only';

export type SemanticIntentCategory =
  | 'sensory_reading'
  | 'physical_manipulation'
  | 'directional_pursuit'
  | 'dialogue'
  | 'combat'
  | 'roleplay_observation';

export interface ClauseSemanticClassification {
  readonly kind: SemanticIntentPrimitive;
  readonly category: SemanticIntentCategory;
  readonly outcomeHint: string | null;
}

/**
 * Translates any natural-language player clause (first-person, third-person, or imperative)
 * into a canonical engine primitive without keyword-list gatekeeping.
 */
export function classifyClause(text: string): ClauseSemanticClassification {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      kind: 'narrate_only',
      category: 'roleplay_observation',
      outcomeHint: 'roleplay_action',
    };
  }
  const unquoted = trimmed.replace(/"[^"]*"|[“”][^“”]*[“”]/g, ' ').trim();
  const clauseText = unquoted.length > 0 ? unquoted : trimmed;

  // 1. Rest intent
  if (/\b(?:short\s*rest|long\s*rest|camp\s+for\s+the\s+night)\b/i.test(trimmed)) {
    return { kind: 'rest', category: 'roleplay_observation', outcomeHint: null };
  }

  // 2. Spellcasting intent
  if (
    !/\b(?:arcane\s+recovery|spell\s+slots?)\b/i.test(trimmed) &&
    /\b(?:cast(?:s|ing)?|fireball|fire\s*bolt|burning\s*hands|sacred\s*flame|guiding\s*bolt|cure\s*wounds|magic\s*missile|mage\s*hand|prestidigitation|detect\s*magic)\b/i.test(
      trimmed,
    )
  ) {
    return { kind: 'cast', category: 'combat', outcomeHint: null };
  }

  // 3. Combat / attack intent (excluding negated combat)
  const constraints = extractUtteranceConstraints(trimmed);
  if (
    !constraints.forbidAttack &&
    !constraints.forbidCombat &&
    !constraints.prepareWithoutAttack &&
    /\b(?:attack(?:s|ing)?|strik(?:e|es|ing)|stab(?:s|bing)?|slash(?:es|ing)?|shoot(?:s|ing)?|cleav(?:e|es|ing)|lung(?:e|es|ing)\s+at)\b/i.test(
      trimmed,
    )
  ) {
    return { kind: 'attack', category: 'combat', outcomeHint: null };
  }

  // 4. Dialogue / speech intent
  if (
    /\b(?:ask(?:s|ing)?|tell(?:s|ing)?|speak(?:s|ing)?\s+(?:to|with)|talk(?:s|ing)?\s+(?:to|with)|greet(?:s|ing)?|question(?:s|ing)?|inquir(?:e|es|ing)|address(?:es|ing)?|call(?:s|ing)?\s+out(?:\s+to)?|say(?:s|ing)?\s+to)\b/i.test(
      clauseText,
    )
  ) {
    return { kind: 'speak', category: 'dialogue', outcomeHint: null };
  }

  // 5. Consumable / item usage intent (e.g. "Drink healing draught", "Use healer's kit")
  if (
    /\b(?:drink(?:s|ing)?|quaff(?:s|ing)?|sip(?:s|ping)?|swallow(?:s|ing)?|consum(?:e|es|ing)|apply|applying|bandag(?:e|es|ing))\b/i.test(
      trimmed,
    ) ||
    (/\buse(?:s|ing)?\b/i.test(trimmed) &&
      /\b(?:draught|potion|elixir|vial|tonic|poultice|salve|kit|scroll|antitoxin|ration)\b/i.test(
        trimmed,
      ))
  ) {
    return {
      kind: 'use_item',
      category: 'physical_manipulation',
      outcomeHint: 'consume_item',
    };
  }

  // 6. Sensory / Cognitive / Reading Intent (prioritized before physical manipulation when reading/examining/listening)
  if (isDocumentOpenOrReadDeclaration(trimmed)) {
    return {
      kind: 'inspect',
      category: 'sensory_reading',
      outcomeHint: 'read_text',
    };
  }

  const hasSensoryOrReadingVerb =
    /\b(?:read(?:s|ing)?|perus(?:e|es|ing)|decipher(?:s|ing)?|translat(?:e|es|ing)|study|studies|studying|scan(?:s|ning)?|por(?:e|es|ing)\s+over|leaf(?:s|ing)?\s+through|listen(?:s|ing)?|eavesdrop(?:s|ping)?|smell(?:s|ing)?|sniff(?:s|ing)?|peer(?:s|ing)?|squint(?:s|ing)?|check(?:s|ing)?|examin(?:e|es|ing)|inspect(?:s|ing)?|look(?:s|ing)?(?:\s+closely)?\s+(?:at|into|over|around)|feel(?:s|ing)?|touch(?:es|ing)?|tap(?:s|ping)?|test(?:s|ing)?|prob(?:e|es|ing)|survey(?:s|ing)?|observ(?:e|es|ing)|notic(?:e|es|ing)|investigat(?:e|es|ing)?|search(?:es|ing)?)\b/i.test(
      trimmed,
    );
  const hasExplicitOpenOrManipulateVerb =
    /\b(?:open(?:s|ing)?|unseal(?:s|ing)?|unlatch(?:es|ing)?|unlock(?:s|ing)?|pry|pries|prying|forc(?:e|es|ing)|wedg(?:e|es|ing)|smash(?:es|ing)?|break(?:s|ing)?|pull(?:s|ing)?|push(?:es|ing)?|flip(?:s|ping)?|turn(?:s|ing)?|rotat(?:e|es|ing)|twist(?:s|ing)?|light(?:s|ing)?|ignit(?:e|es|ing)|extinguish(?:es|ing)?|dous(?:e|es|ing)|tak(?:e|es|ing)|grab(?:s|bing)?|loot(?:s|ing)?|empt(?:y|ies|ying)|plunder(?:s|ing)?|ransack(?:s|ing)?|pick(?:s|ing)?\s+up)\b/i.test(
      trimmed,
    );

  if (hasSensoryOrReadingVerb && !hasExplicitOpenOrManipulateVerb) {
    const mentionsDoor = /\b(?:door|doorway|gate|entry(?:way)?|threshold)\b/i.test(trimmed);
    const isReading =
      /\b(?:read(?:s|ing)?|perus(?:e|es|ing)|decipher(?:s|ing)?|translat(?:e|es|ing)|por(?:e|es|ing)\s+over|leaf(?:s|ing)?\s+through|scan(?:s|ning)?)\b/i.test(
        trimmed,
      );
    const isListening = /\b(?:listen(?:s|ing)?|eavesdrop(?:s|ping)?)\b/i.test(trimmed);
    const isAnalytical =
      /\b(?:decipher(?:s|ing)?|translat(?:e|es|ing)|investigat(?:e|es|ing)?|traps?|hidden|secret|concealed|mechanism)\b/i.test(
        trimmed,
      );
    const isSearch = /\bsearch(?:es|ing)?\b/i.test(trimmed);
    return {
      kind: 'inspect',
      category: 'sensory_reading',
      outcomeHint:
        isListening && mentionsDoor
          ? 'listen'
          : isListening
            ? 'sensory_sequence'
            : isReading
              ? 'read_text'
              : isAnalytical
                ? 'investigate_mark'
                : isSearch
                  ? 'active_search'
                  : 'scene_perception',
    };
  }

  // 6.5. Route / Exit Travel Intent (checked BEFORE physical manipulation so "take the trail" / "use the stairs" / "take the eastern doorway" is travel, not take_item)
  const hasExplicitDoorOpenCloseVerb =
    /\b(?:open(?:s|ing)?|unseal(?:s|ing)?|unlatch(?:es|ing)?|unlock(?:s|ing)?|close(?:s|d|ing)?|shut(?:s|ting)?|pick(?:s|ing)?|pry|pries|prying|forc(?:e|es|ing))\b/i.test(
      trimmed,
    );
  const isRouteOrExitTravel =
    !hasExplicitDoorOpenCloseVerb &&
    !/\b(?:lever|switch|winch|crank|pulley|valve|dial)\b/i.test(trimmed) &&
    /\b(?:tak(?:e|es|ing)|us(?:e|es|ing)|follow(?:s|ing)?|trac(?:e|es|ing)|go(?:es|ing)?\s+(?:(?:down|up)(?!\s+to\b)|along|through|onward|forward)|walk(?:s|ing)?\s+(?:(?:down|up)(?!\s+to\b)|along|through)|head(?:s|ing)?\s+(?:(?:down|up)(?!\s+to\b)|along|through|toward|towards|into|onward)|step(?:s|ping)?\s+(?:onto|into|through)|pass(?:es|ing)?\s+through|enter(?:s|ing)?)\b[\s\S]{0,48}\b(?:trail|path|pathway|road|passage|passageway|corridor|stairs?|staircase|steps|archway|doorway|door|gate|gateway|threshold|bridge|crossing|ford|tunnel|exit|way|route|causeway|lane|track)\b/i.test(
      trimmed,
    );
  if (isRouteOrExitTravel && !constraints.forbidMove) {
    return {
      kind: 'travel',
      category: 'directional_pursuit',
      outcomeHint: 'pursue_route',
    };
  }

  // 7. Directional / Pursuit / Transition Intent ("follow the trail toward...", "head to...", "climb up to...")
  const hasPursuitOrTransitionVerb =
    /\b(?:follow(?:s|ing)?|trac(?:e|es|ing)|head(?:s|ing)?\s+(?:to|toward|into|through|back|up|down)|proceed(?:s|ing)?\s+(?:to|toward|into|through)|continu(?:e|es|ing)\s+(?:to|toward|into|through)|enter(?:s|ing)?|leav(?:e|es|ing)\s+(?:toward|for|through|into)|climb(?:s|ing)?\s+(?:up|down|to|into)|descend(?:s|ing)?|ascend(?:s|ing)?|cross(?:es|ing)?\s+(?:into|through|over)|ventur(?:e|es|ing)\s+(?:into|toward)|make(?:s|ing)?\s+(?:my|our|their|his|her)\s+way\s+(?:to|toward|into)|return(?:s|ing)?\s+(?:to|up|down|through)|retreat(?:s|ing)?\s+(?:to|into|through))\b/i.test(
      trimmed,
    );
  if (hasPursuitOrTransitionVerb) {
    const isTrailOrSceneLead =
      /\b(?:follow(?:s|ing)?|trac(?:e|es|ing))\b[\s\S]{0,48}\b(?:trail|tracks?|marks?|lead|path|footprints?|spoor|route|signs?|passage|corridor|stairs?|archway|chamber|room|hall|door(?:way)?|exit)\b/i.test(
        trimmed,
      ) ||
      /\b(?:toward|into|to|through)\s+(?:the\s+)?[\w\s'-]{2,40}\b(?:chamber|room|hall|vault|sanctum|passage|corridor|stairs?|archway|tower|cellar|crypt|exit|wing|gallery|landing|bridge)\b/i.test(
        trimmed,
      );
    return {
      kind: isTrailOrSceneLead ? 'travel' : 'move',
      category: 'directional_pursuit',
      outcomeHint: isTrailOrSceneLead ? 'pursue_route' : null,
    };
  }

  // 8. Physical Manipulation Intent
  if (hasExplicitOpenOrManipulateVerb) {
    const withoutOpenAdjective = trimmed.replace(
      /\b(?:open(?:ed)?|sealed|closed|locked|unlocked)\s+(?:[a-z-]+\s+){0,2}(?:door|doorway|gate|entry(?:way)?|[a-z]+)\b/gi,
      (match) => {
        // Keep the verb if the match is at the very start of an imperative ("Open the ...")
        if (/^(?:open|unseal|unlock|close)\b/i.test(match) && trimmed.startsWith(match)) {
          return match;
        }
        return match.replace(/^(?:open(?:ed)?|sealed|closed|locked|unlocked)\s+/i, '');
      },
    );
    const mentionsDoor = /\b(?:door|doorway|gate|entry(?:way)?)\b/i.test(withoutOpenAdjective);
    if (
      isWholeContainerLootDeclaration(trimmed) ||
      /\b(?:tak(?:e|es|ing)|grab(?:s|bing)?|pocket(?:s|ing)?|collect(?:s|ing)?|loot(?:s|ing)?|empt(?:y|ies|ying)|plunder(?:s|ing)?|ransack(?:s|ing)?|retriev(?:e|es|ing)|stow(?:s|ing)?|pick(?:s|ing)?\s+up)\b/i.test(
        trimmed,
      )
    ) {
      return {
        kind: 'take_item',
        category: 'physical_manipulation',
        outcomeHint: 'take_item',
      };
    }
    if (mentionsDoor) {
      if (/\b(?:close(?:s|d|ing)?|shut(?:s|ting)?)\b/i.test(trimmed)) {
        return { kind: 'close_door', category: 'physical_manipulation', outcomeHint: null };
      }
      if (
        /\b(?:unlock(?:s|ing)?|pick(?:s|ing)?\s+(?:the\s+)?lock|pry|pries|prying|forc(?:e|es|ing))\b/i.test(
          trimmed,
        )
      ) {
        return { kind: 'unlock_door', category: 'physical_manipulation', outcomeHint: null };
      }
      return { kind: 'open_door', category: 'physical_manipulation', outcomeHint: null };
    }
    const isForceful =
      /\b(?:pry|pries|prying|forc(?:e|es|ing)|wedg(?:e|es|ing)|smash(?:es|ing)?|break(?:s|ing)?|shatter(?:s|ing)?)\b/i.test(
        trimmed,
      );
    return {
      kind: 'interact',
      category: 'physical_manipulation',
      outcomeHint: isForceful ? 'force_manipulate' : 'interact_object',
    };
  }

  // 9. Ordinary movement verbs
  if (
    !constraints.forbidMove &&
    /\b(?:move(?:s|ing)?|walk(?:s|ing)?|step(?:s|ping)?|go(?:es|ing)?|approach(?:es|ing)?)\b/i.test(
      trimmed,
    )
  ) {
    return { kind: 'move', category: 'directional_pursuit', outcomeHint: null };
  }

  // 10. In-world roleplay / flavored action fallback (imperative or declarative)
  return {
    kind: 'narrate_only',
    category: 'roleplay_observation',
    outcomeHint: 'roleplay_action',
  };
}

/** Player-facing fallback that always names an in-world Director response without a 5-verb syntax lecture. */
export function actionableDirectorFallback(understanding: UtteranceUnderstanding): string {
  if (understanding.wantsKnowledgeRecap) {
    return 'The Game Director recaps what your character already knows in the scene, or resolves your next concrete action.';
  }
  if (understanding.wantsContentsQuery) {
    return 'You peer inside to check its contents — the Game Director describes what is visible.';
  }
  if (understanding.speechAct === 'question' || understanding.speechAct === 'rules_query') {
    return 'The Game Director answers your question from established scene facts and table rules.';
  }
  if (understanding.constraints.prepareWithoutAttack) {
    return 'You can ready a weapon without opening combat. Confirm a ready/draw declaration, or name a foe only when you mean to attack.';
  }
  if (understanding.constraints.forbidMove) {
    return 'Staying put. The Game Director narrates what you perceive or do from where you stand without moving.';
  }
  return 'You act within the scene — the Game Director narrates what unfolds from your action.';
}

/**
 * Separates a declaration's primary verb + direct-object target clause from a secondary
 * locative prepositional phrase (e.g. "near the eastern doorway", "beside the locked chest", "on the stone pedestal")
 * while keeping trailing purpose phrases ("for footprints", "for traps") attached to `primaryClause`.
 */
export function splitPrimaryTargetFromLocative(declaration: string): {
  readonly primaryClause: string;
  readonly locativeQualifier: string;
  readonly locativeClause: string;
} {
  const trimmed = declaration.trim();
  if (trimmed.length === 0) {
    return { primaryClause: '', locativeQualifier: '', locativeClause: '' };
  }
  const pattern =
    /^([\s\S]*?\b(?:study|studies|studying|examin(?:e|es|ing)|inspect(?:s|ing)?|search(?:es|ing)?|check(?:s|ing)?|look(?:s|ing)?\s+(?:at|over|inside|into)|read(?:s|ing)?|perus(?:e|es|ing)|decipher(?:s|ing)?|scan(?:s|ning)?|por(?:e|es|ing)\s+over|leaf(?:s|ing)?\s+through|flip(?:s|ping)?\s+(?:open|through)|turn(?:s|ing)?\s+(?:the\s+)?pages?\s+of|unfold(?:s|ing)?|unroll(?:s|ing)?|sift(?:s|ing)?(?:\s+through)?|prob(?:e|es|ing)|investigat(?:e|es|ing)|trac(?:e|es|ing)|analyz(?:e|es|ing)|open(?:s|ing)?|close(?:s|ing)?|shut(?:s|ting)?|unlock(?:s|ing)?|loot(?:s|ing)?|empt(?:y|ies|ying)|clear(?:s|ing)?(?:\s+out)?|plunder(?:s|ing)?|ransack(?:s|ing)?|tak(?:e|es|ing)|grab(?:s|bing)?|collect(?:s|ing)?|retriev(?:e|es|ing)|pick(?:s|ing)?\s+up|pull(?:s|ing)?|flip(?:s|ping)?|push(?:es|ing)?|disarm(?:s|ing)?|touch(?:es|ing)?|feel(?:s|ing)?|smell(?:s|ing)?|use(?:s|ing)?|interact(?:s|ing)?\s+with)\s+(?:the\s+|a\s+|an\s+|some\s+|any\s+|this\s+|that\s+|these\s+|those\s+|my\s+|his\s+|her\s+|their\s+|our\s+)?[a-z0-9'’-]{3,}(?:\s+(?!near\b|beside\b|by\b|next\s+to\b|in\s+front\s+of\b|behind\b|past\b|beyond\b|around\b|alongside\b|close\s+to\b|adjacent\s+to\b|in\b|inside\b|within\b|from\b|off\b|on\b|upon\b|atop\b|over\b|across\b|under\b|beneath\b|underneath\b|below\b|against\b|at\b|resting\s+on\b|sitting\s+on\b|lying\s+on\b|laid\s+(?:out\s+)?on\b)[a-z0-9'’-]+){0,6})\s+((?:resting\s+on|sitting\s+on|lying\s+on|laid\s+(?:out\s+)?on|near(?:\s+to)?|beside|by|next\s+to|in\s+front\s+of|behind|past|beyond|around|alongside|close\s+to|adjacent\s+to|in|inside|within|from|off|on|upon|atop|over|across|under|beneath|underneath|below|against|at)\s+(?:the|a|an|this|that|my|his|her|their|our)\s+[a-z0-9'’\s-]{2,40}?)(?=\s+(?:for|to\s+see|to\s+find|to\s+check|with|using|and|before|while)\b|[.?!,;]|$)(.*)$/i;
  const match = pattern.exec(trimmed);
  if (match === null) {
    return { primaryClause: trimmed, locativeQualifier: '', locativeClause: '' };
  }
  const head = match[1]!.trim();
  const locative = match[2]!.trim();
  const tail = match[3]!.trim();
  const primaryClause = tail.length > 0 ? `${head} ${tail}`.replace(/\s+/g, ' ').trim() : head;
  return {
    primaryClause,
    locativeQualifier: locative,
    locativeClause: locative,
  };
}

/**
 * Readable document / book / record head nouns (`RV-02`).
 */
export const DOCUMENT_NOUN_PATTERN =
  /\b(?:books?|ledgers?|journals?|diaries|diary|logs?|logbooks?|registers?|manifests?|scrolls?|parchments?|letters?|notes?|missives?|dossiers?|folios?|tomes?|manuals?|codex|codices|pamphlets?|charts?|maps?|folders?|envelopes?|papers?|records?)\b/i;

/**
 * Solid non-container surface/fixture head nouns (including compound `-bench`, `-table`, `-desk`, `-counter`, `-shelf`, `-rack`)
 * that cannot transition to `state: 'open'` (`RV-02`).
 */
export const NON_OPENABLE_SURFACE_HEAD_NOUN =
  /^(?:[a-z]*(?:bench|benches|table|tables|desk|desks|counter|counters|shelf|shelves|rack|racks)|altar|altars|pedestal|pedestals|pillar|pillars|column|columns|statue|statues|chair|chairs|stool|stools|anvil|anvils|bed|beds|cot|cots|tapestry|tapestries|banner|banners|painting|paintings|mirror|mirrors)$/i;

/**
 * Returns true when a declaration opens, unfolds, flips through, or reads a document/book/record noun (`RV-02`),
 * rather than taking/pocketing/destroying it.
 */
export function isDocumentOpenOrReadDeclaration(declaration: string): boolean {
  const trimmed = declaration.trim();
  if (trimmed.length === 0) return false;
  // Never treat map/door state corrections ("the map summary still says closed...") as reading an in-world document.
  if (
    (/\b(summary|routes?|map)\b/i.test(trimmed) &&
      /\b(closed|open|wrong|still|says?|show|showing|fix|correct|update)\b/i.test(trimmed)) ||
    (/\b(door|doorway)\b/i.test(trimmed) &&
      /\b(already\s+open|is\s+open|says?\s+closed|still\s+closed|summary)\b/i.test(trimmed))
  ) {
    return false;
  }
  const { primaryClause } = splitPrimaryTargetFromLocative(trimmed);
  const targetClause = primaryClause.trim().length > 0 ? primaryClause : trimmed;
  if (
    /\b(?:tak(?:e|es|ing)|grab(?:s|bing)?|pocket(?:s|ing)?|stow(?:s|ing)?|loot(?:s|ing)?|collect(?:s|ing)?|claim(?:s|ing)?|retriev(?:e|es|ing)|pick(?:s|ing)?\s+up|steal(?:s|ing)?|burn(?:s|ing)?|destroy(?:s|ing)?|tear(?:s|ing)?|rip(?:s|ping)?)\b/i.test(
      targetClause,
    )
  ) {
    return false;
  }
  return /\b(?:open(?:s|ing)?|unfold(?:s|ing)?|unroll(?:s|ing)?|leaf(?:s|ing)?\s+through|flip(?:s|ping)?\s+(?:open|through)|turn(?:s|ing)?\s+(?:the\s+)?pages?\s+of|read(?:s|ing)?|perus(?:e|es|ing)|decipher(?:s|ing)?|translat(?:e|es|ing)|scan(?:s|ning)?|por(?:e|es|ing)\s+over|examin(?:e|es|ing)|inspect(?:s|ing)?|study|studies|studying|check(?:s|ing)?|look(?:s|ing)?\s+(?:at|in|inside|into|over)|peer(?:s|ing)?\s+(?:at|into))\s+(?:the\s+|a\s+|an\s+|some\s+|any\s+|this\s+|that\s+|these\s+|those\s+|my\s+|his\s+|her\s+|their\s+|our\s+)?(?:[a-z0-9'’-]+\s+){0,4}(?:books?|ledgers?|journals?|diaries|diary|logs?|logbooks?|registers?|manifests?|scrolls?|parchments?|letters?|notes?|missives?|dossiers?|folios?|tomes?|manuals?|codex|codices|pamphlets?|charts?|maps?|folders?|envelopes?|papers?|records?)\b/i.test(
    targetClause,
  );
}

/**
 * Returns true when a declaration expresses whole-container looting/collection (`RV-01`),
 * e.g., "I loot the open chest", "I empty the crate", "I take everything from the trunk".
 */
export function isWholeContainerLootDeclaration(declaration: string): boolean {
  const trimmed = declaration.trim();
  if (trimmed.length === 0) return false;
  if (
    /\b(?:(?:do\s+not|don't|dont|not)\s+tak(?:e|ing)|without\s+tak(?:e|ing)|not\s+taking\s+anything)\b/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  return (
    /\b(?:loot(?:s|ing)?|empt(?:y|ies|ying)|clear(?:s|ing)?(?:\s+out)?|plunder(?:s|ing)?|ransack(?:s|ing)?|strip(?:s|ping)?)\b/i.test(
      trimmed,
    ) ||
    /\b(?:tak(?:e|es|ing)|grab(?:s|bing)?|collect(?:s|ing)?|claim(?:s|ing)?|pocket(?:s|ing)?|stow(?:s|ing)?|retriev(?:e|es|ing)|pull(?:s|ing)?\s+out)\s+(?:all|everything|(?:all\s+)?(?:of\s+)?(?:the\s+)?(?:items?|contents?|loot|supplies|gear|goods|things?))\b/i.test(
      trimmed,
    ) ||
    /\b(?:tak(?:e|es|ing)|grab(?:s|bing)?|collect(?:s|ing)?|loot(?:s|ing)?|retriev(?:e|es|ing))\s+from\s+(?:the\s+|a\s+|an\s+|this\s+|that\s+)?(?:open(?:ed)?\s+|unlocked\s+)?[a-z0-9'’-]+\b/i.test(
      trimmed,
    )
  );
}

/**
 * Returns true when a declaration mentions a doorway/gate/archway/exit as a passage or travel route
 * (e.g., "I take the eastern doorway and follow the trail...", "go through the doorway", "take the eastern exit")
 * without an explicit door-opening/closing/unlocking verb.
 */
export function isPassageOrTravelThroughDoorway(declaration: string): boolean {
  const trimmed = declaration.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (
    /\b(?:open(?:s|ing)?|unseal(?:s|ing)?|unlatch(?:es|ing)?|unlock(?:s|ing)?|close(?:s|d|ing)?|shut(?:s|ting)?|pick(?:s|ing)?\s+(?:the\s+)?lock|pry|pries|prying|forc(?:e|es|ing))\b/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  const takesOrPassesDoorway =
    /\b(?:tak(?:e|es|ing)|us(?:e|es|ing)|(?:go(?:es|ing)?|pass(?:es|ing)?|step(?:s|ping)?|walk(?:s|ing)?|head(?:s|ing)?|mov(?:e|es|ing)|continu(?:e|es|ing)|proceed(?:s|ing)?|cross(?:es|ing)?|leav(?:e|es|ing)|exit(?:s|ing)?)(?:\s+(?:north|south|east|west|northern|southern|eastern|western|forward|ahead|onward|out))?\s+through)\s+(?:the\s+)?(?:[a-z'-]+\s+){0,4}(?:doorway|door|gate|gateway|archway|threshold|exit|passage|way)\b/i.test(
      trimmed,
    );
  const compoundDoorwayAndTravel =
    /\b(?:doorway|door|gate|gateway|archway|threshold|exit)\b[\s\S]{0,60}\b(?:and|then)\s+(?:i\s+)?(?:follow|trace|travel|head|continue|proceed|go|walk|march|press\s+on)\b/i.test(
      trimmed,
    ) ||
    /\bfollow(?:s|ing)?\s+(?:the\s+)?[\w\s'-]{1,40}\b(?:toward|towards|into|to|onward|ahead|beyond)\b/i.test(
      trimmed,
    );
  return takesOrPassesDoorway || compoundDoorwayAndTravel;
}
