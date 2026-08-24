import type {
  DerivedCharacterSheet,
  DerivedValue,
} from '../../../shared/character-contract.js';
import type {
  ProgressionDerivedProjection,
} from '../../../shared/rules-combat-contract.js';
import { findClass } from '../srd-manifest.js';

/** Cumulative XP required to attain each level, index 0 = level 1. */
export const XP_THRESHOLDS = [
  0,
  300,
  900,
  2_700,
  6_500,
  14_000,
  23_000,
  34_000,
  48_000,
  64_000,
  85_000,
  100_000,
  120_000,
  140_000,
  165_000,
  195_000,
  225_000,
  265_000,
  305_000,
  355_000,
] as const;

const FULL_CASTER_SLOTS: readonly (readonly number[])[] = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
] as const;

const FULL_CASTERS = new Set(['bard', 'cleric', 'druid', 'sorcerer', 'wizard']);
const HALF_CASTERS = new Set(['paladin', 'ranger']);

export function levelForExperience(experiencePoints: number): number {
  if (!Number.isSafeInteger(experiencePoints) || experiencePoints < 0) {
    throw new Error('Experience Points must be a non-negative integer.');
  }
  let level = 1;
  for (let index = 1; index < XP_THRESHOLDS.length; index += 1) {
    if (experiencePoints < XP_THRESHOLDS[index]!) {
      break;
    }
    level = index + 1;
  }
  return level;
}

export function experienceRequiredForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error('A character level must be from 1 to 20.');
  }
  return XP_THRESHOLDS[level - 1]!;
}

export function proficiencyBonusForLevel(level: number): number {
  experienceRequiredForLevel(level);
  return 2 + Math.floor((level - 1) / 4);
}

export function spellSlotsForClass(classId: string, level: number): readonly number[] {
  experienceRequiredForLevel(level);
  if (FULL_CASTERS.has(classId)) {
    return FULL_CASTER_SLOTS[level - 1]!;
  }
  if (HALF_CASTERS.has(classId)) {
    const effectiveLevel = Math.max(1, Math.ceil(level / 2));
    return FULL_CASTER_SLOTS[effectiveLevel - 1]!;
  }
  if (classId === 'warlock') {
    const slotCount = level === 1 ? 1 : level <= 10 ? 2 : level <= 16 ? 3 : 4;
    const slotLevel = Math.min(5, Math.ceil(level / 2));
    return Array.from({ length: slotLevel }, (_, index) => (index === slotLevel - 1 ? slotCount : 0));
  }
  return [];
}

export function attacksPerActionForClass(classId: string, level: number): number {
  experienceRequiredForLevel(level);
  if (classId === 'fighter') {
    return level >= 20 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
  }
  if (['barbarian', 'monk', 'paladin', 'ranger'].includes(classId) && level >= 5) {
    return 2;
  }
  return 1;
}

function classFeaturesForLevel(classId: string, level: number): readonly string[] {
  const features: string[] = [];
  if (classId === 'fighter') {
    if (level >= 1) features.push('Second Wind', 'Weapon Mastery');
    if (level >= 2) features.push('Action Surge', 'Tactical Mind');
    if (level >= 3) features.push('Champion (Fighter subclass)');
    if (level >= 5) features.push('Extra Attack');
    if (level >= 9) features.push('Indomitable');
    if (level >= 11) features.push('Two Extra Attacks');
    if (level >= 20) features.push('Three Extra Attacks');
  }
  for (const improvementLevel of [4, 8, 12, 16, 19]) {
    if (level >= improvementLevel) features.push(`Ability Score Improvement ${improvementLevel}`);
  }
  if (features.length === 0) {
    features.push('Level 1 class features');
  }
  return features;
}

function replaceProficiency(value: DerivedValue, proficiencyBonus: number): DerivedValue {
  const components = value.components.map((component) =>
    component.ruleId === 'proficiency-bonus' ||
    component.ruleId.startsWith('proficiency-bonus.') ||
    component.ruleId === 'feat.alert.initiative'
      ? { ...component, amount: proficiencyBonus }
      : component,
  );
  return {
    components,
    value: components.reduce((total, component) => total + component.amount, 0),
  };
}

function classResourcesForLevel(
  baseSheet: DerivedCharacterSheet,
  classId: string,
  level: number,
): NonNullable<DerivedCharacterSheet['classResources']> {
  const prior = baseSheet.classResources ?? [];
  const byId = new Map(prior.map((resource) => [resource.id, resource]));
  const next: Array<{
    id: string;
    label: string;
    summary: string;
    remaining: number;
    maximum: number;
    recharge: string;
  }> = [];
  const secondWind = byId.get('second-wind');
  if (secondWind !== undefined || classId === 'fighter') {
    next.push(
      secondWind ?? {
        id: 'second-wind',
        label: 'Second Wind',
        summary: 'Regain hit points as a Bonus Action.',
        remaining: 1,
        maximum: 1,
        recharge: 'Short rest',
      },
    );
  }
  if (classId === 'fighter' && level >= 2) {
    const actionSurge = byId.get('action-surge');
    next.push(
      actionSurge ?? {
        id: 'action-surge',
        label: 'Action Surge',
        summary: 'Take one additional Action on your turn.',
        remaining: 1,
        maximum: 1,
        recharge: 'Short rest',
      },
    );
  }
  for (const resource of prior) {
    if (resource.id === 'second-wind' || resource.id === 'action-surge') {
      continue;
    }
    next.push(resource);
  }
  return next;
}

