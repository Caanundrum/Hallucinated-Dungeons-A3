import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyDamage,
  applyHealing,
  applyTemporaryHitPoints,
  resolveAttack,
  resolveDeathSave,
} from '../../dist/server/rules/engine/adjudication.js';
import { areaFootprint } from '../../dist/server/rules/engine/areas.js';
import {
  parseDamageExpression,
  rollD20,
  rollDamage,
} from '../../dist/server/rules/engine/dice.js';
import { spellAreaCells } from '../../dist/server/rules/engine/spell-effects.js';
import {
  XP_THRESHOLDS,
  attacksPerActionForClass,
  experienceRequiredForLevel,
  levelForExperience,
  proficiencyBonusForLevel,
  spellSlotsForClass,
  recomputeSheetForLevel,
} from '../../dist/server/rules/engine/xp-progression.js';

function sequenceRandom(values) {
  let index = 0;
  return (minimum, maximum) => {
    const value = values[index++];
    assert.notEqual(value, undefined, 'test random sequence exhausted');
    assert.ok(value >= minimum && value < maximum);
    return value;
  };
}

function combatant(overrides = {}) {
  return {
    combatantId: 'combatant-1',
    characterId: 'character-1',
    seatId: 'seat-1',
    name: 'Rules Tester',
    side: 'party',
    level: 1,
    position: { column: 1, row: 1, elevationFeet: 0 },
    armorClass: 15,
    baseArmorClass: 15,
    maxHitPoints: 12,
    currentHitPoints: 12,
    temporaryHitPoints: 0,
    hitDiceRemaining: 1,
    initiativeBonus: 2,
    initiative: 12,
    savingThrowBonuses: {
      strength: 3,
      dexterity: 2,
      constitution: 3,
      intelligence: 0,
      wisdom: 1,
      charisma: 0,
    },
    conditions: [],
    deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
    actionEconomy: {
      actionAvailable: true,
      bonusActionAvailable: true,
      reactionAvailable: true,
      movementRemainingFeet: 30,
    },
    attacks: [
      {
        attackId: 'training-sword',
        label: 'Training Sword',
        attackBonus: 5,
        damageExpression: '1d8+3',
        damageType: 'slashing',
        reachFeet: 5,
      },
    ],
    spellSaveDc: 13,
    spellAttackBonus: 5,
    spellcastingAbilityModifier: 3,
    spellResources: { maximumSlots: [2], remainingSlots: [2] },
    concentrationSpellId: null,
    inventory: [],
    ready: null,
    ...overrides,
  };
}

test('server dice support normal, advantage, disadvantage, and damage expressions', () => {
  assert.deepEqual(rollD20('normal', 3, sequenceRandom([12])), {
    mode: 'normal',
    natural: 12,
    rolls: [12],
    total: 15,
  });
  assert.equal(rollD20('advantage', 0, sequenceRandom([4, 17])).natural, 17);
  assert.equal(rollD20('disadvantage', 0, sequenceRandom([4, 17])).natural, 4);
  assert.deepEqual(parseDamageExpression('2d6 + 1d4 - 2'), {
    terms: [
      { count: 2, sides: 6, sign: 1 },
      { count: 1, sides: 4, sign: 1 },
    ],
    modifier: -2,
  });
  assert.deepEqual(rollDamage('2d4+2', sequenceRandom([3, 4])), {
    rolls: [3, 4],
    total: 9,
  });
  assert.throws(() => parseDamageExpression('require("fs")'));
});

test('sphere, cube, cone, and line footprints include vertical 5-foot cells', () => {
  const origin = { column: 0, row: 0, elevationFeet: 10 };
  for (const shape of ['sphere', 'cube', 'cone', 'line']) {
    const cells = areaFootprint({
      shape,
      origin,
      sizeFeet: 15,
      heightFeet: 10,
      direction: 'east',
      widthFeet: 5,
    });
    assert.ok(cells.length > 0, `${shape} should occupy cells`);
    assert.ok(cells.some((cell) => cell.elevationFeet === 10));
    assert.ok(cells.some((cell) => cell.elevationFeet === 15));
    assert.equal(new Set(cells.map((cell) => cell.id)).size, cells.length);
  }
});

test('Burning Hands uses its canonical cone dimensions and placement height', () => {
  const cells = spellAreaCells('burning-hands', {
    shape: 'cube',
    origin: { column: 2, row: 2, elevationFeet: 5 },
    sizeFeet: 5,
    heightFeet: 5,
    direction: 'south',
  });
  assert.ok(cells.some((cell) => cell.id === '2,2,5'));
  assert.ok(cells.some((cell) => cell.elevationFeet === 10));
  assert.ok(cells.some((cell) => cell.row === 4));
  assert.ok(cells.length > 6);
});

test('XP thresholds map every single-class level 1 through 20', () => {
  assert.equal(XP_THRESHOLDS.length, 20);
  for (let level = 1; level <= 20; level += 1) {
    const threshold = experienceRequiredForLevel(level);
    assert.equal(levelForExperience(threshold), level);
    if (level < 20) {
      assert.equal(levelForExperience(XP_THRESHOLDS[level] - 1), level);
    }
  }
  assert.equal(proficiencyBonusForLevel(1), 2);
  assert.equal(proficiencyBonusForLevel(20), 6);
  assert.equal(attacksPerActionForClass('fighter', 5), 2);
  assert.equal(attacksPerActionForClass('fighter', 20), 4);
  assert.deepEqual(spellSlotsForClass('wizard', 20), [4, 3, 3, 3, 3, 2, 2, 1, 1]);
});

