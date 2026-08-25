import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCatalog,
  buildDraftOptions,
  completedSteps,
  deriveSheet,
  emptyChoices,
  rollAbilityScorePool,
  sanitizeChoices,
  validateChoices,
} from '../../dist/server/rules/character-rules.js';
import {
  BACKGROUNDS,
  CLASSES,
  SPECIES,
  findClass,
  magicInitiateSpellListId,
  spellsForList,
} from '../../dist/server/rules/srd-manifest.js';
import { STANDARD_ARRAY, abilityModifier } from '../../dist/shared/character-contract.js';

/**
 * The character-creation rules engine.
 *
 * The engine is the only authority for whether a character is legal, so these
 * tests carry the weight: they check that it refuses illegal characters for
 * the right reason, that every derived number is both correct and explained,
 * and that all twelve supported classes have a complete legal journey.
 */

/** Builds a complete, legal character for the named class. */
function legalCharacterFor(classId, overrides = {}) {
  const classRecord = findClass(classId);
  const background = BACKGROUNDS.find((entry) => entry.id === overrides.backgroundId) ?? BACKGROUNDS[0];
  const species =
    SPECIES.find((entry) => entry.id === overrides.speciesId) ??
    SPECIES.find((entry) => entry.id === 'human');

  const skillPool =
    classRecord.skillChoiceIds.length === 0
      ? ['acrobatics', 'arcana', 'athletics', 'deception', 'history', 'insight']
      : classRecord.skillChoiceIds;

  const classSkillIds = skillPool
    .filter((id) => !background.skillIds.includes(id))
    .slice(0, classRecord.skillChoiceCount);
  const alreadyProficient = new Set([...background.skillIds, ...classSkillIds]);
  const speciesChoiceIds = {};
  for (const choice of species.choices) {
    if (choice.grantsSkillProficiency === true) {
      const pick = choice.from.find((option) => !alreadyProficient.has(option.id));
      speciesChoiceIds[choice.id] = (pick ?? choice.from[0]).id;
    } else {
      speciesChoiceIds[choice.id] = choice.from[0].id;
    }
  }
  const classChoiceIds = {};
  for (const choice of classRecord.choices) {
    classChoiceIds[choice.id] = choice.from.slice(0, choice.choose).map((option) => option.id);
  }

  const casting = classRecord.spellcasting;
  const cantripIds = casting === null
    ? []
    : spellsForList(casting.spellListId, 0).slice(0, casting.cantripsKnown).map((spell) => spell.id);
  const spellbookIds = casting?.spellbookSize
    ? spellsForList(casting.spellListId, 1).slice(0, casting.spellbookSize).map((spell) => spell.id)
    : [];
  const spellIds = casting === null
    ? []
    : spellsForList(casting.spellListId, 1).slice(0, casting.spellsAvailable).map((spell) => spell.id);

  const backgroundMagicListId = magicInitiateSpellListId(background.originFeat);
  const backgroundFeatCantripIds =
    backgroundMagicListId === null
      ? []
      : spellsForList(backgroundMagicListId, 0).slice(0, 2).map((spell) => spell.id);
  const backgroundFeatSpellIds =
    backgroundMagicListId === null
      ? []
      : spellsForList(backgroundMagicListId, 1).slice(0, 1).map((spell) => spell.id);

  const chosenOriginFeatId =
    species.id === 'human' ? (overrides.chosenOriginFeatId ?? 'Tough') : null;
  const humanMagicListId = magicInitiateSpellListId(chosenOriginFeatId);

  const base = {
    ...emptyChoices(),
    classId,
    backgroundId: background.id,
    speciesId: species.id,
    abilityMethod: 'standard-array',
    baseAbilityScores: {
      strength: 15,
      dexterity: 14,
      constitution: 13,
      intelligence: 12,
      wisdom: 10,
      charisma: 8,
    },
    backgroundAbilityBonuses: { [background.abilityOptions[0]]: 2, [background.abilityOptions[1]]: 1 },
    classSkillIds,
    speciesChoiceIds,
    classEquipmentOptionId: classRecord.equipmentOptions[0].id,
    backgroundEquipmentOptionId: background.equipmentOptions[0].id,
    cantripIds,
    spellbookIds,
    spellIds,
    chosenOriginFeatId,
    backgroundFeatCantripIds,
    backgroundFeatSpellIds,
    originFeatCantripIds:
      humanMagicListId === null ? [] : spellsForList(humanMagicListId, 0).slice(0, 2).map((spell) => spell.id),
    originFeatSpellIds:
      humanMagicListId === null ? [] : spellsForList(humanMagicListId, 1).slice(0, 1).map((spell) => spell.id),
    classChoiceIds,
    identity: { name: 'Test Character', pronouns: 'they/them', appearance: '', concept: '' },
  };
  const merged = { ...base, ...overrides };
  const finalSpecies = SPECIES.find((entry) => entry.id === merged.speciesId) ?? species;
  return {
    ...merged,
    chosenOriginFeatId:
      finalSpecies.id !== 'human'
        ? null
        : 'chosenOriginFeatId' in overrides
          ? overrides.chosenOriginFeatId ?? null
          : merged.chosenOriginFeatId ?? 'Tough',
  };
}

