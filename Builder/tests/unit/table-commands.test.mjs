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

test('table command gateway accepts tactical and Phase 3 rules commands', () => {
  assert.ok(TABLE_COMMAND_TYPES.includes('table.sync'));
  assert.ok(TABLE_COMMAND_TYPES.includes('table.move'));
  assert.ok(TABLE_COMMAND_TYPES.includes('table.open_door'));
  assert.ok(TABLE_COMMAND_TYPES.includes('encounter.begin'));
  assert.ok(TABLE_COMMAND_TYPES.includes('combat.attack'));
  assert.ok(TABLE_COMMAND_TYPES.includes('combat.cast_spell'));
  assert.ok(TABLE_COMMAND_TYPES.includes('progression.level_up'));
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
  assert.equal(ERROR_CODES.TIMING_AUTHORITY_REQUIRED, 'TIMING_AUTHORITY_REQUIRED');
});

test('persistence collections reserve command, event, and projection stores', () => {
  assert.equal(COLLECTIONS.campaignCommands, 'campaignCommands');
  assert.equal(COLLECTIONS.campaignEvents, 'campaignEvents');
  assert.equal(COLLECTIONS.campaignTableProjections, 'campaignTableProjections');
  assert.equal(COLLECTIONS.campaignEncounters, 'campaignEncounters');
  assert.equal(COLLECTIONS.characterProgressions, 'characterProgressions');
  assert.equal(COLLECTIONS.timingAuthorities, 'timingAuthorities');
});

test('action composer stays separate from Party Chat and references Timing Authority', () => {
  assert.equal(ACTION_COMPOSER_STRUCTURE.available, true);
  assert.match(ACTION_COMPOSER_STRUCTURE.notice, /separate from Party Chat/i);
  assert.match(ACTION_COMPOSER_STRUCTURE.notice, /Timing Authority|Active Turn/i);
  assert.equal(ACTION_COMPOSER_STRUCTURE.tableSyncLabel, 'Commit table sync');
  assert.match(ACTION_COMPOSER_STRUCTURE.interpretActionNotice, /Intent Intercept|cannot become a command/i);
  assert.deepEqual([...DOCK_TABS], ['chronicle', 'party_chat', 'rules_desk', 'director_address']);
});
