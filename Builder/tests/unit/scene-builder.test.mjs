import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bootstrapBlankFirstScene,
  BLANK_FIRST_SCENE_TITLE,
  mergeRuntimeEdges,
  proposeDoorSceneAhead,
} from '../../dist/server/table/scene-builder.js';

test('proposeDoorSceneAhead places an east wall with a door on the token row', () => {
  const proposal = proposeDoorSceneAhead({ tokenAnchor: { column: 2, row: 3 } });
  assert.ok(proposal.edges.length >= 2);
  const door = proposal.edges.find((edge) => edge.kind === 'door');
  assert.ok(door);
  assert.equal(door.edgeId, proposal.doorEdgeId);
  assert.equal(door.orientation, 'east');
  assert.equal(door.doorState, 'closed');
});

test('bootstrapBlankFirstScene establishes Quiet chamber at the default spawn', () => {
  const bootstrap = bootstrapBlankFirstScene();
  assert.equal(bootstrap.sceneTitle, BLANK_FIRST_SCENE_TITLE);
  assert.match(bootstrap.sceneBanner, /Quiet chamber/i);
  assert.ok(bootstrap.edges.some((edge) => edge.kind === 'door' && edge.doorState === 'closed'));
  assert.equal(bootstrap.doorEdgeId, bootstrap.edges.find((edge) => edge.kind === 'door')?.edgeId);
});

test('mergeRuntimeEdges overlays runtime geometry without duplicate ids', () => {
  const base = [
    {
      edgeId: 'e:1:1:east',
      column: 1,
      row: 1,
      orientation: 'east',
      kind: 'wall',
      doorState: null,
    },
  ];
  const runtime = [
    {
      edgeId: 'e:5:3:east',
      column: 5,
      row: 3,
      orientation: 'east',
      kind: 'door',
      doorState: 'closed',
    },
  ];
  const merged = mergeRuntimeEdges(base, runtime);
  assert.equal(merged.length, 2);
  assert.ok(merged.some((edge) => edge.edgeId === 'e:5:3:east'));
});
