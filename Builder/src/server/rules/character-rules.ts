/**
 * The deterministic character-creation rules engine.
 *
 * Blueprint ownership: Section 6.4 (character creation rules contract) and
 * Section 6.5 (derivation and audit). Two rules shape every function here:
 *
 * - The server decides legality. `validateChoices` is the only authority for
 *   whether the final Create Character action may run; the client renders
 *   what this returns and never reaches its own verdict.
 * - Every derived number carries its own explanation. `DerivedValue` records
 *   the components and the rule identifier each came from, so the sheet can
 *   answer "why is this number?" without a second calculation path.
 */

import {
  ABILITIES,
  ABILITY_LABELS,
  ABILITY_METHODS,
  CHARACTER_NAME_MAX_LENGTH,
  CHARACTER_TEXT_MAX_LENGTH,
  MAX_ABILITY_ROLL_ATTEMPTS,
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  WIZARD_STEPS,
  abilityModifier,
  pointBuyCost,
  type Ability,
  type CharacterChoices,
  type DerivedAttack,
  type DerivedCharacterSheet,
  type DerivedProficiency,
  type DerivedValue,
  type DraftOptions,
  type RulesCatalog,
  type UnresolvedChoice,
  type WizardStep,
} from '../../shared/character-contract.js';
import { randomInt } from 'node:crypto';
import {
  BACKGROUNDS,
  CLASSES,
  QUICK_START_TEMPLATES,
  RULES_VERSION,
  SKILLS,
  SPECIES,
  findArmor,
  findBackground,
  findClass,
  findSkill,
  findSpecies,
  findSpell,
  findWeapon,
  spellsForList,
  type ClassRecord,
  type EquipmentOption,
} from './srd-manifest.js';

/** Proficiency Bonus at level 1. Single-class progression only (Section 1.5.19). */
const LEVEL_1_PROFICIENCY_BONUS = 2;
const STARTING_LEVEL = 1;

export function emptyChoices(): CharacterChoices {
  return {
    classId: null,
    backgroundId: null,
    speciesId: null,
    abilityMethod: 'standard-array',
    baseAbilityScores: {},
    rolledScorePool: null,
    abilityRollAttempts: 0,
    backgroundAbilityBonuses: {},
    classSkillIds: [],
    speciesChoiceIds: {},
    classEquipmentOptionId: null,
    backgroundEquipmentOptionId: null,
    cantripIds: [],
    spellIds: [],
    classChoiceIds: {},
    identity: { name: '', pronouns: '', appearance: '', concept: '' },
  };
}

/** One Ability Score: 4d6, drop the lowest die. */
export function rollOneAbilityScore(rollDie: () => number = () => randomInt(1, 7)): number {
  const dice = [rollDie(), rollDie(), rollDie(), rollDie()].sort((a, b) => a - b);
  return dice[1]! + dice[2]! + dice[3]!;
}

/** Six Ability Scores for a rolled pool, highest first for display. */
export function rollAbilityScorePool(rollDie: () => number = () => randomInt(1, 7)): readonly number[] {
  return Array.from({ length: 6 }, () => rollOneAbilityScore(rollDie)).sort((a, b) => b - a);
}

export { MAX_ABILITY_ROLL_ATTEMPTS };

export function buildCatalog(): RulesCatalog {
  return {
    rulesVersion: RULES_VERSION,
    classes: CLASSES.map((entry) => ({ id: entry.id, label: entry.label, summary: entry.summary })),
    species: SPECIES.map((entry) => ({ id: entry.id, label: entry.label, summary: entry.summary })),
    backgrounds: BACKGROUNDS.map((entry) => ({ id: entry.id, label: entry.label, summary: entry.summary })),
    skills: SKILLS.map((entry) => ({ id: entry.id, label: entry.label, ability: entry.ability })),
  };
}

function unresolved(step: WizardStep, code: string, message: string): UnresolvedChoice {
  return { step, code, message };
}

/**
 * Every requirement still blocking creation, in wizard order.
 *
 * Section 6.4 requires the builder to prevent incompatible selections rather
 * than accepting them and failing later, so anything selected that is not
 * legal for the current character is reported here as unresolved too.
 */