test('an empty draft reports every required decision and cannot be created', () => {
  const problems = validateChoices(emptyChoices());
  const codes = problems.map((problem) => problem.code);

  assert.ok(codes.includes('CLASS_REQUIRED'));
  assert.ok(codes.includes('BACKGROUND_REQUIRED'));
  assert.ok(codes.includes('SPECIES_REQUIRED'));
  assert.ok(codes.includes('ABILITY_SCORES_INCOMPLETE'));
  assert.ok(codes.includes('NAME_REQUIRED'));
  assert.equal(deriveSheet(emptyChoices()), null);
});

test('every supported class has a complete legal journey', () => {
  for (const entry of CLASSES) {
    const choices = legalCharacterFor(entry.id);
    const problems = validateChoices(choices);
    assert.deepEqual(
      problems.map((problem) => `${problem.code}: ${problem.message}`),
      [],
      `${entry.id} could not produce a legal character`,
    );

    const sheet = deriveSheet(choices);
    assert.notEqual(sheet, null, `${entry.id} produced no sheet`);
    assert.equal(sheet.level, 1);
    assert.equal(sheet.experiencePoints, 0);
    assert.equal(sheet.proficiencyBonus.value, 2);
    assert.ok(sheet.hitPoints.value > 0, `${entry.id} derived non-positive Hit Points`);
    assert.ok(sheet.armorClass.value >= 10, `${entry.id} derived an Armor Class below 10`);
    assert.equal(completedSteps(choices).length, 7, `${entry.id} did not complete every wizard step`);
  }
});

test('identity is last: a mechanically complete character is still blocked without a name', () => {
  const choices = legalCharacterFor('fighter', { identity: { name: '', pronouns: '', appearance: '', concept: '' } });
  const problems = validateChoices(choices);

  assert.deepEqual(
    problems.map((problem) => problem.code),
    ['NAME_REQUIRED'],
    'only the name should be missing',
  );
  // Every mechanical step is finished; only Identity remains.
  assert.deepEqual([...completedSteps(choices)].sort(), [
    'abilities',
    'background',
    'class',
    'equipment',
    'features',
    'species',
  ]);
});

test('Hit Points derive from the Hit Die, Constitution, and species bonuses, and explain themselves', () => {
  // Dwarf grants +1 Hit Point per level; Barbarian has a d12 Hit Die.
  const choices = legalCharacterFor('barbarian', {
    speciesId: 'dwarf',
    speciesChoiceIds: {},
    baseAbilityScores: { strength: 15, dexterity: 14, constitution: 15, intelligence: 12, wisdom: 10, charisma: 8 },
    backgroundAbilityBonuses: { intelligence: 2, wisdom: 1 },
  });

  const sheet = deriveSheet(choices);
  const constitutionModifier = abilityModifier(15);
  assert.equal(sheet.hitPoints.value, 12 + constitutionModifier + 1);

  const labels = sheet.hitPoints.components.map((component) => component.label);
  assert.ok(labels.some((label) => label.includes('Hit Die')));
  assert.ok(labels.includes('Constitution'));
  assert.ok(labels.some((label) => label.includes('Dwarf')));
  for (const component of sheet.hitPoints.components) {
    assert.ok(component.ruleId.length > 0, 'every component names the rule it came from');
  }
});

