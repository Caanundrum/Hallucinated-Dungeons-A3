import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCampaignBlueprint,
  draftCampaignBlueprintOptionsWithAi,
  formatBlueprintBeatPrompt,
  sanitizeWotcProductIdentity,
  selectActiveBlueprintBeat,
} from '../../dist/server/campaigns/campaign-blueprint.js';
import {
  buildMapRuntimeFromBlueprint,
  travelSceneRuntime,
} from '../../dist/server/table/scene-commands.js';
import { isTrustedAvatarUrl } from '../../dist/shared/portrait-contract.js';
import { resolveSceneArtUrl } from '../../dist/shared/map-contract.js';
import {
  clampGridDimension,
  defaultDimensionsForArchetype,
  verifySceneZonesReachable,
} from '../../dist/server/table/scene-composition.js';
import {
  buildCampaignAssetPrompt,
  resolveBattlemapAspectRatio,
} from '../../dist/server/assets/campaign-assets.js';

test('sanitizeWotcProductIdentity scrubs non-SRD Product Identity terms', () => {
  const raw =
    "A Mind Flayer and a Beholder lurk beneath Waterdeep and Baldur's Gate in the Underdark, serving Vecna.";
  const cleaned = sanitizeWotcProductIdentity(raw);
  assert.doesNotMatch(
    cleaned,
    /Mind Flayer|Beholder|Waterdeep|Baldur's Gate|Underdark|Vecna/i,
  );
  assert.match(cleaned, /Psychic Tentacle Horror/i);
  assert.match(cleaned, /Aberrant Eye Tyrant/i);
  assert.match(cleaned, /Crownport/i);
  assert.match(cleaned, /The Whispering Lich/i);
});

test('buildCampaignBlueprint builds SRD 5.2.1 milestone graph and room XP awards across level range', () => {
  const blueprint = buildCampaignBlueprint({
    summary: 'Recover the stolen lantern from the sunken harbor crypt beneath Oakhaven.',
    name: 'Lantern of Oakhaven',
    startLevel: 1,
    targetEndLevel: 3,
    campaignTone: 'gothic_horror',
  });
  assert.equal(blueprint.startLevel, 1);
  assert.equal(blueprint.targetEndLevel, 3);
  assert.equal(blueprint.campaignTone, 'gothic_horror');
  assert.ok(Array.isArray(blueprint.milestones));
  assert.equal(blueprint.milestones.length, 2);

  // Level 1 -> 2 milestone requires 300 XP; Level 2 -> 3 milestone requires 900 XP.
  const m1 = blueprint.milestones[0];
  const m2 = blueprint.milestones[1];
  assert.equal(m1.targetLevelAfterCompletion, 2);
  assert.equal(m1.requiredXpThreshold, 300);
  assert.equal(m1.rooms.length, 3);
  assert.equal(m1.rooms[0].sceneId, 'scene-m1-r1');
  assert.equal(m1.rooms[2].isMilestoneClimax, true);

  assert.equal(m2.targetLevelAfterCompletion, 3);
  assert.equal(m2.requiredXpThreshold, 900);
  assert.equal(m2.rooms.length, 3);
  assert.equal(m2.rooms[0].sceneId, 'scene-m2-r1');
});

test('formatBlueprintBeatPrompt injects leveling curve pacing and climax gating', () => {
  const blueprint = buildCampaignBlueprint({
    summary: 'Investigate the haunted archive for the missing seal.',
    startLevel: 1,
    targetEndLevel: 2,
    campaignTone: 'mystery_intrigue',
  });
  const beat = selectActiveBlueprintBeat(blueprint, 0);
  assert.ok(beat);

  const gatedPrompt = formatBlueprintBeatPrompt(beat, {
    blueprint,
    currentLevel: 1,
    currentXp: 100,
    activeSceneId: 'scene-m1-r1',
  });
  assert.match(gatedPrompt, /100\s*\/\s*300 XP/i);
  assert.match(gatedPrompt, /below 300/i);

  const unlockedPrompt = formatBlueprintBeatPrompt(beat, {
    blueprint,
    currentLevel: 1,
    currentXp: 300,
    activeSceneId: 'scene-m1-r2',
  });
  assert.match(unlockedPrompt, /300\s*\/\s*300 XP/i);
  assert.match(unlockedPrompt, /ready for the Milestone Climax/i);
});

