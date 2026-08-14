import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTION_COMPOSER_STRUCTURE,
  DOCK_TABS,
} from '../../dist/shared/communication-contract.js';
import {
  TABLE_COMMAND_TYPES,
  TABLE_EVENT_TYPES,
  TABLE_EVENT_PAGE_SIZE,
  isTableCommandType,
} from '../../dist/shared/command-contract.js';
import { ERROR_CODES } from '../../dist/shared/contract.js';
import { COLLECTIONS } from '../../dist/server/persistence/firestore.js';

test('table command gateway accepts sync, move, and open_door', () => {
  assert.deepEqual([...TABLE_COMMAND_TYPES], ['table.sync', 'table.move', 'table.open_door']);
  assert.ok(TABLE_EVENT_TYPES.includes('table.token_moved'));
  assert.equal(isTableCommandType('table.sync'), true);
  assert.equal(isTableCommandType('table.move'), true);
  assert.equal(isTableCommandType('party_chat'), false);
  assert.equal(TABLE_EVENT_PAGE_SIZE, 20);
});

test('stale version, not-seated, and illegal-path failures have dedicated machine codes', () => {
  assert.equal(ERROR_CODES.STALE_STATE_VERSION, 'STALE_STATE_VERSION');
  assert.equal(ERROR_CODES.NOT_SEATED, 'NOT_SEATED');
  assert.equal(ERROR_CODES.ILLEGAL_PATH, 'ILLEGAL_PATH');
});

test('persistence collections reserve command, event, and projection stores', () => {
  assert.equal(COLLECTIONS.campaignCommands, 'campaignCommands');
  assert.equal(COLLECTIONS.campaignEvents, 'campaignEvents');
  assert.equal(COLLECTIONS.campaignTableProjections, 'campaignTableProjections');
});

test('action composer is available for table sync and keeps Interpret Action gated', () => {
  assert.equal(ACTION_COMPOSER_STRUCTURE.available, true);
  assert.match(ACTION_COMPOSER_STRUCTURE.notice, /separate from Party Chat/i);
  assert.match(ACTION_COMPOSER_STRUCTURE.notice, /Timing Authority/i);
  assert.equal(ACTION_COMPOSER_STRUCTURE.tableSyncLabel, 'Commit table sync');
  assert.match(ACTION_COMPOSER_STRUCTURE.interpretActionNotice, /cannot spend resources/i);
  assert.deepEqual([...DOCK_TABS], ['chronicle', 'party_chat', 'rules_desk']);
});
