/**
 * Shared character-creation contract.
 *
 * Blueprint ownership: Sections 1.5.8 (in-product creation only), 1.5.8.1
 * (familiar SRD terminology), 1.5.8.2 (identity-last wizard), 6.4 (character
 * creation rules contract), 6.5 (derivation and audit), and 19.12 (character
 * aggregate).
 *
 * Terminology rule: every player-facing name here is the approved SRD name.
 * Class is Class, Species is Species, Background is Background, Hit Points is
 * Hit Points. No invented vocabulary substitutes for a rules term.
 */

export const ABILITIES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;
export type Ability = (typeof ABILITIES)[number];

/** Player-facing SRD names for each ability, used everywhere the player sees one. */
export const ABILITY_LABELS: Record<Ability, string> = {
  strength: 'Strength',
  dexterity: 'Dexterity',
  constitution: 'Constitution',
  intelligence: 'Intelligence',
  wisdom: 'Wisdom',
  charisma: 'Charisma',
};

export type AbilityScores = Record<Ability, number>;

/**
 * The wizard steps, in the order Section 1.5.8.2 fixes. Identity is last: the
 * player defines the character mechanically before naming them.
 */
export const WIZARD_STEPS = [
  'class',
  'background',
  'species',
  'abilities',
  'equipment',
  'features',
  'identity',
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  class: 'Class',
  background: 'Background',
  species: 'Species',
  abilities: 'Ability Scores and Proficiencies',
  equipment: 'Equipment',
  features: 'Class Features and Spells',
  identity: 'Identity & Final Review',
};

/** Ability-generation methods this phase supports. */
export const ABILITY_METHODS = ['standard-array', 'point-buy'] as const;
export type AbilityMethod = (typeof ABILITY_METHODS)[number];

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

/** Point-buy budget and per-score cost, per the SRD point-buy rules. */
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_COSTS: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};

/**
 * The player's recorded choices. This is the source of truth that is stored;
 * derived numbers are always recomputed from it (Section 6.5), never stored
 * as the only record of how the sheet came to be.
 */
export interface CharacterChoices {
  readonly classId: string | null;
  readonly backgroundId: string | null;
  readonly speciesId: string | null;
  readonly abilityMethod: AbilityMethod;
  /** Base scores before background increases, keyed by ability. */
  readonly baseAbilityScores: Partial<AbilityScores>;
  /**
   * The Background ability increases, which the SRD allows as either +2 and
   * +1 across two of the Background's three abilities, or +1 to each of the
   * three. Keyed by ability.
   */
  readonly backgroundAbilityBonuses: Partial<Record<Ability, number>>;
  /** Skill ids chosen from the class's skill list. */
  readonly classSkillIds: readonly string[];
  /** Choice ids resolved for species options (for example an Elven Lineage). */
  readonly speciesChoiceIds: Readonly<Record<string, string>>;
  /** Selected starting-equipment option id for class and background. */
  readonly classEquipmentOptionId: string | null;
  readonly backgroundEquipmentOptionId: string | null;
  /** Cantrip and level-1 spell ids, for classes that cast at level 1. */
  readonly cantripIds: readonly string[];
  readonly spellIds: readonly string[];
  /** Class-specific level-1 choices, keyed by the choice id in the manifest. */
  readonly classChoiceIds: Readonly<Record<string, readonly string[]>>;
  readonly identity: CharacterIdentity;
}

export interface CharacterIdentity {
  readonly name: string;
  readonly pronouns: string;
  readonly appearance: string;
  readonly concept: string;
}

export const CHARACTER_NAME_MAX_LENGTH = 40;
export const CHARACTER_TEXT_MAX_LENGTH = 300;

/**
 * One contribution to a derived value. Section 6.5 requires every derived
 * number to be explainable: base value, modifiers, equipment, and the rule
 * identifier each came from.
 */
export interface DerivationComponent {
  readonly label: string;
  readonly amount: number;
  readonly ruleId: string;
}

export interface DerivedValue {
  readonly value: number;
  readonly components: readonly DerivationComponent[];
}

export interface DerivedAttack {
  readonly name: string;
  readonly attackBonus: DerivedValue;
  readonly damage: string;
  readonly damageType: string;
  readonly properties: readonly string[];
  readonly ruleId: string;
}

export interface DerivedProficiency {
  readonly id: string;
  readonly label: string;
  readonly sourceLabel: string;
  readonly ruleId: string;
}

/**
 * The complete server-computed sheet. The client renders this and never
 * calculates a mechanical value of its own.
 */