test('buildMapRuntimeFromBlueprint and travelSceneRuntime traverse multi-map graph and award discovery XP once', () => {
  const blueprint = buildCampaignBlueprint({
    summary: 'Track the missing courier to the ruined watchtower.',
    startLevel: 1,
    targetEndLevel: 2,
    campaignTone: 'heroic_fantasy',
  });
  const runtime = buildMapRuntimeFromBlueprint({
    campaignId: 'camp-graph-1',
    blueprint,
    accountIds: ['acc-1'],
    seatTokens: [{ seatId: 'seat-1', characterId: 'char-1', column: 2, row: 3 }],
    activateFirstScene: true,
  });

  assert.equal(runtime.activeSceneId, 'scene-m1-r1');
  assert.ok(runtime.sceneInstances?.['scene-m1-r1']);
  assert.ok(runtime.sceneInstances?.['scene-m1-r2']);
  assert.ok(runtime.sceneInstances?.['scene-m1-r3']);
  assert.equal(runtime.sceneInstances['scene-m1-r1'].visited, true);
  assert.equal(runtime.sceneInstances['scene-m1-r2'].visited, false);

  // Travel from room 1 to room 2 awards discovery XP on first visit.
  const step1 = travelSceneRuntime({
    runtime,
    campaignId: 'camp-graph-1',
    accountId: 'acc-1',
    destinationHint: 'scene-m1-r2',
  });
  assert.equal(step1.runtime.activeSceneId, 'scene-m1-r2');
  assert.ok((step1.xpAwarded ?? 0) > 0);
  assert.equal(step1.runtime.sceneInstances?.['scene-m1-r2']?.visited, true);

  // Returning to room 1 and then visiting room 2 again does not double-award discovery XP.
  const backTo1 = travelSceneRuntime({
    runtime: step1.runtime,
    campaignId: 'camp-graph-1',
    accountId: 'acc-1',
    destinationHint: 'return',
    returnToPrevious: true,
  });
  assert.equal(backTo1.runtime.activeSceneId, 'scene-m1-r1');
  assert.equal(backTo1.xpAwarded ?? 0, 0);

  const revisit2 = travelSceneRuntime({
    runtime: backTo1.runtime,
    campaignId: 'camp-graph-1',
    accountId: 'acc-1',
    destinationHint: 'scene-m1-r2',
  });
  assert.equal(revisit2.runtime.activeSceneId, 'scene-m1-r2');
  assert.equal(revisit2.xpAwarded ?? 0, 0);
});

test('isTrustedAvatarUrl and resolveSceneArtUrl accept /api/assets/<assetId>', () => {
  assert.equal(isTrustedAvatarUrl('/api/assets/asset_abc-123'), true);
  assert.equal(resolveSceneArtUrl('/api/assets/asset_abc-123'), '/api/assets/asset_abc-123');
});

test('QA Report Fix #1: room summaries and exits stay in-world and multi-word NPC titles never leak into namedPlaces', () => {
  const blueprint = buildCampaignBlueprint({
    summary: 'Stop Tiamat and the Five-Headed Serpent Queen Vaelkora in Waterdeep.',
    name: 'Scourge of the Wyrm',
    startLevel: 1,
    targetEndLevel: 3,
    campaignTone: 'dark_fantasy',
  });
  assert.ok(
    blueprint.namedNpcs.some((npc) => /Serpent Queen Vaelkora/i.test(npc)),
    'Serpent Queen Vaelkora should be classified as an NPC',
  );
  assert.ok(
    blueprint.namedNpcs.some((npc) => /Five-Crowned Wyrm/i.test(npc)),
    'Five-Crowned Wyrm should be classified as an NPC',
  );
  assert.ok(
    !blueprint.namedPlaces.some((place) => /Serpent Queen Vaelkora|Five-Crowned Wyrm/i.test(place)),
    'Boss/NPC names must never be classified as a place',
  );
  for (const milestone of blueprint.milestones ?? []) {
    for (const room of milestone.rooms) {
      assert.doesNotMatch(
        room.summary,
        /\bMilestone\s+\d+\b|\bclimax\b|\bside-trek\b|elevates the party to Level/i,
      );
      assert.doesNotMatch(room.title, /Serpent Queen Vaelkora\s+—|Five-Crowned Wyrm\s+—/i);
      for (const exit of room.exits) {
        assert.doesNotMatch(exit.edgeLabel, /\bMilestone\s+\d+\b/i);
      }
    }
  }
});

