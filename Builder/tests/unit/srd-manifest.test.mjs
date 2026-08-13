import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ARMOR,
  BACKGROUNDS,
  CLASSES,
  RULES_MANIFEST_PROVENANCE,
  SKILLS,
  SPECIES,
  SPELLS,
  WEAPONS,
  spellsForList,
} from '../../dist/server/rules/srd-manifest.js';
import { ABILITIES } from '../../dist/shared/character-contract.js';

/**
 * Internal consistency of the SRD character-creation manifest.
 *
 * These tests verify the manifest's *structure*: that every cross-reference
 * resolves, every identifier is unique, and every record carries the fields
 * the rules engine consumes. They deliberately do NOT claim to verify
 * fidelity to the printed SRD, which needs a human against the source
 * document — see RULES_MANIFEST_PROVENANCE.
 */

const skillIds = new Set(SKILLS.map((skill) => skill.id));
const armorIds = new Set(ARMOR.map((armor) => armor.id));
const weaponIds = new Set(WEAPONS.map((weapon) => weapon.id));
const classIds = new Set(CLASSES.map((entry) => entry.id));

function assertUniqueIds(records, label) {
  const ids = records.map((record) => record.id);
  assert.equal(new Set(ids).size, ids.length, `${label} contains a duplicate id`);
}

test('the manifest states its provenance and does not claim human verification', () => {
  assert.equal(RULES_MANIFEST_PROVENANCE.source, 'SRD 5.2.1');
  assert.equal(RULES_MANIFEST_PROVENANCE.fidelityVerification, 'PENDING_HUMAN_REVIEW');
  assert.match(RULES_MANIFEST_PROVENANCE.attribution, /System Reference Document 5\.2\.1/);
});

test('every record set has unique identifiers', () => {
  assertUniqueIds(SKILLS, 'SKILLS');
  assertUniqueIds(ARMOR, 'ARMOR');
  assertUniqueIds(WEAPONS, 'WEAPONS');
  assertUniqueIds(SPECIES, 'SPECIES');
  assertUniqueIds(BACKGROUNDS, 'BACKGROUNDS');
  assertUniqueIds(CLASSES, 'CLASSES');
  assertUniqueIds(SPELLS, 'SPELLS');
});

test('the eighteen SRD skills each map to a real ability', () => {
  assert.equal(SKILLS.length, 18);
  for (const skill of SKILLS) {
    assert.ok(ABILITIES.includes(skill.ability), `${skill.id} has an unknown ability`);
    assert.ok(skill.label.length > 0);
  }
});

test('every class is internally consistent', () => {
  assert.equal(CLASSES.length, 12, 'all twelve SRD classes must be supported');

  for (const entry of CLASSES) {
    assert.ok([6, 8, 10, 12].includes(entry.hitDie), `${entry.id} has an implausible Hit Die`);
    assert.equal(entry.savingThrowProficiencies.length, 2, `${entry.id} must have two saving throw proficiencies`);
    for (const ability of entry.savingThrowProficiencies) {
      assert.ok(ABILITIES.includes(ability), `${entry.id} names an unknown saving throw ability`);
    }

    assert.ok(entry.skillChoiceCount > 0, `${entry.id} must choose at least one skill`);
    for (const skillId of entry.skillChoiceIds) {
      assert.ok(skillIds.has(skillId), `${entry.id} offers unknown skill ${skillId}`);
    }
    if (entry.skillChoiceIds.length > 0) {
      assert.ok(
        entry.skillChoiceIds.length >= entry.skillChoiceCount,
        `${entry.id} cannot choose ${entry.skillChoiceCount} from ${entry.skillChoiceIds.length} options`,
      );
    }

    assert.ok(entry.equipmentOptions.length >= 2, `${entry.id} must offer a real equipment choice`);
    for (const option of entry.equipmentOptions) {
      for (const armorId of option.armorIds) {
        assert.ok(armorIds.has(armorId), `${entry.id} equipment references unknown armor ${armorId}`);
      }
      for (const weaponId of option.weaponIds) {
        assert.ok(weaponIds.has(weaponId), `${entry.id} equipment references unknown weapon ${weaponId}`);
      }
      assert.ok(option.gold >= 0);
    }

    for (const choice of entry.choices) {
      assert.ok(choice.helper.length > 0, `${entry.id} choice ${choice.id} needs helper text`);
      assert.ok(choice.from.length >= choice.choose, `${entry.id} choice ${choice.id} cannot be satisfied`);
      assert.equal(new Set(choice.from.map((option) => option.id)).size, choice.from.length);
      for (const option of choice.from) {
        assert.ok(option.summary.length > 0, `${entry.id}.${choice.id}.${option.id} needs a summary`);
      }
    }

    assert.ok(entry.features.length > 0, `${entry.id} must have at least one level 1 feature`);
  }
});

