import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deriveEpicFramingTags,
  isRulesIntentDraftCommand,
} from '../../dist/shared/intent-draft-contract.js';

test('deriveEpicFramingTags marks crit and finishing blows without inventing HP', () => {
  const tags = deriveEpicFramingTags('Critical hit! Training Dummy drops to 0 Hit Points.', [20, 8]);
  assert.ok(tags.includes('crit'));
  assert.ok(tags.includes('finishing_blow'));
  assert.equal(tags.includes('near_miss'), false);
});

test('deriveEpicFramingTags marks near-miss and heroic failure from prose', () => {
  assert.ok(
    deriveEpicFramingTags('The kobold is barely standing at 1 Hit Point.').includes('near_miss'),
  );
  assert.ok(
    deriveEpicFramingTags('Your bold leap missed the goblin.', [1]).includes('heroic_failure'),
  );
});

test('rules intent drafts are the combat/item confirm path', () => {
  assert.equal(isRulesIntentDraftCommand('combat.attack'), true);
  assert.equal(isRulesIntentDraftCommand('combat.cast_spell'), true);
  assert.equal(isRulesIntentDraftCommand('inventory.use_item'), true);
  assert.equal(isRulesIntentDraftCommand('table.move'), false);
});
