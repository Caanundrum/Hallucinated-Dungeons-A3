import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FEET_PER_SQUARE,
  MAP_COORDINATE_SCHEMA_VERSION,
  defaultFootprintForSize,
  edgeId,
} from '../../dist/shared/map-contract.js';
import {
  DEFAULT_MOVEMENT_BUDGET_FEET,
  areAdjacent,
  isDiagonalStep,
} from '../../dist/shared/movement-contract.js';
import {
  crossedEdgeId,
  validateWalkPath,
  visibleSquaresFrom,
} from '../../dist/server/table/path-validator.js';
import {
  buildStarterCells,
  buildStarterInteriorWalls,
} from '../../dist/server/table/map-projection.js';

function starterMap(tokens = []) {
  return {
    campaignId: 'test',
    mapBundleId: 'starter:test',
    mapVersion: 1,
    title: 'Local starter chamber',
    coordinateSpace: {
      coordinateSpaceId: 'space:test',
      schemaVersion: MAP_COORDINATE_SCHEMA_VERSION,
      columns: 12,
      rows: 8,
      feetPerSquare: FEET_PER_SQUARE,
      pixelsPerSquare: 48,
    },
    cells: buildStarterCells(),
    edges: buildStarterInteriorWalls(),
    tokens,
    artProvenance: 'procedural_local_placeholder',
    viewerSeatId: null,
    exploredSquareIds: [],
    visibleSquareIds: [],
  };
}

test('orthogonal adjacency and diagonal detection', () => {
  assert.equal(areAdjacent({ column: 2, row: 2 }, { column: 3, row: 2 }), true);
  assert.equal(areAdjacent({ column: 2, row: 2 }, { column: 3, row: 3 }), true);
  assert.equal(areAdjacent({ column: 2, row: 2 }, { column: 4, row: 2 }), false);
  assert.equal(isDiagonalStep({ column: 2, row: 2 }, { column: 3, row: 3 }), true);
  assert.equal(crossedEdgeId({ column: 2, row: 2 }, { column: 3, row: 2 }), edgeId(2, 2, 'east'));
});

test('legal one-step walk onto floor costs five feet', () => {
  const map = starterMap([
    {
      tokenId: 'token:a',
      seatId: 'seat-a',
      label: 'Scout',
      footprint: defaultFootprintForSize('medium', { column: 2, row: 2 }),
    },
  ]);
  const result = validateWalkPath({
    map,
    start: { column: 2, row: 2 },
    path: [{ column: 3, row: 2 }],
    footprintTemplate: defaultFootprintForSize('medium', { column: 2, row: 2 }),
    movementBudgetFeet: DEFAULT_MOVEMENT_BUDGET_FEET,
    movementMode: 'walk',
    actorSeatId: 'seat-a',
  });
  assert.equal(result.legal, true);
  assert.equal(result.totalCostFeet, 5);
  assert.equal(result.remainingBudgetFeet, 25);
});

test('closed door edge rejects orthogonal entry', () => {
  const map = starterMap([
    {
      tokenId: 'token:a',
      seatId: 'seat-a',
      label: 'Scout',
      footprint: defaultFootprintForSize('medium', { column: 5, row: 3 }),
    },
  ]);
  const result = validateWalkPath({
    map,
    start: { column: 5, row: 3 },
    path: [{ column: 6, row: 3 }],
    footprintTemplate: defaultFootprintForSize('medium', { column: 5, row: 3 }),
    movementBudgetFeet: DEFAULT_MOVEMENT_BUDGET_FEET,
    movementMode: 'walk',
    actorSeatId: 'seat-a',
  });
  assert.equal(result.legal, false);
  assert.equal(result.rejectionCode, 'BLOCKED_EDGE');
});

test('blocked border terrain rejects entry', () => {
  const map = starterMap([
    {
      tokenId: 'token:a',
      seatId: 'seat-a',
      label: 'Scout',
      footprint: defaultFootprintForSize('medium', { column: 1, row: 1 }),
    },
  ]);
  const result = validateWalkPath({
    map,
    start: { column: 1, row: 1 },
    path: [{ column: 0, row: 1 }],
    footprintTemplate: defaultFootprintForSize('medium', { column: 1, row: 1 }),
    movementBudgetFeet: DEFAULT_MOVEMENT_BUDGET_FEET,
    movementMode: 'walk',
    actorSeatId: 'seat-a',
  });
  assert.equal(result.legal, false);
  assert.equal(result.rejectionCode, 'BLOCKED_TERRAIN');
});

test('vision radius enumerates Chebyshev disk inside map bounds', () => {
  const squares = visibleSquaresFrom({ column: 2, row: 2 }, 1, { columns: 12, rows: 8 });
  assert.equal(squares.length, 9);
});