export function deriveProgression(
  baseSheet: DerivedCharacterSheet,
  classId: string,
  level: number,
): ProgressionDerivedProjection {
  const classRecord = findClass(classId);
  if (classRecord === null) {
    throw new Error('The character Class is not available for progression.');
  }
  experienceRequiredForLevel(level);
  const constitutionModifier = baseSheet.abilityModifiers.constitution;
  const averageHitDie = Math.floor(classRecord.hitDie / 2) + 1;
  const hitPointsPerAdditionalLevel = Math.max(1, averageHitDie + constitutionModifier);
  return {
    proficiencyBonus: proficiencyBonusForLevel(level),
    maxHitPoints: baseSheet.hitPoints.value + (level - 1) * hitPointsPerAdditionalLevel,
    hitDice: `${level}d${classRecord.hitDie}`,
    attacksPerAction: attacksPerActionForClass(classId, level),
    spellSlots: spellSlotsForClass(classId, level),
    classFeatures: classFeaturesForLevel(classId, level),
  };
}

/**
 * Recomputes all level-sensitive values represented by the Phase 1 sheet.
 * Original choices and derivation components remain the source of truth.
 */
export function recomputeSheetForLevel(
  baseSheet: DerivedCharacterSheet,
  classId: string,
  level: number,
  experiencePoints: number,
): DerivedCharacterSheet {
  const derived = deriveProgression(baseSheet, classId, level);
  const priorProficiency = baseSheet.proficiencyBonus.value;
  const proficiencyDelta = derived.proficiencyBonus - priorProficiency;
  const hitPointComponents = [
    ...baseSheet.hitPoints.components,
    ...(level > 1
      ? [{
          label: `Levels 2–${level}`,
          amount: derived.maxHitPoints - baseSheet.hitPoints.value,
          ruleId: `class.${classId}.hit-points-after-level-1`,
        }]
      : []),
  ];
  return {
    ...baseSheet,
    level,
    experiencePoints,
    proficiencyBonus: {
      value: derived.proficiencyBonus,
      components: [{
        label: `Level ${level}`,
        amount: derived.proficiencyBonus,
        ruleId: `proficiency-bonus.level-${level}`,
      }],
    },
    hitPoints: { value: derived.maxHitPoints, components: hitPointComponents },
    hitPointsCurrent: derived.maxHitPoints,
    hitDice: derived.hitDice,
    features: [
      ...baseSheet.features.filter(
        (feature) =>
          !derived.classFeatures.some(
            (label) => feature.name === label || feature.name.startsWith(`${label} `),
          ),
      ),
      ...derived.classFeatures.map((label) => ({
        name: label,
        source: `class.${classId}`,
        summary: `Granted at character level ${level}.`,
      })),
    ],
    savingThrows: Object.fromEntries(
      Object.entries(baseSheet.savingThrows).map(([ability, value]) => [
        ability,
        replaceProficiency(value, derived.proficiencyBonus),
      ]),
    ) as DerivedCharacterSheet['savingThrows'],
    skills: baseSheet.skills.map((skill) => ({
      ...skill,
      bonus: replaceProficiency(skill.bonus, derived.proficiencyBonus),
    })),
    initiative: replaceProficiency(baseSheet.initiative, derived.proficiencyBonus),
    attacks: baseSheet.attacks.map((attack) => ({
      ...attack,
      attackBonus: {
        ...attack.attackBonus,
        value: attack.attackBonus.value + proficiencyDelta,
        components: attack.attackBonus.components.map((component) =>
          component.ruleId === 'proficiency-bonus'
            ? { ...component, amount: derived.proficiencyBonus }
            : component,
        ),
      },
    })),
    classResources: classResourcesForLevel(baseSheet, classId, level),
    ...(classId === 'fighter' && level >= 3
      ? { subclassLabel: 'Champion (Alpha default Fighter subclass)' }
      : {}),
    spellcasting:
      baseSheet.spellcasting === null
        ? null
        : {
            ...baseSheet.spellcasting,
            spellSaveDc: replaceProficiency(
              baseSheet.spellcasting.spellSaveDc,
              derived.proficiencyBonus,
            ),
            spellAttackBonus: replaceProficiency(
              baseSheet.spellcasting.spellAttackBonus,
              derived.proficiencyBonus,
            ),
            level1SlotCount: derived.spellSlots[0] ?? 0,
            level1SlotsRemaining: derived.spellSlots[0] ?? baseSheet.spellcasting.level1SlotsRemaining,
          },
  };
}
