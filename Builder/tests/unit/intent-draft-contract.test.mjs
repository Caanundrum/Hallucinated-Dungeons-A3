import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deriveEpicFramingTags,
  isRulesIntentDraftCommand,
  parseRestorableIntentDraft,
  shouldPersistIntentDraftState,
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

const OPEN_DRAFT = {
  campaignId: 'camp-1',
  draftId: 'draft-1',
  proposedCommandType: 'combat.short_rest',
  summary: 'Short Rest',
};

test('parseRestorableIntentDraft clears terminal failed/stale drafts', () => {
  for (const interceptState of ['failed', 'stale', 'cancelled', 'confirmed']) {
    const result = parseRestorableIntentDraft(
      JSON.stringify({ ...OPEN_DRAFT, interceptState }),
      'camp-1',
    );
    assert.deepEqual(result, { draft: {}, clearStored: true });
  }
});

test('parseRestorableIntentDraft restores open drafts as awaiting_confirmation', () => {
  for (const interceptState of ['awaiting_confirmation', 'draft', undefined]) {
    const result = parseRestorableIntentDraft(
      JSON.stringify({ ...OPEN_DRAFT, interceptState }),
      'camp-1',
    );
    assert.equal(result?.clearStored, false);
    assert.equal(result?.draft.interceptState, 'awaiting_confirmation');
    assert.equal(result?.draft.draftId, 'draft-1');
  }
});

test('parseRestorableIntentDraft rejects wrong campaign or corrupt payload', () => {
  assert.deepEqual(
    parseRestorableIntentDraft(JSON.stringify({ ...OPEN_DRAFT, interceptState: 'draft' }), 'other'),
    { draft: {}, clearStored: true },
  );
  assert.deepEqual(parseRestorableIntentDraft('{not-json', 'camp-1'), {
    draft: {},
    clearStored: true,
  });
  assert.equal(parseRestorableIntentDraft(null, 'camp-1'), null);
});

test('shouldPersistIntentDraftState skips terminal states', () => {
  assert.equal(shouldPersistIntentDraftState('awaiting_confirmation'), true);
  assert.equal(shouldPersistIntentDraftState('draft'), true);
  assert.equal(shouldPersistIntentDraftState('failed'), false);
  assert.equal(shouldPersistIntentDraftState('stale'), false);
  assert.equal(shouldPersistIntentDraftState('cancelled'), false);
  assert.equal(shouldPersistIntentDraftState('confirmed'), false);
});
