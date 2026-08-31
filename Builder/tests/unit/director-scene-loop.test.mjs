import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  composeDirectorScene,
  nextObjectState,
  featureLabelWithState,
} from '../../dist/server/table/scene-composition.js';
import { applyComposedSceneToRuntime, updateSceneObjectState } from '../../dist/server/table/scene-runtime.js';
import { emptyMapRuntime } from '../../dist/server/table/map-runtime.js';
import { buildAuthoritativeMapBundle } from '../../dist/server/table/map-projection.js';

describe('Batch 2 Director scene composition', () => {
  it('composes different interiors from different premises', () => {
    const inn = composeDirectorScene({
      kind: 'interior',
      sceneId: 's-inn',
      premise: 'a haunted marsh inn',
      seedKey: 'camp-a:inn',
    });
    const crypt = composeDirectorScene({
      kind: 'interior',
      sceneId: 's-crypt',
      premise: 'a sealed stone crypt',
      seedKey: 'camp-b:crypt',
    });
    assert.notEqual(inn.templateId, crypt.templateId);
    assert.notEqual(inn.title, crypt.title);
    assert.ok(inn.features.some((f) => f.objectKind === 'light' && f.interactable));
    assert.ok(inn.exits.length >= 1);
    assert.ok(inn.columns >= 10);
  });

  it('persists non-door object state across travel and return', () => {
    const interior = composeDirectorScene({
      kind: 'interior',
      sceneId: 's1',
      premise: 'workshop by the forest',
      seedKey: 'camp:loop',
    });
    let runtime = applyComposedSceneToRuntime({
      runtime: emptyMapRuntime('camp'),
      composed: interior,
      mode: 'establish',
      accountIds: ['acct'],
      seatTokens: [{ seatId: 'seat-1', column: 2, row: 2 }],
    });
    const light = interior.features.find((f) => f.objectKind === 'light');
    assert.ok(light);
    const next = nextObjectState(light, 'extinguish the lamp');
    assert.equal(next, 'unlit');
    runtime = updateSceneObjectState({
      runtime,
      objectId: light.objectId,
      nextState: 'unlit',
      labelWithState: featureLabelWithState({ ...light, state: 'unlit' }),
    });
    assert.ok(runtime);
    const unlitLabel = runtime.sceneInstances?.[interior.sceneId]?.features.find(
      (f) => f.objectId === light.objectId,
    )?.label;
    assert.match(unlitLabel ?? '', /unlit/i);

    const exterior = composeDirectorScene({
      kind: 'exterior',
      sceneId: 's2',
      destinationHint: 'the forest path',
      seedKey: 'camp:loop:ext',
      returnToSceneId: interior.sceneId,
    });
    runtime = applyComposedSceneToRuntime({
      runtime,
      composed: exterior,
      mode: 'travel',
      accountIds: ['acct'],
      seatTokens: runtime.tokenPositions,
    });
    assert.equal(runtime.activeSceneId, exterior.sceneId);
    assert.ok((runtime.sceneStack ?? []).includes(interior.sceneId));

    runtime = applyComposedSceneToRuntime({
      runtime,
      composed: interior,
      mode: 'restore',
      accountIds: ['acct'],
      seatTokens: runtime.tokenPositions,
    });
    assert.equal(runtime.activeSceneId, interior.sceneId);
    const restored = runtime.sceneInstances?.[interior.sceneId]?.features.find(
      (f) => f.objectId === light.objectId,
    );
    assert.equal(restored?.state, 'unlit');
  });

  it('projects Director scenes onto the map bundle with mapApplied geometry', () => {
    const interior = composeDirectorScene({
      kind: 'interior',
      sceneId: 'proj-1',
      premise: 'village cottage',
      seedKey: 'camp:proj',
    });
    const runtime = applyComposedSceneToRuntime({
      runtime: emptyMapRuntime('camp'),
      composed: interior,
      mode: 'establish',
      accountIds: ['acct'],
      seatTokens: [{ seatId: 'seat-1', column: 2, row: 2 }],
    });
    const bundle = buildAuthoritativeMapBundle({
      campaignId: 'camp',
      seats: [
        {
          seatId: 'seat-1',
          campaignId: 'camp',
          ownerAccountId: 'acct',
          characterId: 'char-1',
          characterName: 'Hero',
        },
      ],
      runtime,
    });
    assert.equal(bundle.title, interior.title);
    assert.ok(bundle.mapBundleId.startsWith('director:'));
    assert.ok(bundle.notableFeatures.some((f) => f.objectId && f.objectState));
    assert.notEqual(bundle.title, 'Quiet chamber');
  });
});
