import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCampaignBlueprint,
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
