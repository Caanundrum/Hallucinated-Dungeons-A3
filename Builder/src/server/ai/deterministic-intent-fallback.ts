/**
 * Deterministic Intent Fallback Cascade.
 *
 * Rules-bound deterministic interpreter that resolves player natural language declarations
 * when the AI Mechanics Arbiter is not invoked or cannot disambiguate an intent.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type { IntentInterpretResponse } from '../../shared/ai-director-contract.js';
import type { IntentDraftCommandType } from '../../shared/intent-draft-contract.js';
import type { EncounterProjection } from '../../shared/rules-combat-contract.js';
import type { DerivedCharacterSheet } from '../../shared/character-contract.js';
import type { MapBundleProjection } from '../../shared/map-contract.js';
import type { CampaignMemoryProjection } from '../../shared/campaign-memory-contract.js';
import { loadCampaignMemory } from '../campaigns/campaign-memory.js';
import { fetchCampaignMap } from '../table/map-projection.js';
import {
  doorAuthorityFromStored,
  formatDoorPlayerFacingLabel,
  parsePlayerDeclaration,
  resolveIntentAuthority,
  textReferencesUnlockedDoorState,
  textRequestsLockPicking,
} from '../../shared/play-authority-contract.js';
import {
  actionableDirectorFallback,
  evaluateCharacterCapability,
  resolveConditionalDoorIntent,
  understandUtterance,
} from '../../shared/utterance-understanding.js';
import {
  declarationIsDoorOpenOrPassage,
  declarationNegatesDoorOpen,
} from '../../shared/resolved-action-receipt.js';
import { isAdjacentToDoorEdge } from '../../shared/map-presentation.js';
import { rejectUnsupportedPremiseClaim } from '../../shared/campaign-facts.js';
import { containerLabelHintFromText } from '../../shared/container-contents.js';
import {
  pathBesideFeature,
  resolveBlankTableDoorBuild,
  resolveDoorIntentForMap,
  wantsBesideDoorIntent,
} from '../table/scene-door-intent.js';
import { buildSkillCheckDraftSummary } from '../table/skill-check-resolve.js';
import { SPELL_EFFECTS } from '../rules/engine/spell-effects.js';
import { dedupeInspectCandidateLabels } from './director-prose-scrubbers.js';
import { buildPremiseFactCorpus, loadScenePremiseExtras } from './director-context.js';

export interface DeterministicIntentFallbackInput {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly accountId: string;
  readonly rawText: string;
  readonly moveTarget?: { column: number; row: number } | null | undefined;
  readonly encounter: EncounterProjection | null;
  readonly seatedSheet: DerivedCharacterSheet | null;
  readonly rulesProgressionClassLabel: string | null;
  readonly knownNpcs: readonly { readonly id: string; readonly label: string }[];
  readonly presentNpcs?: readonly { readonly id: string; readonly label: string }[];
  readonly absentRoomNpcs?: readonly {
    readonly id: string;
    readonly label: string;
    readonly roomTitle: string;
  }[];
}

export interface DeterministicIntentFallbackResult {
  readonly proposedCommandType: IntentDraftCommandType;
  readonly summary: string;
  readonly path?: IntentInterpretResponse['path'];
  readonly edgeId?: string;
  readonly objectId?: string;
  readonly destinationHint?: string;
  readonly returnToPrevious?: boolean;
  readonly premise?: string;
  readonly targetCombatantId?: string;
  readonly spellId?: string;
  readonly itemId?: string;
  readonly declaredFoes?: readonly { readonly name: string }[];
  readonly arcaneRecovery?: boolean;
  readonly deferDirectorNarrate?: boolean;
  readonly authority: ReturnType<typeof resolveIntentAuthority>;
  readonly structured: ReturnType<typeof parsePlayerDeclaration>;
}

function titleCaseWords(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Pull fiction hostiles from a declaration (PQA-170/171).
 * Prefers "a hostile ashfang raider named Kest" → "Ashfang Raider Kest".
 */
export function extractDeclaredFoesFromText(
  rawText: string,
): readonly { readonly name: string }[] {
  const foes: { name: string }[] = [];
  const patterned = rawText.matchAll(
    /\b(?:a|an|the)\s+(?:hostile\s+|enemy\s+|foe\s+)?([A-Za-z][\w' -]{1,48}?)\s+named\s+([A-Z][\w'-]+)/gi,
  );
  for (const match of patterned) {
    const kind = titleCaseWords(match[1]!.replace(/\s+/g, ' ').trim());
    const personal = match[2]!;
    const name = `${kind} ${personal}`.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (name.length > 0 && !foes.some((entry) => entry.name === name)) {
      foes.push({ name });
    }
  }
  if (foes.length > 0) {
    return foes.slice(0, 4);
  }
  const namedOnly = /\bnamed\s+([A-Z][\w'-]+)/.exec(rawText);
  if (namedOnly !== null) {
    return [{ name: namedOnly[1]!.slice(0, 80) }];
  }
  return [];
}

function matchSpellFromText(text: string): (typeof SPELL_EFFECTS)[string] | null {
  const entries = Object.values(SPELL_EFFECTS);
  for (const effect of entries) {
    const label = effect.label.toLowerCase();
    const id = effect.spellId.replace(/-/g, ' ');
    if (text.includes(label) || text.includes(id) || text.includes(effect.spellId)) {
      return effect;
    }
  }
  return null;
}

function matchCombatantFromText(
  text: string,
  combatants: EncounterProjection['combatants'],
): EncounterProjection['combatants'][number] | null {
  let best: EncounterProjection['combatants'][number] | null = null;
  let bestScore = 0;
  for (const combatant of combatants) {
    const nameTokens = combatant.name
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 2);
    const idTokens = combatant.combatantId
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2);
    const score = [...new Set([...nameTokens, ...idTokens])].filter((token) =>
      text.includes(token),
    ).length;
    if (score > bestScore) {
      bestScore = score;
      best = combatant;
    }
  }
  if (best !== null) {
    return best;
  }
  if (/kobold|goblin/.test(text)) {
    return combatants.find((combatant) => /goblin/i.test(combatant.name)) ?? null;
  }
  if (/dummy|training/.test(text)) {
    return combatants.find((combatant) => /dummy/i.test(combatant.name)) ?? null;
  }
  return null;
}

function isOneStepFrom(
  anchor: { readonly column: number; readonly row: number },
  target: { readonly column: number; readonly row: number },
): boolean {
  const columnDelta = Math.abs(anchor.column - target.column);
  const rowDelta = Math.abs(anchor.row - target.row);
  return columnDelta <= 1 && rowDelta <= 1 && columnDelta + rowDelta > 0;
}

