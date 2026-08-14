import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTION_COMPOSER_STRUCTURE,
  DOCK_TABS,
} from '../../dist/shared/communication-contract.js';
import { ERROR_CODES } from '../../dist/shared/contract.js';
import { COLLECTIONS } from '../../dist/server/persistence/firestore.js';
import {
  ACTIVE_TURN_PERMITTED_COMMANDS,
  TIMING_AUTHORITY_SCHEMA_VERSION,
  TIMING_OPPORTUNITY_CLASSES,
  isTimingAuthorityState,
  isTimingOpportunityClass,
} from '../../dist/shared/timing-authority-contract.js';

test('timing authority contract covers Active Turn only', () => {
  assert.equal(TIMING_AUTHORITY_SCHEMA_VERSION, 'phase2-timing-v1');
  assert.deepEqual([...TIMING_OPPORTUNITY_CLASSES], ['active_turn']);
  assert.equal(isTimingOpportunityClass('active_turn'), true);
  assert.equal(isTimingOpportunityClass('reaction'), false);
  assert.equal(isTimingAuthorityState('issued'), true);
  assert.equal(isTimingAuthorityState('pending'), false);
  assert.deepEqual(
    [...ACTIVE_TURN_PERMITTED_COMMANDS],
    ['table.sync', 'table.move', 'table.open_door'],
  );
});

test('timing authority failure codes and collection are reserved', () => {
  assert.equal(ERROR_CODES.TIMING_AUTHORITY_REQUIRED, 'TIMING_AUTHORITY_REQUIRED');
  assert.equal(ERROR_CODES.TIMING_AUTHORITY_INVALID, 'TIMING_AUTHORITY_INVALID');
  assert.equal(COLLECTIONS.timingAuthorities, 'timingAuthorities');
});

test('action composer unlocks Interpret Action via Timing Authority copy', () => {
  assert.equal(ACTION_COMPOSER_STRUCTURE.available, true);
  assert.match(ACTION_COMPOSER_STRUCTURE.notice, /Claim Active Turn/i);
  assert.match(ACTION_COMPOSER_STRUCTURE.interpretActionNotice, /Intent Intercept/i);
  assert.match(ACTION_COMPOSER_STRUCTURE.interpretActionNotice, /Party Chat still cannot/i);
  assert.deepEqual([...DOCK_TABS], ['chronicle', 'party_chat', 'rules_desk']);
});