export interface DerivedCharacterSheet {
  readonly level: number;
  readonly experiencePoints: number;
  readonly proficiencyBonus: DerivedValue;
  readonly abilityScores: Record<Ability, DerivedValue>;
  readonly abilityModifiers: Record<Ability, number>;
  readonly hitPoints: DerivedValue;
  readonly hitDice: string;
  readonly armorClass: DerivedValue;
  readonly initiative: DerivedValue;
  readonly speed: DerivedValue;
  readonly passivePerception: DerivedValue;
  readonly savingThrows: Record<Ability, DerivedValue>;
  readonly savingThrowProficiencies: readonly Ability[];
  readonly skills: readonly {
    readonly id: string;
    readonly label: string;
    readonly ability: Ability;
    readonly proficient: boolean;
    readonly bonus: DerivedValue;
  }[];
  readonly senses: readonly string[];
  readonly proficiencies: readonly DerivedProficiency[];
  readonly languages: readonly string[];
  readonly features: readonly { readonly name: string; readonly source: string; readonly summary: string }[];
  readonly attacks: readonly DerivedAttack[];
  readonly equipment: readonly { readonly name: string; readonly quantity: number }[];
  readonly currencyGold: number;
  readonly spellcasting: {
    readonly ability: Ability;
    readonly spellSaveDc: DerivedValue;
    readonly spellAttackBonus: DerivedValue;
    readonly cantrips: readonly { readonly id: string; readonly name: string }[];
    readonly spells: readonly { readonly id: string; readonly name: string }[];
    readonly level1SlotCount: number;
    readonly preparationStyle: 'prepared' | 'known';
  } | null;
}

/** One unresolved requirement blocking creation, named in player-facing terms. */
export interface UnresolvedChoice {
  readonly step: WizardStep;
  readonly code: string;
  readonly message: string;
}

/**
 * The server's answer for a draft: what has been chosen, what it derives to,
 * and exactly what remains. `canCreate` is the only authority for whether the
 * final Create Character action may run (Section 6.4).
 */
export interface DraftProjection {
  readonly draftId: string;
  readonly rulesVersion: string;
  readonly updatedAt: string;
  readonly choices: CharacterChoices;
  readonly sheet: DerivedCharacterSheet | null;
  readonly unresolved: readonly UnresolvedChoice[];
  readonly completedSteps: readonly WizardStep[];
  readonly canCreate: boolean;
}

/** A committed, account-owned character. */
export interface CharacterProjection {
  readonly characterId: string;
  readonly rulesVersion: string;
  readonly createdAt: string;
  readonly identity: CharacterIdentity;
  readonly classLabel: string;
  readonly speciesLabel: string;
  readonly backgroundLabel: string;
  readonly level: number;
  readonly choices: CharacterChoices;
  readonly sheet: DerivedCharacterSheet;
}

export interface CharacterVaultProjection {
  readonly accountId: string;
  readonly characters: readonly CharacterSummary[];
  readonly drafts: readonly DraftSummary[];
}

export interface CharacterSummary {
  readonly characterId: string;
  readonly name: string;
  readonly classLabel: string;
  readonly speciesLabel: string;
  readonly backgroundLabel: string;
  readonly level: number;
  readonly createdAt: string;
}

export interface DraftSummary {
  readonly draftId: string;
  readonly classLabel: string | null;
  readonly updatedAt: string;
  readonly canCreate: boolean;
  readonly unresolvedCount: number;
}

/** Options the wizard renders, produced from the rules manifest by the server. */
export interface RulesCatalog {
  readonly rulesVersion: string;
  readonly classes: readonly CatalogEntry[];
  readonly species: readonly CatalogEntry[];
  readonly backgrounds: readonly CatalogEntry[];
  readonly skills: readonly { readonly id: string; readonly label: string; readonly ability: Ability }[];
}

export interface CatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
}

export interface SelectableOption {
  readonly id: string;
  readonly label: string;
}

export interface OptionChoiceView {
  readonly id: string;
  readonly label: string;
  readonly choose: number;
  readonly from: readonly SelectableOption[];
}

export interface EquipmentOptionView {
  readonly id: string;
  readonly label: string;
  readonly gold: number;
}

/**
 * Everything the wizard needs to render the current step, derived from the
 * rules manifest against the choices made so far. The client renders these
 * options and never invents one.
 */
export interface DraftOptions {
  readonly catalog: RulesCatalog;
  readonly quickStartTemplates: readonly CatalogEntry[];
  readonly classDetail: {
    readonly label: string;
    readonly hitDie: number;
    readonly savingThrowProficiencies: readonly Ability[];
    readonly skillChoiceCount: number;
    readonly skillOptions: readonly SelectableOption[];
    readonly choices: readonly OptionChoiceView[];
    readonly equipmentOptions: readonly EquipmentOptionView[];
    readonly features: readonly { readonly name: string; readonly summary: string }[];
    readonly spellcasting: {
      readonly abilityLabel: string;
      readonly cantripsKnown: number;
      readonly spellsAvailable: number;
      readonly preparationStyle: 'prepared' | 'known';
      readonly cantripOptions: readonly SelectableOption[];
      readonly spellOptions: readonly SelectableOption[];
    } | null;
  } | null;
  readonly speciesDetail: {
    readonly label: string;
    readonly speed: number;
    readonly size: string;
    readonly senses: readonly string[];
    readonly features: readonly { readonly name: string; readonly summary: string }[];
    readonly choices: readonly OptionChoiceView[];
  } | null;
  readonly backgroundDetail: {
    readonly label: string;
    readonly abilityOptions: readonly Ability[];
    readonly originFeat: string;
    readonly skillLabels: readonly string[];
    readonly toolProficiency: string;
    readonly equipmentOptions: readonly EquipmentOptionView[];
  } | null;
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/** Cost of a point-buy array, or null when a score is outside the legal range. */
export function pointBuyCost(scores: readonly number[]): number | null {
  let total = 0;
  for (const score of scores) {
    const cost = POINT_BUY_COSTS[score];
    if (cost === undefined) {
      return null;
    }
    total += cost;
  }
  return total;
}