function stripAdjectivalOpenDoor(text: string): string {
  return text.replace(/\bopen(?:ed)?\s+(?:wooden\s+)?(?:door|doorway|gate|entry(?:way)?)s?\b/gi, 'doorway');
}

/** Trap/lock language that must stay on the skill-check path (PQA-155). */
function mentionsDoorHazardIntent(text: string): boolean {
  return textRequestsLockPicking(text) || /(trap|disarm|lockpick|lock\s*pick)/.test(text);
}

/**
 * Door state / manipulation without a hazard check (PQA-155).
 * Plain inspect/check/examine of a visible door reads state — it is not Investigation.
 */
function mentionsDoorStateIntent(text: string): boolean {
  if (mentionsDoorHazardIntent(text) || textReferencesUnlockedDoorState(text)) {
    return false;
  }
  if (declarationNegatesDoorOpen(text)) {
    return (
      /(listen|swing|ajar|hinge|free\s*swing|push|pull|test|inspect|check|examine|look\s*at|study|locked).*(door|gate|entry)/.test(
        text,
      ) ||
      /(door|gate|entry).*(listen|swing|ajar|hinge|stuck|free|push|pull|test|inspect|check|examine|state|locked)/.test(
        text,
      )
    );
  }
  return (
    /(listen|swing|ajar|hinge|free\s*swing|push|pull|test|inspect|check|examine|look\s*at|study).*(door|gate|entry)/.test(
      text,
    ) ||
    /(door|gate|entry).*(listen|swing|ajar|hinge|stuck|free|push|pull|test|inspect|check|examine|state)/.test(
      text,
    )
  );
}

function mentionsSkillCheckIntent(text: string): boolean {
  if (mentionsDoorStateIntent(text) || textReferencesUnlockedDoorState(text)) {
    return false;
  }
  // Compound sensory listen (e.g. "hide and listen", "crouch and listen") is Director perception, not a roll draft.
  if (/\blisten\b/i.test(text)) {
    return false;
  }
  const wantsStealth = /\b(?:hide|conceal|take\s+cover|stealth|crouch\s+behind|duck\s+behind)\b/i.test(text);
  const wantsSkill = /\b(?:trap|disarm|investigat(?:e|es|ing|ion)?|perception|search(?:es|ing)?|examine|inspect|stealth|hide|sleight\s+of\s+hand|athletics|acrobatics)\b/i.test(text);
  return (
    wantsStealth ||
    textRequestsLockPicking(text) ||
    (wantsSkill &&
      (/\b(?:door|lock|way|trap|entry|gate|bench|workbench|mark|desk|chest|table|wall|shelf|corpse|body|floor|ceiling|statue|altar|symbol|footprint|tracks)\b/i.test(text) ||
        /\b(?:using|with|for)\s+(?:investigation|perception|stealth|athletics|thieves)/i.test(text)))
  );
}

/** Vague investigate/search that must clarify a target before drafting a roll. */
function mentionsAmbiguousInspectIntent(text: string): boolean {
  if (mentionsDoorHazardIntent(text) || mentionsDoorStateIntent(text)) {
    return false;
  }
  // Broad scene surveys are Director perception — not skill-target clarifies.
  if (
    /\b(?:survey|look\s+around|peer\s+around|look\s+and\s+listen)\b/.test(text) ||
    (/\b(?:examin(?:e|es|ing)|search(?:es|ing)?|investigat(?:e|es|ing)|inspect(?:s|ing)?|look(?:s|ing)?|listen(?:s|ing)?)\b/.test(
      text,
    ) &&
      /\b(?:chamber|room|scene|surroundings|area|here)\b/.test(text) &&
      !/\b(?:door|doorway|gate|lock|lamp|bench|crate|counter|trap)\b/.test(text))
  ) {
    return false;
  }
  return (
    /\b(investigat|search|examine|inspect)\b/.test(text) &&
    /\b(most suspicious|anything unusual|visible feature|suspicious feature|the area|this area|the room|the chamber)\b/.test(
      text,
    ) &&
    !/\b(door|doorway|gate|lock|lamp|bench|crate|counter)\b/.test(text)
  );
}

function mentionsDoorIntent(text: string): boolean {
  // Negation: "without opening" / "do not open" is not an open-door intent.
  if (declarationNegatesDoorOpen(text)) {
    return false;
  }
  // Scene survey / look-around that only uses doorway as location is perception, not door work.
  if (
    /\b(?:look(?:s|ing)?\s+around|peer(?:s|ing)?\s+around|survey(?:s|ing)?|take(?:s|ing)?\s+(?:a\s+)?look\s+around|see(?:s|ing)?\s+around)\b/i.test(
      text,
    ) &&
    !/\b(?:opens?|opening|unlock|closes?|closing|shut|step(?:s|ping)?\s+through|through\s+(?:the\s+)?(?:door|doorway))\b/i.test(
      text,
    )
  ) {
    return false;
  }
  // Strip subordinate observation clauses ("keeping an eye on the closed east doorway", "while watching the door")
  // before testing whether the action itself targets a door.
  const withoutSubordinateObservation = text.replace(
    /,?\s*\b(?:keeping\s+an\s+eye\s+on|watching|glancing\s+(?:at|toward)|eyeing|mindful\s+of|staying\s+clear\s+of)\s+(?:the\s+)?(?:[a-z-]+\s+){0,4}(?:door|doorway|gate|entry(?:way)?)\b/gi,
    '',
  );
  if (!/\b(?:door|doorway|gate|entry(?:way)?|beyond)\b/i.test(withoutSubordinateObservation)) {
    return false;
  }
  // Adjectival "open wooden door" is door state, not an open-door verb.
  const withoutOpenNoun = stripAdjectivalOpenDoor(withoutSubordinateObservation);
  const openVerb = /\b(?:opens?|opening|push(?:es|ing)?|swings?|swinging)\b/i.test(withoutOpenNoun);
  const closeVerb = /\b(?:closes?|closing|shut(?:s|ting)?)\b/i.test(withoutSubordinateObservation);
  const passageVerb = /\b(?:enter(?:s|ing)?|steps?|stepping|through)\b/i.test(withoutSubordinateObservation);
  if (
    textReferencesUnlockedDoorState(withoutSubordinateObservation) &&
    !openVerb &&
    !closeVerb &&
    !passageVerb &&
    !/\bbeyond\b/i.test(withoutSubordinateObservation)
  ) {
    // Bare unlocked-state reference — not a door action (A1).
    return false;
  }
  if (
    textReferencesUnlockedDoorState(withoutSubordinateObservation) &&
    (openVerb || passageVerb || /\bbeyond\b/i.test(withoutSubordinateObservation))
  ) {
    return !textRequestsLockPicking(withoutSubordinateObservation);
  }
  return (
    mentionsDoorStateIntent(withoutSubordinateObservation) ||
    closeVerb ||
    (/(opens?|opening|push(?:es|ing)?|swings?).*(door|doorway|gate|entry)/.test(withoutOpenNoun) &&
      !textRequestsLockPicking(withoutSubordinateObservation)) ||
    (/(door|doorway|gate|entryway).*(opens?|opening|ahead|beyond|enter)/.test(withoutOpenNoun) &&
      !textRequestsLockPicking(withoutSubordinateObservation)) ||
    // Through / step / enter a door or doorway (including reverse crossing from the far side).
    (/\b(?:door|doorway|gate|entryway)\b/.test(withoutOpenNoun) &&
      passageVerb &&
      !textRequestsLockPicking(withoutSubordinateObservation)) ||
    // "Enter the room beyond" is doorway transit, not free-form mark-square movement.
    (/\bbeyond\b/.test(withoutSubordinateObservation) &&
      /\b(?:enter|room|chamber|door|doorway)\b/.test(withoutSubordinateObservation) &&
      !textRequestsLockPicking(withoutSubordinateObservation)) ||
    // Catch-all for explicit door/gate/doorway nouns with no unlock / passage language.
    (/\b(door|doorway|gate|entryway)\b/.test(withoutSubordinateObservation) &&
      !textRequestsLockPicking(withoutSubordinateObservation) &&
      !textReferencesUnlockedDoorState(withoutSubordinateObservation) &&
      !passageVerb)
  );
}