test('Armor Class uses worn armor with its Dexterity cap, and adds a Shield', () => {
  // The Cleric kit is a Chain Shirt (base 13, Dexterity capped at 2) plus a Shield.
  const choices = legalCharacterFor('cleric', {
    baseAbilityScores: { strength: 13, dexterity: 15, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 },
    backgroundAbilityBonuses: { intelligence: 2, wisdom: 1 },
  });
  const sheet = deriveSheet(choices);

  // Dexterity 15 is a +2 modifier, which is exactly at the medium-armor cap.
  assert.equal(sheet.armorClass.value, 13 + 2 + 2);
  assert.ok(sheet.armorClass.components.some((component) => component.label === 'Shield'));
});

test('Fighting Style Defense adds +1 Armor Class while wearing armor', () => {
  const withDefense = legalCharacterFor('fighter', {
    classChoiceIds: { 'fighting-style': ['defense'] },
    classEquipmentOptionId: 'fighter-a',
  });
  const withoutDefense = legalCharacterFor('fighter', {
    classChoiceIds: { 'fighting-style': ['archery'] },
    classEquipmentOptionId: 'fighter-a',
  });
  const defended = deriveSheet(withDefense);
  const undefeated = deriveSheet(withoutDefense);

  assert.equal(defended.armorClass.value, undefeated.armorClass.value + 1);
  assert.ok(
    defended.armorClass.components.some((component) => component.label === 'Fighting Style: Defense'),
  );
  assert.ok(
    defended.features.some((feature) => feature.name === 'Fighting Style: Defense'),
    'Chosen fighting style must appear on the sheet by name',
  );
});

test('species choices appear on the sheet with their selected option label', () => {
  const choices = legalCharacterFor('fighter', {
    speciesId: 'goliath',
    speciesChoiceIds: { 'giant-ancestry': 'stone' },
  });
  const sheet = deriveSheet(choices);
  const feature = sheet.features.find((entry) => entry.name === "Giant Ancestry: Stone's Endurance");
  assert.ok(feature);
  assert.match(feature.summary, /Reaction/i);
});

test('Fighting Style Archery adds +2 to ranged attack rolls', () => {
  const choices = legalCharacterFor('fighter', {
    classChoiceIds: { 'fighting-style': ['archery'] },
    classEquipmentOptionId: 'fighter-b',
  });
  const sheet = deriveSheet(choices);
  const longbow = sheet.attacks.find((attack) => attack.name === 'Longbow');
  assert.ok(longbow);
  assert.ok(longbow.attackBonus.components.some((component) => component.label === 'Fighting Style: Archery'));
});

test('Unarmored Defense replaces the ordinary Armor Class formula for the Barbarian', () => {
  const choices = legalCharacterFor('barbarian', {
    baseAbilityScores: { strength: 15, dexterity: 14, constitution: 14, intelligence: 12, wisdom: 10, charisma: 8 },
    backgroundAbilityBonuses: { intelligence: 2, wisdom: 1 },
  });
  const sheet = deriveSheet(choices);

  // The Barbarian kit carries no armor, so 10 + Dexterity + Constitution applies.
  assert.equal(sheet.armorClass.value, 10 + abilityModifier(14) + abilityModifier(14));
  assert.ok(
    sheet.armorClass.components.some((component) => component.ruleId.includes('unarmored-defense')),
  );
});

test('skill proficiency comes from every source and is reflected in the bonus', () => {
  const choices = legalCharacterFor('rogue', {
    backgroundId: 'acolyte',
    backgroundAbilityBonuses: { intelligence: 2, wisdom: 1 },
  });
  const sheet = deriveSheet(choices);

  // The Acolyte Background grants Insight and Religion regardless of Class.
  const insight = sheet.skills.find((skill) => skill.id === 'insight');
  assert.equal(insight.proficient, true);
  assert.equal(
    insight.bonus.value,
    sheet.abilityModifiers.wisdom + sheet.proficiencyBonus.value,
  );

  const untrained = sheet.skills.find((skill) => !skill.proficient);
  assert.equal(untrained.bonus.value, sheet.abilityModifiers[untrained.ability]);
});

test('saving throw proficiencies match the class and are applied once', () => {
  const choices = legalCharacterFor('wizard');
  const sheet = deriveSheet(choices);

  assert.deepEqual([...sheet.savingThrowProficiencies].sort(), ['intelligence', 'wisdom']);
  assert.equal(
    sheet.savingThrows.intelligence.value,
    sheet.abilityModifiers.intelligence + sheet.proficiencyBonus.value,
  );
  assert.equal(sheet.savingThrows.strength.value, sheet.abilityModifiers.strength);
});

