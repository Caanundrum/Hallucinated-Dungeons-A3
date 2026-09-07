import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeMoveDestination,
  formatEdgeAccessibleLabel,
  formatMapTerrainSummary,
  formatMoveTravelSummary,
  formatPartyDoorAdjacency,
  isAdjacentToDoorEdge,
} from '../../dist/shared/map-presentation.js';

const quietChamberEdges = [
  {
    edgeId: 'wall-e-1',
    column: 4,
    row: 1,
    orientation: 'east',
    kind: 'wall',
    doorState: null,
  },
  {
    edgeId: 'wall-e-2',
    column: 4,
    row: 2,
    orientation: 'east',
    kind: 'wall',
    doorState: null,
  },
  {
    edgeId: 'door-e',
    column: 4,
    row: 3,
    orientation: 'east',
    kind: 'door',
    doorState: 'closed',
  },
];

test('edge accessible labels uniquify walls and keep a single door name', () => {
  const wallA = formatEdgeAccessibleLabel(quietChamberEdges[0], quietChamberEdges);
  const wallB = formatEdgeAccessibleLabel(quietChamberEdges[1], quietChamberEdges);
  const door = formatEdgeAccessibleLabel(quietChamberEdges[2], quietChamberEdges);
  assert.match(wallA, /Wall facing east at column 4, row 1/);
  assert.match(wallB, /Wall facing east at column 4, row 2/);
  assert.notEqual(wallA, wallB);
  assert.equal(door, 'Wooden doorway east — closed');
});

test('map terrain summary names doorway routes and party adjacency', () => {
  const map = {
    mapId: 'm1',
    campaignId: 'c1',
    title: 'Quiet chamber',
    coordinateSpace: {
      columns: 8,
      rows: 6,
      pixelsPerSquare: 48,
      feetPerSquare: 5,
      origin: 'top_left',
    },
    cells: [],
    edges: quietChamberEdges,
    tokens: [
      {
        tokenId: 't1',
        seatId: 's1',
        label: 'Pip',
        footprint: {
          size: 'medium',
          width: 1,
          height: 1,
          tinySlot: null,
          elevationFeet: 0,
          anchor: { column: 4, row: 3 },
        },
      },
    ],
    notableFeatures: [],
    provenance: { kind: 'procedural_local_placeholder' },
  };
  assert.equal(isAdjacentToDoorEdge({ column: 4, row: 3 }, quietChamberEdges[2]), true);
  const summary = formatMapTerrainSummary(map);
  assert.match(summary, /Wooden doorway east — closed/);
  assert.doesNotMatch(summary, /unmarked opening/);
  assert.match(summary, /Pip is beside the east door/);
  assert.equal(formatPartyDoorAdjacency(map), 'Pip is beside the east door');
});

test('move travel summary names destination instead of marked destination', () => {
  const map = {
    title: 'Quiet chamber',
    coordinateSpace: { feetPerSquare: 5 },
    edges: quietChamberEdges,
    notableFeatures: [],
  };
  const body = formatMoveTravelSummary({
    path: [
      { column: 3, row: 3 },
      { column: 4, row: 3 },
    ],
    map,
    start: { column: 2, row: 3 },
    actorLabel: 'Pip',
  });
  assert.match(body, /toward Wooden doorway east — closed/);
  assert.doesNotMatch(body, /marked destination/);
  assert.equal(
    describeMoveDestination(map, { column: 4, row: 3 }),
    'Wooden doorway east — closed',
  );
});