export function validateChoices(choices: CharacterChoices): readonly UnresolvedChoice[] {
  const problems: UnresolvedChoice[] = [];

  const classRecord = findClass(choices.classId);
  const backgroundRecord = findBackground(choices.backgroundId);
  const speciesRecord = findSpecies(choices.speciesId);

  if (classRecord === null) {
    problems.push(unresolved('class', 'CLASS_REQUIRED', 'Choose a Class.'));
  }
  if (backgroundRecord === null) {
    problems.push(unresolved('background', 'BACKGROUND_REQUIRED', 'Choose a Background.'));
  }
  if (speciesRecord === null) {
    problems.push(unresolved('species', 'SPECIES_REQUIRED', 'Choose a Species.'));
  }

  // ── Class skill proficiencies ──────────────────────────────────────────
  if (classRecord !== null) {
    const allowed =
      classRecord.skillChoiceIds.length === 0
        ? SKILLS.map((skill) => skill.id)
        : classRecord.skillChoiceIds;
    const chosen = choices.classSkillIds;
    const illegal = chosen.filter((id) => !allowed.includes(id));
    const duplicated = chosen.length !== new Set(chosen).size;

    if (illegal.length > 0) {
      problems.push(
        unresolved(
          'class',
          'CLASS_SKILL_NOT_AVAILABLE',
          `${classRecord.label} cannot choose ${illegal.join(', ')} as a skill proficiency.`,
        ),
      );
    }
    if (duplicated) {
      problems.push(
        unresolved('class', 'CLASS_SKILL_DUPLICATE', 'Each skill proficiency must be different.'),
      );
    }
    if (chosen.length !== classRecord.skillChoiceCount) {
      problems.push(
        unresolved(
          'class',
          'CLASS_SKILL_COUNT',
          `Choose ${classRecord.skillChoiceCount} skill proficiencies for ${classRecord.label}. ${chosen.length} chosen.`,
        ),
      );
    }

    for (const choice of classRecord.choices) {
      const selected = choices.classChoiceIds[choice.id] ?? [];
      const legalIds = choice.from.map((option) => option.id);
      if (selected.some((id) => !legalIds.includes(id))) {
        problems.push(
          unresolved('features', 'CLASS_CHOICE_INVALID', `An option selected for ${choice.label} is not available.`),
        );
      }
      if (selected.length !== choice.choose) {
        problems.push(
          unresolved('features', 'CLASS_CHOICE_REQUIRED', `Choose ${choice.choose} for ${choice.label}.`),
        );
      }
    }
  }

  // ── Species choices ────────────────────────────────────────────────────
  if (speciesRecord !== null) {
    for (const choice of speciesRecord.choices) {
      const selected = choices.speciesChoiceIds[choice.id];
      if (selected === undefined) {
        problems.push(unresolved('species', 'SPECIES_CHOICE_REQUIRED', `Choose ${choice.label}.`));
        continue;
      }
      if (!choice.from.some((option) => option.id === selected)) {
        problems.push(
          unresolved('species', 'SPECIES_CHOICE_INVALID', `That option is not available for ${choice.label}.`),
        );
      }
    }
  }

  // ── Ability scores ─────────────────────────────────────────────────────
  if (!ABILITY_METHODS.includes(choices.abilityMethod)) {
    problems.push(unresolved('abilities', 'ABILITY_METHOD_INVALID', 'Choose a supported ability-generation method.'));
  }

  if (
    choices.abilityMethod === 'rolled' &&
    (choices.rolledScorePool === null || choices.rolledScorePool.length !== 6)
  ) {
    problems.push(
      unresolved(
        'abilities',
        'ABILITY_ROLL_REQUIRED',
        `Roll for Ability Scores (up to ${MAX_ABILITY_ROLL_ATTEMPTS} times). Each roll replaces the previous one.`,
      ),
    );
  }

  const assigned = ABILITIES.map((ability) => choices.baseAbilityScores[ability]);
  if (assigned.some((score) => score === undefined)) {
    problems.push(
      unresolved('abilities', 'ABILITY_SCORES_INCOMPLETE', 'Assign a score to each of the six Ability Scores.'),
    );
  } else {
    const scores = assigned as number[];
    if (choices.abilityMethod === 'standard-array') {
      const sortedChosen = [...scores].sort((a, b) => b - a).join(',');
      const sortedArray = [...STANDARD_ARRAY].sort((a, b) => b - a).join(',');
      if (sortedChosen !== sortedArray) {
        problems.push(
          unresolved(
            'abilities',
            'STANDARD_ARRAY_MISMATCH',
            `The standard array assigns exactly ${STANDARD_ARRAY.join(', ')} across the six Ability Scores.`,
          ),
        );
      }
    } else if (choices.abilityMethod === 'point-buy') {
      const cost = pointBuyCost(scores);
      if (cost === null) {
        problems.push(
          unresolved('abilities', 'POINT_BUY_OUT_OF_RANGE', 'Point buy allows scores from 8 to 15 before Background increases.'),
        );
      } else if (cost > POINT_BUY_BUDGET) {
        problems.push(
          unresolved('abilities', 'POINT_BUY_OVER_BUDGET', `Point buy allows ${POINT_BUY_BUDGET} points. That array costs ${cost}.`),
        );
      }
    } else if (choices.abilityMethod === 'rolled' && choices.rolledScorePool !== null) {
      const sortedChosen = [...scores].sort((a, b) => b - a).join(',');
      const sortedPool = [...choices.rolledScorePool].sort((a, b) => b - a).join(',');
      if (sortedChosen !== sortedPool) {
        problems.push(
          unresolved(
            'abilities',
            'ROLLED_POOL_MISMATCH',
            `Assign exactly the rolled scores (${choices.rolledScorePool.join(', ')}) across the six Ability Scores.`,
          ),
        );
      }
    }
  }

  // ── Background ability increases ───────────────────────────────────────
  if (backgroundRecord !== null) {
    const bonuses = choices.backgroundAbilityBonuses;
    const entries = ABILITIES.map((ability) => [ability, bonuses[ability] ?? 0] as const).filter(
      ([, amount]) => amount !== 0,
    );
    const outsideBackground = entries.filter(
      ([ability]) => !backgroundRecord.abilityOptions.includes(ability),
    );
    const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
    const amounts = entries.map(([, amount]) => amount).sort((a, b) => b - a).join(',');
    const legalPattern = amounts === '2,1' || amounts === '1,1,1';

    if (outsideBackground.length > 0) {
      problems.push(
        unresolved(
          'background',
          'BACKGROUND_BONUS_NOT_AVAILABLE',
          `${backgroundRecord.label} increases only ${backgroundRecord.abilityOptions
            .map((ability) => ABILITY_LABELS[ability])
            .join(', ')}.`,
        ),
      );
    } else if (total === 0) {
      problems.push(
        unresolved('background', 'BACKGROUND_BONUS_REQUIRED', 'Assign the Background ability increases.'),
      );
    } else if (!legalPattern) {
      problems.push(
        unresolved(
          'background',
          'BACKGROUND_BONUS_PATTERN',
          'Background increases are either +2 and +1 across two abilities, or +1 to each of three.',
        ),
      );
    }
  }

  // ── Equipment ──────────────────────────────────────────────────────────
  if (classRecord !== null) {
    if (!classRecord.equipmentOptions.some((option) => option.id === choices.classEquipmentOptionId)) {
      problems.push(
        unresolved('equipment', 'CLASS_EQUIPMENT_REQUIRED', `Choose starting equipment for ${classRecord.label}.`),
      );
    }
  }
  if (backgroundRecord !== null) {
    if (!backgroundRecord.equipmentOptions.some((option) => option.id === choices.backgroundEquipmentOptionId)) {
      problems.push(
        unresolved('equipment', 'BACKGROUND_EQUIPMENT_REQUIRED', `Choose starting equipment for ${backgroundRecord.label}.`),
      );
    }
  }

  // ── Cantrips and spells ────────────────────────────────────────────────
  if (classRecord?.spellcasting != null) {
    const casting = classRecord.spellcasting;
    const legalCantrips = spellsForList(casting.spellListId, 0).map((spell) => spell.id);
    const legalSpells = spellsForList(casting.spellListId, 1).map((spell) => spell.id);

    if (choices.cantripIds.some((id) => !legalCantrips.includes(id))) {
      problems.push(
        unresolved('features', 'CANTRIP_NOT_ON_LIST', `A chosen cantrip is not on the ${classRecord.label} spell list.`),
      );
    }
    if (new Set(choices.cantripIds).size !== choices.cantripIds.length) {
      problems.push(unresolved('features', 'CANTRIP_DUPLICATE', 'Each cantrip must be different.'));
    }
    if (choices.cantripIds.length !== casting.cantripsKnown) {
      problems.push(
        unresolved('features', 'CANTRIP_COUNT', `Choose ${casting.cantripsKnown} cantrips. ${choices.cantripIds.length} chosen.`),
      );
    }

    if (choices.spellIds.some((id) => !legalSpells.includes(id))) {
      problems.push(
        unresolved('features', 'SPELL_NOT_ON_LIST', `A chosen spell is not on the ${classRecord.label} spell list.`),
      );
    }
    if (new Set(choices.spellIds).size !== choices.spellIds.length) {
      problems.push(unresolved('features', 'SPELL_DUPLICATE', 'Each spell must be different.'));
    }
    if (choices.spellIds.length !== casting.spellsAvailable) {
      const verb = casting.preparationStyle === 'prepared' ? 'prepare' : 'know';
      problems.push(
        unresolved('features', 'SPELL_COUNT', `Choose ${casting.spellsAvailable} level 1 spells to ${verb}. ${choices.spellIds.length} chosen.`),
      );
    }
  } else if (choices.cantripIds.length > 0 || choices.spellIds.length > 0) {
    problems.push(
      unresolved('features', 'SPELLS_NOT_AVAILABLE', 'This Class does not cast spells at level 1.'),
    );
  }

  // ── Identity, last ─────────────────────────────────────────────────────
  const name = choices.identity.name.trim();
  if (name.length === 0) {
    problems.push(unresolved('identity', 'NAME_REQUIRED', 'Give your character a name.'));
  } else if (name.length > CHARACTER_NAME_MAX_LENGTH) {
    problems.push(
      unresolved('identity', 'NAME_TOO_LONG', `A character name is at most ${CHARACTER_NAME_MAX_LENGTH} characters.`),
    );
  }
  for (const [field, label] of [
    ['pronouns', 'Pronouns'],
    ['appearance', 'Appearance'],
    ['concept', 'Concept'],
  ] as const) {
    if (choices.identity[field].length > CHARACTER_TEXT_MAX_LENGTH) {
      problems.push(
        unresolved('identity', 'IDENTITY_TEXT_TOO_LONG', `${label} is at most ${CHARACTER_TEXT_MAX_LENGTH} characters.`),
      );
    }
  }

  return problems;
}

