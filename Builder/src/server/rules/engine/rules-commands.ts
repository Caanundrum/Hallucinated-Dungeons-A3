import { randomInt, randomUUID } from 'node:crypto';

import type { Firestore, Timestamp, Transaction } from 'firebase-admin/firestore';

import type { Ability } from '../../../shared/character-contract.js';
import {
  TABLE_EVENT_PAGE_SIZE,
  type TableCommandAcceptResponse,
  type TableCommandType,
  type TableEventProjection,
  type TableEventType,
  type TableStateProjection,
} from '../../../shared/command-contract.js';
import { ERROR_CODES } from '../../../shared/contract.js';
import {
  TIMING_AUTHORITY_SCHEMA_VERSION,
  type TimingOpportunityClass,
} from '../../../shared/timing-authority-contract.js';
import type {
  AreaCell,
  CharacterProgressionProjection,
  CombatantProjection,
  DecisionWindowProjection,
  EncounterProjection,
  RulesCommandFields,
} from '../../../shared/rules-combat-contract.js';
import { COLLECTIONS } from '../../persistence/firestore.js';
import {
  requireTimingAuthority,
  supersedeIssuedActiveTurnAuthorities,
  writeCombatTurnAuthority,
} from '../../table/timing-authority.js';
import {
  applyDamage,
  applyHealing,
  resolveAttack,
  resolveDeathSave,
  resolveSavingThrow,
  type AttackResolution,
} from './adjudication.js';
import { applyCondition, expireConditions, removeCondition } from './conditions.js';
import { createSeededRandom, rollD20, rollDamage, type RandomSource } from './dice.js';
import {
  baseSheetFor,
  initialStoredProgression,
  loadCharacterRulesSource,
  loadEncounter,
  loadProgressionProjection,
  projectProgression,
  type StoredCharacterRulesSource,
  type StoredProgression,
} from './encounter-runtime.js';
import { spellAreaCells, spellEffect } from './spell-effects.js';
import { levelForExperience } from './xp-progression.js';

export const RULES_COMMAND_TYPES = [
  'encounter.begin',
  'initiative.roll',
  'encounter.next_turn',
  'encounter.end',
  'combat.attack',
  'combat.cast_spell',
  'combat.death_save',
  'combat.short_rest',
  'combat.long_rest',
  'combat.ready',
  'combat.reaction',
  'combat.training_drop',
  'progression.award_xp',
  'progression.level_up',
  'inventory.use_item',
] as const;
export type RulesCommandType = (typeof RULES_COMMAND_TYPES)[number];

const EVENT_FOR_COMMAND: Record<RulesCommandType, TableEventType> = {
  'encounter.begin': 'encounter.started',
  'initiative.roll': 'initiative.rolled',
  'encounter.next_turn': 'encounter.turn_advanced',
  'encounter.end': 'encounter.ended',
  'combat.attack': 'combat.attack_resolved',
  'combat.cast_spell': 'combat.spell_resolved',
  'combat.death_save': 'combat.death_save_resolved',
  'combat.short_rest': 'combat.short_rest_completed',
  'combat.long_rest': 'combat.long_rest_completed',
  'combat.ready': 'combat.ready_declared',
  'combat.reaction': 'combat.reaction_resolved',
  'combat.training_drop': 'combat.training_drop_resolved',
  'progression.award_xp': 'progression.xp_awarded',
  'progression.level_up': 'progression.level_gained',
  'inventory.use_item': 'inventory.item_used',
};

const ABILITIES: readonly Ability[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

export class RulesCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RulesCommandError';
    this.code = code;
  }
}

interface StoredSeat {
  readonly seatId: string;
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly characterId: string;
}

interface StoredTableProjection {
  readonly campaignId: string;
  readonly stateVersion: number;
  readonly lastEventSequence: number;
  readonly lastEventId: string | null;
  readonly updatedAt: Timestamp | Date | null;
  readonly tokenPositions?: readonly unknown[];
  readonly doorStates?: Readonly<Record<string, string>>;
  readonly exploredByAccount?: Readonly<Record<string, readonly string[]>>;
  readonly npcSpotlight?: import('../../../shared/table-contention-contract.js').NpcSpotlightProjection | null;
}

interface StoredCommand {
  readonly commandId: string;
  readonly campaignId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly commandType: TableCommandType;
  readonly actorAccountId: string;
  readonly seatId: string;
  readonly expectedStateVersion: number;
  readonly eventId: string;
  readonly acceptedAt: Timestamp | Date;
  readonly diceSeed: number;
}

interface StoredEvent {
  readonly eventId: string;
  readonly campaignId: string;
  readonly eventSequence: number;
  readonly eventType: TableEventType;
  readonly commandId: string;
  readonly requestId: string;
  readonly actorAccountId: string;
  readonly seatId: string;
  readonly priorStateVersion: number;
  readonly resultStateVersion: number;
  readonly committedAt: Timestamp | Date;
  readonly summary: string;
  readonly rolls: readonly number[];
}

interface RulesMutation {
  readonly encounter: EncounterProjection | null;
  readonly progression: StoredProgression;
  readonly summary: string;
  readonly rolls: readonly number[];
  readonly affectedCombatantIds: readonly string[];
  readonly areaCells: readonly AreaCell[];
  readonly reactionAuthority?: {
    readonly timingAuthorityId: string;
    readonly decisionWindowId: string;
  };
}

function isRulesCommandType(commandType: TableCommandType): commandType is RulesCommandType {
  return (RULES_COMMAND_TYPES as readonly string[]).includes(commandType);
}

