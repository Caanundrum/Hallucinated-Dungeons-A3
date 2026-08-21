import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyExplorationConflict } from '../../dist/server/table/commands.js';

const baseProjection = {
  campaignId: 'camp-1',
  stateVersion: 3,
  lastEventSequence: 3,
  lastEventId: 'evt-3',
  updatedAt: null,
  tokenPositions: [
    { seatId: 'seat-a', column: 2, row: 2 },
    { seatId: 'seat-b', column: 4, row: 4 },
  ],
  doorStates: { 'door-north': 'open' },
  exploredByAccount: {},
  npcSpotlight: null,
};

test('classifyExplorationConflict detects same door', () => {
  const conflict = classifyExplorationConflict({
    commandType: 'table.open_door',
    current: baseProjection,
    expectedStateVersion: 2,
    openEdgeId: 'door-north',
    actorSeatId: 'seat-a',
    encounterActive: false,
  });
  assert.equal(conflict.reason, 'same_door');
  assert.equal(conflict.edgeId, 'door-north');
});

test('classifyExplorationConflict detects overlapping move', () => {
  const conflict = classifyExplorationConflict({
    commandType: 'table.move',
    current: baseProjection,
    expectedStateVersion: 2,
    movePath: [
      { column: 3, row: 3 },
      { column: 4, row: 4 },
    ],
    actorSeatId: 'seat-a',
    encounterActive: false,
  });
  assert.equal(conflict.reason, 'overlapping_move');
});

test('classifyExplorationConflict detects scene lock over free-roam moves', () => {
  const conflict = classifyExplorationConflict({
    commandType: 'table.move',
    current: baseProjection,
    expectedStateVersion: 2,
    movePath: [{ column: 1, row: 1 }],
    actorSeatId: 'seat-a',
    encounterActive: true,
  });
  assert.equal(conflict.reason, 'scene_lock');
});