/** Steps with nothing unresolved, so the wizard can show real progress. */
export function completedSteps(choices: CharacterChoices): readonly WizardStep[] {
  const problems = validateChoices(choices);
  return WIZARD_STEPS.filter((step) => !problems.some((problem) => problem.step === step));
}

function value(components: readonly { label: string; amount: number; ruleId: string }[]): DerivedValue {
  return { value: components.reduce((sum, part) => sum + part.amount, 0), components };
}

function equipmentOptionFor(
  options: readonly EquipmentOption[],
  id: string | null,
): EquipmentOption | null {
  return options.find((option) => option.id === id) ?? null;
}

/**
 * Best Armor Class available from the chosen equipment and features.
 *
 * Unarmored Defense replaces the ordinary formula only while its conditions
 * hold, so it is evaluated against the equipment actually chosen rather than
 * assumed from the Class alone.
 */
function deriveArmorClass(
  classRecord: ClassRecord,
  classEquipment: EquipmentOption | null,
  modifiers: Record<Ability, number>,
): DerivedValue {
  const armorIds = classEquipment?.armorIds ?? [];
  const bodyArmor = armorIds
    .map((id) => findArmor(id))
    .filter((armor): armor is NonNullable<typeof armor> => armor !== null && armor.category !== 'shield');
  const shield = armorIds.some((id) => findArmor(id)?.category === 'shield');

  if (classRecord.unarmoredDefenseAbility !== null && bodyArmor.length === 0) {
    // The Monk's Unarmored Defense also requires no Shield; the Barbarian's
    // permits one.
    const shieldBlocksIt = classRecord.id === 'monk' && shield;
    if (!shieldBlocksIt) {
      const components = [
        { label: 'Unarmored Defense base', amount: 10, ruleId: `class.${classRecord.id}.unarmored-defense` },
        { label: ABILITY_LABELS.dexterity, amount: modifiers.dexterity, ruleId: 'ability.dexterity' },
        {
          label: ABILITY_LABELS[classRecord.unarmoredDefenseAbility],
          amount: modifiers[classRecord.unarmoredDefenseAbility],
          ruleId: `ability.${classRecord.unarmoredDefenseAbility}`,
        },
      ];
      if (shield) {
        components.push({ label: 'Shield', amount: 2, ruleId: 'armor.shield' });
      }
      return value(components);
    }
  }

  const best = bodyArmor.sort((a, b) => b.baseArmorClass - a.baseArmorClass)[0];
  if (best === undefined) {
    const components = [
      { label: 'Unarmored base', amount: 10, ruleId: 'armor.unarmored' },
      { label: ABILITY_LABELS.dexterity, amount: modifiers.dexterity, ruleId: 'ability.dexterity' },
    ];
    if (shield) {
      components.push({ label: 'Shield', amount: 2, ruleId: 'armor.shield' });
    }
    return value(components);
  }

  const dexterityApplied =
    best.dexterityCap === null ? modifiers.dexterity : Math.min(modifiers.dexterity, best.dexterityCap);
  const components = [
    { label: best.label, amount: best.baseArmorClass, ruleId: `armor.${best.id}` },
    { label: ABILITY_LABELS.dexterity, amount: dexterityApplied, ruleId: 'ability.dexterity' },
  ];
  if (shield) {
    components.push({ label: 'Shield', amount: 2, ruleId: 'armor.shield' });
  }
  return value(components);
}

