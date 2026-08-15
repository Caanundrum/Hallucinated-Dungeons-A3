/**
 * Phase 3 deterministic SRD combat and progression projections.
 *
 * These are server-authored records. Clients select commands and targets, but
 * never calculate rolls, damage, legal targets, areas, or advancement.
 */

import type { Ability, DerivedCharacterSheet } from './character-contract.js';

export const ENCOUNTER_STATUSES = ['setup', 'active', 'ended'] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

export const COMBATANT_SIDES = ['party', 'foe'] as const;
export type CombatantSide = (typeof COMBATANT_SIDES)[number];

export const CONDITION_IDS = [
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
  'exhaustion',
  'guiding-bolt-marked',
  'shielded',
] as const;
export type ConditionId = (typeof CONDITION_IDS)[number];

export const AREA_SHAPES = ['sphere', 'cube', 'cone', 'line'] as const;
export type AreaShape = (typeof AREA_SHAPES)[number];

export interface GridPoint3d {
  readonly column: number;
  readonly row: number;
  readonly elevationFeet: number;
}

export interface AreaTarget {
  readonly shape: AreaShape;
  readonly origin: GridPoint3d;
  /** Size means radius for sphere, side for cube, and length for cone/line. */
  readonly sizeFeet: number;
  readonly heightFeet: number;
  readonly direction?: 'north' | 'east' | 'south' | 'west';
  readonly widthFeet?: number;
}

export interface AreaCell extends GridPoint3d {
  readonly id: string;
}

export interface ConditionProjection {
  readonly conditionId: ConditionId;
  readonly label: string;
  readonly source: string;
  readonly expiresAtRound: number | null;
}

export interface ActionEconomyProjection {
  readonly actionAvailable: boolean;
  readonly bonusActionAvailable: boolean;
  readonly reactionAvailable: boolean;
  readonly movementRemainingFeet: number;
}

export interface DeathSaveProjection {
  readonly successes: number;
  readonly failures: number;
  readonly stable: boolean;
  readonly dead: boolean;
}

export interface SpellResourceProjection {
  /** Index 0 is spell level 1; index 8 is spell level 9. */
  readonly maximumSlots: readonly number[];
  readonly remainingSlots: readonly number[];
}

export interface CombatantAttackProjection {
  readonly attackId: string;
  readonly label: string;
  readonly attackBonus: number;
  readonly damageExpression: string;
  readonly damageType: string;
  readonly reachFeet: number;
}

export interface CombatantProjection {
  readonly combatantId: string;
  readonly characterId: string | null;
  readonly seatId: string | null;
  readonly name: string;
  readonly side: CombatantSide;
  readonly level: number;
  readonly position: GridPoint3d;
  readonly armorClass: number;
  readonly baseArmorClass: number;
  readonly maxHitPoints: number;
  readonly currentHitPoints: number;
  readonly temporaryHitPoints: number;
  readonly hitDiceRemaining: number;
  readonly initiativeBonus: number;
  readonly initiative: number | null;
  readonly savingThrowBonuses: Readonly<Record<Ability, number>>;
  readonly conditions: readonly ConditionProjection[];
  readonly deathSaves: DeathSaveProjection;
  readonly actionEconomy: ActionEconomyProjection;
  readonly attacks: readonly CombatantAttackProjection[];
  readonly spellSaveDc: number | null;
  readonly spellAttackBonus: number | null;
  readonly spellcastingAbilityModifier: number;
  readonly spellResources: SpellResourceProjection;
  readonly concentrationSpellId: string | null;
  readonly inventory: readonly { readonly itemId: string; readonly label: string; readonly quantity: number }[];
  readonly ready: {
    readonly trigger: string;
    readonly reactionKind: 'opportunity_attack' | 'shield';
    readonly targetCombatantId: string | null;
  } | null;
}

export interface DecisionWindowProjection {
  readonly decisionWindowId: string;
  readonly opportunityClass: 'reaction' | 'decision';
  readonly eligibleCombatantId: string;
  readonly reactionKind: 'opportunity_attack' | 'shield';
  readonly trigger: string;
  readonly targetCombatantId: string | null;
  readonly state: 'open' | 'resolved' | 'declined' | 'expired';
  readonly openedAtRound: number;
}

export interface EncounterLogEntry {
  readonly sequence: number;
  readonly commandType: string;
  readonly summary: string;
  readonly rolls: readonly number[];
}

export interface EncounterProjection {
  readonly encounterId: string;
  readonly campaignId: string;
  readonly stateVersion: number;
  readonly status: EncounterStatus;
  readonly round: number;
  readonly turnIndex: number;
  readonly activeCombatantId: string | null;
  readonly initiativeOrder: readonly string[];
  readonly combatants: readonly CombatantProjection[];
  readonly areaCells: readonly AreaCell[];
  readonly decisionWindows: readonly DecisionWindowProjection[];
  readonly log: readonly EncounterLogEntry[];
  readonly updatedAt: string;
}

export interface ProgressionDerivedProjection {
  readonly proficiencyBonus: number;
  readonly maxHitPoints: number;
  readonly hitDice: string;
  readonly attacksPerAction: number;
  readonly spellSlots: readonly number[];
  readonly classFeatures: readonly string[];
}

export interface CharacterProgressionProjection {
  readonly characterId: string;
  readonly classId: string;
  readonly experiencePoints: number;
  readonly level: number;
  readonly levelUpAvailable: boolean;
  readonly derived: ProgressionDerivedProjection;
  readonly sheet: DerivedCharacterSheet;
  readonly updatedAt: string;
}

export interface RuleExplanationProjection {
  readonly ruleId: string;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly string[];
  readonly source: 'SRD 5.2' | 'Hallucinated Dungeons Phase 3';
}

export interface RulesCommandFields {
  readonly targetCombatantId?: string;
  readonly spellId?: string;
  readonly attackId?: string;
  readonly area?: AreaTarget;
  readonly reactionKind?: 'opportunity_attack' | 'shield';
  readonly decisionWindowId?: string;
  readonly readyTrigger?: string;
  readonly xpAmount?: number;
  readonly itemId?: string;
}

export interface RulesCommandResult {
  readonly summary: string;
  readonly rolls: readonly number[];
  readonly affectedCombatantIds: readonly string[];
  readonly areaCells: readonly AreaCell[];
}
