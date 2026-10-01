import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendEquipmentOverride,
} from '../../dist/server/rules/engine/encounter-runtime.js';
import {
  isPortableSceneContainer,
  matchTakeContainerByDeclaration,
  takeScenePropRuntime,
} from '../../dist/server/table/scene-commands.js';
import { removeSceneObject } from '../../dist/server/table/scene-runtime.js';

function runtimeWithFeatures(features) {
  return {
    campaignId: 'camp-1',
    tokenPositions: [],
    doorStates: {},
    runtimeEdges: [],
    sceneTitle: 'Canal warehouse',
    exploredByAccount: {},
    activeSceneId: 'scene-1',
    sceneInstances: {
      'scene-1': {
        sceneId: 'scene-1',
        templateId: 't1',
        title: 'Canal warehouse',
        sceneBanner: '',
        purpose: 'interior',
        environment: 'urban',
        lighting: 'dim',
        mood: 'tense',
        columns: 12,
        rows: 8,
        cells: [],
        edges: [],
        features,
        doorStates: {},
        spawn: { column: 2, row: 2 },
        exits: [],
        tokenPositions: [],
        exploredByAccount: {},
        revision: 1,
      },
    },
    sceneStack: [],
    adventureStarted: true,
    premiseKey: 'courier',
  };
}

test('appendEquipmentOverride merges onto base sheet without wipe', () => {
  const next = appendEquipmentOverride({
    baseEquipment: [
      { name: 'Longsword', quantity: 1, equipped: true },
      { name: 'Backpack', quantity: 1 },
    ],
    itemName: 'Courier satchel',
  });
  assert.equal(next.length, 3);
  assert.ok(next.some((item) => item.name === 'Longsword' && item.quantity === 1));
  assert.ok(next.some((item) => item.name === 'Courier satchel' && item.quantity === 1));
});

test('appendEquipmentOverride stacks duplicate names on overrides', () => {
  const next = appendEquipmentOverride({
    baseEquipment: [{ name: 'Rope', quantity: 1 }],
    equipmentOverrides: [
      { name: 'Rope', quantity: 1 },
      { name: 'Courier satchel', quantity: 1 },
    ],
    itemName: 'Courier satchel',
  });
  const satchel = next.find((item) => item.name === 'Courier satchel');
  assert.equal(satchel?.quantity, 2);
  assert.equal(next.length, 2);
});

test('matchTakeContainerByDeclaration finds courier satchel', () => {
  const runtime = runtimeWithFeatures([
    {
      objectId: 'obj:satchel',
      column: 4,
      row: 3,
      label: 'Courier satchel (open)',
      referenceKind: 'poi',
      objectKind: 'container',
      state: 'open',
      interactable: true,
    },
    {
      objectId: 'obj:crate',
      column: 5,
      row: 3,
      label: 'Freight crate',
      referenceKind: 'poi',
      objectKind: 'container',
      state: 'closed',
      interactable: true,
    },
  ]);
  assert.equal(
    matchTakeContainerByDeclaration(runtime, 'I take the open courier satchel'),
    'obj:satchel',
  );
  assert.equal(
    matchTakeContainerByDeclaration(runtime, 'I take the freight crate'),
    null,
  );
});

test('takeScenePropRuntime removes portable container from the scene', () => {
  const runtime = runtimeWithFeatures([
    {
      objectId: 'obj:satchel',
      column: 4,
      row: 3,
      label: 'Courier satchel (open)',
      referenceKind: 'poi',
      objectKind: 'container',
      state: 'open',
      interactable: true,
    },
  ]);
  assert.equal(isPortableSceneContainer(runtime.sceneInstances['scene-1'].features[0]), true);
  const result = takeScenePropRuntime({ runtime, objectId: 'obj:satchel' });
  assert.equal(result.equipmentName, 'Courier satchel');
  assert.equal(result.runtime.sceneInstances['scene-1'].features.length, 0);
  assert.match(result.chronicle, /stowed in inventory/i);
});

test('removeSceneObject is a no-op when id is missing', () => {
  const runtime = runtimeWithFeatures([
    {
      objectId: 'obj:satchel',
      column: 4,
      row: 3,
      label: 'Courier satchel',
      referenceKind: 'poi',
      objectKind: 'container',
      state: 'closed',
      interactable: true,
    },
  ]);
  assert.equal(removeSceneObject({ runtime, objectId: 'missing' }), null);
});
