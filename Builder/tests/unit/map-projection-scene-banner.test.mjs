import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAuthoritativeMapBundle } from '../../dist/server/table/map-projection.js';
import { BLANK_FIRST_SCENE_TITLE } from '../../dist/server/table/scene-builder.js';

test('PQA-187: blank tables bootstrap Quiet chamber with walls and a door', () => {
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
  assert.equal(map.title, BLANK_FIRST_SCENE_TITLE);
  assert.match(map.sceneBanner, /Quiet chamber/i);
  assert.match(map.sceneBanner, /wooden doorway|walls/i);
  assert.ok(map.edges.some((edge) => edge.kind === 'door'));
  assert.ok(map.edges.some((edge) => edge.kind === 'wall'));
  assert.ok(map.cells.some((cell) => cell.terrain === 'blocked'));
  assert.doesNotMatch(map.sceneBanner, /empty table/i);
  assert.notEqual(map.title, 'Blank table');
});

test('PQA-177: Quiet chamber seeds non-authoritative reference markers', () => {
  const map = buildAuthoritativeMapBundle({
    campaignId: 'camp-blank-markers',
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
  assert.ok(map.notableFeatures.length >= 3);
  assert.ok(map.notableFeatures.some((feature) => feature.referenceKind === 'lighting'));
  assert.ok(map.notableFeatures.some((feature) => feature.referenceKind === 'cover'));
  assert.ok(map.notableFeatures.some((feature) => feature.referenceKind === 'hazard'));
  assert.ok(
    map.notableFeatures.every((feature) => /reference/i.test(feature.label)),
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