function toIso(value: Timestamp | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

function eventProjection(event: StoredEvent): TableEventProjection {
  return {
    eventId: event.eventId,
    eventSequence: event.eventSequence,
    eventType: event.eventType,
    commandId: event.commandId,
    requestId: event.requestId,
    actorAccountId: event.actorAccountId,
    seatId: event.seatId,
    priorStateVersion: event.priorStateVersion,
    resultStateVersion: event.resultStateVersion,
    committedAt: toIso(event.committedAt) ?? new Date(0).toISOString(),
    summary: event.summary,
    rolls: event.rolls,
  };
}

async function recentEvents(
  firestore: Firestore,
  campaignId: string,
): Promise<TableEventProjection[]> {
  const snapshot = await firestore
    .collection(COLLECTIONS.campaignEvents)
    .where('campaignId', '==', campaignId)
    .limit(200)
    .get();
  return snapshot.docs
    .map((doc) => eventProjection(doc.data() as StoredEvent))
    .sort((left, right) => left.eventSequence - right.eventSequence)
    .slice(-TABLE_EVENT_PAGE_SIZE);
}

function tableProjection(
  campaignId: string,
  stored: StoredTableProjection,
  events: readonly TableEventProjection[],
): TableStateProjection {
  return {
    campaignId,
    stateVersion: stored.stateVersion ?? 0,
    lastEventSequence: stored.lastEventSequence ?? 0,
    lastEventId: stored.lastEventId ?? null,
    updatedAt: toIso(stored.updatedAt),
    recentEvents: events,
    npcSpotlight: stored.npcSpotlight ?? null,
  };
}

function emptyTableProjection(campaignId: string): StoredTableProjection {
  return {
    campaignId,
    stateVersion: 0,
    lastEventSequence: 0,
    lastEventId: null,
    updatedAt: null,
    tokenPositions: [],
    doorStates: {},
    exploredByAccount: {},
  };
}

/** Coalesce legacy/migrated table docs that omit version fields (PQA-082/083). */
function normalizeStoredTableProjection(
  campaignId: string,
  stored: Partial<StoredTableProjection> | null | undefined,
): StoredTableProjection {
  const empty = emptyTableProjection(campaignId);
  if (stored === null || stored === undefined) {
    return empty;
  }
  return {
    ...empty,
    ...stored,
    campaignId,
    stateVersion: typeof stored.stateVersion === 'number' ? stored.stateVersion : 0,
    lastEventSequence:
      typeof stored.lastEventSequence === 'number' ? stored.lastEventSequence : 0,
    lastEventId: typeof stored.lastEventId === 'string' ? stored.lastEventId : null,
  };
}

async function assertCampaignMember(
  firestore: Firestore,
  accountId: string,
  campaignId: string,
): Promise<void> {
  const membership = await firestore
    .collection(COLLECTIONS.campaignMemberships)
    .where('campaignId', '==', campaignId)
    .where('accountId', '==', accountId)
    .limit(1)
    .get();
  if (membership.empty) {
    throw new RulesCommandError(ERROR_CODES.NOT_FOUND, 'No such route.');
  }
}

async function loadOwnSeat(
  firestore: Firestore,
  accountId: string,
  campaignId: string,
): Promise<StoredSeat> {
  const snapshot = await firestore
    .collection(COLLECTIONS.campaignSeats)
    .where('campaignId', '==', campaignId)
    .where('ownerAccountId', '==', accountId)
    .limit(1)
    .get();
  if (snapshot.empty) {
    throw new RulesCommandError(
      ERROR_CODES.NOT_SEATED,
      'Seat a character you own before submitting rules commands.',
    );
  }
  return snapshot.docs[0]!.data() as StoredSeat;
}

function actionEconomy() {
  return {
    actionAvailable: true,
    bonusActionAvailable: true,
    reactionAvailable: true,
    movementRemainingFeet: 30,
    deathSaveAvailable: false,
  } as const;
}

function dyingActionEconomy(deathSaveAvailable: boolean) {
  return {
    actionAvailable: false,
    bonusActionAvailable: false,
    reactionAvailable: false,
    movementRemainingFeet: 0,
    deathSaveAvailable,
  } as const;
}

function emptyDeathSaves() {
  return { successes: 0, failures: 0, stable: false, dead: false } as const;
}

function withDamageModifier(expression: string, modifier: number): string {
  if (modifier === 0) return expression;
  return `${expression}${modifier > 0 ? '+' : ''}${modifier}`;
}

function buildPlayerCombatant(
  source: StoredCharacterRulesSource,
  progression: CharacterProgressionProjection,
  seat: StoredSeat,
): CombatantProjection {
  const sheet = progression.sheet;
  const weaponModifier = Math.max(sheet.abilityModifiers.strength, sheet.abilityModifiers.dexterity);
  const attacks = sheet.attacks.map((attack, index) => ({
    attackId: `sheet-attack-${index}`,
    label: attack.name,
    attackBonus: attack.attackBonus.value,
    damageExpression: withDamageModifier(attack.damage, weaponModifier),
    damageType: attack.damageType,
    reachFeet: attack.properties.some((property) => property.includes('Range')) ? 60 : 5,
  }));
  if (attacks.length === 0) {
    attacks.push({
      attackId: 'unarmed-strike',
      label: 'Unarmed Strike',
      attackBonus: progression.derived.proficiencyBonus + sheet.abilityModifiers.strength,
      damageExpression: `${Math.max(1, 1 + sheet.abilityModifiers.strength)}`,
      damageType: 'bludgeoning',
      reachFeet: 5,
    });
  }
  const savingThrowBonuses = Object.fromEntries(
    ABILITIES.map((ability) => [ability, sheet.savingThrows[ability].value]),
  ) as Record<Ability, number>;
  const spellSlots = progression.derived.spellSlots;
  return {
    combatantId: `character:${source.characterId}`,
    characterId: source.characterId,
    seatId: seat.seatId,
    name: source.choices.identity.name,
    side: 'party',
    level: progression.level,
    position: { column: 1, row: 1, elevationFeet: 0 },
    armorClass: sheet.armorClass.value,
    baseArmorClass: sheet.armorClass.value,
    maxHitPoints: progression.derived.maxHitPoints,
    currentHitPoints: progression.derived.maxHitPoints,
    temporaryHitPoints: 0,
    hitDiceRemaining: progression.level,
    initiativeBonus: sheet.initiative.value,
    initiative: null,
    savingThrowBonuses,
    conditions: [],
    deathSaves: emptyDeathSaves(),
    actionEconomy: actionEconomy(),
    attacks,
    spellSaveDc: sheet.spellcasting?.spellSaveDc.value ?? null,
    spellAttackBonus: sheet.spellcasting?.spellAttackBonus.value ?? null,
    spellcastingAbilityModifier:
      sheet.spellcasting === null ? 0 : sheet.abilityModifiers[sheet.spellcasting.ability],
    spellResources: {
      maximumSlots: spellSlots,
      remainingSlots: spellSlots,
    },
    concentrationSpellId: null,
    inventory: [{ itemId: 'healing-potion', label: 'Potion of Healing', quantity: 2 }],
    ready: null,
  };
}

function foe(
  combatantId: string,
  name: string,
  position: { column: number; row: number; elevationFeet: number },
  armorClass: number,
  hitPoints: number,
  initiativeBonus: number,
  attackBonus: number,
  damageExpression: string,
): CombatantProjection {
  return {
    combatantId,
    characterId: null,
    seatId: null,
    name,
    side: 'foe',
    level: 1,
    position,
    armorClass,
    baseArmorClass: armorClass,
    maxHitPoints: hitPoints,
    currentHitPoints: hitPoints,
    temporaryHitPoints: 0,
    hitDiceRemaining: 1,
    initiativeBonus,
    initiative: null,
    savingThrowBonuses: {
      strength: 0,
      dexterity: initiativeBonus,
      constitution: 0,
      intelligence: -1,
      wisdom: 0,
      charisma: -1,
    },
    conditions: [],
    deathSaves: emptyDeathSaves(),
    actionEconomy: actionEconomy(),
    attacks: [{
      attackId: 'training-weapon',
      label: name === 'Practice Goblin' ? 'Practice Scimitar' : 'Padded Slam',
      attackBonus,
      damageExpression,
      damageType: 'bludgeoning',
      reachFeet: 5,
    }],
    spellSaveDc: null,
    spellAttackBonus: null,
    spellcastingAbilityModifier: 0,
    spellResources: { maximumSlots: [], remainingSlots: [] },
    concentrationSpellId: null,
    inventory: [],
    ready: null,
  };
}

function findActor(encounter: EncounterProjection, seatId: string): CombatantProjection {
  const actor = encounter.combatants.find((combatant) => combatant.seatId === seatId);
  if (actor === undefined) {
    throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'Your seated character is not in this encounter.');
  }
  return actor;
}

function requireEncounter(encounter: EncounterProjection | null): EncounterProjection {
  if (encounter === null) {
    throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'Begin an encounter first.');
  }
  return encounter;
}

/** Rests, XP awards, and level-ups belong outside active initiative. */
function requireOutOfCombat(
  encounter: EncounterProjection | null,
  actionLabel: string,
): void {
  if (encounter !== null && (encounter.status === 'active' || encounter.status === 'setup')) {
    throw new RulesCommandError(
      ERROR_CODES.BAD_REQUEST,
      `${actionLabel} is unavailable while an encounter is in progress. End combat first.`,
    );
  }
}

function livingFoes(encounter: EncounterProjection): readonly CombatantProjection[] {
  return encounter.combatants.filter(
    (combatant) =>
      combatant.side === 'foe' &&
      combatant.currentHitPoints > 0 &&
      !combatant.deathSaves.dead,
  );
}

function endEncounterIfFoesDefeated(
  encounter: EncounterProjection,
): EncounterProjection {
  if (encounter.status !== 'active') {
    return encounter;
  }
  if (livingFoes(encounter).length > 0) {
    return encounter;
  }
  return {
    ...encounter,
    status: 'ended',
    activeCombatantId: null,
    decisionWindows: encounter.decisionWindows.map((window) =>
      window.state === 'open' ? { ...window, state: 'expired' } : window,
    ),
  };
}

function formatAttackSummary(options: {
  readonly attackerName: string;
  readonly targetName: string;
  readonly attackLabel: string;
  readonly attackBonus: number;
  readonly armorClass: number;
  readonly resolution: AttackResolution;
  readonly attackRolls: readonly number[];
}): string {
  const {
    attackerName,
    targetName,
    attackLabel,
    attackBonus,
    armorClass,
    resolution,
    attackRolls,
  } = options;
  const natural = attackRolls[0];
  const rollPart =
    typeof natural === 'number'
      ? ` (d20 ${natural}${attackBonus >= 0 ? '+' : ''}${attackBonus}=${resolution.attackTotal} vs AC ${armorClass})`
      : ` (total ${resolution.attackTotal} vs AC ${armorClass})`;
  if (!resolution.hit) {
    return `${attackerName} missed ${targetName} with ${attackLabel}${rollPart}.`;
  }
  return `${attackerName} hit ${targetName} with ${attackLabel}${rollPart} for ${resolution.damage} damage${
    resolution.critical ? ' (critical hit)' : ''
  }.`;
}

