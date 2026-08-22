import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
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
