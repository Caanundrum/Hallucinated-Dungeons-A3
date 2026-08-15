import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CREATURE_SIZES,
  DEFAULT_FOOTPRINT_SQUARES,
  FEET_PER_SQUARE,
  MAP_COORDINATE_SCHEMA_VERSION,
  WEBGL_LAYER_Z_INDEX,
  WEBGL_RENDER_LAYERS,
  defaultFootprintForSize,
  edgeId,
  footprintFitsCoordinateSpace,
  footprintSquares,
  isCreatureSize,
  isWebGlRenderLayer,
  squareId,
} from '../../dist/shared/map-contract.js';

test('map schema version and five-foot scale are fixed for Phase 2b', () => {
  assert.equal(MAP_COORDINATE_SCHEMA_VERSION, 'phase2-map-v1');
  assert.equal(FEET_PER_SQUARE, 5);
});

test('creature sizes and default footprints match the reviewed SRD-shaped defaults', () => {
  assert.deepEqual([...CREATURE_SIZES], [
    'tiny',
    'small',
    'medium',
    'large',
    'huge',
    'gargantuan',
  ]);
  assert.deepEqual(DEFAULT_FOOTPRINT_SQUARES.medium, { width: 1, height: 1 });
  assert.deepEqual(DEFAULT_FOOTPRINT_SQUARES.large, { width: 2, height: 2 });
  assert.deepEqual(DEFAULT_FOOTPRINT_SQUARES.gargantuan, { width: 4, height: 4 });
  assert.equal(isCreatureSize('medium'), true);
  assert.equal(isCreatureSize('colossal'), false);
});

test('square and edge identifiers are deterministic', () => {
  assert.equal(squareId(3, 4), 'c3r4');
  assert.equal(edgeId(5, 2, 'east'), 'e:5:2:east');
});

test('footprint expansion and fit checks stay integer and fail closed', () => {
  const medium = defaultFootprintForSize('medium', { column: 1, row: 1 });
  assert.deepEqual(footprintSquares(medium), [{ column: 1, row: 1 }]);
  assert.equal(footprintFitsCoordinateSpace(medium, { columns: 12, rows: 8 }), true);

  const large = defaultFootprintForSize('large', { column: 11, row: 0 });
  assert.equal(footprintFitsCoordinateSpace(large, { columns: 12, rows: 8 }), false);

  const tinyOk = defaultFootprintForSize('tiny', { column: 0, row: 0 }, { tinySlot: 'se' });
  assert.equal(tinyOk.tinySlot, 'se');
  assert.equal(footprintFitsCoordinateSpace(tinyOk, { columns: 2, rows: 2 }), true);

  const tinyMissingSlot = { ...tinyOk, tinySlot: null };
  assert.equal(footprintFitsCoordinateSpace(tinyMissingSlot, { columns: 2, rows: 2 }), false);
});

test('Render Layer Registry assigns named layers with increasing z indices', () => {
  assert.equal(WEBGL_RENDER_LAYERS[0], 'world_background');
  assert.equal(WEBGL_RENDER_LAYERS.at(-1), 'canvas_affordances');
  assert.equal(isWebGlRenderLayer('tokens_entities'), true);
  assert.equal(isWebGlRenderLayer('hud_overlay'), false);
  let previous = -1;
  for (const layer of WEBGL_RENDER_LAYERS) {
    assert.ok(WEBGL_LAYER_Z_INDEX[layer] > previous, layer);
    previous = WEBGL_LAYER_Z_INDEX[layer];
  }
});