function mentionsMovementIntent(text: string): boolean {
  return /\b(?:moves?|walks?|goes?|steps?|approaches?|enters?|heading)\b/i.test(text);
}

async function gateDoorDeclarationAgainstLiveTruth(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly accountId: string;
  readonly text: string;
  readonly seatedSheet: DerivedCharacterSheet | null;
  readonly map: MapBundleProjection;
}): Promise<{
  readonly proposedCommandType: 'table.sync';
  readonly summary: string;
  readonly edgeId?: string;
} | null> {
  const understanding = understandUtterance(options.text);
  const extras = await loadScenePremiseExtras({
    firestore: options.firestore,
    campaignId: options.campaignId,
    accountId: options.accountId,
  });
  let memory: CampaignMemoryProjection | null = null;
  try {
    memory = await loadCampaignMemory(
      options.firestore,
      options.campaignId,
      options.accountId,
    );
  } catch {
    memory = null;
  }
  const facts = buildPremiseFactCorpus(memory, extras.banners, extras.premiseKey);
  const premiseReject = rejectUnsupportedPremiseClaim({
    claimText: options.text,
    knownNpcNames: memory?.npcs.map((npc) => npc.name) ?? [],
    inventoryNames: options.seatedSheet?.equipment.map((item) => item.name) ?? [],
    facts,
  });
  if (premiseReject !== null) {
    return { proposedCommandType: 'table.sync', summary: premiseReject };
  }

  const doors = options.map.edges.filter((edge) => edge.kind === 'door');
  const openDoors = doors.filter((edge) => edge.doorState === 'open');
  const ownToken =
    options.map.viewerSeatId === null
      ? options.map.tokens[0]
      : (options.map.tokens.find((token) => token.seatId === options.map.viewerSeatId) ??
        options.map.tokens[0]);
  const anchor = ownToken?.footprint.anchor ?? null;
  const adjacentOpen =
    anchor === null
      ? undefined
      : openDoors.find((edge) => isAdjacentToDoorEdge(anchor, edge));
  const mentioned =
    doors.find((edge) => (/\beast\b/i.test(options.text) ? edge.orientation === 'east' : false)) ??
    doors.find((edge) => (/\bwest\b/i.test(options.text) ? edge.orientation === 'west' : false)) ??
    adjacentOpen ??
    openDoors[0] ??
    doors[0];
  let doorLeaf: 'open' | 'closed' | 'unknown' = 'unknown';
  if (adjacentOpen !== undefined) {
    doorLeaf = 'open';
  } else if (mentioned !== undefined) {
    doorLeaf = mentioned.doorState === 'open' ? 'open' : 'closed';
  }
  const conditional = resolveConditionalDoorIntent({
    constraints: understanding.constraints,
    doorLeaf,
  });
  if (conditional === 'noop') {
    const label =
      mentioned !== undefined
        ? formatDoorPlayerFacingLabel(
            doorAuthorityFromStored(mentioned.doorState),
            mentioned.orientation,
          )
        : 'the doorway';
    return {
      proposedCommandType: 'table.sync',
      summary: `${label} is already open. Leaving it exactly as it is — no open or step-through is prepared.`,
      ...(mentioned !== undefined ? { edgeId: mentioned.edgeId } : {}),
    };
  }
  return null;
}