function requireActiveActor(encounter: EncounterProjection, seatId: string): CombatantProjection {
  if (encounter.status !== 'active') {
    throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'Roll initiative before taking combat actions.');
  }
  const actor = findActor(encounter, seatId);
  if (encounter.activeCombatantId !== actor.combatantId) {
    throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'It is not your combatant’s turn.');
  }
  if (!actor.actionEconomy.actionAvailable) {
    throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'This combatant has already spent its action.');
  }
  if (actor.currentHitPoints === 0 || actor.deathSaves.dead) {
    throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'This combatant cannot take that action at 0 Hit Points.');
  }
  return actor;
}

function requireActiveCombatantForEndTurn(
  encounter: EncounterProjection | null,
  seatId: string,
): void {
  const current = requireEncounter(encounter);
  if (current.status !== 'active') {
    throw new RulesCommandError(
      ERROR_CODES.BAD_REQUEST,
      'No active initiative order can advance.',
    );
  }
  const active =
    current.combatants.find((combatant) => combatant.combatantId === current.activeCombatantId) ??
    null;
  if (active === null) {
    throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'No active combatant is set.');
  }
  if (active.side === 'foe') {
    return;
  }
  if (active.seatId !== seatId) {
    throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'It is not your turn.');
  }
}

const RULES_SETUP_COMMANDS = new Set<RulesCommandType>([
  'encounter.begin',
  'initiative.roll',
  'encounter.end',
]);

async function requireRulesCommandTimingAuthority(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
  readonly seatId: string;
  readonly timingAuthorityId: string | undefined;
  readonly commandType: RulesCommandType;
  readonly encounter: EncounterProjection | null;
}): Promise<void> {
  const { commandType, encounter, seatId, ...authorityOptions } = options;
  if (RULES_SETUP_COMMANDS.has(commandType)) {
    return;
  }
  if (commandType === 'encounter.next_turn') {
    requireActiveCombatantForEndTurn(encounter, seatId);
    const active =
      encounter?.combatants.find(
        (combatant) => combatant.combatantId === encounter.activeCombatantId,
      ) ?? null;
    if (active?.side === 'foe') {
      return;
    }
  }
  await requireTimingAuthority({
    ...authorityOptions,
    seatId,
    commandType,
    consume: false,
  });
}

async function issueAuthorityForActivePartyCombatant(options: {
  readonly transaction: Transaction;
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly encounter: EncounterProjection;
  readonly projectionVersion: number;
  readonly committedAt: Date;
}): Promise<void> {
  const { transaction, firestore, campaignId, encounter, projectionVersion, committedAt } =
    options;
  const active =
    encounter.combatants.find(
      (combatant) => combatant.combatantId === encounter.activeCombatantId,
    ) ?? null;
  if (
    active === null ||
    active.side !== 'party' ||
    active.seatId === null ||
    active.characterId === null
  ) {
    return;
  }
  const seatSnap = await transaction.get(
    firestore.collection(COLLECTIONS.campaignSeats).doc(active.seatId),
  );
  if (!seatSnap.exists) {
    return;
  }
  const seat = seatSnap.data() as { ownerAccountId: string; characterId: string };
  await supersedeIssuedActiveTurnAuthorities({
    transaction,
    firestore,
    campaignId,
    now: committedAt,
  });
  writeCombatTurnAuthority({
    transaction,
    firestore,
    campaignId,
    seatId: active.seatId,
    characterId: seat.characterId,
    accountId: seat.ownerAccountId,
    encounterId: encounter.encounterId,
    projectionVersion,
    issuedAt: committedAt,
  });
}

function replaceCombatants(
  encounter: EncounterProjection,
  replacements: readonly CombatantProjection[],
): EncounterProjection {
  const byId = new Map(replacements.map((combatant) => [combatant.combatantId, combatant]));
  return {
    ...encounter,
    combatants: encounter.combatants.map(
      (combatant) => byId.get(combatant.combatantId) ?? combatant,
    ),
  };
}

function spendAction(combatant: CombatantProjection): CombatantProjection {
  return {
    ...combatant,
    actionEconomy: { ...combatant.actionEconomy, actionAvailable: false },
  };
}

function spendSlot(combatant: CombatantProjection, spellLevel: number): CombatantProjection {
  if (spellLevel === 0) return combatant;
  const slotIndex = spellLevel - 1;
  const remaining = [...combatant.spellResources.remainingSlots];
  if ((remaining[slotIndex] ?? 0) < 1) {
    throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'No spell slot remains at that level.');
  }
  remaining[slotIndex] = remaining[slotIndex]! - 1;
  return {
    ...combatant,
    spellResources: { ...combatant.spellResources, remainingSlots: remaining },
  };
}

function targetById(encounter: EncounterProjection, targetCombatantId: string | undefined) {
  if (typeof targetCombatantId !== 'string') {
    throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'Choose a combat target.');
  }
  const target = encounter.combatants.find(
    (combatant) => combatant.combatantId === targetCombatantId,
  );
  if (target === undefined || target.deathSaves.dead) {
    throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'That combat target is not available.');
  }
  return target;
}

function appendLog(
  encounter: EncounterProjection,
  commandType: RulesCommandType,
  summary: string,
  rolls: readonly number[],
): EncounterProjection {
  return {
    ...encounter,
    log: [
      ...encounter.log,
      { sequence: encounter.log.length + 1, commandType, summary, rolls },
    ].slice(-50),
  };
}

function cantripExpression(expression: string, level: number): string {
  const count = level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
  return expression.replace(/^1d/, `${count}d`);
}

function resolveConcentration(
  prior: CombatantProjection,
  damaged: CombatantProjection,
  damage: number,
  rng: RandomSource,
): { combatant: CombatantProjection; rolls: readonly number[] } {
  if (prior.concentrationSpellId === null || damage <= 0 || damaged.currentHitPoints === 0) {
    return { combatant: damaged, rolls: [] };
  }
  const save = resolveSavingThrow({
    combatant: damaged,
    ability: 'constitution',
    difficultyClass: Math.max(10, Math.floor(damage / 2)),
    rng,
  });
  return {
    combatant: save.success ? damaged : { ...damaged, concentrationSpellId: null },
    rolls: save.rolls,
  };
}

