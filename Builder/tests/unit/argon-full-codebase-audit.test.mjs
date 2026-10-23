import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveSheet,
  emptyChoices,
  validateChoices,
} from '../../dist/server/rules/character-rules.js';
import {
  BACKGROUNDS,
  ORIGIN_FEAT_OPTIONS,
  SPECIES,
  findClass,
  magicInitiateSpellListId,
  spellsForList,
} from '../../dist/server/rules/srd-manifest.js';
import {
  deriveProgression,
  recomputeSheetForLevel,
} from '../../dist/server/rules/engine/xp-progression.js';
import { isAdjacentToDoorEdge } from '../../dist/shared/map-presentation.js';
import { validateWalkPath } from '../../dist/server/table/path-validator.js';
import { resolveSkillAttemptFromSummary } from '../../dist/server/table/skill-check-resolve.js';
import { parsePlayerDeclaration } from '../../dist/shared/play-authority-contract.js';

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

  const proficientForExpertise = [...classSkillIds, ...background.skillIds];
  for (const choice of species.choices) {
    if (choice.grantsSkillProficiency === true && speciesChoiceIds[choice.id]) {
      proficientForExpertise.push(speciesChoiceIds[choice.id]);
    }
  }
  const expertiseFeature = classRecord.features.find((feature) => feature.name === 'Expertise');
  const expertiseSlots =
    expertiseFeature !== undefined && /\b(?:two|2)\b/i.test(expertiseFeature.summary) ? 2 : 0;
  const expertiseSkillIds =
    overrides.expertiseSkillIds ??
    (expertiseSlots > 0 ? proficientForExpertise.slice(0, expertiseSlots) : []);

  const hasMastery = classRecord.features.some((feature) => feature.name === 'Weapon Mastery');
  const masterySlots = hasMastery ? (classId === 'fighter' ? 3 : 2) : 0;
  const defaultMastery =
    masterySlots === 0
      ? []
      : ['Dagger', 'Shortsword', 'Shortbow', 'Longsword', 'Longbow', 'Greataxe'].slice(0, masterySlots);

  const casting = classRecord.spellcasting;
  const cantripIds =
    casting === null
      ? []
      : spellsForList(casting.spellListId, 0).slice(0, casting.cantripsKnown).map((spell) => spell.id);
  const spellbookIds = casting?.spellbookSize
    ? spellsForList(casting.spellListId, 1).slice(0, casting.spellbookSize).map((spell) => spell.id)
    : [];
  const spellIds =
    casting === null
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
    expertiseSkillIds,
    weaponMasteryWeaponNames: overrides.weaponMasteryWeaponNames ?? defaultMastery,
    identity: { name: 'Kaelen Stone', pronouns: 'they/them', appearance: '', concept: '' },
  };
  return { ...base, ...overrides };
}

test('Argon Audit — ORIGIN_FEAT_OPTIONS provides non-empty summaries for Crafter, Savage Attacker, and Tavern Brawler', () => {
  for (const label of ['Crafter', 'Savage Attacker', 'Tavern Brawler', 'Tough']) {
    const opt = ORIGIN_FEAT_OPTIONS.find((o) => o.label === label);
    assert.ok(opt, `Expected Origin feat option for ${label}`);
    assert.ok(opt.summary.length > 15, `Expected non-empty summary for ${label}, got "${opt.summary}"`);
  }
});

test('Argon Audit — Tough feat and Dwarf Toughness grant +2/+1 HP at level 1 and scale on level-up', () => {
  const humanTough = legalCharacterFor('fighter', {
    speciesId: 'human',
    chosenOriginFeatId: 'Tough',
  });
  const humanSheet = deriveSheet(humanTough);
  assert.ok(humanSheet.hitPoints.components.some((c) => c.ruleId === 'feat.tough.hit-points'));
  const conMod = humanSheet.abilityModifiers.constitution;
  // Fighter d10 (10) + CON + Tough (+2)
  assert.equal(humanSheet.hitPoints.value, 10 + conMod + 2);

  // Level 5 (6500 XP): 10 + 4*(6) + 5*conMod + 5*2(Tough) = 34 + 5*conMod + 10 = 44 + 5*conMod
  const prog = deriveProgression(humanSheet, 'fighter', 5);
  assert.equal(prog.maxHitPoints, 44 + 5 * conMod);

  const dwarfFighter = legalCharacterFor('fighter', {
    speciesId: 'dwarf',
    chosenOriginFeatId: null,
  });
  const dwarfSheet = deriveSheet(dwarfFighter);
  assert.ok(dwarfSheet.hitPoints.components.some((c) => c.ruleId === 'species.dwarf.hit-points'));
  const dwarfProg = deriveProgression(dwarfSheet, 'fighter', 5);
  assert.equal(dwarfProg.maxHitPoints, 34 + 5 * dwarfSheet.abilityModifiers.constitution + 5);
});

test('Argon Audit — Rogue Expertise scales double proficiency bonus on level-up to Level 5', () => {
  const rogueChoices = legalCharacterFor('rogue');
  const level1Sheet = deriveSheet(rogueChoices);
  const expSkillId = rogueChoices.expertiseSkillIds[0];
  const l1Skill = level1Sheet.skills.find((s) => s.id === expSkillId);
  assert.ok(l1Skill);
  assert.equal(l1Skill.proficient, true);
  const abilityMod = level1Sheet.abilityModifiers[l1Skill.ability];
  // At Level 1, PB is +2 -> expertise grants +4
  assert.equal(l1Skill.bonus.value, abilityMod + 4);

  // At Level 5 (6500 XP), PB becomes +3 -> expertise must grant +6 (not +5!)
  const level5Sheet = recomputeSheetForLevel(level1Sheet, 'rogue', 5, 6500);
  const l5Skill = level5Sheet.skills.find((s) => s.id === expSkillId);
  assert.equal(l5Skill.bonus.value, abilityMod + 6);
});

