import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  availableScoresFromPool,
  pointBuyScoresForAbility,
  remainingPointBuyBudget,
} from '../../dist/shared/character-contract.js';

/**
 * Prevent-first helpers for the character wizard: depleted score pools and
 * point-buy options that fit the remaining budget.
 */

test('availableScoresFromPool removes assigned scores as a multiset', () => {
  const scores = { strength: 15, dexterity: 14 };
  const forConstitution = availableScoresFromPool([...STANDARD_ARRAY], scores, 'constitution');
  assert.deepEqual([...forConstitution].sort((a, b) => b - a), [13, 12, 10, 8]);
  assert.ok(!forConstitution.includes(15));
  assert.ok(!forConstitution.includes(14));

  // The ability being edited still sees its own current score as available.
  const forStrength = availableScoresFromPool([...STANDARD_ARRAY], scores, 'strength');
  assert.ok(forStrength.includes(15));
  assert.ok(!forStrength.includes(14));
});

test('availableScoresFromPool keeps duplicate rolled values usable once each', () => {
  const pool = [14, 14, 12, 10, 10, 8];
  const scores = { strength: 14, dexterity: 10 };
  const remaining = availableScoresFromPool(pool, scores, 'constitution');
  assert.deepEqual(
    [...remaining].sort((a, b) => b - a),
    [14, 12, 10, 8],
  );
});

test('pointBuyScoresForAbility refuses scores that blow the remaining budget', () => {
  // Three 15s cost 27. Nothing else can rise above 8.
  const scores = {
    strength: 15,
    dexterity: 15,
    constitution: 15,
  };
  assert.equal(remainingPointBuyBudget(scores, 'intelligence'), 0);
  assert.deepEqual(pointBuyScoresForAbility(scores, 'intelligence'), [8]);
  assert.deepEqual(pointBuyScoresForAbility(scores, 'wisdom'), [8]);

  // Editing Strength frees its 9 points, so 8–15 are all affordable again.
  assert.deepEqual(pointBuyScoresForAbility(scores, 'strength'), [8, 9, 10, 11, 12, 13, 14, 15]);
});

test('point buy starts with the full budget available', () => {
  assert.equal(remainingPointBuyBudget({}, 'strength'), POINT_BUY_BUDGET);
  assert.deepEqual(pointBuyScoresForAbility({}, 'strength'), [8, 9, 10, 11, 12, 13, 14, 15]);
});