test('QA Report Fix HD18-01 through HD18-05: Copper Bell mystery entity roles and milestone variance', () => {
  const premise =
    'In Brindlefen village, courier Mira Vale vanished with a copper bell. Nim arrives at the riverside mill to find Mira alive and recover the bell. The miller Orin is waiting at the entrance.';
  const blueprint = buildCampaignBlueprint({
    summary: premise,
    name: 'The Copper Bell Mystery',
    startLevel: 1,
    targetEndLevel: 3,
    campaignTone: 'dark_fantasy',
  });

  // HD18-01: Mira Vale is an NPC, NOT a place. Mill and Brindlefen are places.
  assert.ok(blueprint.namedNpcs.some((n) => /Mira Vale/i.test(n)), 'Mira Vale is an NPC');
  assert.ok(blueprint.namedNpcs.some((n) => /Orin/i.test(n)), 'Orin is an NPC');
  assert.ok(!blueprint.namedPlaces.some((p) => /Mira Vale/i.test(p)), 'Mira Vale is NOT a place');
  assert.ok(blueprint.namedPlaces.some((p) => /riverside mill/i.test(p)), 'Riverside mill is a place');

  // HD18-02: Prop is copper bell and hook contains copper bell
  assert.ok(blueprint.namedProps.some((p) => /copper bell/i.test(p)), 'copper bell is extracted as prop');
  assert.match(blueprint.questHook ?? '', /copper bell/i, 'quest hook names the copper bell');

  // HD18-03: Orin is the opening NPC waiting at the entrance in Room 1
  const m1 = blueprint.milestones?.[0];
  const m2 = blueprint.milestones?.[1];
  assert.ok(m1 && m2);
  assert.equal(m1.rooms[0]?.npcs[0]?.name, 'Orin', 'Opening NPC is Orin');

  // HD18-04: Distinct room titles across milestones
  assert.notEqual(m1.rooms[1]?.title, m2.rooms[1]?.title, 'Room 2 titles differ across milestones');
  assert.notEqual(m1.rooms[2]?.title, m2.rooms[2]?.title, 'Room 3 titles differ across milestones');

  // HD18-05: No Informant #2 placeholder
  for (const m of blueprint.milestones ?? []) {
    for (const r of m.rooms) {
      assert.doesNotMatch(r.summary, /Informant\s+#\d+/i, 'No Informant #N placeholder');
      for (const npc of r.npcs) {
        assert.doesNotMatch(npc.name, /Informant\s+#\d+/i, 'No Informant #N NPC name');
      }
    }
  }
});

test('Antagonist Wyrm/Boss names never carry leading verbs or spawn in Room 1, and outdoor scenes have no wooden doors', async () => {
  const options = await draftCampaignBlueprintOptionsWithAi({
    summary: 'Remove The Five-Crowned Wyrm from the forest crossroads and save the realm.',
    name: 'Fall of the Wyrm',
    startLevel: 1,
    targetEndLevel: 20,
    campaignTone: 'heroic_fantasy',
    env: { HD_ENVIRONMENT_CLASS: 'local' },
  });
  assert.equal(options.length, 3);
  for (const bp of options) {
    for (const npc of bp.namedNpcs) {
      assert.doesNotMatch(npc, /^(?:Remove|Destroy|Slay|Kill|Defeat)\s+/i);
    }
    const room1 = bp.milestones?.[0]?.rooms?.[0];
    assert.ok(room1);
    for (const npc of room1.npcs) {
      assert.doesNotMatch(npc.name, /Five-Crowned Wyrm|Remove The|Destroy The/i);
    }
    assert.match(room1.battlemapPrompt ?? '', /Top-down overhead fantasy battlemap/i);
    for (const act of bp.acts) {
      assert.doesNotMatch(act.currentActGoal, /Remove The Five-Crowned Wyrm|Destroy The Five-Crowned Wyrm/i);
      assert.doesNotMatch(act.currentActGoal, /the trouble that brought the party together/i);
    }
  }

  const runtime = buildMapRuntimeFromBlueprint({
    campaignId: 'camp-wyrm-outdoor',
    blueprint: options[0],
    accountIds: ['acc-1'],
    activateFirstScene: true,
  });
  const scene1 = runtime.sceneInstances?.['scene-m1-r1'];
  assert.ok(scene1);
  // Outdoor forest crossroads must not have wooden doorways or orphan wall segments in the middle of the trail
  const doorEdges = scene1.edges.filter((e) => e.kind === 'door');
  const wallEdges = scene1.edges.filter((e) => e.kind === 'wall');
  assert.equal(doorEdges.length, 0, 'Outdoor forest crossroads has 0 door edges');
  assert.equal(wallEdges.length, 0, 'Outdoor forest crossroads has 0 orphan wall edges');
});

test('Packet 2: variable grid dimensions, layout archetypes, reachability, and aspect-aligned map prompts', () => {
  assert.equal(clampGridDimension(4, 12), 8);
  assert.equal(clampGridDimension(40, 12), 32);
  assert.equal(clampGridDimension(16, 12), 16);
  assert.deepEqual(defaultDimensionsForArchetype('open_chamber'), { columns: 16, rows: 12 });
  assert.deepEqual(defaultDimensionsForArchetype('alcove_hall'), { columns: 16, rows: 16 });
  assert.deepEqual(defaultDimensionsForArchetype('outdoor_clearing'), { columns: 20, rows: 16 });

  assert.equal(resolveBattlemapAspectRatio(16, 16), '1:1');
  assert.equal(resolveBattlemapAspectRatio(16, 12), '4:3');
  assert.equal(resolveBattlemapAspectRatio(18, 8), '16:9');
  assert.equal(resolveBattlemapAspectRatio(12, 16), '3:4');
  assert.equal(resolveBattlemapAspectRatio(8, 16), '9:16');

  const prompt = buildCampaignAssetPrompt({
    kind: 'battlemap',
    rawPrompt: 'Ancient sanctum chamber',
    gridLayout: {
      columns: 16,
      rows: 16,
      layoutArchetype: 'open_chamber',
      wallSummary: 'Open continuous floor with no interior dividing wall.',
    },
  });
  assert.match(prompt, /16x16 tactical squares \(open chamber\)/i);
  assert.match(prompt, /Open continuous floor with no interior dividing wall/i);

  const bp = buildCampaignBlueprint({
    summary: 'At the Blue Heron tavern, Mara Venn waits for a missing courier behind a locked red door.',
    name: 'Blue Heron Mystery',
    startLevel: 1,
    targetEndLevel: 2,
    campaignTone: 'mystery_investigation',
  });
  const runtime = buildMapRuntimeFromBlueprint({
    campaignId: 'camp-packet2',
    blueprint: bp,
    accountIds: ['acc-1'],
    activateFirstScene: true,
  });
  const r1 = runtime.sceneInstances?.['scene-m1-r1'];
  const r2 = runtime.sceneInstances?.['scene-m1-r2'];
  const r3 = runtime.sceneInstances?.['scene-m1-r3'];
  assert.ok(r1 && r2 && r3);
  assert.equal(r1.layoutArchetype, 'divided_rooms');
  assert.equal(r2.layoutArchetype, 'corridor');
  assert.equal(r2.columns, 16);
  assert.equal(r2.rows, 8);
  assert.equal(r3.layoutArchetype, 'open_chamber');
  assert.equal(r3.columns, 16);
  assert.equal(r3.rows, 16);
  assert.equal(r2.edges.length, 0, 'Corridor without door exit has no center dividing wall');
  assert.equal(r3.edges.length, 0, 'Open sanctum chamber has no center dividing wall');
  for (const scene of [r1, r2, r3]) {
    assert.equal(
      verifySceneZonesReachable({
        columns: scene.columns,
        rows: scene.rows,
        cells: scene.cells,
        edges: scene.edges,
        spawn: scene.spawn,
      }),
      true,
      `All walkable squares in ${scene.sceneId} must be reachable from spawn`,
    );
  }
});

test('Packet 3 & Packet 5: Three-Way Lock Rule and Rolling Headlights Just-In-Time (JIT) compilation', () => {
  const bp = buildCampaignBlueprint({
    summary: 'At the Blue Heron tavern, Mara Venn holds the brass key to a locked red door.',
    name: 'Rolling Headlights Campaign',
    startLevel: 1,
    targetEndLevel: 3,
    campaignTone: 'mystery_investigation',
  });

  // Packet 5: Rolling Headlights pre-compiles only scene-m1-r1 and scene-m1-r2 at creation time
  const runtime = buildMapRuntimeFromBlueprint({
    campaignId: 'camp-headlights',
    blueprint: bp,
    accountIds: ['acc-1'],
    activateFirstScene: true,
    onlySceneIds: ['scene-m1-r1', 'scene-m1-r2'],
  });
  assert.ok(runtime.sceneInstances?.['scene-m1-r1']);
  assert.ok(runtime.sceneInstances?.['scene-m1-r2']);
  assert.equal(runtime.sceneInstances?.['scene-m1-r3'], undefined);
  assert.equal(runtime.sceneInstances?.['scene-m2-r1'], undefined);

  // Packet 3: Three-Way Lock Rule — locked door in scene-m1-r1 has keyItemId, lockpickDC, breakDC,
  // and the key exists in an NPC's heldItems or unlocked container/item in the scene.
  const r1 = runtime.sceneInstances['scene-m1-r1'];
  const lockedDoor = r1.edges.find((e) => e.kind === 'door' && r1.doorStates[e.edgeId] === 'locked');
  assert.ok(lockedDoor, 'Locked premise produces a locked door edge');
  assert.ok(lockedDoor.keyItemId, 'Locked door has a keyItemId');
  assert.equal(typeof lockedDoor.lockpickDC, 'number');
  assert.equal(typeof lockedDoor.breakDC, 'number');
  const keyExistsOnScene = r1.features.some(
    (f) =>
      (f.heldItems ?? []).includes(lockedDoor.keyItemId) ||
      (f.contents ?? []).includes(lockedDoor.keyItemId) ||
      (f.objectKind === 'item' && f.label.includes(lockedDoor.keyItemId)),
  );
  assert.equal(keyExistsOnScene, true, 'Matching keyItemId exists on an NPC or container/item in the scene');

  // Travel from scene-m1-r1 -> scene-m1-r2 (already in headlights)
  const step1 = travelSceneRuntime({
    runtime,
    campaignId: 'camp-headlights',
    accountId: 'acc-1',
    destinationHint: 'scene-m1-r2',
    blueprint: bp,
  });
  assert.equal(step1.runtime.activeSceneId, 'scene-m1-r2');

  // Travel from scene-m1-r2 -> scene-m1-r3: JIT compiles scene-m1-r3 AND its forward headlight scene-m2-r1!
  const step2 = travelSceneRuntime({
    runtime: step1.runtime,
    campaignId: 'camp-headlights',
    accountId: 'acc-1',
    destinationHint: 'scene-m1-r3',
    blueprint: bp,
  });
  assert.equal(step2.runtime.activeSceneId, 'scene-m1-r3');
  assert.equal(step2.jitCompiledSceneId, 'scene-m1-r3');
  assert.ok(step2.runtime.sceneInstances?.['scene-m1-r3']);
  assert.ok(
    step2.runtime.sceneInstances?.['scene-m2-r1'],
    'Rolling Headlights pre-compiled forward exit scene-m2-r1 when arriving in scene-m1-r3',
  );
});



