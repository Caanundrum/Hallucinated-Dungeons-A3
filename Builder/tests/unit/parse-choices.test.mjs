import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseChoices } from '../../dist/server/characters/parse-choices.js';

/**
 * Boundary parsing for character-choice payloads.
 *
 * Structural rejection belongs here. Rules legality belongs to the rules
 * engine — a well-shaped but illegal payload must parse so the player sees a
 * rules explanation rather than a generic rejection.
 */

function completePayload(overrides = {}) {
  return {
    classId: 'fighter',
    backgroundId: 'soldier',
    speciesId: 'dwarf',
    abilityMethod: 'standard-array',
    baseAbilityScores: {
      strength: 15,
      dexterity: 14,
      constitution: 13,
      intelligence: 12,
      wisdom: 10,
      charisma: 8,
    },
    backgroundAbilityBonuses: { strength: 2, constitution: 1 },
    classSkillIds: ['athletics', 'perception'],
    speciesChoiceIds: {},
    classEquipmentOptionId: 'fighter-a',
    backgroundEquipmentOptionId: 'soldier-kit',
    cantripIds: [],
    spellIds: [],
    classChoiceIds: { 'fighting-style': ['defense'] },
    identity: {
      name: 'Thorn',
      pronouns: 'they/them',
      appearance: '',
      concept: '',
    },
    ...overrides,
  };
}

test('parseChoices accepts a complete, well-formed payload', () => {
  const parsed = parseChoices(completePayload());
  assert.ok(parsed);
  assert.equal(parsed.identity.name, 'Thorn');
  assert.equal(parsed.classId, 'fighter');
  assert.equal(parsed.abilityMethod, 'standard-array');
});

test('parseChoices rejects malformed structure', () => {
  assert.equal(parseChoices(null), null);
  assert.equal(parseChoices('fighter'), null);
  assert.equal(parseChoices([]), null);
  assert.equal(parseChoices(completePayload({ abilityMethod: 'not-a-method' })), null);
  assert.equal(
    parseChoices(
      completePayload({
        baseAbilityScores: { strength: 99 },
      }),
    ),
    null,
  );
  assert.equal(
    parseChoices(
      completePayload({
        identity: { name: 'Thorn' },
      }),
    ),
    null,
  );
});

test('parseChoices accepts rolled method but never trusts client roll state', () => {
  const parsed = parseChoices(
    completePayload({
      abilityMethod: 'rolled',
      rolledScorePool: [18, 18, 18, 18, 18, 18],
      abilityRollAttempts: 99,
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.abilityMethod, 'rolled');
  assert.equal(parsed.rolledScorePool, null);
  assert.equal(parsed.abilityRollAttempts, 0);
});

test('parseChoices accepts null optional ids so the rules engine can explain them', () => {
  const parsed = parseChoices(
    completePayload({
      classId: null,
      backgroundId: null,
      speciesId: null,
      classEquipmentOptionId: null,
      backgroundEquipmentOptionId: null,
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.classId, null);
  assert.equal(parsed.backgroundId, null);
});