test('the standard array must be assigned exactly, and point buy must stay in budget', () => {
  const overArray = legalCharacterFor('fighter', {
    baseAbilityScores: { strength: 15, dexterity: 15, constitution: 15, intelligence: 15, wisdom: 15, charisma: 15 },
  });
  assert.ok(validateChoices(overArray).some((problem) => problem.code === 'STANDARD_ARRAY_MISMATCH'));

  const legalArray = legalCharacterFor('fighter');
  assert.deepEqual(
    [...Object.values(legalArray.baseAbilityScores)].sort((a, b) => b - a),
    [...STANDARD_ARRAY].sort((a, b) => b - a),
  );

  const overBudget = legalCharacterFor('fighter', {
    abilityMethod: 'point-buy',
    baseAbilityScores: { strength: 15, dexterity: 15, constitution: 15, intelligence: 15, wisdom: 15, charisma: 15 },
  });
  assert.ok(validateChoices(overBudget).some((problem) => problem.code === 'POINT_BUY_OVER_BUDGET'));

  const outOfRange = legalCharacterFor('fighter', {
    abilityMethod: 'point-buy',
    baseAbilityScores: { strength: 18, dexterity: 8, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8 },
  });
  assert.ok(validateChoices(outOfRange).some((problem) => problem.code === 'POINT_BUY_OUT_OF_RANGE'));

  const withinBudget = legalCharacterFor('fighter', {
    abilityMethod: 'point-buy',
    baseAbilityScores: { strength: 15, dexterity: 14, constitution: 13, intelligence: 10, wisdom: 10, charisma: 8 },
  });
  assert.deepEqual(validateChoices(withinBudget), []);
});

test('background ability increases must follow the SRD pattern and stay on the background list', () => {
  const wrongPattern = legalCharacterFor('fighter', {
    backgroundAbilityBonuses: { intelligence: 3 },
  });
  assert.ok(validateChoices(wrongPattern).some((problem) => problem.code === 'BACKGROUND_BONUS_PATTERN'));

  const wrongAbility = legalCharacterFor('fighter', {
    backgroundId: 'acolyte',
    backgroundAbilityBonuses: { strength: 2, dexterity: 1 },
  });
  assert.ok(
    validateChoices(wrongAbility).some((problem) => problem.code === 'BACKGROUND_BONUS_NOT_AVAILABLE'),
    'Acolyte increases only Intelligence, Wisdom, or Charisma',
  );

  const threeOnes = legalCharacterFor('fighter', {
    backgroundId: 'acolyte',
    backgroundAbilityBonuses: { intelligence: 1, wisdom: 1, charisma: 1 },
  });
  assert.deepEqual(validateChoices(threeOnes), []);
});

test('a skill outside the class list is refused rather than silently accepted', () => {
  // Arcana is not on the Barbarian skill list.
  const choices = legalCharacterFor('barbarian', { classSkillIds: ['arcana', 'athletics'] });
  const problems = validateChoices(choices);
  assert.ok(problems.some((problem) => problem.code === 'CLASS_SKILL_NOT_AVAILABLE'));
});

test('duplicate skill selections are refused', () => {
  const choices = legalCharacterFor('barbarian', { classSkillIds: ['athletics', 'athletics'] });
  assert.ok(validateChoices(choices).some((problem) => problem.code === 'CLASS_SKILL_DUPLICATE'));
});

test('background-granted class skills are dropped so wizard plus sage stays legal', () => {
  const overlapping = {
    ...emptyChoices(),
    classId: 'wizard',
    backgroundId: 'sage',
    classSkillIds: ['arcana', 'investigation'],
  };
  const sanitized = sanitizeChoices(overlapping);
  assert.deepEqual(sanitized.classSkillIds, ['investigation']);
  assert.ok(
  !validateChoices(sanitized).some((problem) => problem.code === 'CLASS_SKILL_BACKGROUND_OVERLAP'),
    'overlap should be removed, not reported as a blocker',
  );
  assert.ok(
    validateChoices(sanitized).some((problem) => problem.code === 'CLASS_SKILL_COUNT'),
    'one class pick remains after arcana is granted by sage',
  );

  const repaired = sanitizeChoices({
    ...overlapping,
    classSkillIds: ['arcana', 'investigation', 'insight'],
  });
  assert.deepEqual(repaired.classSkillIds, ['investigation', 'insight']);
  const repairedProblems = validateChoices(repaired);
  assert.ok(
    !repairedProblems.some((problem) => problem.step === 'class'),
    'class skill overlap and count should be resolved after sanitization',
  );
});