test('attack adjudication resolves natural misses, hits, damage, and critical dice', () => {
  const attacker = combatant();
  const target = combatant({ combatantId: 'target', armorClass: 16 });
  const miss = resolveAttack({
    attacker,
    target,
    rng: sequenceRandom([1]),
  });
  assert.equal(miss.hit, false);
  assert.equal(miss.damage, 0);

  const hit = resolveAttack({
    attacker,
    target,
    rng: sequenceRandom([14, 6]),
  });
  assert.equal(hit.hit, true);
  assert.equal(hit.attackTotal, 19);
  assert.equal(hit.damage, 9);
  assert.equal(hit.target.currentHitPoints, 3);

  const critical = resolveAttack({
    attacker,
    target,
    rng: sequenceRandom([20, 4, 5]),
  });
  assert.equal(critical.critical, true);
  assert.equal(critical.damage, 12);
  assert.equal(critical.target.currentHitPoints, 0);
});

test('damage consumes temp HP, healing recovers, and death saves cover 1/20/three results', () => {
  const protectedTarget = applyTemporaryHitPoints(combatant(), 5);
  const damaged = applyDamage(protectedTarget, 7);
  assert.equal(damaged.temporaryHitPoints, 0);
  assert.equal(damaged.currentHitPoints, 10);
  assert.equal(applyHealing(damaged, 99).currentHitPoints, 12);

  const dying = applyDamage(combatant(), 12);
  assert.equal(dying.currentHitPoints, 0);
  assert.ok(dying.conditions.some((condition) => condition.conditionId === 'unconscious'));

  const criticalFailure = resolveDeathSave(dying, sequenceRandom([1]));
  assert.equal(criticalFailure.outcome, 'critical_failure');
  assert.equal(criticalFailure.combatant.deathSaves.failures, 2);

  const revived = resolveDeathSave(dying, sequenceRandom([20]));
  assert.equal(revived.outcome, 'revived');
  assert.equal(revived.combatant.currentHitPoints, 1);

  let saving = dying;
  for (const roll of [10, 11, 12]) {
    saving = resolveDeathSave(saving, sequenceRandom([roll])).combatant;
  }
  assert.equal(saving.deathSaves.stable, true);
  assert.equal(saving.deathSaves.successes, 3);
});


test('recomputeSheetForLevel refreshes Alert initiative and adds Action Surge at level 2+', () => {
  const baseSheet = {
    level: 1,
    experiencePoints: 0,
    proficiencyBonus: {
      value: 2,
      components: [{ label: 'Level 1', amount: 2, ruleId: 'proficiency-bonus.level-1' }],
    },
    abilityScores: {
      strength: { value: 15, components: [] },
      dexterity: { value: 14, components: [] },
      constitution: { value: 13, components: [] },
      intelligence: { value: 10, components: [] },
      wisdom: { value: 12, components: [] },
      charisma: { value: 8, components: [] },
    },
    abilityModifiers: {
      strength: 2,
      dexterity: 2,
      constitution: 1,
      intelligence: 0,
      wisdom: 1,
      charisma: -1,
    },
    hitPoints: {
      value: 11,
      components: [{ label: 'Hit Die', amount: 11, ruleId: 'class.fighter.hit-points' }],
    },
    hitPointsCurrent: 11,
    hitDice: '1d10',
    armorClass: { value: 16, components: [] },
    initiative: {
      value: 4,
      components: [
        { label: 'Dexterity', amount: 2, ruleId: 'ability.dexterity' },
        { label: 'Alert', amount: 2, ruleId: 'feat.alert.initiative' },
      ],
    },
    speed: { value: 30, components: [] },
    passivePerception: { value: 11, components: [] },
    savingThrows: {
      strength: {
        value: 4,
        components: [
          { label: 'Strength', amount: 2, ruleId: 'ability.strength' },
          { label: 'Proficiency Bonus', amount: 2, ruleId: 'proficiency-bonus' },
        ],
      },
      dexterity: { value: 2, components: [{ label: 'Dexterity', amount: 2, ruleId: 'ability.dexterity' }] },
      constitution: {
        value: 3,
        components: [
          { label: 'Constitution', amount: 1, ruleId: 'ability.constitution' },
          { label: 'Proficiency Bonus', amount: 2, ruleId: 'proficiency-bonus' },
        ],
      },
      intelligence: { value: 0, components: [] },
      wisdom: { value: 1, components: [] },
      charisma: { value: -1, components: [] },
    },
    skills: [],
    attacks: [],
    features: [],
    equipment: [],
    proficiencies: [],
    spellcasting: null,
    classResources: [
      {
        id: 'second-wind',
        label: 'Second Wind',
        summary: 'Regain hit points as a Bonus Action.',
        remaining: 1,
        maximum: 1,
        recharge: 'Short rest',
      },
    ],
    weaponMasteries: [],
    subclassLabel: 'Subclass unlocks at level 3 (Champion is the Alpha default)',
  };

  const level5 = recomputeSheetForLevel(baseSheet, 'fighter', 5, 6500);
  assert.equal(level5.proficiencyBonus.value, 3);
  const alert = level5.initiative.components.find((component) => component.ruleId === 'feat.alert.initiative');
  assert.ok(alert);
  assert.equal(alert.amount, 3);
  assert.equal(level5.initiative.value, 5);
  assert.ok((level5.classResources ?? []).some((resource) => resource.id === 'action-surge'));
  assert.ok((level5.classResources ?? []).some((resource) => resource.id === 'second-wind'));
  assert.match(level5.subclassLabel ?? '', /Champion/i);
});
