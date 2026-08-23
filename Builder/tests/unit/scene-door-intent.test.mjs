import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveBlankTableDoorBuild, resolveDoorIntentForMap } from '../../dist/server/table/scene-door-intent.js';

function chamberMap(options) {
  const cells = [];
  for (let column = 0; column < 12; column += 1) {
    for (let row = 0; row < 8; row += 1) {
      cells.push({ column, row, terrain: 'normal', known: true });
    }
  }
  return {
    mapBundleId: 'blank:camp-1',
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
        edgeId: 'e:9:5:east',
        column: 9,
        row: 5,
        orientation: 'east',
        kind: 'wall',
        doorState: null,
      },
      {
        edgeId: 'e:9:6:east',
        column: 9,
        row: 6,
        orientation: 'east',
        kind: 'door',
        doorState: 'open',
      },
      {
        edgeId: 'e:9:7:east',
        column: 9,
        row: 7,
        orientation: 'east',
        kind: 'wall',
        doorState: null,
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

test('resolveDoorIntentForMap acknowledges token already through an open doorway', () => {
  const map = chamberMap({ tokenColumn: 10, tokenRow: 6 });
  const resolved = resolveDoorIntentForMap(
    map,
    { column: 10, row: 6 },
    'i walk to the far wall, open the wooden door, and enter the room beyond.',
  );
  assert.ok(resolved);
  assert.equal(resolved.proposedCommandType, 'table.sync');
  assert.match(resolved.summary, /already through the doorway/i);
  assert.doesNotMatch(resolved.summary, /open floor/i);
});

test('resolveDoorIntentForMap never claims an open floor when edges exist', () => {
  const map = chamberMap({ tokenColumn: 7, tokenRow: 6 });
  const resolved = resolveDoorIntentForMap(
    map,
    { column: 7, row: 6 },
    'i open the wooden door ahead of me.',
  );
  assert.ok(resolved);
  assert.doesNotMatch(resolved.summary, /open floor/i);
});

test('resolveBlankTableDoorBuild only applies to edgeless blank tables', () => {
  const blank = chamberMap({ tokenColumn: 7, tokenRow: 6 });
  blank.edges = [];
  blank.title = 'Blank table';
  const build = resolveBlankTableDoorBuild(blank, { column: 7, row: 6 }, 'open the door ahead');
  assert.ok(build);
  assert.equal(build.proposedCommandType, 'table.build_scene');

  const chamber = chamberMap({ tokenColumn: 10, tokenRow: 6 });
  assert.equal(resolveBlankTableDoorBuild(chamber, { column: 10, row: 6 }, 'open the door ahead'), null);
});
