import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isOnOpenDoorPassage, nextStepThroughOpenDoor, nextStepTowardOpenDoor } from '../../dist/server/table/move-planner.js';

function blankMapWithOpenDoor(options) {
  const cells = [];
  for (let column = 0; column < 12; column += 1) {
    for (let row = 0; row < 8; row += 1) {
      cells.push({ column, row, terrain: 'normal', known: true });
    }
  }
  return {
    mapBundleId: 'blank:test',
    title: 'Improvised chamber',
    coordinateSpace: {
      columns: 12,
      rows: 8,
      pixelsPerSquare: 48,
      feetPerSquare: 5,
    },
    cells,
    edges: [
      {
        edgeId: `e:${options.doorColumn}:${options.doorRow}:east`,
        column: options.doorColumn,
        row: options.doorRow,
        orientation: 'east',
        kind: 'door',
        doorState: 'open',
      },
    ],
    tokens: [
      {
        tokenId: 'tok-1',
        seatId: 'seat-1',
        label: 'Hero',
        footprint: {
          anchor: { column: options.tokenColumn, row: options.tokenRow },
          widthSquares: 1,
          heightSquares: 1,
        },
      },
    ],
    notableFeatures: [],
    viewerSeatId: 'seat-1',
  };
}

test('nextStepTowardOpenDoor steps east toward an open doorway', () => {
  const map = blankMapWithOpenDoor({
    tokenColumn: 7,
    tokenRow: 6,
    doorColumn: 9,
    doorRow: 6,
  });
  assert.deepEqual(nextStepTowardOpenDoor({ column: 7, row: 6 }, map), { column: 8, row: 6 });
  assert.deepEqual(nextStepTowardOpenDoor({ column: 8, row: 6 }, map), { column: 9, row: 6 });
  assert.deepEqual(nextStepTowardOpenDoor({ column: 9, row: 6 }, map), { column: 10, row: 6 });
  // On the far side, through-step reverses onto the approach square.
  assert.deepEqual(nextStepTowardOpenDoor({ column: 10, row: 6 }, map), { column: 9, row: 6 });
});

test('isOnOpenDoorPassage is true only on the far side of an open door', () => {
  const map = blankMapWithOpenDoor({
    tokenColumn: 9,
    tokenRow: 6,
    doorColumn: 9,
    doorRow: 6,
  });
  assert.equal(isOnOpenDoorPassage({ column: 9, row: 6 }, map), false);
  assert.equal(isOnOpenDoorPassage({ column: 10, row: 6 }, map), true);
});

test('nextStepThroughOpenDoor reverses from far side onto approach', () => {
  const map = blankMapWithOpenDoor({
    tokenColumn: 10,
    tokenRow: 6,
    doorColumn: 9,
    doorRow: 6,
  });
  assert.deepEqual(nextStepThroughOpenDoor({ column: 10, row: 6 }, map), { column: 9, row: 6 });
  assert.deepEqual(nextStepThroughOpenDoor({ column: 9, row: 6 }, map), { column: 10, row: 6 });
});