test('every casting class has enough spells on its list to make a legal character', () => {
  for (const entry of CLASSES) {
    if (entry.spellcasting === null) {
      continue;
    }
    const casting = entry.spellcasting;
    assert.ok(classIds.has(casting.spellListId), `${entry.id} names an unknown spell list`);
    assert.ok(ABILITIES.includes(casting.ability));
    assert.ok(casting.level1SlotCount >= 1, `${entry.id} must have a level 1 spell slot`);

    const cantrips = spellsForList(casting.spellListId, 0);
    const spells = spellsForList(casting.spellListId, 1);
    assert.ok(
      cantrips.length >= casting.cantripsKnown,
      `${entry.id} needs ${casting.cantripsKnown} cantrips but its list has ${cantrips.length}`,
    );
    assert.ok(
      spells.length >= casting.spellsAvailable,
      `${entry.id} needs ${casting.spellsAvailable} level 1 spells but its list has ${spells.length}`,
    );
  }
});

test('every species is internally consistent', () => {
  assert.equal(SPECIES.length, 10);
  for (const entry of SPECIES) {
    assert.ok(entry.speed >= 25 && entry.speed <= 40, `${entry.id} has an implausible Speed`);
    assert.ok(['Small', 'Medium'].includes(entry.size), `${entry.id} has an unexpected size`);
    assert.ok(entry.hitPointsPerLevel >= 0);
    for (const choice of entry.choices) {
      assert.ok(choice.helper.length > 0, `${entry.id} choice ${choice.id} needs helper text`);
      assert.ok(choice.from.length >= choice.choose, `${entry.id} choice ${choice.id} cannot be satisfied`);
      for (const option of choice.from) {
        assert.ok(option.summary.length > 0, `${entry.id} option ${option.id} needs a summary`);
      }
      if (choice.grantsSkillProficiency === true) {
        for (const option of choice.from) {
          assert.ok(skillIds.has(option.id), `${entry.id} offers unknown skill ${option.id}`);
        }
      }
    }
  }
});

test('every background grants the SRD-shaped package', () => {
  assert.equal(BACKGROUNDS.length, 16);
  for (const entry of BACKGROUNDS) {
    assert.equal(entry.abilityOptions.length, 3, `${entry.id} must list three abilities`);
    assert.equal(new Set(entry.abilityOptions).size, 3, `${entry.id} lists a duplicate ability`);
    for (const ability of entry.abilityOptions) {
      assert.ok(ABILITIES.includes(ability));
    }
    assert.equal(entry.skillIds.length, 2, `${entry.id} must grant two skill proficiencies`);
    for (const skillId of entry.skillIds) {
      assert.ok(skillIds.has(skillId), `${entry.id} grants unknown skill ${skillId}`);
    }
    assert.ok(entry.originFeat.length > 0, `${entry.id} must grant an origin feat`);
    assert.ok(entry.toolProficiency.length > 0);
    assert.equal(entry.equipmentOptions.length, 2, `${entry.id} must offer a kit or gold`);
  }
});

test('every spell lists at least one real class list', () => {
  for (const spell of SPELLS) {
    assert.ok([0, 1].includes(spell.level));
    assert.ok(spell.lists.length > 0, `${spell.id} belongs to no class list`);
    for (const listId of spell.lists) {
      assert.ok(classIds.has(listId), `${spell.id} names unknown list ${listId}`);
    }
  }
});

test('armor records are usable by the Armor Class calculation', () => {
  for (const armor of ARMOR) {
    assert.ok(armor.baseArmorClass > 0);
    assert.ok(['light', 'medium', 'heavy', 'shield'].includes(armor.category));
    if (armor.category === 'heavy') {
      assert.equal(armor.dexterityCap, 0, `${armor.id} is heavy armor and adds no Dexterity`);
    }
    if (armor.category === 'medium') {
      assert.equal(armor.dexterityCap, 2, `${armor.id} is medium armor and caps Dexterity at 2`);
    }
  }
});