function deriveAttacks(
  classEquipment: EquipmentOption | null,
  modifiers: Record<Ability, number>,
  proficiencyBonus: number,
): readonly DerivedAttack[] {
  // Only the Class equipment option produces attack lines: the character is
  // proficient with everything in their own Class kit by construction, so no
  // proficiency has to be inferred. Background items are carried as
  // equipment without an attack line rather than assuming proficiency.
  const weaponIds = classEquipment?.weaponIds ?? [];
  return weaponIds
    .map((id) => findWeapon(id))
    .filter((weapon): weapon is NonNullable<typeof weapon> => weapon !== null)
    .map((weapon) => {
      const ranged = weapon.category.endsWith('ranged');
      const finesse = weapon.properties.includes('Finesse');
      const ability: Ability = ranged
        ? 'dexterity'
        : finesse && modifiers.dexterity > modifiers.strength
          ? 'dexterity'
          : 'strength';
      return {
        name: weapon.label,
        attackBonus: value([
          { label: ABILITY_LABELS[ability], amount: modifiers[ability], ruleId: `ability.${ability}` },
          { label: 'Proficiency Bonus', amount: proficiencyBonus, ruleId: 'proficiency-bonus' },
        ]),
        damage: weapon.damage,
        damageType: weapon.damageType,
        properties: weapon.properties,
        ruleId: `weapon.${weapon.id}`,
      };
    });
}

