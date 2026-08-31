import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  composeDirectorScene,
  directorNarrationBeat,
  directorOwnedCompositionHint,
  nextObjectState,
  featureLabelWithState,
  matchLandmarkDestination,
  sceneContractSummary,
} from '../../dist/server/table/scene-composition.js';
import { applyComposedSceneToRuntime, updateSceneObjectState } from '../../dist/server/table/scene-runtime.js';
import { emptyMapRuntime } from '../../dist/server/table/map-runtime.js';
import { buildAuthoritativeMapBundle } from '../../dist/server/table/map-projection.js';
import { squareId } from '../../dist/shared/map-contract.js';

describe('Batch 3 Director scene abstraction', () => {
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
    assert.ok(inn.description.length > 10);
    assert.ok(inn.exits.length >= 1);
    assert.match(sceneContractSummary(inn), /Inhabitants: none/);
  });

  it('places encounter inhabitants inside spawn vision with creature/npc markers', () => {
    const encounter = composeDirectorScene({
      kind: 'encounter',
      sceneId: 'enc-1',
      destinationHint: 'watchful stranger danger ahead',
      seedKey: 'camp:enc',
    });
    const actor = encounter.features.find(
      (f) => f.objectKind === 'creature' || f.objectKind === 'npc',
    );
    assert.ok(actor);
    assert.ok(encounter.inhabitantObjectIds.includes(actor.objectId));
    assert.ok(['creature', 'npc'].includes(actor.referenceKind));
    const dist =
      Math.abs(actor.column - encounter.spawn.column) + Math.abs(actor.row - encounter.spawn.row);
    assert.ok(dist <= 4, `actor too far from spawn: ${dist}`);

    const runtime = applyComposedSceneToRuntime({
      runtime: emptyMapRuntime('camp'),
      composed: encounter,
      mode: 'establish',
      accountIds: ['acct'],
      seatTokens: [{ seatId: 'seat-1', column: 2, row: 2 }],
    });
    const explored = new Set(runtime.exploredByAccount.acct ?? []);
    assert.ok(
      explored.has(squareId(actor.column, actor.row)),
      'inhabitant square must be explored so fog does not hide fiction',
    );
    const full = buildAuthoritativeMapBundle({
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
    assert.ok(
      full.notableFeatures.some((f) => /stranger|bandit|wolf|lookout/i.test(f.label)),
      'inhabitant missing from authoritative projection',
    );
  });

  it('composes open-ended landmark destinations with distinct layouts', () => {
    assert.equal(matchLandmarkDestination('climb to the ruined watchtower on the ridge'), true);
    const tower = composeDirectorScene({
      kind: 'landmark',
      sceneId: 'lm-tower',
      destinationHint: 'climb to the ruined watchtower on the ridge',
      seedKey: 'camp:tower',
    });
    const docks = composeDirectorScene({
      kind: 'landmark',
      sceneId: 'lm-docks',
      destinationHint: 'make for the foggy docks',
      seedKey: 'camp:docks',
    });
    assert.notEqual(tower.templateId, docks.templateId);
    assert.notEqual(tower.columns, docks.columns);
    assert.ok(tower.exits.length >= 2);
    assert.ok(docks.exits.length >= 2);
    assert.ok(tower.features.some((f) => /shutter|masonry/i.test(f.label)));
    const towerExits = tower.features.filter((f) => f.objectKind === 'exit');
    assert.ok(towerExits.length >= 2, 'watchtower contract exits must project as features');
    assert.ok(towerExits.some((f) => /parapet|stair/i.test(f.label)));
    assert.ok(towerExits.some((f) => /ladder/i.test(f.label)));
    assert.ok(
      tower.edges.filter((e) => e.kind === 'door').length >= 1,
      'watchtower must expose door/exit edges on the tactical map',
    );
    const dist = Math.abs(towerExits[0].column - tower.spawn.column) + Math.abs(towerExits[0].row - tower.spawn.row);
    assert.ok(dist <= 4, 'exit markers must stay inside spawn vision');
  });

  it('projects contract exits for every scene kind', () => {
    for (const kind of /** @type {const} */ (['interior', 'exterior', 'encounter', 'landmark'])) {
      const scene = composeDirectorScene({
        kind,
        sceneId: `exit-${kind}`,
        premise: 'misty marsh inn',
        destinationHint:
          kind === 'landmark' ? 'climb to the ruined watchtower on the ridge' : 'travel onward into danger',
        seedKey: `camp:exit:${kind}`,
      });
      assert.ok(scene.exits.length >= 1, `${kind} needs at least one contract exit`);
      assert.ok(
        scene.features.filter((f) => f.objectKind === 'exit').length >= scene.exits.length,
        `${kind} must materialize every contract exit`,
      );
      assert.ok(scene.edges.some((e) => e.kind === 'door'), `${kind} must have door geometry`);
    }
  });

  it('persists non-light cover state across travel and return', () => {
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
    const cover = interior.features.find((f) => f.objectKind === 'cover');
    assert.ok(cover);
    const next = nextObjectState(cover, 'smash the crate stack');
    assert.equal(next, 'broken');
    runtime = updateSceneObjectState({
      runtime,
      objectId: cover.objectId,
      nextState: 'broken',
      labelWithState: featureLabelWithState({ ...cover, state: 'broken' }),
    });
    assert.ok(runtime);

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
    runtime = applyComposedSceneToRuntime({
      runtime,
      composed: interior,
      mode: 'restore',
      accountIds: ['acct'],
      seatTokens: runtime.tokenPositions,
    });
    const restored = runtime.sceneInstances?.[interior.sceneId]?.features.find(
      (f) => f.objectId === cover.objectId,
    );
    assert.equal(restored?.state, 'broken');
  });

  it('produces Director narration beats from the scene contract', () => {
    const scene = composeDirectorScene({
      kind: 'encounter',
      sceneId: 'n1',
      destinationHint: 'danger ahead',
      seedKey: 'camp:narr',
    });
    const establish = directorNarrationBeat('establish', { scene });
    assert.match(establish, /./);
    assert.ok(!/^Traveled to /i.test(establish));
    assert.ok(!/^Scene built:/i.test(establish));
    const travel = directorNarrationBeat('travel', { scene, priorTitle: 'Warm inn' });
    assert.match(travel, /Warm inn/);
    assert.ok(travel.includes(scene.title));
  });

  it('keeps encounter family under Director seed, not player phrasing', () => {
    const wolfAsk = composeDirectorScene({
      kind: 'encounter',
      sceneId: 'e-wolf',
      destinationHint: 'travel onward into the wolf thicket',
      seedKey: 'camp:authority:enc',
    });
    const banditAsk = composeDirectorScene({
      kind: 'encounter',
      sceneId: 'e-bandit',
      destinationHint: 'travel onward into the bandit ambush',
      seedKey: 'camp:authority:enc',
    });
    assert.equal(wolfAsk.templateId, banditAsk.templateId);
    assert.equal(wolfAsk.environment, banditAsk.environment);
  });

  it('resolves composition hints from presented exits or premise/seed, not invented names', () => {
    const invented = directorOwnedCompositionHint({
      kind: 'landmark',
      premise: 'a misty marsh inn',
      seedKey: 'camp:hint:1',
      playerDeclaration: 'climb to the crystal palace',
      presentedExits: [
        {
          label: 'Trail toward higher ground',
          destinationHint: 'the ruined watchtower on the ridge',
        },
      ],
    });
    assert.ok(!/palace/i.test(invented));
    assert.match(invented, /watchtower|dock|cavern|bridge|ruin/i);

    const viaExit = directorOwnedCompositionHint({
      kind: 'landmark',
      premise: 'a misty marsh inn',
      seedKey: 'camp:hint:1',
      playerDeclaration: 'take the trail toward higher ground',
      presentedExits: [
        {
          label: 'Trail toward higher ground',
          destinationHint: 'the ruined watchtower on the ridge',
        },
      ],
    });
    assert.match(viaExit, /watchtower/i);

    const exterior = directorOwnedCompositionHint({
      kind: 'exterior',
      premise: 'a misty marsh inn beside the reeds',
      seedKey: 'camp:hint:ext',
      playerDeclaration: 'leave toward the crystal palace',
      presentedExits: [],
    });
    assert.match(exterior, /marsh/i);
  });
});