test('magic initiate backgrounds require feat cantrip and spell picks', () => {
  const incomplete = {
    ...emptyChoices(),
    classId: 'wizard',
    backgroundId: 'sage',
    speciesId: 'dwarf',
    classSkillIds: ['insight', 'investigation'],
    backgroundAbilityBonuses: { intelligence: 2, constitution: 1 },
    classEquipmentOptionId: 'wizard-a',
    backgroundEquipmentOptionId: 'sage-kit',
    cantripIds: ['fire-bolt', 'mage-hand', 'prestidigitation'],
    spellIds: ['burning-hands', 'shield', 'magic-missile', 'sleep'],
  };
  const problems = validateChoices(incomplete);
  assert.ok(problems.some((problem) => problem.code === 'BACKGROUND_FEAT_CANTRIP_COUNT'));
  assert.ok(problems.some((problem) => problem.code === 'BACKGROUND_FEAT_SPELL_COUNT'));

  const complete = {
    ...incomplete,
    backgroundFeatCantripIds: ['ray-of-frost', 'shocking-grasp'],
    backgroundFeatSpellIds: ['detect-magic'],
    identity: { name: 'Sage Wizard', pronouns: 'they/them', appearance: '', concept: '' },
    baseAbilityScores: {
      strength: 8,
      dexterity: 14,
      constitution: 13,
      intelligence: 15,
      wisdom: 12,
      charisma: 10,
    },
  };
  assert.ok(
    !validateChoices(complete).some((problem) => problem.code.startsWith('BACKGROUND_FEAT_')),
    'background magic initiate picks should satisfy feat validation',
  );
});

test('humans must choose a versatile origin feat', () => {
  const incomplete = legalCharacterFor('fighter', { speciesId: 'human', chosenOriginFeatId: null });
  assert.ok(validateChoices(incomplete).some((problem) => problem.code === 'ORIGIN_FEAT_REQUIRED'));

  const withFeat = legalCharacterFor('fighter', { speciesId: 'human', chosenOriginFeatId: 'Tough' });
  assert.ok(!validateChoices(withFeat).some((problem) => problem.code === 'ORIGIN_FEAT_REQUIRED'));
});

test('spells must come from the class list, in the right number', () => {
  const wizard = legalCharacterFor('wizard');
  assert.deepEqual(validateChoices(wizard), []);

  const offList = legalCharacterFor('wizard', { spellIds: ['cure-wounds', 'bless', 'bane', 'guiding-bolt'] });
  assert.ok(validateChoices(offList).some((problem) => problem.code === 'SPELL_NOT_ON_LIST'));

  const tooFew = legalCharacterFor('wizard', { spellIds: ['magic-missile'] });
  assert.ok(validateChoices(tooFew).some((problem) => problem.code === 'SPELL_COUNT'));

  const duplicated = legalCharacterFor('wizard', {
    cantripIds: ['fire-bolt', 'fire-bolt', 'light'],
  });
  assert.ok(validateChoices(duplicated).some((problem) => problem.code === 'CANTRIP_DUPLICATE'));
});

test('a non-casting class cannot carry spells', () => {
  const choices = legalCharacterFor('fighter', { spellIds: ['magic-missile'] });
  assert.ok(validateChoices(choices).some((problem) => problem.code === 'SPELLS_NOT_AVAILABLE'));
});

test('spellcasting statistics derive from the class ability', () => {
  const choices = legalCharacterFor('wizard', {
    baseAbilityScores: { strength: 8, dexterity: 14, constitution: 13, intelligence: 15, wisdom: 12, charisma: 10 },
    backgroundAbilityBonuses: { intelligence: 2, wisdom: 1 },
  });
  const sheet = deriveSheet(choices);

  // Intelligence 15 plus the Acolyte-style +2 gives 17, a +3 modifier.
  assert.equal(sheet.abilityScores.intelligence.value, 17);
  assert.equal(sheet.spellcasting.spellSaveDc.value, 8 + 2 + 3);
  assert.equal(sheet.spellcasting.spellAttackBonus.value, 2 + 3);
  assert.equal(sheet.spellcasting.preparationStyle, 'prepared');
  assert.equal(sheet.spellcasting.level1SlotCount, 2);
});