/**
 * The complete level-1 sheet, or null when Class, Background, or Species is
 * still unchosen. Ability scores may be incomplete; missing scores are
 * treated as unset rather than guessed, and the caller sees the gap through
 * `validateChoices`.
 */
export function deriveSheet(choices: CharacterChoices): DerivedCharacterSheet | null {
  const classRecord = findClass(choices.classId);
  const backgroundRecord = findBackground(choices.backgroundId);
  const speciesRecord = findSpecies(choices.speciesId);
  if (classRecord === null || backgroundRecord === null || speciesRecord === null) {
    return null;
  }

  const proficiencyBonus = value([
    { label: 'Level 1', amount: LEVEL_1_PROFICIENCY_BONUS, ruleId: 'proficiency-bonus.level-1' },
  ]);

  const abilityScores = {} as Record<Ability, DerivedValue>;
  const modifiers = {} as Record<Ability, number>;
  for (const ability of ABILITIES) {
    const base = choices.baseAbilityScores[ability] ?? 0;
    const backgroundBonus = choices.backgroundAbilityBonuses[ability] ?? 0;
    const components = [{ label: 'Base score', amount: base, ruleId: `ability-method.${choices.abilityMethod}` }];
    if (backgroundBonus !== 0) {
      components.push({
        label: `${backgroundRecord.label} increase`,
        amount: backgroundBonus,
        ruleId: `background.${backgroundRecord.id}.ability-increase`,
      });
    }
    const derived = value(components);
    abilityScores[ability] = derived;
    modifiers[ability] = abilityModifier(derived.value);
  }

  const hitPointComponents = [
    { label: `Hit Die maximum (d${classRecord.hitDie})`, amount: classRecord.hitDie, ruleId: `class.${classRecord.id}.hit-die` },
    { label: ABILITY_LABELS.constitution, amount: modifiers.constitution, ruleId: 'ability.constitution' },
  ];
  if (speciesRecord.hitPointsPerLevel > 0) {
    hitPointComponents.push({
      label: `${speciesRecord.label} Hit Points per level`,
      amount: speciesRecord.hitPointsPerLevel * STARTING_LEVEL,
      ruleId: `species.${speciesRecord.id}.hit-points`,
    });
  }

  const classEquipment = equipmentOptionFor(classRecord.equipmentOptions, choices.classEquipmentOptionId);
  const backgroundEquipment = equipmentOptionFor(
    backgroundRecord.equipmentOptions,
    choices.backgroundEquipmentOptionId,
  );

  // ── Proficiencies from every source ────────────────────────────────────
  const proficiencies: DerivedProficiency[] = [];
  const skillSources = new Map<string, string>();

  for (const skillId of choices.classSkillIds) {
    skillSources.set(skillId, classRecord.label);
  }
  for (const skillId of backgroundRecord.skillIds) {
    skillSources.set(skillId, backgroundRecord.label);
  }
  for (const choice of speciesRecord.choices) {
    if (choice.grantsSkillProficiency === true) {
      const selected = choices.speciesChoiceIds[choice.id];
      if (selected !== undefined && findSkill(selected) !== null) {
        skillSources.set(selected, speciesRecord.label);
      }
    }
  }

  for (const [skillId, source] of skillSources) {
    const skill = findSkill(skillId);
    if (skill !== null) {
      proficiencies.push({ id: `skill.${skillId}`, label: skill.label, sourceLabel: source, ruleId: `skill.${skillId}` });
    }
  }
  for (const armorProficiency of classRecord.armorProficiencies) {
    proficiencies.push({ id: `armor.${armorProficiency}`, label: armorProficiency, sourceLabel: classRecord.label, ruleId: `class.${classRecord.id}.armor` });
  }
  for (const weaponProficiency of classRecord.weaponProficiencies) {
    proficiencies.push({ id: `weapon.${weaponProficiency}`, label: weaponProficiency, sourceLabel: classRecord.label, ruleId: `class.${classRecord.id}.weapons` });
  }
  for (const toolProficiency of classRecord.toolProficiencies) {
    proficiencies.push({ id: `tool.${toolProficiency}`, label: toolProficiency, sourceLabel: classRecord.label, ruleId: `class.${classRecord.id}.tools` });
  }
  proficiencies.push({
    id: `tool.${backgroundRecord.toolProficiency}`,
    label: backgroundRecord.toolProficiency,
    sourceLabel: backgroundRecord.label,
    ruleId: `background.${backgroundRecord.id}.tool`,
  });

  const skills = SKILLS.map((skill) => {
    const proficient = skillSources.has(skill.id);
    const components = [
      { label: ABILITY_LABELS[skill.ability], amount: modifiers[skill.ability], ruleId: `ability.${skill.ability}` },
    ];
    if (proficient) {
      components.push({
        label: `Proficiency Bonus (${skillSources.get(skill.id) ?? ''})`,
        amount: proficiencyBonus.value,
        ruleId: 'proficiency-bonus',
      });
    }
    return { id: skill.id, label: skill.label, ability: skill.ability, proficient, bonus: value(components) };
  });

  const savingThrows = {} as Record<Ability, DerivedValue>;
  for (const ability of ABILITIES) {
    const proficient = classRecord.savingThrowProficiencies.includes(ability);
    const components = [
      { label: ABILITY_LABELS[ability], amount: modifiers[ability], ruleId: `ability.${ability}` },
    ];
    if (proficient) {
      components.push({ label: 'Proficiency Bonus', amount: proficiencyBonus.value, ruleId: 'proficiency-bonus' });
    }
    savingThrows[ability] = value(components);
  }

  const perception = skills.find((skill) => skill.id === 'perception');
  const passivePerception = value([
    { label: 'Passive base', amount: 10, ruleId: 'passive.base' },
    { label: 'Perception', amount: perception?.bonus.value ?? modifiers.wisdom, ruleId: 'skill.perception' },
  ]);

  const equipment = [
    ...(classEquipment?.items ?? []),
    ...(backgroundEquipment?.items ?? []),
  ].map((item) => ({ name: item.name, quantity: item.quantity }));

  const features = [
    ...classRecord.features.map((feature) => ({ name: feature.name, source: classRecord.label, summary: feature.summary })),
    ...speciesRecord.features.map((feature) => ({ name: feature.name, source: speciesRecord.label, summary: feature.summary })),
    { name: backgroundRecord.originFeat, source: backgroundRecord.label, summary: 'Origin feat granted by your Background.' },
  ];

  const casting = classRecord.spellcasting;
  const spellcasting = casting === null
    ? null
    : {
        ability: casting.ability,
        spellSaveDc: value([
          { label: 'Base', amount: 8, ruleId: 'spellcasting.save-dc-base' },
          { label: 'Proficiency Bonus', amount: proficiencyBonus.value, ruleId: 'proficiency-bonus' },
          { label: ABILITY_LABELS[casting.ability], amount: modifiers[casting.ability], ruleId: `ability.${casting.ability}` },
        ]),
        spellAttackBonus: value([
          { label: 'Proficiency Bonus', amount: proficiencyBonus.value, ruleId: 'proficiency-bonus' },
          { label: ABILITY_LABELS[casting.ability], amount: modifiers[casting.ability], ruleId: `ability.${casting.ability}` },
        ]),
        cantrips: choices.cantripIds
          .map((id) => findSpell(id))
          .filter((spell): spell is NonNullable<typeof spell> => spell !== null)
          .map((spell) => ({ id: spell.id, name: spell.label })),
        spells: choices.spellIds
          .map((id) => findSpell(id))
          .filter((spell): spell is NonNullable<typeof spell> => spell !== null)
          .map((spell) => ({ id: spell.id, name: spell.label })),
        level1SlotCount: casting.level1SlotCount,
        preparationStyle: casting.preparationStyle,
      };

  return {
    level: STARTING_LEVEL,
    experiencePoints: 0,
    proficiencyBonus,
    abilityScores,
    abilityModifiers: modifiers,
    hitPoints: value(hitPointComponents),
    hitDice: `1d${classRecord.hitDie}`,
    armorClass: deriveArmorClass(classRecord, classEquipment, modifiers),
    initiative: value([{ label: ABILITY_LABELS.dexterity, amount: modifiers.dexterity, ruleId: 'ability.dexterity' }]),
    speed: value([{ label: `${speciesRecord.label} Speed`, amount: speciesRecord.speed, ruleId: `species.${speciesRecord.id}.speed` }]),
    passivePerception,
    savingThrows,
    savingThrowProficiencies: classRecord.savingThrowProficiencies,
    skills,
    senses: speciesRecord.senses,
    proficiencies,
    languages: ['Common'],
    features,
    attacks: deriveAttacks(classEquipment, modifiers, proficiencyBonus.value),
    equipment,
    currencyGold: (classEquipment?.gold ?? 0) + (backgroundEquipment?.gold ?? 0),
    spellcasting,
  };
}