export async function resolveDeterministicIntentFallback(
  options: DeterministicIntentFallbackInput,
): Promise<DeterministicIntentFallbackResult> {
  const rawText = options.rawText.trim();
  const text = rawText.toLowerCase();

  let proposedCommandType: IntentDraftCommandType = 'table.sync';
  let summary =
    'I heard your declaration. Confirm only commits what the table can resolve right now.';
  let path: IntentInterpretResponse['path'];
  let edgeId: string | undefined;
  let objectId: string | undefined;
  let destinationHint: string | undefined;
  let returnToPrevious: boolean | undefined;
  let premise: string | undefined;
  let targetCombatantId: string | undefined;
  let spellId: string | undefined;
  let itemId: string | undefined;
  let declaredFoes: readonly { readonly name: string }[] | undefined;
  let arcaneRecovery: boolean | undefined;
  let deferDirectorNarrate = false;

  const encounter = options.encounter;
  const seatedSheet = options.seatedSheet;
  const rulesProgressionClassLabel = options.rulesProgressionClassLabel;
  const knownNpcs = options.knownNpcs;

  const combatActive = encounter !== null && encounter.status === 'active';
  const foes =
    encounter?.combatants.filter(
      (combatant) => combatant.side === 'foe' && combatant.currentHitPoints > 0,
    ) ?? [];
  const party =
    encounter?.combatants.filter((combatant) => combatant.side === 'party') ?? [];

  const structured = parsePlayerDeclaration(rawText, {
    knownNpcs,
    ...(options.presentNpcs !== undefined ? { presentNpcs: options.presentNpcs } : {}),
  });
  const authority = resolveIntentAuthority(structured);
  const absentRoomNpcs = options.absentRoomNpcs ?? [];
  const matchedAbsentNpc =
    structured.addressee !== null
      ? absentRoomNpcs.find((npc) => {
          const target = structured.addressee!.toLowerCase();
          const label = npc.label.toLowerCase();
          return label === target || label.includes(target) || target.includes(label);
        }) ?? null
      : null;
  const utterance = understandUtterance(rawText);
  const hasDedicatedGatewayBranch =
    !utterance.constraints.prepareWithoutAttack &&
    !utterance.constraints.forbidCombat &&
    (/(end (the )?(encounter|fight|combat)|stop (the )?fight|withdraw from (combat|the fight))/i.test(
      text,
    ) ||
      /arcane recovery/i.test(text) ||
      /(short\s*rest|take a short rest|rest briefly|catch my breath|recover.*(second wind|action surge|short.?rest))/i.test(
        text,
      ) ||
      /(long\s*rest|take a long rest|camp for the night|sleep until morning)/i.test(text) ||
      /(begin (the )?encounter|start (the )?(encounter|combat|fight)|roll initiative|initiative)/i.test(
        text,
      ) ||
      (/hostile|guardian|foe|enemy/.test(text) && /initiative|encounter|combat/.test(text)) ||
      /(potion|drink.*heal|use.*heal|healing potion)/.test(text) ||
      /\b(attack|strike|hit|slash|smash|stab|swing|warhammer|longsword|club|hammer)\b/.test(
        text,
      ));
  const emptyClarifyYieldsToGateway =
    authority.disposition === 'clarify' &&
    authority.actionSequence.length === 0 &&
    structured.addressee === null &&
    !structured.isInterrogative &&
    hasDedicatedGatewayBranch;
  // Clarify / narrate-only must never fall into the keyword combat/travel cascade.
  const authorityShortCircuit =
    authority.disposition === 'director_narrate_only' ||
    authority.disposition === 'reject_world_authorship' ||
    (authority.disposition === 'clarify' && !emptyClarifyYieldsToGateway) ||
    utterance.speechAct === 'question' ||
    utterance.speechAct === 'rules_query' ||
    utterance.wantsKnowledgeRecap ||
    utterance.constraints.prepareWithoutAttack ||
    utterance.constraints.forbidCombat ||
    (authority.disposition === 'propose_command' &&
      authority.actionSequence[0]?.kind === 'unlock_door') ||
    (authority.disposition === 'propose_command' &&
      authority.actionSequence[0]?.kind === 'inspect' &&
      (authority.actionSequence[0]?.outcomeHint === 'trap_search' ||
        authority.actionSequence[0]?.outcomeHint === 'investigate_mark' ||
        authority.actionSequence[0]?.outcomeHint === 'active_search' ||
        authority.actionSequence[0]?.outcomeHint === 'stealth_hide')) ||
    (authority.disposition === 'propose_command' &&
      authority.actionSequence[0]?.kind === 'inspect' &&
      authority.actionSequence[0]?.outcomeHint === 'take_container') ||
    (authority.disposition === 'propose_command' &&
      authority.actionSequence[0]?.kind === 'move' &&
      !mentionsDoorIntent(text) &&
      authority.actionSequence[0]?.outcomeHint !== 'beside_door');

  // Batch 2/3 — reusable Director scene loop (begin / object / travel / landmark / return).
  let sceneLoopResolved = false;
  if (
    /\b(begin (the )?adventure|start (the )?adventure|establish (the )?(first |opening )?scene)\b/i.test(
      text,
    )
  ) {
    proposedCommandType = 'table.begin_adventure';
    summary =
      'Ready to begin the adventure. Confirm so the Game Director establishes the opening scene from your premise.';
    sceneLoopResolved = true;
  } else if (
    (/\b(return|go back|head back|retreat|back to|passage back)\b/i.test(text) &&
      /\b(scene|chamber|room|inn|tavern|cellar|stairs|upstairs|path|way|earlier|previous)\b/i.test(text)) ||
    /\b(?:return|head\s+back|go\s+back)\s+(?:up|down|to|through)\b/i.test(text) ||
    /\bpassage\s+back\b/i.test(text)
  ) {
    proposedCommandType = 'table.travel_scene';
    returnToPrevious = true;
    destinationHint = 'return to the earlier scene';
    summary =
      'Ready to return to the earlier scene. Confirm to restore it with prior consequences.';
    sceneLoopResolved = true;
  } else if (
    !mentionsDoorIntent(text) &&
    (/\b(leave|travel|head (out|outside|onward|for|to|down)|go (outside|outdoors|onward|through|to|toward|down)|step (out|outside)|climb|descend|ascend|walk down|take the stairs|down the stairs|up the stairs|enter the|follow the|make for|seek)\b/i.test(
      text,
    ) ||
      /\b(watchtower|tower|dock|docks|pier|harbor|cavern|cave|bridge|ridge|ruin|ruins|keep|fort)\b/i.test(
        text,
      ))
  ) {
    proposedCommandType = 'table.travel_scene';
    destinationHint = rawText.slice(0, 200);
    summary =
      'Ready to leave for another scene. Confirm so the Game Director establishes the next place.';
    sceneLoopResolved = true;
  } else if (
    // Door open/passage belongs to door authority — never steal into prop interact
    // via "open the" + fuzzy label match (wood ⊂ wooden → Wood pile).
    !declarationIsDoorOpenOrPassage(rawText) &&
    !declarationNegatesDoorOpen(rawText) &&
    !mentionsDoorIntent(text) &&
    /\b(extinguish|douse|snuff|relight|ignite|kindle|break|smash|kick|shatter|move the|clear the|open the|close the|disarm)\b/i.test(
      text,
    )
  ) {
    try {
      const { loadMapRuntime } = await import('../table/map-runtime.js');
      const { matchInteractableByDeclaration } = await import('../table/scene-commands.js');
      const runtime = await loadMapRuntime(options.firestore, options.campaignId);
      const matched = matchInteractableByDeclaration(runtime, text);
      if (matched !== null) {
        proposedCommandType = 'table.interact_object';
        objectId = matched;
        summary =
          'Ready to change that object on the scene. Confirm to update its state on the table.';
        sceneLoopResolved = true;
      }
    } catch {
      sceneLoopResolved = false;
    }
  }

  if (sceneLoopResolved) {
    // Skip combat/door branches — scene loop owns this declaration.
  } else if (authorityShortCircuit) {
    // Absent campaign NPCs must be caught before generic clarify / world-authorship bounce (F26-10).
    if (matchedAbsentNpc !== null) {
      proposedCommandType = 'table.sync';
      deferDirectorNarrate = false;
      summary = `${matchedAbsentNpc.label} is not in this room right now — they remain back in ${matchedAbsentNpc.roomTitle}, out of earshot from here.`;
    } else if (/(cast|spell|fireball|fire bolt|firebolt|burning hands|sacred flame|guiding bolt|cure wounds)/.test(text)) {
      const matchedSpell = matchSpellFromText(text);
      const spellLabelFromText =
        matchedSpell?.label ??
        (text.match(/\b(fireball|fire\s*bolt|burning\s*hands|sacred\s*flame|guiding\s*bolt|cure\s*wounds)\b/i)?.[1] ??
          null);
      const capability = evaluateCharacterCapability(seatedSheet, {
        wantsCast: true,
        spellId: matchedSpell?.spellId ?? null,
        spellLabel: spellLabelFromText,
        classLabel: rulesProgressionClassLabel,
      });
      proposedCommandType = 'table.sync';
      summary = !capability.allowed
        ? [capability.reason, capability.suggestion].filter(Boolean).join(' ')
        : authority.clarificationPrompt ?? authority.summary;
    } else if (
      authority.actionSequence.some(
        (step) => step.kind === 'inspect' && step.outcomeHint === 'take_container',
      )
    ) {
      try {
        const { loadMapRuntime } = await import('../table/map-runtime.js');
        const { matchTakeContainerByDeclaration } = await import('../table/scene-commands.js');
        const runtime = await loadMapRuntime(options.firestore, options.campaignId);
        const matched = matchTakeContainerByDeclaration(runtime, rawText);
        if (matched !== null) {
          const active =
            runtime.activeSceneId !== null && runtime.activeSceneId !== undefined
              ? runtime.sceneInstances?.[runtime.activeSceneId]
              : undefined;
          const feature = active?.features.find((entry) => entry.objectId === matched);
          const label =
            feature?.label.replace(/\s*[—(].*$/, '').trim() ||
            containerLabelHintFromText(rawText) ||
            'that container';
          proposedCommandType = 'table.take_scene_prop';
          objectId = matched;
          summary = `Ready to take ${label} into your inventory. Confirm to stow it and remove it from the map.`;
        } else {
          proposedCommandType = 'table.sync';
          deferDirectorNarrate = true;
          summary = authority.summary;
        }
      } catch {
        proposedCommandType = 'table.sync';
        deferDirectorNarrate = true;
        summary = authority.summary;
      }
    } else if (
      authority.actionSequence.some(
        (step) =>
          step.kind === 'inspect' &&
          (step.outcomeHint === 'take_from_container' ||
            step.outcomeHint === 'take_item' ||
            step.outcomeHint === 'contents_query'),
      ) ||
      (/\b(?:take|grab|pocket|stow|carry|lift|pick(?:ing|ed)?\s+up)\b/i.test(text) &&
        containerLabelHintFromText(text) !== null)
    ) {
      // Contents take / peek remains narrate-only until inventory item commits land.
      proposedCommandType = 'table.sync';
      deferDirectorNarrate = true;
      summary = authority.summary;
    } else if (
      authority.disposition === 'propose_command' &&
      (authority.actionSequence[0]?.kind === 'unlock_door' ||
        (authority.actionSequence[0]?.kind === 'inspect' &&
          (authority.actionSequence[0]?.outcomeHint === 'trap_search' ||
            authority.actionSequence[0]?.outcomeHint === 'investigate_mark' ||
            authority.actionSequence[0]?.outcomeHint === 'active_search' ||
            authority.actionSequence[0]?.outcomeHint === 'stealth_hide')))
    ) {
      const extras = await loadScenePremiseExtras({
        firestore: options.firestore,
        campaignId: options.campaignId,
        accountId: options.accountId,
      });
      let memoryForPremise: CampaignMemoryProjection | null = null;
      try {
        memoryForPremise = await loadCampaignMemory(
          options.firestore,
          options.campaignId,
          options.accountId,
        );
      } catch {
        memoryForPremise = null;
      }
      const premiseReject = rejectUnsupportedPremiseClaim({
        claimText: text,
        knownNpcNames: memoryForPremise?.npcs.map((npc) => npc.name) ?? [],
        inventoryNames: seatedSheet?.equipment.map((item) => item.name) ?? [],
        facts: buildPremiseFactCorpus(memoryForPremise, extras.banners, extras.premiseKey),
      });
      if (premiseReject !== null) {
        proposedCommandType = 'table.sync';
        summary = premiseReject;
      } else {
        proposedCommandType = 'table.sync';
        summary = buildSkillCheckDraftSummary(seatedSheet, text);
      }
    } else if (
      authority.disposition === 'propose_command' &&
      authority.actionSequence[0]?.kind === 'move'
    ) {
      // Invented scenery may have been ignored — keep the real move (TQA-004).
      if (options.moveTarget) {
        proposedCommandType = 'table.move';
        path = [options.moveTarget];
        summary =
          authority.summary.startsWith('Ready to')
            ? authority.summary
            : 'Ready to move. Confirm to commit the step.';
        if (authority.ignoredWorldFacts.length > 0 && !/ignored|Game Director/i.test(summary)) {
          summary = `${summary} Player-authored places were ignored — only the Game Director establishes those.`;
        }
      } else {
        // Prefer feature/prop movement (e.g. service counter, hearth) or doorway geometry over mark-square.
        let doorResolved = false;
        try {
          const map = await fetchCampaignMap({
            firestore: options.firestore,
            accountId: options.accountId,
            campaignId: options.campaignId,
          });
          const ownToken =
            map.viewerSeatId === null
              ? map.tokens[0]
              : (map.tokens.find((token) => token.seatId === map.viewerSeatId) ?? map.tokens[0]);

          if (ownToken !== undefined && !mentionsDoorIntent(text)) {
            let targetFeature = map.notableFeatures.find((f) => {
              const label = f.label.toLowerCase();
              if (text.toLowerCase().includes(label)) return true;
              const parts = label.split(/\s+/).filter((p) => p.length >= 4);
              return parts.some((p) => text.toLowerCase().includes(p));
            });
            let featureDisplayLabel = targetFeature?.label ?? null;
            if (
              targetFeature === undefined &&
              /\b(?:service\s+counter|counter|bar)\b/i.test(text)
            ) {
              targetFeature = map.notableFeatures.find(
                (f) =>
                  f.column === 4 &&
                  (f.row === 2 || f.row === 4) &&
                  f.objectKind !== 'npc' &&
                  f.objectKind !== 'exit',
              );
              if (targetFeature !== undefined) {
                featureDisplayLabel = 'Service counter';
              }
            }
            if (targetFeature !== undefined && featureDisplayLabel !== null) {
              const featureSquare = { column: targetFeature.column, row: targetFeature.row };
              const featurePath = pathBesideFeature(ownToken.footprint.anchor, featureSquare, map);
              if (featurePath !== null && featurePath.length > 0) {
                proposedCommandType = 'table.move';
                path = featurePath;
                const steps = featurePath.length;
                const feet = steps * map.coordinateSpace.feetPerSquare;
                summary = `Walk beside the ${featureDisplayLabel} in ${map.title} (${steps} square${steps === 1 ? '' : 's'}, ${feet} ft). Confirm to commit the move.`;
                doorResolved = true;
              }
            }
          }
          const primaryMoveText = text
            .replace(
              /(?:,\s*|\s+)(?:while\s+|whilst\s+|as\s+i\s+)?(?:keeping\s+(?:an\s+eye|watch|my\s+eyes?)\s+on|watching|eyeing|glancing\s+(?:at|toward)|looking\s+toward|staying\s+wary\s+of|mindful\s+of)\s+(?:the\s+)?(?:[a-z-]+\s+){0,4}(?:door|doorway|gate|entry(?:way)?|threshold|exit)\b[^.?!]*/gi,
              '',
            )
            .trim();
          if (
            !doorResolved &&
            ownToken !== undefined &&
            map.edges.length > 0 &&
            /\b(?:door|doorway|gate|entry(?:way)?|threshold|through|beyond|west|east|north|south)\b/i.test(
              primaryMoveText,
            )
          ) {
            const gated = await gateDoorDeclarationAgainstLiveTruth({
              firestore: options.firestore,
              campaignId: options.campaignId,
              accountId: options.accountId,
              text: primaryMoveText,
              seatedSheet,
              map,
            });
            if (gated !== null) {
              proposedCommandType = gated.proposedCommandType;
              summary = gated.summary;
              if (gated.edgeId !== undefined) {
                edgeId = gated.edgeId;
              }
              doorResolved = true;
            } else {
              const persisted = resolveDoorIntentForMap(
                map,
                ownToken.footprint.anchor,
                primaryMoveText,
              );
              if (persisted !== null) {
                const hasReturnExit = map.notableFeatures.some(
                  (f) =>
                    (f.referenceKind === 'exit' || f.objectKind === 'exit') &&
                    /\b(?:passage\s+back|return\s+to|back\s+to)\b/i.test(f.label),
                );
                const isCrossingStep =
                  persisted.proposedCommandType === 'table.move' &&
                  /\b(?:step(?:s|ping)?\s+(?:back\s+)?through|walk(?:s|ing)?\s+through|go(?:es|ing)?\s+through|through\s+the\s+open|enter(?:s|ing)?)\b/i.test(
                    primaryMoveText,
                  );
                if (hasReturnExit && isCrossingStep) {
                  proposedCommandType = 'table.travel_scene';
                  returnToPrevious = true;
                  destinationHint = 'return to the earlier scene';
                  summary =
                    'Ready to return through the open doorway to the earlier scene. Confirm to restore it with prior consequences.';
                  doorResolved = true;
                } else {
                  proposedCommandType = persisted.proposedCommandType;
                  summary = persisted.summary;
                  if (persisted.path !== undefined) {
                    path = [...persisted.path];
                  }
                  if (persisted.edgeId !== undefined) {
                    edgeId = persisted.edgeId;
                  }
                  doorResolved = true;
                }
              }
            }
          }
        } catch {
          doorResolved = false;
        }
        if (!doorResolved) {
          proposedCommandType = 'table.sync';
          summary =
            authority.ignoredWorldFacts.length > 0
              ? 'Your movement stands — mark an adjacent square on the map to commit it. Player-authored places were ignored; only the Game Director establishes those.'
              : 'Mark an adjacent square on the map, then declare your move again to commit the step.';
        }
      }
    } else if (authority.disposition === 'director_narrate_only') {
      proposedCommandType = authority.proposedCommandType ?? 'table.sync';
      deferDirectorNarrate = true;
      summary = authority.summary;
    } else {
      proposedCommandType = authority.proposedCommandType ?? 'table.sync';
      summary = authority.clarificationPrompt ?? authority.summary;
    }
  } else if (
    (authority.disposition === 'propose_command' &&
      (authority.actionSequence[0]?.kind === 'open_door' ||
        authority.actionSequence[0]?.kind === 'close_door' ||
        (authority.actionSequence[0]?.kind === 'move' &&
          authority.actionSequence[0]?.outcomeHint === 'beside_door'))) ||
    wantsBesideDoorIntent(text) ||
    (mentionsDoorIntent(text) &&
      !/(begin (the )?encounter|start (the )?(encounter|combat|fight)|roll initiative)/i.test(
        text,
      ) &&
      (!mentionsSkillCheckIntent(text) || mentionsDoorStateIntent(text)))
  ) {
    try {
      const map = await fetchCampaignMap({
        firestore: options.firestore,
        accountId: options.accountId,
        campaignId: options.campaignId,
      });
      const ownToken =
        map.viewerSeatId === null
          ? map.tokens[0]
          : (map.tokens.find((token) => token.seatId === map.viewerSeatId) ?? map.tokens[0]);
      if (ownToken !== undefined) {
        const gated = await gateDoorDeclarationAgainstLiveTruth({
          firestore: options.firestore,
          campaignId: options.campaignId,
          accountId: options.accountId,
          text,
          seatedSheet,
          map,
        });
        if (gated !== null) {
          proposedCommandType = gated.proposedCommandType;
          summary = gated.summary;
          if (gated.edgeId !== undefined) {
            edgeId = gated.edgeId;
          }
        } else {
          const persisted = resolveDoorIntentForMap(map, ownToken.footprint.anchor, text);
          if (persisted !== null) {
            const hasReturnExit = map.notableFeatures.some(
              (f) =>
                (f.referenceKind === 'exit' || f.objectKind === 'exit') &&
                /\b(?:passage\s+back|return\s+to|back\s+to)\b/i.test(f.label),
            );
            const isCrossingStep =
              persisted.proposedCommandType === 'table.move' &&
              /\b(?:step(?:s|ping)?\s+(?:back\s+)?through|walk(?:s|ing)?\s+through|go(?:es|ing)?\s+through|through\s+the\s+open|enter(?:s|ing)?)\b/i.test(
                text,
              );
            if (hasReturnExit && isCrossingStep) {
              proposedCommandType = 'table.travel_scene';
              returnToPrevious = true;
              destinationHint = 'return to the earlier scene';
              summary =
                'Ready to return through the open doorway to the earlier scene. Confirm to restore it with prior consequences.';
            } else {
              proposedCommandType = persisted.proposedCommandType;
              summary = persisted.summary;
              if (persisted.path !== undefined) {
                path = [...persisted.path];
              }
              if (persisted.edgeId !== undefined) {
                edgeId = persisted.edgeId;
              }
            }
          } else {
            const blankBuild = resolveBlankTableDoorBuild(map, ownToken.footprint.anchor, text);
            if (blankBuild !== null) {
              proposedCommandType = blankBuild.proposedCommandType;
              summary = blankBuild.summary;
              if (blankBuild.edgeId !== undefined) {
                edgeId = blankBuild.edgeId;
              }
            } else {
              proposedCommandType = 'table.sync';
              summary =
                'This scene has no door to open yet. Ask the Director what you can interact with here, or declare how you explore the chamber.';
            }
          }
        }
      }
    } catch {
      proposedCommandType = 'table.sync';
      summary =
        'This scene has no door to open yet. Ask the Director what you can interact with here, or declare how you explore the chamber.';
    }
  } else if (mentionsAmbiguousInspectIntent(text) || mentionsSkillCheckIntent(text)) {
    proposedCommandType = 'table.sync';
    let candidateLabels: string[] = [];
    try {
      const map = await fetchCampaignMap({
        firestore: options.firestore,
        accountId: options.accountId,
        campaignId: options.campaignId,
      });
      candidateLabels = dedupeInspectCandidateLabels([
        ...map.notableFeatures
          .map((feature) => feature.label)
          .filter((label) => label.trim().length > 0),
        ...map.edges
          .filter((edge) => edge.kind === 'door')
          .map((edge) =>
            formatDoorPlayerFacingLabel(
              doorAuthorityFromStored(edge.doorState),
              edge.orientation,
            ),
          ),
      ]).slice(0, 8);
    } catch {
      candidateLabels = [];
    }
    summary = buildSkillCheckDraftSummary(seatedSheet, text, { candidateLabels });
  } else if (mentionsMovementIntent(text) && options.moveTarget) {
    let legalStep = false;
    try {
      const map = await fetchCampaignMap({
        firestore: options.firestore,
        accountId: options.accountId,
        campaignId: options.campaignId,
      });
      const ownToken =
        map.viewerSeatId === null
          ? map.tokens[0]
          : (map.tokens.find((token) => token.seatId === map.viewerSeatId) ?? map.tokens[0]);
      if (ownToken !== undefined) {
        legalStep = isOneStepFrom(ownToken.footprint.anchor, options.moveTarget);
      } else if (!mentionsDoorIntent(text)) {
        legalStep = true;
      }
    } catch {
      legalStep = !mentionsDoorIntent(text);
    }
    if (legalStep) {
      proposedCommandType = 'table.move';
      path = [options.moveTarget];
      summary = 'Ready to move. Confirm to commit the step.';
    } else {
      proposedCommandType = 'table.sync';
      summary =
        'That destination is not a legal next step from where you stand. Pick an adjacent square on the map, or declare a door or scene action instead.';
    }
  } else if (
    /(end (the )?(encounter|fight|combat)|stop (the )?fight|withdraw from (combat|the fight))/i.test(
      text,
    )
  ) {
    if (encounter !== null && encounter.status !== 'ended') {
      proposedCommandType = 'encounter.end';
      summary =
        'Ready to end the encounter and leave combat. Confirm to clear initiative so the table can rest or explore.';
    } else {
      proposedCommandType = 'table.sync';
      summary = 'There is no active encounter to end right now.';
    }
  } else if (
    /arcane recovery/i.test(text) ||
    (/(short\s*rest|take a short rest)/i.test(text) &&
      /arcane recovery|recover.*(spell )?slot|restore.*(spell )?slot/i.test(text))
  ) {
    if (combatActive) {
      proposedCommandType = 'table.sync';
      summary =
        'Arcane Recovery needs the fight to end first. End the encounter, then declare a Short Rest with Arcane Recovery.';
    } else {
      proposedCommandType = 'combat.short_rest';
      arcaneRecovery = true;
      summary =
        'Ready to take a Short Rest and use Arcane Recovery to restore expended level-1 spell slots (up to half your Wizard level, rounded up; once per day). Confirm to resolve the rest.';
    }
  } else if (
    /(short\s*rest|take a short rest|rest briefly|catch my breath|recover.*(second wind|action surge|short.?rest))/i.test(
      text,
    )
  ) {
    if (combatActive) {
      proposedCommandType = 'table.sync';
      summary =
        'A Short Rest needs the fight to end first. End the encounter, then declare a Short Rest again.';
    } else {
      proposedCommandType = 'combat.short_rest';
      summary =
        'Ready to take a Short Rest and recover short-rest resources (and spend a Hit Die if available). Confirm to resolve the rest.';
    }
  } else if (
    /(long\s*rest|take a long rest|camp for the night|sleep until morning)/i.test(text)
  ) {
    if (combatActive) {
      proposedCommandType = 'table.sync';
      summary =
        'A Long Rest needs the fight to end first. End the encounter, then declare a Long Rest again.';
    } else {
      proposedCommandType = 'combat.long_rest';
      summary =
        'Ready to take a Long Rest and restore Hit Points, Hit Dice, spell slots, and class resources. Confirm to resolve the rest.';
    }
  } else if (
    /(begin (the )?encounter|start (the )?(encounter|combat|fight)|roll initiative|initiative)/i.test(text) ||
    (/hostile|guardian|foe|enemy/.test(text) && /initiative|encounter|combat/.test(text))
  ) {
    const wantsInitiative = /initiative/.test(text);
    const storyFoes = extractDeclaredFoesFromText(rawText);
    if (combatActive) {
      proposedCommandType = 'table.sync';
      summary = 'Combat is already active. Declare your attack or spell on your turn.';
    } else if (encounter !== null && encounter.status === 'setup') {
      proposedCommandType = 'initiative.roll';
      summary =
        'Ready to roll initiative for this encounter. Confirm to establish turn order.';
    } else if (encounter !== null && encounter.status === 'ended') {
      proposedCommandType = 'encounter.begin';
      if (storyFoes.length > 0) {
        declaredFoes = storyFoes;
        const foeNames = storyFoes.map((foe) => foe.name).join(' and ');
        summary = wantsInitiative
          ? `Ready to begin a new encounter against ${foeNames}. Confirm to start; initiative follows once setup is ready.`
          : `Ready to begin a new encounter against ${foeNames}. Confirm to start combat setup.`;
      } else {
        summary = wantsInitiative
          ? 'Ready to begin a new encounter with practice foes. Confirm to start; initiative follows once setup is ready.'
          : 'Ready to begin a new encounter with practice foes. Confirm to start combat setup.';
      }
    } else {
      // No encounter yet — begin is the supported path (hosted has no Tools tab).
      proposedCommandType = 'encounter.begin';
      if (storyFoes.length > 0) {
        declaredFoes = storyFoes;
        const foeNames = storyFoes.map((foe) => foe.name).join(' and ');
        summary = wantsInitiative
          ? `Ready to begin the encounter against ${foeNames} and prepare initiative. Confirm to bring them into play, then confirm rolling initiative.`
          : `Ready to begin the encounter against ${foeNames}. Confirm to bring them into play.`;
      } else {
        summary = wantsInitiative
          ? 'Ready to begin the encounter and prepare initiative. Confirm to bring practice foes into play, then confirm rolling initiative.'
          : 'Ready to begin the encounter. Confirm to bring practice foes into play.';
      }
    }
  } else if (/(potion|drink.*heal|use.*heal|healing potion)/.test(text)) {
    const self = party.find((combatant) => combatant.seatId !== null) ?? party[0] ?? null;
    if (!combatActive || self === null) {
      proposedCommandType = 'encounter.begin';
      summary =
        'Ready to begin an encounter so you can use a Potion of Healing on your turn. Confirm to start combat setup, then declare the potion again.';
    } else {
      proposedCommandType = 'inventory.use_item';
      itemId = 'healing-potion';
      targetCombatantId = self.combatantId;
      summary = `Ready to use a Potion of Healing on ${self.name}. Confirm to let the engine resolve the heal.`;
    }
  } else if (/(cast|spell|fireball|fire bolt|firebolt|burning hands|sacred flame|guiding bolt|cure wounds)/.test(text)) {
    const matchedSpell = matchSpellFromText(text);
    const classLabel =
      rulesProgressionClassLabel !== null
        ? rulesProgressionClassLabel
        : null;
    const spellLabelFromText =
      matchedSpell?.label ??
      (text.match(/\b(fireball|fire\s*bolt|burning\s*hands|sacred\s*flame|guiding\s*bolt|cure\s*wounds)\b/i)?.[1] ??
        null);
    const capability = evaluateCharacterCapability(seatedSheet, {
      wantsCast: true,
      spellId: matchedSpell?.spellId ?? null,
      spellLabel: spellLabelFromText,
      classLabel,
    });
    if (!capability.allowed) {
      proposedCommandType = 'table.sync';
      summary = [capability.reason, capability.suggestion].filter(Boolean).join(' ');
    } else {
      const target = matchCombatantFromText(text, foes) ?? (foes.length === 1 ? foes[0]! : null);
      if (!combatActive) {
        proposedCommandType = 'encounter.begin';
        const storyFoes = extractDeclaredFoesFromText(rawText);
        if (storyFoes.length > 0) {
          declaredFoes = storyFoes;
          const foeNames = storyFoes.map((foe) => foe.name).join(' and ');
          summary = `Ready to begin an encounter against ${foeNames} so you can cast in combat. Confirm to start combat setup, then declare the spell again after initiative.`;
        } else {
          summary =
            'Ready to begin an encounter so you can cast in combat. Confirm to start combat setup, then declare the spell again after initiative.';
        }
      } else if (matchedSpell === null) {
        summary =
          'Name which prepared spell you cast (for example Fire Bolt or Burning Hands), then declare again.';
        proposedCommandType = 'table.sync';
      } else if (matchedSpell.targetKind === 'area') {
        proposedCommandType = 'combat.cast_spell';
        spellId = matchedSpell.spellId;
        summary = `Ready to cast ${matchedSpell.label}. Confirm to resolve the area with the engine.`;
      } else if (matchedSpell.targetKind === 'self') {
        const self = party.find((combatant) => combatant.seatId !== null) ?? party[0] ?? null;
        proposedCommandType = 'combat.cast_spell';
        spellId = matchedSpell.spellId;
        if (self !== null) targetCombatantId = self.combatantId;
        summary = `Ready to cast ${matchedSpell.label} on yourself. Confirm to resolve with the engine.`;
      } else if (target === null) {
        const foeHint =
          foes
            .slice(0, 2)
            .map((foe) => foe.name)
            .join(' or ') || 'a foe in the encounter';
        summary = `Ready to cast ${matchedSpell.label}, but name which foe (for example ${foeHint}).`;
        proposedCommandType = 'table.sync';
      } else {
        proposedCommandType = 'combat.cast_spell';
        spellId = matchedSpell.spellId;
        targetCombatantId = target.combatantId;
        summary = `Ready to cast ${matchedSpell.label} at ${target.name}. Confirm to resolve the spell with the engine.`;
      }
    }
  } else if (
    /\b(attack|strike|hit|slash|smash|stab|swing|warhammer|longsword|club|hammer)\b/.test(text)
  ) {
    if (utterance.constraints.prepareWithoutAttack || utterance.constraints.forbidCombat) {
      proposedCommandType = 'table.sync';
      summary = actionableDirectorFallback(utterance);
    } else {
      const target = matchCombatantFromText(text, foes) ?? (foes.length === 1 ? foes[0]! : null);
      if (!combatActive) {
        proposedCommandType = 'encounter.begin';
        const storyFoes = extractDeclaredFoesFromText(rawText);
        if (storyFoes.length > 0) {
          declaredFoes = storyFoes;
          const foeNames = storyFoes.map((foe) => foe.name).join(' and ');
          summary = `Ready to begin an encounter against ${foeNames} so you can attack. Confirm to start combat setup, then declare the attack again after initiative.`;
        } else {
          summary =
            'Ready to begin an encounter so you can attack. Confirm to start combat setup, then declare the attack again after initiative.';
        }
      } else if (target === null) {
        const foeHint =
          foes
            .slice(0, 2)
            .map((foe) => foe.name)
            .join(' or ') || 'a foe in the encounter';
        summary = `Say who you attack (${foeHint}), then declare again.`;
        proposedCommandType = 'table.sync';
      } else {
        proposedCommandType = 'combat.attack';
        targetCombatantId = target.combatantId;
        summary = `Ready to attack ${target.name} with your weapon. Confirm to let the engine roll to hit and damage.`;
      }
    }
  }

  return {
    proposedCommandType,
    summary,
    authority,
    structured,
    ...(path !== undefined ? { path } : {}),
    ...(edgeId !== undefined ? { edgeId } : {}),
    ...(objectId !== undefined ? { objectId } : {}),
    ...(destinationHint !== undefined ? { destinationHint } : {}),
    ...(returnToPrevious === true ? { returnToPrevious: true } : {}),
    ...(premise !== undefined ? { premise } : {}),
    ...(targetCombatantId !== undefined ? { targetCombatantId } : {}),
    ...(spellId !== undefined ? { spellId } : {}),
    ...(itemId !== undefined ? { itemId } : {}),
    ...(declaredFoes !== undefined && declaredFoes.length > 0 ? { declaredFoes } : {}),
    ...(arcaneRecovery === true ? { arcaneRecovery: true } : {}),
    ...(deferDirectorNarrate ? { deferDirectorNarrate: true } : {}),
  };
}