function mutateRules(options: {
  readonly commandType: RulesCommandType;
  readonly encounter: EncounterProjection | null;
  readonly progression: StoredProgression;
  readonly source: StoredCharacterRulesSource;
  readonly seat: StoredSeat;
  readonly fields: RulesCommandFields;
  readonly rng: RandomSource;
  readonly now: Date;
  readonly idSource: string;
}): RulesMutation {
  const { commandType, fields, rng, source, seat, now, idSource } = options;
  let encounter = options.encounter;
  let progression = options.progression;
  let summary = '';
  let rolls: number[] = [];
  let affectedCombatantIds: string[] = [];
  let areaCells: readonly AreaCell[] = [];
  let reactionAuthority: RulesMutation['reactionAuthority'];

  if (commandType === 'encounter.begin') {
    // Session Zero must be recorded before live combat training starts.
    // Soft exploration at the table remains available before seating gates apply.
    if (encounter !== null && encounter.status !== 'ended') {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'An encounter is already in progress.');
    }
    const player = buildPlayerCombatant(source, projectProgression(source, progression), seat);
    encounter = {
      encounterId: `encounter:${idSource}`,
      campaignId: seat.campaignId,
      stateVersion: 0,
      status: 'setup',
      round: 0,
      turnIndex: 0,
      activeCombatantId: null,
      initiativeOrder: [],
      combatants: [
        player,
        foe(
          'training-dummy',
          'Training Dummy',
          { column: 3, row: 1, elevationFeet: 0 },
          10,
          20,
          0,
          2,
          '1',
        ),
        foe(
          'practice-goblin',
          'Practice Goblin',
          { column: 2, row: 1, elevationFeet: 0 },
          13,
          12,
          2,
          6,
          '2d6+2',
        ),
      ],
      areaCells: [],
      decisionWindows: [],
      log: [],
      updatedAt: now.toISOString(),
    };
    summary = `${player.name} faces a Training Dummy and a Practice Goblin for rules practice — practice foes with no story arrival. Two Potions of Healing were added to ${player.name}’s inventory.`;
    affectedCombatantIds = encounter.combatants.map((combatant) => combatant.combatantId);
  } else if (commandType === 'initiative.roll') {
    const current = requireEncounter(encounter);
    if (current.status !== 'setup') {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'Initiative has already been rolled.');
    }
    const combatants = current.combatants.map((combatant) => {
      const roll = rollD20('normal', combatant.initiativeBonus, rng);
      rolls.push(...roll.rolls);
      return { ...combatant, initiative: roll.total, actionEconomy: actionEconomy() };
    });
    const initiativeOrder = [...combatants]
      .sort(
        (left, right) =>
          (right.initiative ?? 0) - (left.initiative ?? 0) ||
          right.initiativeBonus - left.initiativeBonus ||
          left.combatantId.localeCompare(right.combatantId),
      )
      .map((combatant) => combatant.combatantId);
    encounter = {
      ...current,
      status: 'active',
      round: 1,
      turnIndex: 0,
      activeCombatantId: initiativeOrder[0] ?? null,
      initiativeOrder,
      combatants,
    };
    summary = `Initiative order: ${initiativeOrder
      .map((id) => {
        const combatant = combatants.find((entry) => entry.combatantId === id);
        if (combatant === undefined) {
          return id;
        }
        const side =
          combatant.side === 'foe'
            ? 'hostile practice'
            : combatant.side === 'party'
              ? 'party'
              : combatant.side;
        return `${combatant.name} (${side}, HP ${combatant.currentHitPoints}/${combatant.maxHitPoints})`;
      })
      .join('; ')}.`;
    affectedCombatantIds = initiativeOrder;
  } else if (commandType === 'encounter.next_turn') {
    const current = requireEncounter(encounter);
    if (current.status !== 'active' || current.initiativeOrder.length === 0) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'No active initiative order can advance.');
    }
    const livingOrder = current.initiativeOrder.filter((combatantId) => {
      const combatant = current.combatants.find((entry) => entry.combatantId === combatantId);
      return (
        combatant !== undefined &&
        combatant.currentHitPoints > 0 &&
        !combatant.deathSaves.dead
      );
    });
    if (livingOrder.length === 0 || livingFoes(current).length === 0) {
      encounter = {
        ...current,
        status: 'ended',
        activeCombatantId: null,
        decisionWindows: current.decisionWindows.map((window) =>
          window.state === 'open' ? { ...window, state: 'expired' as const } : window,
        ),
      };
      summary =
        livingFoes(current).length === 0
          ? 'Encounter ended — all foes are defeated.'
          : 'Encounter ended — no living combatants remain in initiative.';
      affectedCombatantIds = [];
    } else {
      const previousActive = current.activeCombatantId;
      const previousLivingIndex =
        previousActive === null ? -1 : livingOrder.indexOf(previousActive);
      const nextLivingIndex = (previousLivingIndex + 1) % livingOrder.length;
      const advancedRound =
        previousLivingIndex >= 0 && nextLivingIndex <= previousLivingIndex
          ? current.round + 1
          : Math.max(1, current.round);
      const activeCombatantId = livingOrder[nextLivingIndex]!;
      let combatants = current.combatants.map((combatant) => {
        const expired = expireConditions(combatant.conditions, advancedRound);
        if (combatant.combatantId !== activeCombatantId) {
          return {
            ...combatant,
            conditions: expired,
            ready: combatant.combatantId === previousActive ? null : combatant.ready,
          };
        }
        const shieldExpired = expired.some((condition) => condition.conditionId === 'shielded');
        return {
          ...combatant,
          armorClass: shieldExpired ? combatant.baseArmorClass : combatant.armorClass,
          conditions: removeCondition(expired, 'shielded'),
          actionEconomy: actionEconomy(),
          ready: null,
        };
      });
      const decisionWindows = current.decisionWindows.map((window) =>
        window.state === 'open' && window.eligibleCombatantId === previousActive
          ? { ...window, state: 'expired' as const }
          : window,
      );
      let active = combatants.find((combatant) => combatant.combatantId === activeCombatantId)!;
      summary = `Round ${advancedRound}: ${active.name} is active.`;
      affectedCombatantIds = [activeCombatantId];
      if (active.side === 'foe' && active.currentHitPoints > 0) {
        const partyTarget = combatants.find(
          (combatant) =>
            combatant.side === 'party' &&
            combatant.currentHitPoints > 0 &&
            !combatant.deathSaves.dead,
        );
        if (partyTarget !== undefined) {
          const attack = resolveAttack({ attacker: active, target: partyTarget, rng });
          rolls.push(...attack.rolls);
          active = spendAction(active);
          const foeAttack = active.attacks[0]!;
          const nonlethalTarget =
            attack.target.currentHitPoints === 0
              ? {
                  ...attack.target,
                  currentHitPoints: 1,
                  conditions: removeCondition(attack.target.conditions, 'unconscious'),
                  deathSaves: emptyDeathSaves(),
                }
              : attack.target;
          combatants = combatants.map((combatant) =>
            combatant.combatantId === active.combatantId
              ? active
              : combatant.combatantId === partyTarget.combatantId
                ? nonlethalTarget
                : combatant,
          );
          summary += ` ${formatAttackSummary({
            attackerName: active.name,
            targetName: partyTarget.name,
            attackLabel: `${foeAttack.label} (nonlethal training)`,
            attackBonus: foeAttack.attackBonus,
            armorClass: partyTarget.armorClass,
            resolution: { ...attack, target: nonlethalTarget },
            attackRolls: attack.rolls,
          })}`;
          if (
            attack.target.currentHitPoints === 0 &&
            nonlethalTarget.currentHitPoints === 1
          ) {
            summary +=
              ' Training safeguard: damage that would drop the character to 0 instead leaves them at 1 Hit Point.';
          }
          affectedCombatantIds.push(partyTarget.combatantId);
        }
      }
      encounter = endEncounterIfFoesDefeated({
        ...current,
        turnIndex: nextLivingIndex,
        round: advancedRound,
        activeCombatantId,
        combatants,
        decisionWindows,
        initiativeOrder: livingOrder,
      });
      if (encounter.status === 'ended') {
        summary += ' Encounter ended — all foes are defeated.';
      }
    }
  } else if (commandType === 'encounter.end') {
    const current = requireEncounter(encounter);
    if (current.status === 'ended') {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'This encounter is already ended.');
    }
    encounter = {
      ...current,
      status: 'ended',
      activeCombatantId: null,
      decisionWindows: current.decisionWindows.map((window) =>
        window.state === 'open' ? { ...window, state: 'expired' as const } : window,
      ),
    };
    summary = 'Encounter ended by the table. Combatants remain for recovery and rests.';
    affectedCombatantIds = current.combatants.map((combatant) => combatant.combatantId);
  } else if (commandType === 'combat.attack') {
    const current = requireEncounter(encounter);
    const actor = requireActiveActor(current, seat.seatId);
    const target = targetById(current, fields.targetCombatantId);
    if (target.side === actor.side) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'An attack must target the opposing side.');
    }
    if (target.currentHitPoints <= 0 || target.conditions.some((c) => c.conditionId === 'unconscious')) {
      throw new RulesCommandError(
        ERROR_CODES.BAD_REQUEST,
        `${target.name} is already defeated. Choose another target or end the encounter.`,
      );
    }
    const chosenAttack =
      actor.attacks.find((entry) => entry.attackId === fields.attackId) ?? actor.attacks[0];
    if (chosenAttack === undefined) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'No attack is available.');
    }
    const resolution = resolveAttack({
      attacker: actor,
      target,
      ...(fields.attackId === undefined ? {} : { attackId: fields.attackId }),
      rng,
    });
    const concentration = resolveConcentration(target, resolution.target, resolution.damage, rng);
    encounter = endEncounterIfFoesDefeated(
      replaceCombatants(current, [spendAction(actor), concentration.combatant]),
    );
    rolls.push(...resolution.rolls, ...concentration.rolls);
    summary = formatAttackSummary({
      attackerName: actor.name,
      targetName: target.name,
      attackLabel: chosenAttack.label,
      attackBonus: chosenAttack.attackBonus,
      armorClass: target.armorClass,
      resolution,
      attackRolls: resolution.rolls,
    });
    if (encounter.status === 'ended') {
      summary += ' Encounter ended — all foes are defeated.';
    }
    affectedCombatantIds = [actor.combatantId, target.combatantId];
  } else if (commandType === 'combat.cast_spell') {
    const current = requireEncounter(encounter);
    let actor = requireActiveActor(current, seat.seatId);
    if (typeof fields.spellId !== 'string') {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'Choose a spell.');
    }
    const effect = spellEffect(fields.spellId);
    const availableSpells = [...source.choices.cantripIds, ...source.choices.spellIds];
    if (!availableSpells.includes(effect.spellId)) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, `${actor.name} does not know or have ${effect.label} prepared.`);
    }
    if (effect.spellId === 'shield') {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'Shield is cast only through an open reaction window.');
    }
    actor = spendAction(spendSlot(actor, effect.level));
    const replacements: CombatantProjection[] = [actor];

    if (effect.targetKind === 'area') {
      if (fields.area === undefined) {
        throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, `${effect.label} requires area placement.`);
      }
      areaCells = spellAreaCells(effect.spellId, fields.area);
      const targets = current.combatants.filter(
        (combatant) =>
          combatant.side !== actor.side &&
          areaCells.some(
            (cell) =>
              cell.column === combatant.position.column &&
              cell.row === combatant.position.row &&
              cell.elevationFeet === combatant.position.elevationFeet,
          ),
      );
      const damageRoll = rollDamage(effect.damageExpression!, rng);
      rolls.push(...damageRoll.rolls);
      for (const target of targets) {
        const save = resolveSavingThrow({
          combatant: target,
          ability: effect.saveAbility!,
          difficultyClass: actor.spellSaveDc ?? 10,
          rng,
        });
        rolls.push(...save.rolls);
        const damage =
          save.success && effect.halfDamageOnSave ? Math.floor(damageRoll.total / 2) :
          save.success ? 0 : damageRoll.total;
        const damaged = applyDamage(target, damage);
        const concentration = resolveConcentration(target, damaged, damage, rng);
        rolls.push(...concentration.rolls);
        replacements.push(concentration.combatant);
      }
      summary = `${actor.name} cast ${effect.label} across ${areaCells.length} cells, affecting ${targets.length} combatant(s).`;
      affectedCombatantIds = [actor.combatantId, ...targets.map((target) => target.combatantId)];
    } else {
      const selectedTarget =
        effect.targetKind === 'self'
          ? actor
          : targetById(current, fields.targetCombatantId);
      const target =
        selectedTarget.combatantId === actor.combatantId ? actor : selectedTarget;
      if (effect.resolution === 'healing') {
        const healingRoll = rollDamage(effect.healingExpression!, rng);
        const healing = healingRoll.total + actor.spellcastingAbilityModifier;
        rolls.push(...healingRoll.rolls);
        replacements.push(applyHealing(target, healing));
        summary = `${actor.name} cast ${effect.label}, healing ${target.name} for ${healing} Hit Points.`;
      } else if (effect.resolution === 'attack') {
        const attackRoll = rollD20('normal', actor.spellAttackBonus ?? 0, rng);
        rolls.push(...attackRoll.rolls);
        const hit = attackRoll.natural !== 1 && (attackRoll.natural === 20 || attackRoll.total >= target.armorClass);
        let damage = 0;
        let updatedTarget = target;
        if (hit) {
          const expression =
            effect.level === 0
              ? cantripExpression(effect.damageExpression!, actor.level)
              : effect.damageExpression!;
          const damageRoll = rollDamage(expression, rng);
          rolls.push(...damageRoll.rolls);
          damage = damageRoll.total;
          updatedTarget = applyDamage(target, damage, { critical: attackRoll.natural === 20 });
          if (effect.spellId === 'guiding-bolt' && updatedTarget.currentHitPoints > 0) {
            updatedTarget = {
              ...updatedTarget,
              conditions: applyCondition(
                updatedTarget.conditions,
                'guiding-bolt-marked',
                effect.label,
                current.round + 1,
              ),
            };
          }
          const concentration = resolveConcentration(target, updatedTarget, damage, rng);
          rolls.push(...concentration.rolls);
          updatedTarget = concentration.combatant;
        }
        replacements.push(updatedTarget);
        summary = hit
          ? `${actor.name} cast ${effect.label} and dealt ${damage} ${effect.damageType} damage to ${target.name}.`
          : `${actor.name} cast ${effect.label} but missed ${target.name}.`;
      } else if (effect.resolution === 'save') {
        const save = resolveSavingThrow({
          combatant: target,
          ability: effect.saveAbility!,
          difficultyClass: actor.spellSaveDc ?? 10,
          rng,
        });
        const damageRoll = rollDamage(
          effect.level === 0
            ? cantripExpression(effect.damageExpression!, actor.level)
            : effect.damageExpression!,
          rng,
        );
        const damage = save.success ? 0 : damageRoll.total;
        rolls.push(...save.rolls, ...damageRoll.rolls);
        replacements.push(applyDamage(target, damage));
        summary = save.success
          ? `${target.name} succeeded on the save against ${effect.label}.`
          : `${actor.name} dealt ${damage} ${effect.damageType} damage to ${target.name} with ${effect.label}.`;
      } else {
        actor = { ...actor, concentrationSpellId: effect.concentration ? effect.spellId : actor.concentrationSpellId };
        replacements[0] = actor;
        summary = `${actor.name} cast ${effect.label}${effect.concentration ? ' and began concentrating' : ''}.`;
      }
      affectedCombatantIds = [actor.combatantId, target.combatantId];
    }
    encounter = { ...replaceCombatants(current, replacements), areaCells };
  } else if (commandType === 'combat.death_save') {
    const current = requireEncounter(encounter);
    const actor = findActor(current, seat.seatId);
    if (current.activeCombatantId !== actor.combatantId) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'Death Saving Throws occur on the combatant’s turn.');
    }
    if (actor.currentHitPoints !== 0) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'Death Saving Throws are only for combatants at 0 Hit Points.');
    }
    if (actor.deathSaves.dead) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'That combatant is already dead.');
    }
    if (actor.deathSaves.stable) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'That combatant is already stable.');
    }
    if (actor.actionEconomy.deathSaveAvailable !== true) {
      throw new RulesCommandError(
        ERROR_CODES.BAD_REQUEST,
        'This combatant has already made a Death Saving Throw this turn.',
      );
    }
    let result: ReturnType<typeof resolveDeathSave>;
    try {
      result = resolveDeathSave(actor, rng);
    } catch (failure) {
      throw new RulesCommandError(
        ERROR_CODES.BAD_REQUEST,
        failure instanceof Error ? failure.message : 'Death Saving Throw could not be resolved.',
      );
    }
    rolls.push(result.natural);
    const afterSave = {
      ...result.combatant,
      actionEconomy:
        result.combatant.currentHitPoints > 0
          ? actionEconomy()
          : dyingActionEconomy(false),
    };
    encounter = replaceCombatants(current, [afterSave]);
    summary = `${actor.name} rolled ${result.natural}: Death Save ${result.outcome.replace('_', ' ')}.`;
    affectedCombatantIds = [actor.combatantId];
  } else if (commandType === 'combat.training_drop') {
    const current = requireEncounter(encounter);
    const hasTrainingFoes = current.combatants.some(
      (combatant) =>
        combatant.combatantId === 'training-dummy' || combatant.combatantId === 'practice-goblin',
    );
    if (!hasTrainingFoes) {
      throw new RulesCommandError(
        ERROR_CODES.BAD_REQUEST,
        'Training drop is only available in the local Training Dummy encounter.',
      );
    }
    const actor = requireActiveActor(current, seat.seatId);
    if (actor.currentHitPoints === 0) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'That combatant is already at 0 Hit Points.');
    }
    const dropped = spendAction(
      applyDamage(actor, actor.currentHitPoints + actor.temporaryHitPoints),
    );
    const forDeathPractice = {
      ...dropped,
      actionEconomy: dyingActionEconomy(true),
    };
    encounter = replaceCombatants(current, [forDeathPractice]);
    summary = `${actor.name} used the training control to drop to 0 Hit Points for Death Save practice.`;
    affectedCombatantIds = [actor.combatantId];
  } else if (commandType === 'combat.short_rest') {
    requireOutOfCombat(encounter, 'A Short Rest');
    const projected = projectProgression(source, progression);
    const sheet = projected.sheet;
    const resourceRemaining: Record<string, number> = {
      ...(progression.resourceRemaining ?? {}),
    };
    for (const resource of sheet.classResources ?? []) {
      if (/short rest/i.test(resource.recharge)) {
        resourceRemaining[resource.id] = resource.maximum;
      }
    }
    let healing = 0;
    let healingRolls: number[] = [];
    const maxHp = sheet.hitPoints.value;
    const currentHp =
      typeof progression.hitPointsCurrent === 'number'
        ? progression.hitPointsCurrent
        : sheet.hitPointsCurrent;
    // Prefer encounter combatant when one exists (ended fight); otherwise rest from sheet trackers.
    if (encounter !== null) {
      const current = requireEncounter(encounter);
      const actor = findActor(current, seat.seatId);
      if (actor.deathSaves.dead) {
        throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'A dead combatant cannot take a Short Rest.');
      }
      if (actor.hitDiceRemaining < 1) {
        throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'No Hit Dice remain for a Short Rest.');
      }
      const hitDie = Number(/d(\d+)/.exec(projected.derived.hitDice)?.[1] ?? 8);
      const healingRoll = rollDamage(`1d${hitDie}`, rng);
      healing = Math.max(0, healingRoll.total + baseSheetFor(source).abilityModifiers.constitution);
      healingRolls = [...healingRoll.rolls];
      rolls.push(...healingRolls);
      const beforeHp = actor.currentHitPoints;
      const healed = applyHealing(actor, healing);
      const effective = healed.currentHitPoints - beforeHp;
      const rested = {
        ...healed,
        hitDiceRemaining: actor.hitDiceRemaining - 1,
      };
      encounter = replaceCombatants(current, [rested]);
      progression = {
        ...progression,
        updatedAt: now.toISOString(),
        hitPointsCurrent: rested.currentHitPoints,
        resourceRemaining,
      };
      summary =
        effective === healing
          ? `${actor.name} completed a Short Rest and recovered ${effective} Hit Points. Short-rest class resources recharged.`
          : `${actor.name} completed a Short Rest and recovered ${effective} Hit Points (rolled ${healing}; capped at maximum). Short-rest class resources recharged.`;
      affectedCombatantIds = [actor.combatantId];
    } else {
      // Exploration rest (no encounter record): recharge short-rest resources and heal with one Hit Die.
      const hitDie = Number(/d(\d+)/.exec(projected.derived.hitDice)?.[1] ?? 8);
      const healingRoll = rollDamage(`1d${hitDie}`, rng);
      healing = Math.max(0, healingRoll.total + baseSheetFor(source).abilityModifiers.constitution);
      healingRolls = [...healingRoll.rolls];
      rolls.push(...healingRolls);
      const nextHp = Math.min(maxHp, currentHp + healing);
      const effective = nextHp - currentHp;
      progression = {
        ...progression,
        updatedAt: now.toISOString(),
        hitPointsCurrent: nextHp,
        resourceRemaining,
      };
      summary =
        effective === healing
          ? `${source.choices.identity.name} completed a Short Rest and recovered ${effective} Hit Points. Short-rest class resources recharged.`
          : `${source.choices.identity.name} completed a Short Rest and recovered ${effective} Hit Points (rolled ${healing}; capped at maximum). Short-rest class resources recharged.`;
      affectedCombatantIds = [];
    }
  } else if (commandType === 'combat.long_rest') {
    requireOutOfCombat(encounter, 'A Long Rest');
    const projected = projectProgression(source, progression);
    const sheet = projected.sheet;
    const resourceRemaining: Record<string, number> = {
      ...(progression.resourceRemaining ?? {}),
    };
    for (const resource of sheet.classResources ?? []) {
      resourceRemaining[resource.id] = resource.maximum;
    }
    const level1SlotsRemaining = sheet.spellcasting?.level1SlotCount;
    if (encounter !== null) {
      const current = requireEncounter(encounter);
      const actor = findActor(current, seat.seatId);
      if (actor.deathSaves.dead) {
        throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'A dead combatant cannot take a Long Rest.');
      }
      const restored = {
        ...actor,
        currentHitPoints: actor.maxHitPoints,
        temporaryHitPoints: 0,
        hitDiceRemaining: Math.min(
          actor.level,
          actor.hitDiceRemaining + Math.max(1, Math.floor(actor.level / 2)),
        ),
        conditions: removeCondition(
          removeCondition(actor.conditions, 'exhaustion'),
          'unconscious',
        ),
        deathSaves: emptyDeathSaves(),
        spellResources: {
          ...actor.spellResources,
          remainingSlots: actor.spellResources.maximumSlots,
        },
        concentrationSpellId: null,
        actionEconomy: actionEconomy(),
      };
      encounter = replaceCombatants(current, [restored]);
      progression = {
        ...progression,
        updatedAt: now.toISOString(),
        hitPointsCurrent: restored.currentHitPoints,
        temporaryHitPoints: 0,
        resourceRemaining,
        ...(level1SlotsRemaining === undefined ? {} : { level1SlotsRemaining }),
      };
      summary = `${actor.name} completed a Long Rest, restoring Hit Points, Hit Dice, spell slots, and class resources.`;
      affectedCombatantIds = [actor.combatantId];
    } else {
      progression = {
        ...progression,
        updatedAt: now.toISOString(),
        hitPointsCurrent: sheet.hitPoints.value,
        temporaryHitPoints: 0,
        resourceRemaining,
        ...(level1SlotsRemaining === undefined ? {} : { level1SlotsRemaining }),
      };
      summary = `${source.choices.identity.name} completed a Long Rest, restoring Hit Points, spell slots, and class resources.`;
      affectedCombatantIds = [];
    }
  } else if (commandType === 'combat.ready') {
    const current = requireEncounter(encounter);
    const actor = requireActiveActor(current, seat.seatId);
    const reactionKind = fields.reactionKind ?? 'opportunity_attack';
    const target =
      reactionKind === 'shield'
        ? actor
        : targetById(current, fields.targetCombatantId);
    if (reactionKind === 'opportunity_attack' && target.side === actor.side) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'An Opportunity Attack targets an opposing combatant.');
    }
    const decisionWindowId = `decision:${idSource}`;
    const trigger = fields.readyTrigger?.trim() || (reactionKind === 'shield' ? 'When hit by an attack' : 'When the target moves out of reach');
    const decisionWindow: DecisionWindowProjection = {
      decisionWindowId,
      opportunityClass: 'reaction',
      eligibleCombatantId: actor.combatantId,
      reactionKind,
      trigger,
      targetCombatantId: target.combatantId,
      state: 'open',
      openedAtRound: current.round,
    };
    const readyActor = spendAction({
      ...actor,
      ready: { trigger, reactionKind, targetCombatantId: target.combatantId },
    });
    encounter = {
      ...replaceCombatants(current, [readyActor]),
      decisionWindows: [...current.decisionWindows, decisionWindow],
    };
    summary = `${actor.name} readied ${reactionKind === 'shield' ? 'Shield' : 'an Opportunity Attack'}: ${trigger}.`;
    affectedCombatantIds = [actor.combatantId, target.combatantId];
  } else if (commandType === 'combat.reaction') {
    const current = requireEncounter(encounter);
    const actor = findActor(current, seat.seatId);
    const window = current.decisionWindows.find(
      (entry) =>
        entry.decisionWindowId === fields.decisionWindowId &&
        entry.eligibleCombatantId === actor.combatantId &&
        entry.state === 'open',
    );
    if (window === undefined || window.reactionKind !== fields.reactionKind) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'That reaction window is not open.');
    }
    if (!actor.actionEconomy.reactionAvailable) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'This combatant has already spent its Reaction.');
    }
    let updatedActor: CombatantProjection = {
      ...actor,
      ready: null,
      actionEconomy: { ...actor.actionEconomy, reactionAvailable: false },
    };
    const replacements: CombatantProjection[] = [updatedActor];
    if (window.reactionKind === 'opportunity_attack') {
      const target = targetById(current, window.targetCombatantId ?? undefined);
      const distance =
        Math.max(
          Math.abs(actor.position.column - target.position.column),
          Math.abs(actor.position.row - target.position.row),
        ) * 5;
      if (distance > (actor.attacks[0]?.reachFeet ?? 5)) {
        throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'The target is outside Opportunity Attack reach.');
      }
      const attack = resolveAttack({ attacker: actor, target, rng });
      rolls.push(...attack.rolls);
      replacements.push(attack.target);
      summary = attack.hit
        ? `${actor.name} spent a Reaction for an Opportunity Attack, dealing ${attack.damage} damage to ${target.name}.`
        : `${actor.name} spent a Reaction for an Opportunity Attack but missed ${target.name}.`;
      affectedCombatantIds = [actor.combatantId, target.combatantId];
    } else {
      if (!source.choices.spellIds.includes('shield')) {
        throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, `${actor.name} does not have Shield prepared.`);
      }
      updatedActor = spendSlot(updatedActor, 1);
      updatedActor = {
        ...updatedActor,
        armorClass: updatedActor.baseArmorClass + 5,
        conditions: applyCondition(
          updatedActor.conditions,
          'shielded',
          'Shield',
          current.round + 1,
        ),
      };
      replacements[0] = updatedActor;
      summary = `${actor.name} spent a Reaction and a level 1 slot to cast Shield, gaining +5 Armor Class.`;
      affectedCombatantIds = [actor.combatantId];
    }
    encounter = {
      ...replaceCombatants(current, replacements),
      decisionWindows: current.decisionWindows.map((entry) =>
        entry.decisionWindowId === window.decisionWindowId
          ? { ...entry, state: 'resolved' }
          : entry,
      ),
    };
  } else if (commandType === 'progression.award_xp') {
    requireOutOfCombat(encounter, 'Awarding XP');
    if (encounter === null || encounter.status !== 'ended') {
      throw new RulesCommandError(
        ERROR_CODES.BAD_REQUEST,
        'Award XP after the encounter ends (all foes defeated).',
      );
    }
    const amount = fields.xpAmount ?? 300;
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'XP award must be an integer from 1 to 100,000.');
    }
    if (progression.lastAwardedEncounterId === encounter.encounterId) {
      throw new RulesCommandError(
        ERROR_CODES.BAD_REQUEST,
        'XP for this encounter was already awarded. Resolve a new beat before awarding again.',
      );
    }
    progression = {
      ...progression,
      experiencePoints: progression.experiencePoints + amount,
      updatedAt: now.toISOString(),
      lastAwardedEncounterId: encounter.encounterId,
    };
    summary = `${source.choices.identity.name} gained ${amount} XP (${progression.experiencePoints} total).`;
  } else if (commandType === 'progression.level_up') {
    requireOutOfCombat(encounter, 'Leveling up');
    const earnedLevel = levelForExperience(progression.experiencePoints);
    if (earnedLevel <= progression.level || progression.level >= 20) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'The character has not earned another level.');
    }
    progression = {
      ...progression,
      level: progression.level + 1,
      updatedAt: now.toISOString(),
    };
    const projected = projectProgression(source, progression);
    if (encounter !== null) {
      const actor = findActor(encounter, seat.seatId);
      const gainedMaximum = projected.derived.maxHitPoints - actor.maxHitPoints;
      encounter = replaceCombatants(encounter, [{
        ...actor,
        level: progression.level,
        maxHitPoints: projected.derived.maxHitPoints,
        currentHitPoints: actor.currentHitPoints + Math.max(0, gainedMaximum),
        hitDiceRemaining: actor.hitDiceRemaining + 1,
        spellResources: {
          maximumSlots: projected.derived.spellSlots,
          remainingSlots: projected.derived.spellSlots.map(
            (maximum, index) => Math.min(maximum, actor.spellResources.remainingSlots[index] ?? maximum),
          ),
        },
      }]);
    }
    summary = `${source.choices.identity.name} reached level ${progression.level}; derived statistics were recomputed.`;
  } else if (commandType === 'inventory.use_item') {
    const current = requireEncounter(encounter);
    const actor = requireActiveActor(current, seat.seatId);
    if (fields.itemId !== 'healing-potion') {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'That item is not usable in this encounter.');
    }
    const item = actor.inventory.find((entry) => entry.itemId === 'healing-potion');
    if (item === undefined || item.quantity < 1) {
      throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'No Potion of Healing remains.');
    }
    const selectedTarget =
      fields.targetCombatantId === undefined
        ? actor
        : targetById(current, fields.targetCombatantId);
    const target = selectedTarget;
    if (target.currentHitPoints >= target.maxHitPoints) {
      throw new RulesCommandError(
        ERROR_CODES.BAD_REQUEST,
        `${target.name} is already at full Hit Points. A Potion of Healing cannot be used.`,
      );
    }
    const healingRoll = rollDamage('2d4+2', rng);
    rolls.push(...healingRoll.rolls);
    const beforeHp = target.currentHitPoints;
    const inventory = actor.inventory
      .map((entry) =>
        entry.itemId === 'healing-potion' ? { ...entry, quantity: entry.quantity - 1 } : entry,
      )
      .filter((entry) => entry.quantity > 0);
    const spentActor = spendAction({ ...actor, inventory });
    const healedTarget =
      target.combatantId === actor.combatantId
        ? applyHealing(spentActor, healingRoll.total)
        : applyHealing(target, healingRoll.total);
    const effective = healedTarget.currentHitPoints - beforeHp;
    encounter = replaceCombatants(
      current,
      target.combatantId === actor.combatantId
        ? [healedTarget]
        : [spentActor, healedTarget],
    );
    summary =
      effective === healingRoll.total
        ? `${actor.name} used a Potion of Healing on ${target.name}, restoring ${effective} Hit Points.`
        : `${actor.name} used a Potion of Healing on ${target.name}, restoring ${effective} Hit Points (rolled ${healingRoll.total}; capped at maximum).`;
    affectedCombatantIds = [actor.combatantId, target.combatantId];
  }

  if (encounter !== null) {
    encounter = appendLog(encounter, commandType, summary, rolls);
  }
  return {
    encounter,
    progression,
    summary,
    rolls,
    affectedCombatantIds,
    areaCells,
    ...(reactionAuthority === undefined ? {} : { reactionAuthority }),
  };
}