/**
 * The selectable options for the current draft state, so the wizard renders
 * only legal choices instead of offering something the server would reject
 * (Section 6.4: prevent incompatible selections rather than accepting them).
 */
export function buildDraftOptions(choices: CharacterChoices): DraftOptions {
  const classRecord = findClass(choices.classId);
  const speciesRecord = findSpecies(choices.speciesId);
  const backgroundRecord = findBackground(choices.backgroundId);

  return {
    catalog: buildCatalog(),
    quickStartTemplates: QUICK_START_TEMPLATES.map((template) => ({
      id: template.id,
      label: template.label,
      summary: template.summary,
    })),
    classDetail:
      classRecord === null
        ? null
        : {
            label: classRecord.label,
            hitDie: classRecord.hitDie,
            savingThrowProficiencies: classRecord.savingThrowProficiencies,
            skillChoiceCount: classRecord.skillChoiceCount,
            skillOptions: (classRecord.skillChoiceIds.length === 0
              ? SKILLS.map((skill) => skill.id)
              : classRecord.skillChoiceIds
            )
              .map((id) => findSkill(id))
              .filter((skill): skill is NonNullable<typeof skill> => skill !== null)
              .map((skill) => ({ id: skill.id, label: skill.label })),
            choices: classRecord.choices.map((choice) => ({
              id: choice.id,
              label: choice.label,
              choose: choice.choose,
              from: choice.from.map((option) => ({ id: option.id, label: option.label })),
            })),
            equipmentOptions: classRecord.equipmentOptions.map((option) => ({
              id: option.id,
              label: option.label,
              gold: option.gold,
            })),
            features: classRecord.features.map((feature) => ({ name: feature.name, summary: feature.summary })),
            spellcasting:
              classRecord.spellcasting === null
                ? null
                : {
                    abilityLabel: ABILITY_LABELS[classRecord.spellcasting.ability],
                    cantripsKnown: classRecord.spellcasting.cantripsKnown,
                    spellsAvailable: classRecord.spellcasting.spellsAvailable,
                    preparationStyle: classRecord.spellcasting.preparationStyle,
                    cantripOptions: spellsForList(classRecord.spellcasting.spellListId, 0).map((spell) => ({
                      id: spell.id,
                      label: spell.label,
                    })),
                    spellOptions: spellsForList(classRecord.spellcasting.spellListId, 1).map((spell) => ({
                      id: spell.id,
                      label: spell.label,
                    })),
                  },
          },
    speciesDetail:
      speciesRecord === null
        ? null
        : {
            label: speciesRecord.label,
            speed: speciesRecord.speed,
            size: speciesRecord.size,
            senses: speciesRecord.senses,
            features: speciesRecord.features.map((feature) => ({ name: feature.name, summary: feature.summary })),
            choices: speciesRecord.choices.map((choice) => ({
              id: choice.id,
              label: choice.label,
              choose: choice.choose,
              from: choice.from.map((option) => ({ id: option.id, label: option.label })),
            })),
          },
    backgroundDetail:
      backgroundRecord === null
        ? null
        : {
            label: backgroundRecord.label,
            abilityOptions: backgroundRecord.abilityOptions,
            originFeat: backgroundRecord.originFeat,
            skillLabels: backgroundRecord.skillIds
              .map((id) => findSkill(id)?.label ?? id)
              .filter((label) => label.length > 0),
            toolProficiency: backgroundRecord.toolProficiency,
            equipmentOptions: backgroundRecord.equipmentOptions.map((option) => ({
              id: option.id,
              label: option.label,
              gold: option.gold,
            })),
          },
  };
}

/** Labels for a committed character, resolved from the manifest. */
export function describeChoices(choices: CharacterChoices): {
  classLabel: string;
  speciesLabel: string;
  backgroundLabel: string;
} {
  return {
    classLabel: findClass(choices.classId)?.label ?? 'Unchosen',
    speciesLabel: findSpecies(choices.speciesId)?.label ?? 'Unchosen',
    backgroundLabel: findBackground(choices.backgroundId)?.label ?? 'Unchosen',
  };
}

export { RULES_VERSION };
