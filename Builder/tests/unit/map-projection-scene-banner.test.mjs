import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAuthoritativeMapBundle } from '../../dist/server/table/map-projection.js';
import { BLANK_FIRST_SCENE_TITLE } from '../../dist/server/table/scene-builder.js';

test('FQA-010 / PQA-187: blank tables await Director first scene (no Quiet chamber auto-bootstrap)', () => {
  const map = buildAuthoritativeMapBundle({
    campaignId: 'camp-blank',
    seats: [],
    runtime: {
      tokenPositions: [],
      doorStates: {},
      runtimeEdges: [],
      exploredByAccount: {},
    },
    adventureTemplateId: null,
    currentChapterId: null,
  });
  assert.equal(map.title, 'Awaiting first scene');
  assert.match(map.sceneBanner, /Game Director|first scene/i);
  assert.equal(map.edges.length, 0);
  assert.equal(map.notableFeatures.length, 0);
  assert.doesNotMatch(map.sceneBanner, /empty table/i);
  assert.notEqual(map.title, 'Blank table');
  assert.notEqual(map.title, BLANK_FIRST_SCENE_TITLE);
});

test('PQA-177: Quiet chamber reference markers remain available for legacy bootstrap helper', async () => {
  const { BLANK_FIRST_SCENE_REFERENCE_MARKERS } = await import(
    '../../dist/server/table/scene-builder.js'
  );
  assert.ok(BLANK_FIRST_SCENE_REFERENCE_MARKERS.length >= 3);
  assert.ok(BLANK_FIRST_SCENE_REFERENCE_MARKERS.some((feature) => feature.referenceKind === 'lighting'));
  assert.ok(BLANK_FIRST_SCENE_REFERENCE_MARKERS.some((feature) => feature.referenceKind === 'cover'));
  assert.ok(BLANK_FIRST_SCENE_REFERENCE_MARKERS.some((feature) => feature.referenceKind === 'hazard'));
  assert.ok(
    BLANK_FIRST_SCENE_REFERENCE_MARKERS.every((feature) => /reference/i.test(feature.label)),
  );
});

test('PQA-160: scene banner reflects improvised chamber title and geometry', () => {
  const map = buildAuthoritativeMapBundle({
    campaignId: 'camp-1',
    seats: [],
    runtime: {
      tokenPositions: [],
      doorStates: {},
      runtimeEdges: [
        {
          edgeId: 'e:5:3:east',
          column: 5,
          row: 3,
          orientation: 'east',
          kind: 'door',
          doorState: 'closed',
        },
      ],
      sceneTitle: 'Improvised chamber',
      exploredByAccount: {},
    },
    adventureTemplateId: null,
    currentChapterId: null,
  });
  assert.match(map.sceneBanner, /Improvised chamber/i);
  assert.match(map.sceneBanner, /walls and doorways are committed/i);
  assert.equal(map.title, 'Improvised chamber');
});