export async function fetchRulesState(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<{
  readonly encounter: EncounterProjection | null;
  readonly progression: CharacterProgressionProjection;
}> {
  await assertCampaignMember(options.firestore, options.accountId, options.campaignId);
  const seat = await loadOwnSeat(options.firestore, options.accountId, options.campaignId);
  const [encounter, progression] = await Promise.all([
    loadEncounter(options.firestore, options.campaignId),
    loadProgressionProjection(options.firestore, seat.characterId),
  ]);
  return { encounter, progression };
}

export async function acceptRulesCommand(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
  readonly requestId: string;
  readonly commandType: TableCommandType;
  readonly expectedStateVersion: number;
  readonly deviceSessionId: string;
  readonly timingAuthorityId?: string;
} & RulesCommandFields): Promise<TableCommandAcceptResponse> {
  const {
    firestore,
    accountId,
    campaignId,
    requestId,
    commandType,
    expectedStateVersion,
    deviceSessionId,
    timingAuthorityId,
    ...fields
  } = options;
  if (!isRulesCommandType(commandType)) {
    throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'That rules command type is not supported.');
  }
  if (!Number.isInteger(expectedStateVersion) || expectedStateVersion < 0) {
    throw new RulesCommandError(ERROR_CODES.BAD_REQUEST, 'expectedStateVersion must be a non-negative integer.');
  }
  await assertCampaignMember(firestore, accountId, campaignId);
  const seat = await loadOwnSeat(firestore, accountId, campaignId);
  const source = await loadCharacterRulesSource(firestore, seat.characterId);
  if (source.ownerAccountId !== accountId) {
    throw new RulesCommandError(ERROR_CODES.NOT_FOUND, 'No such route.');
  }

  const projectionRef = firestore.collection(COLLECTIONS.campaignTableProjections).doc(campaignId);
  const encounterRef = firestore.collection(COLLECTIONS.campaignEncounters).doc(campaignId);
  const progressionRef = firestore.collection(COLLECTIONS.characterProgressions).doc(seat.characterId);
  const idempotencyKey = `${campaignId}:${accountId}:${requestId}`;

  const priorDuplicate = await firestore
    .collection(COLLECTIONS.campaignCommands)
    .where('idempotencyKey', '==', idempotencyKey)
    .limit(1)
    .get();
  if (!priorDuplicate.empty) {
    const command = priorDuplicate.docs[0]!.data() as StoredCommand;
    const [eventSnap, tableSnap, encounter, progression, events] = await Promise.all([
      firestore.collection(COLLECTIONS.campaignEvents).doc(command.eventId).get(),
      projectionRef.get(),
      loadEncounter(firestore, campaignId),
      loadProgressionProjection(firestore, seat.characterId),
      recentEvents(firestore, campaignId),
    ]);
    if (!eventSnap.exists) {
      throw new RulesCommandError(ERROR_CODES.UPSTREAM_UNAVAILABLE, 'A prior command commit could not be recovered.');
    }
    const table = normalizeStoredTableProjection(
      campaignId,
      tableSnap.exists ? (tableSnap.data() as StoredTableProjection) : null,
    );
    return {
      duplicate: true,
      commandId: command.commandId,
      requestId: command.requestId,
      event: eventProjection(eventSnap.data() as StoredEvent),
      table: tableProjection(campaignId, table, events),
      ...(encounter === null ? {} : { encounter }),
      progression,
    };
  }

  await requireRulesCommandTimingAuthority({
    firestore,
    accountId,
    campaignId,
    seatId: seat.seatId,
    timingAuthorityId,
    commandType,
    encounter: await loadEncounter(firestore, campaignId),
  });

  const diceSeed = randomInt(0, 0x1_0000_0000);
  const commandId = randomUUID();
  const eventId = randomUUID();
  const committedAt = new Date();

  const committed = await firestore.runTransaction(async (transaction) => {
    const duplicateQuery = firestore
      .collection(COLLECTIONS.campaignCommands)
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1);
    const [duplicateSnapshot, tableSnap, encounterSnap, progressionSnap] = await Promise.all([
      transaction.get(duplicateQuery),
      transaction.get(projectionRef),
      transaction.get(encounterRef),
      transaction.get(progressionRef),
    ]);
    if (!duplicateSnapshot.empty) {
      throw new RulesCommandError(
        ERROR_CODES.STALE_STATE_VERSION,
        'This retry raced with the original command; reload the table state.',
      );
    }
    const currentTable = normalizeStoredTableProjection(
      campaignId,
      tableSnap.exists ? (tableSnap.data() as StoredTableProjection) : null,
    );
    if (currentTable.stateVersion !== expectedStateVersion) {
      throw new RulesCommandError(
        ERROR_CODES.STALE_STATE_VERSION,
        `This table moved on (server version ${currentTable.stateVersion}). Reload, then retry.`,
      );
    }
    const currentEncounter = encounterSnap.exists
      ? (encounterSnap.data() as EncounterProjection)
      : null;
    const currentProgression = progressionSnap.exists
      ? (progressionSnap.data() as StoredProgression)
      : initialStoredProgression(source, committedAt);
    const mutation = mutateRules({
      commandType,
      encounter: currentEncounter,
      progression: currentProgression,
      source,
      seat,
      fields,
      rng: createSeededRandom(diceSeed),
      now: committedAt,
      idSource: commandId,
    });
    const nextVersion = currentTable.stateVersion + 1;
    const nextSequence = currentTable.lastEventSequence + 1;
    const nextTable: StoredTableProjection = {
      ...currentTable,
      stateVersion: nextVersion,
      lastEventSequence: nextSequence,
      lastEventId: eventId,
      updatedAt: committedAt,
    };
    const nextEncounter =
      mutation.encounter === null
        ? null
        : { ...mutation.encounter, stateVersion: nextVersion, updatedAt: committedAt.toISOString() };
    const command: StoredCommand = {
      commandId,
      campaignId,
      requestId,
      idempotencyKey,
      commandType,
      actorAccountId: accountId,
      seatId: seat.seatId,
      expectedStateVersion,
      eventId,
      acceptedAt: committedAt,
      diceSeed,
    };
    const event: StoredEvent = {
      eventId,
      campaignId,
      eventSequence: nextSequence,
      eventType: EVENT_FOR_COMMAND[commandType],
      commandId,
      requestId,
      actorAccountId: accountId,
      seatId: seat.seatId,
      priorStateVersion: currentTable.stateVersion,
      resultStateVersion: nextVersion,
      committedAt,
      summary: mutation.summary,
      rolls: mutation.rolls,
    };
    // Issue Active Turn Authority before any transaction writes. That helper
    // reads the active seat + existing authorities; Firestore rejects reads
    // after writes in the same transaction (which previously flaked initiative
    // / next_turn whenever a party combatant became active).
    if (
      nextEncounter !== null &&
      nextEncounter.status === 'active' &&
      (commandType === 'initiative.roll' || commandType === 'encounter.next_turn')
    ) {
      await issueAuthorityForActivePartyCombatant({
        transaction,
        firestore,
        campaignId,
        encounter: nextEncounter,
        projectionVersion: nextVersion,
        committedAt,
      });
    }
    transaction.set(firestore.collection(COLLECTIONS.campaignCommands).doc(commandId), command);
    transaction.set(firestore.collection(COLLECTIONS.campaignEvents).doc(eventId), event);
    transaction.set(projectionRef, nextTable);
    transaction.set(progressionRef, mutation.progression);
    if (nextEncounter !== null) transaction.set(encounterRef, nextEncounter);
    transaction.update(firestore.collection(COLLECTIONS.campaignSeats).doc(seat.seatId), {
      lastAcknowledgedEventSequence: nextSequence,
      deviceSessionId,
    });
    transaction.update(firestore.collection(COLLECTIONS.campaigns).doc(campaignId), {
      updatedAt: committedAt,
    });
    if (mutation.reactionAuthority !== undefined && nextEncounter !== null) {
      const expiresAt = new Date(committedAt.getTime() + 5 * 60 * 1000);
      transaction.set(
        firestore
          .collection(COLLECTIONS.timingAuthorities)
          .doc(mutation.reactionAuthority.timingAuthorityId),
        {
          timingAuthorityId: mutation.reactionAuthority.timingAuthorityId,
          schemaVersion: TIMING_AUTHORITY_SCHEMA_VERSION,
          opportunityClass: 'reaction' satisfies TimingOpportunityClass,
          campaignId,
          seatId: seat.seatId,
          characterId: seat.characterId,
          accountId,
          permittedCommandTypes: ['combat.reaction'],
          projectionVersionAtIssue: nextVersion,
          issuedAt: committedAt,
          expiresAt,
          state: 'issued',
          singleUse: true,
          encounterId: nextEncounter.encounterId,
          resolutionFrameId: mutation.reactionAuthority.decisionWindowId,
        },
      );
    }
    if (commandType === 'combat.reaction' && timingAuthorityId !== undefined) {
      transaction.update(
        firestore.collection(COLLECTIONS.timingAuthorities).doc(timingAuthorityId),
        { state: 'consumed' },
      );
    }
    return { command, event, table: nextTable, encounter: nextEncounter, progression: mutation.progression };
  });

  const events = await recentEvents(firestore, campaignId);
  const projectedEvent = eventProjection(committed.event);
  const allEvents = events.some((event) => event.eventId === projectedEvent.eventId)
    ? events
    : [...events, projectedEvent];
  return {
    duplicate: false,
    commandId: committed.command.commandId,
    requestId: committed.command.requestId,
    event: projectedEvent,
    table: tableProjection(campaignId, committed.table, allEvents),
    ...(committed.encounter === null ? {} : { encounter: committed.encounter }),
    progression: projectProgression(source, committed.progression),
  };
}
