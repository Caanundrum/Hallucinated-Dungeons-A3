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

test('PQA-155: inspect adjacent closed door narrates state instead of opening', () => {
  const map = chamberMap({ tokenColumn: 9, tokenRow: 6 });
  map.edges = map.edges.map((edge) =>
    edge.kind === 'door' ? { ...edge, doorState: 'closed' } : edge,
  );
  const resolved = resolveDoorIntentForMap(
    map,
    { column: 9, row: 6 },
    'I inspect the door carefully.',
  );
  assert.ok(resolved);
  assert.equal(resolved.proposedCommandType, 'table.sync');
  assert.equal(resolved.edgeId, 'e:9:6:east');
  assert.match(resolved.summary, /closed/i);
  assert.doesNotMatch(resolved.summary, /Ready to open|Investigation|Confirm to roll/i);
});

test('PQA-155: inspect adjacent open door narrates free swing', () => {
  const map = chamberMap({ tokenColumn: 9, tokenRow: 6 });
  const resolved = resolveDoorIntentForMap(
    map,
    { column: 9, row: 6 },
    'I inspect the wooden door.',
  );
  assert.ok(resolved);
  assert.equal(resolved.proposedCommandType, 'table.sync');
  assert.match(resolved.summary, /already open|swings freely/i);
});

test('open/step-through while not adjacent explains approach then re-declare', () => {
  const map = chamberMap({ tokenColumn: 2, tokenRow: 2 });
  map.edges = map.edges.map((edge) =>
    edge.kind === 'door' ? { ...edge, doorState: 'unlocked' } : edge,
  );
  const resolved = resolveDoorIntentForMap(
    map,
    { column: 2, row: 2 },
    'Loophole opens the unlocked doorway and steps through.',
  );
  assert.ok(resolved);
  assert.equal(resolved.proposedCommandType, 'table.move');
  assert.match(resolved.summary, /Confirm moves you closer only/i);
  assert.match(resolved.summary, /declare open|step through again/i);
  assert.match(resolved.summary, /unlocked|closed/i);
  assert.doesNotMatch(resolved.summary, /Sleight of Hand|attempt the lock|Confirm to roll/i);
});

test('adjacent unlocked open/step-through drafts table.open_door with cross-on-confirm copy', () => {
  const map = chamberMap({ tokenColumn: 9, tokenRow: 6 });
  map.edges = map.edges.map((edge) =>
    edge.kind === 'door' ? { ...edge, doorState: 'unlocked' } : edge,
  );
  const resolved = resolveDoorIntentForMap(
    map,
    { column: 9, row: 6 },
    'I open the unlocked doorway and step through.',
  );
  assert.ok(resolved);
  assert.equal(resolved.proposedCommandType, 'table.open_door');
  assert.equal(resolved.edgeId, 'e:9:6:east');
  assert.match(resolved.summary, /Ready to open/i);
  assert.match(resolved.summary, /step through|cross the doorway|unlocked/i);
  assert.doesNotMatch(resolved.summary, /Sleight of Hand|attempt the lock|moves you closer only/i);
});

test('adjacent open door step-through drafts table.move onto the passage square', () => {
  const map = chamberMap({ tokenColumn: 9, tokenRow: 6 });
  const resolved = resolveDoorIntentForMap(
    map,
    { column: 9, row: 6 },
    'I step through the open doorway.',
  );
  assert.ok(resolved);
  assert.equal(resolved.proposedCommandType, 'table.move');
  assert.deepEqual(resolved.path, [{ column: 10, row: 6 }]);
  assert.match(resolved.summary, /Ready to step through the open doorway/i);
  assert.doesNotMatch(resolved.summary, /already through|confirm when you are ready|declare what you do next/i);
});

test('open-door enter-beyond while adjacent to open door is a move, not already-through', () => {
  const map = chamberMap({ tokenColumn: 9, tokenRow: 6 });
  const resolved = resolveDoorIntentForMap(
    map,
    { column: 9, row: 6 },
    'I enter the room beyond.',
  );
  assert.ok(resolved);
  assert.equal(resolved.proposedCommandType, 'table.move');
  assert.deepEqual(resolved.path, [{ column: 10, row: 6 }]);
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