test('attacks derive from the class equipment and use the right ability', () => {
  const choices = legalCharacterFor('rogue', {
    baseAbilityScores: { strength: 10, dexterity: 15, constitution: 14, intelligence: 13, wisdom: 12, charisma: 8 },
    backgroundAbilityBonuses: { intelligence: 2, wisdom: 1 },
  });
  const sheet = deriveSheet(choices);

  const shortsword = sheet.attacks.find((attack) => attack.name === 'Shortsword');
  assert.notEqual(shortsword, undefined);
  // Shortsword has Finesse, and Dexterity beats Strength here.
  assert.equal(shortsword.attackBonus.value, sheet.abilityModifiers.dexterity + 2);
  assert.equal(shortsword.damage, '1d6');
});

test('passive Perception follows the Perception skill, including proficiency', () => {
  const choices = legalCharacterFor('ranger', { classSkillIds: ['perception', 'stealth', 'survival'] });
  const sheet = deriveSheet(choices);
  const perception = sheet.skills.find((skill) => skill.id === 'perception');

  assert.equal(perception.proficient, true);
  assert.equal(sheet.passivePerception.value, 10 + perception.bonus.value);
});

test('the wizard offers only options the current selections allow', () => {
  const options = buildDraftOptions(legalCharacterFor('cleric'));

  assert.equal(options.classDetail.label, 'Cleric');
  assert.equal(options.classDetail.spellcasting.abilityLabel, 'Wisdom');
  assert.ok(options.classDetail.skillOptions.every((option) => option.id !== 'stealth'));
  assert.ok(options.classDetail.choices.some((choice) => choice.id === 'divine-order'));

  const empty = buildDraftOptions(emptyChoices());
  assert.equal(empty.classDetail, null);
  assert.equal(empty.speciesDetail, null);
  assert.equal(empty.backgroundDetail, null);
  assert.equal(empty.catalog.classes.length, 12);
});

test('the catalog exposes every option the manifest supports', () => {
  const catalog = buildCatalog();
  assert.equal(catalog.classes.length, 12);
  assert.equal(catalog.species.length, 10);
  assert.equal(catalog.backgrounds.length, 16);
  assert.equal(catalog.skills.length, 18);
});

test('rolled Ability Scores must match the server pool and require a roll first', () => {
  const needsRoll = legalCharacterFor('fighter', {
    abilityMethod: 'rolled',
    rolledScorePool: null,
    abilityRollAttempts: 0,
    baseAbilityScores: {},
  });
  assert.ok(validateChoices(needsRoll).some((problem) => problem.code === 'ABILITY_ROLL_REQUIRED'));

  const pool = [15, 14, 13, 12, 10, 9];
  const mismatch = legalCharacterFor('fighter', {
    abilityMethod: 'rolled',
    rolledScorePool: pool,
    abilityRollAttempts: 1,
    baseAbilityScores: {
      strength: 15,
      dexterity: 14,
      constitution: 13,
      intelligence: 12,
      wisdom: 10,
      charisma: 8,
    },
  });
  assert.ok(validateChoices(mismatch).some((problem) => problem.code === 'ROLLED_POOL_MISMATCH'));

  const legal = legalCharacterFor('fighter', {
    abilityMethod: 'rolled',
    rolledScorePool: pool,
    abilityRollAttempts: 1,
    baseAbilityScores: {
      strength: 15,
      dexterity: 14,
      constitution: 13,
      intelligence: 12,
      wisdom: 10,
      charisma: 9,
    },
  });
  assert.deepEqual(validateChoices(legal), []);
});

test('4d6 drop-lowest pool generation drops the lowest die', () => {
  let call = 0;
  // Four dice per score: 1,2,3,4 → drop 1 → 9. Six scores.
  const die = () => {
    const sequence = [1, 2, 3, 4];
    const value = sequence[call % 4];
    call += 1;
    return value;
  };
  const pool = rollAbilityScorePool(die);
  assert.equal(pool.length, 6);
  assert.ok(pool.every((score) => score === 9));
});

