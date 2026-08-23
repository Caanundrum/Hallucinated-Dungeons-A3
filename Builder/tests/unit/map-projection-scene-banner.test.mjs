import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAuthoritativeMapBundle } from '../../dist/server/table/map-projection.js';

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