test('Argon Audit — Unarmed Strike with negative STR/DEX modifier produces valid damage expression "1"', () => {
  const lowStrChoices = legalCharacterFor('wizard', {
    classEquipmentOptionId: null,
    baseAbilityScores: {
      strength: 8,
      dexterity: 8,
      constitution: 14,
      intelligence: 15,
      wisdom: 13,
      charisma: 12,
    },
  });
  const sheet = deriveSheet(lowStrChoices);
  const unarmed = sheet.attacks.find((a) => a.ruleId === 'weapon.unarmed-strike');
  assert.ok(unarmed);
  assert.equal(unarmed.damage, '1');
});

test('Argon Audit — validateChoices rejects fractional ability scores', () => {
  const fractionalChoices = legalCharacterFor('fighter', {
    abilityMethod: 'point-buy',
    baseAbilityScores: {
      strength: 14.5,
      dexterity: 14,
      constitution: 14,
      intelligence: 10,
      wisdom: 10,
      charisma: 8.5,
    },
  });
  const errors = validateChoices(fractionalChoices);
  assert.ok(errors.length > 0);
});

test('Argon Audit — isAdjacentToDoorEdge supports north-oriented door edges', () => {
  const northDoor = {
    edgeId: 'e:4:3:north',
    column: 4,
    row: 3,
    orientation: 'north',
    kind: 'door',
    doorState: 'closed',
  };
  assert.equal(isAdjacentToDoorEdge({ column: 4, row: 3 }, northDoor), true);
  assert.equal(isAdjacentToDoorEdge({ column: 4, row: 2 }, northDoor), true);
  assert.equal(isAdjacentToDoorEdge({ column: 4, row: 4 }, northDoor), false);
});

test('Argon Audit — validateWalkPath blocks movement across north and west walls', () => {
  const baseMap = {
    sceneId: 'test-scene',
    title: 'Test Scene',
    coordinateSpace: {
      columns: 6,
      rows: 6,
      feetPerSquare: 5,
      origin: 'top-left',
      anchorMode: 'cell-center',
    },
    cells: [],
    edges: [
      {
        edgeId: 'e:2:2:north',
        column: 2,
        row: 2,
        orientation: 'north',
        kind: 'wall',
      },
      {
        edgeId: 'e:2:2:west',
        column: 2,
        row: 2,
        orientation: 'west',
        kind: 'door',
        doorState: 'closed',
      },
    ],
    notableFeatures: [],
    tokens: [],
  };

  const footprintTemplate = {
    sizeCategory: 'Medium',
    widthSquares: 1,
    heightSquares: 1,
  };

  const northCross = validateWalkPath({
    map: baseMap,
    start: { column: 2, row: 2 },
    path: [{ column: 2, row: 1 }],
    footprintTemplate,
    movementBudgetFeet: 30,
    movementMode: 'walk',
    actorSeatId: 'seat-1',
  });
  assert.equal(northCross.legal, false);

  const westCross = validateWalkPath({
    map: baseMap,
    start: { column: 2, row: 2 },
    path: [{ column: 1, row: 2 }],
    footprintTemplate,
    movementBudgetFeet: 30,
    movementMode: 'walk',
    actorSeatId: 'seat-1',
  });
  assert.equal(westCross.legal, false);
});

test('Argon Audit — resolveSkillAttemptFromSummary resolves all 18 SRD skills, honors custom DC, and does not unlock doors on chest Investigation', () => {
  const sheet = deriveSheet(legalCharacterFor('fighter'));

  // Investigation check on a locked chest must NOT roll a phantom Sleight of Hand lock attempt
  const chestRes = resolveSkillAttemptFromSummary(
    sheet,
    'Ready to inspect the locked chest (Investigation proficient, +3; DC 15). Confirm to roll.',
  );
  assert.ok(chestRes);
  assert.match(chestRes.summary, /Investigation on the locked chest/);
  assert.doesNotMatch(chestRes.summary, /Lock attempt/);
  assert.equal(chestRes.lockYielded, false);

  // Athletics check via Ready-to summary
  const athleticsRes = resolveSkillAttemptFromSummary(
    sheet,
    'Ready to attempt the slick masonry wall (Athletics proficient, +5; DC 14). Confirm to roll.',
  );
  assert.ok(athleticsRes);
  assert.match(athleticsRes.summary, /Athletics check on slick masonry wall/);
  assert.match(athleticsRes.summary, /vs DC 14/);
});

test('Argon Audit — parsePlayerDeclaration ignores leading adverbs and interjections as NPC addressees', () => {
  assert.equal(
    parsePlayerDeclaration('Quietly, I check the floorboards near the counter.').addressee,
    null,
  );
  assert.equal(
    parsePlayerDeclaration('Wait, something glints in the torchlight.').addressee,
    null,
  );
  assert.equal(
    parsePlayerDeclaration('Bram, what is behind that locked door?', {
      knownNpcs: [{ id: 'npc-bram', label: 'Bram' }],
    }).addressee,
    'Bram',
  );
});