test('species skill-choice labels are plain English, not “Skillful skill proficiency”', () => {
  const human = SPECIES.find((entry) => entry.id === 'human');
  const skillful = human.choices.find((choice) => choice.id === 'human-skillful');
  assert.ok(skillful);
  assert.match(skillful.label, /Skillful/i);
  assert.doesNotMatch(skillful.label, /Skillful skill proficiency/i);

  const elf = SPECIES.find((entry) => entry.id === 'elf');
  const keen = elf.choices.find((choice) => choice.id === 'elf-keen-senses');
  assert.ok(keen);
  assert.match(keen.label, /Keen Senses/i);
  assert.doesNotMatch(keen.label, /Keen Senses skill proficiency/i);
});

test('Alert adds proficiency bonus to initiative, not a flat +5', () => {
  const choices = legalCharacterFor('fighter', { backgroundId: 'criminal' });
  const sheet = deriveSheet(choices);
  const alert = sheet.initiative.components.find((component) => component.ruleId === 'feat.alert.initiative');
  assert.ok(alert);
  assert.equal(alert.amount, sheet.proficiencyBonus.value);
  assert.equal(alert.amount, 2);
  assert.equal(
    sheet.initiative.value,
    sheet.abilityModifiers.dexterity + sheet.proficiencyBonus.value,
  );
});

test('level-1 Fighter sheets omit Action Surge; mastery lists starting weapons', () => {
  const choices = legalCharacterFor('fighter', { classEquipmentOptionId: 'fighter-a' });
  const sheet = deriveSheet(choices);
  assert.equal((sheet.classResources ?? []).some((resource) => resource.id === 'action-surge'), false);
  assert.ok((sheet.classResources ?? []).some((resource) => resource.id === 'second-wind'));
  assert.ok((sheet.weaponMasteries ?? []).length >= 1);
  assert.ok(
    /Champion|level 3|fighting style/i.test(sheet.subclassLabel ?? ''),
    `unexpected subclassLabel: ${sheet.subclassLabel}`,
  );
});

test('PQA-195 Human Versatile names the Origin feat separately from the Background feat', () => {
  const choices = legalCharacterFor('fighter', {
    speciesId: 'human',
    backgroundId: 'soldier',
    chosenOriginFeatId: 'Tough',
  });
  const sheet = deriveSheet(choices);
  const versatile = sheet.features.find((feature) => feature.name.startsWith('Versatile:'));
  assert.ok(versatile, 'expected Versatile: Feat feature');
  assert.equal(versatile.name, 'Versatile: Tough');
  assert.match(versatile.source, /Human.*Versatile/i);
  assert.equal(
    sheet.features.some((feature) => feature.name === 'Versatile'),
    false,
    'bare Versatile line must be dropped once a feat is chosen',
  );
  const backgroundFeat = sheet.features.find((feature) => feature.name === 'Savage Attacker' || feature.source.includes('Soldier'));
  assert.ok(backgroundFeat || sheet.features.some((feature) => /Soldier/i.test(feature.source)));
});

test('PQA-211 Fighter mastery slots pad Unassigned and honor explicit picks', () => {
  const auto = deriveSheet(legalCharacterFor('fighter', { classEquipmentOptionId: 'fighter-a' }));
  assert.equal(auto.weaponMasterySlotCount, 3);
  assert.equal((auto.weaponMasteries ?? []).length, 3);
  assert.ok((auto.weaponMasteries ?? []).some((entry) => entry.assigned === false || entry.name === 'Unassigned'));

  const explicit = deriveSheet(
    legalCharacterFor('fighter', {
      classEquipmentOptionId: 'fighter-a',
      weaponMasteryWeaponNames: ['Longsword', 'Longbow'],
    }),
  );
  const assigned = (explicit.weaponMasteries ?? []).filter((entry) => entry.assigned !== false);
  assert.equal(assigned.length, 2);
  assert.deepEqual(
    assigned.map((entry) => entry.name).sort(),
    ['Longbow', 'Longsword'],
  );
  assert.equal((explicit.weaponMasteries ?? []).filter((entry) => entry.assigned === false).length, 1);

  const options = buildDraftOptions(legalCharacterFor('fighter'));
  assert.notEqual(options.weaponMastery, null);
  assert.equal(options.weaponMastery.slotCount, 3);
  assert.ok(options.weaponMastery.options.some((option) => option.id === 'Longbow'));
});
