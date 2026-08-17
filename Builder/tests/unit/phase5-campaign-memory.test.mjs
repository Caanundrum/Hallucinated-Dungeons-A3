import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADVENTURE_TEMPLATES,
  RECOMMENDED_ADVENTURE_TEMPLATE,
  isAdventureTemplate,
} from '../../dist/shared/campaign-contract.js';
import {
  NPC_AUDIENCE_LEVELS,
  QUEST_STATUSES,
  SESSION_STATES,
  isNpcAudienceLevel,
} from '../../dist/shared/campaign-memory-contract.js';
import {
  EMBERFERRY_CROSSING_PACK,
  STARTER_CAMPAIGN_PACK_ID,
} from '../../dist/shared/content/emberferry-crossing.js';
import {
  isMapArtProvenance,
  MAP_ART_PROVENANCE_VALUES,
} from '../../dist/shared/map-contract.js';
import {
  MAX_CONCURRENT_CUE_SOUNDS,
  MAX_CUE_SOUND_DURATION_MS,
  PRESENTATION_CUE_KINDS,
  isPresentationCueKind,
} from '../../dist/shared/presentation-cue-contract.js';
import {
  isNarrationDensity,
  NARRATION_DENSITIES,
} from '../../dist/shared/settings-contract.js';
import { ERROR_CODES } from '../../dist/shared/contract.js';
import { COLLECTIONS } from '../../dist/server/persistence/firestore.js';
import {
  loadAdventureMapPresentation,
  resolveStarterPack,
  resolveStarterPackForTemplate,
} from '../../dist/server/campaigns/campaign-memory.js';
import { classifyEvent } from '../../dist/server/presentation/presentation-cues.js';

/**
 * Phase 5 campaign memory, starter pack, and Presentation Cue Plan coverage.
 *
 * Firestore-backed flows (`ensureCampaignMemory`, `recordSessionSuspend`,
 * `resumeSession`, `loadCampaignMemory`, `fetchPresentationCuePlan`) are
 * proved end-to-end against the real Local Arena emulator by
 * `tests/e2e/phase5-starter-resume.spec.ts`, consistent with this suite's
 * existing convention of not faking Firestore in `node:test` unit coverage
 * (see `tests/unit/characters-service.test.mjs`). This file covers every
 * pure, Firestore-free piece: starter-pack resolution, audience
 * classification on the seed content itself, and cue-kind derivation.
 */

function fakeEvent(overrides) {
  return {
    eventId: 'evt-1',
    eventSequence: 1,
    eventType: 'table.token_moved',
    commandId: 'cmd-1',
    requestId: 'req-1',
    actorAccountId: 'acc-1',
    seatId: 'seat-1',
    priorStateVersion: 0,
    resultStateVersion: 1,
    committedAt: '2026-08-16T00:00:00.000Z',
    ...overrides,
  };
}

test('campaign memory contract defines audience, quest, and session enums', () => {
  assert.deepEqual([...NPC_AUDIENCE_LEVELS], ['public', 'private', 'secret']);
  assert.equal(isNpcAudienceLevel('secret'), true);
  assert.equal(isNpcAudienceLevel('classified'), false);
  assert.deepEqual([...QUEST_STATUSES], ['open', 'completed', 'failed']);
  assert.deepEqual([...SESSION_STATES], ['active', 'suspended']);
});

test('adventure template contract recommends Emberferry Crossing and keeps blank honest', () => {
  assert.deepEqual([...ADVENTURE_TEMPLATES], ['emberferry_crossing', 'blank']);
  assert.equal(RECOMMENDED_ADVENTURE_TEMPLATE, 'emberferry_crossing');
  assert.equal(isAdventureTemplate('emberferry_crossing'), true);
  assert.equal(isAdventureTemplate('blank'), true);
  assert.equal(isAdventureTemplate('sandbox_worldgen'), false);
});

test('resolveStarterPack maps the versioned pack id and fails closed on anything else', () => {
  assert.equal(resolveStarterPack(STARTER_CAMPAIGN_PACK_ID), EMBERFERRY_CROSSING_PACK);
  assert.equal(resolveStarterPack(null), null);
  assert.equal(resolveStarterPack('some-other-pack-id'), null);
});

test('resolveStarterPackForTemplate maps the creation-time template choice', () => {
  assert.equal(resolveStarterPackForTemplate('emberferry_crossing'), EMBERFERRY_CROSSING_PACK);
  assert.equal(resolveStarterPackForTemplate('blank'), null);
});

test('loadAdventureMapPresentation reports starter map fields for Emberferry and null for blank', () => {
  const presentation = loadAdventureMapPresentation(STARTER_CAMPAIGN_PACK_ID);
  assert.ok(presentation !== null);
  assert.equal(presentation.title, 'Emberferry Mist Dock');
  assert.equal(presentation.artProvenance, 'original_phase5_starter_v1');
  assert.ok(presentation.sceneBanner.length > 0);
  assert.equal(presentation.notableFeatures.length, 3);
  assert.ok(presentation.scene !== null);
  assert.equal(presentation.scene.sceneId, 'emberferry-mist-dock');
  assert.ok(presentation.scene.cells.some((cell) => cell.terrain === 'blocked'));
  assert.ok(presentation.scene.cells.some((cell) => cell.terrain === 'floor'));
  assert.equal(loadAdventureMapPresentation(null), null);
});

test('Emberferry chapter scenes swap titles and geometry', async () => {
  const { resolveEmberferryScene, listEmberferryScenes } = await import(
    '../../dist/shared/content/emberferry-maps.js'
  );
  const scenes = listEmberferryScenes();
  assert.equal(scenes.length, 3);
  assert.equal(resolveEmberferryScene('emberferry-ch1-dockside').title, 'Emberferry Mist Dock');
  assert.equal(resolveEmberferryScene('emberferry-ch2-mist-caves').title, 'Mist-Cut Caves');
  assert.equal(resolveEmberferryScene('emberferry-ch3-bell-tower').title, 'Drowned Bell Tower');
  const dock = resolveEmberferryScene('emberferry-ch1-dockside');
  const caves = resolveEmberferryScene('emberferry-ch2-mist-caves');
  assert.notEqual(dock.cells.map((c) => c.terrain).join(''), caves.cells.map((c) => c.terrain).join(''));
});

test('map art provenance contract names both the placeholder and the starter presentation', () => {
  assert.deepEqual(
    [...MAP_ART_PROVENANCE_VALUES],
    ['procedural_local_placeholder', 'original_phase5_starter_v1'],
  );
  assert.equal(isMapArtProvenance('original_phase5_starter_v1'), true);
  assert.equal(isMapArtProvenance('hand_painted_deluxe'), false);
});

test('Emberferry Crossing pack is versioned and starts on chapter 1, day 1', () => {
  assert.equal(EMBERFERRY_CROSSING_PACK.packId, 'emberferry-crossing-v1');
  assert.equal(EMBERFERRY_CROSSING_PACK.packVersion, '1.0.0');
  assert.equal(EMBERFERRY_CROSSING_PACK.chapters.length, 3);
  assert.equal(EMBERFERRY_CROSSING_PACK.chapters[0].sequence, 1);
  assert.equal(EMBERFERRY_CROSSING_PACK.chapters[0].title, 'Dockside at Emberferry');
  assert.equal(EMBERFERRY_CROSSING_PACK.startingCampaignTime.inGameDay, 1);
});

test('Emberferry Crossing never classifies its twist NPC as public or private', () => {
  const bellkeeper = EMBERFERRY_CROSSING_PACK.npcs.find((npc) => npc.npcId === 'the-bellkeeper');
  assert.ok(bellkeeper, 'the Bellkeeper must exist in the pack');
  assert.equal(bellkeeper.audience, 'secret');

  const lysa = EMBERFERRY_CROSSING_PACK.npcs.find((npc) => npc.npcId === 'lysa-quill');
  assert.ok(lysa, 'Harbor Warden Lysa Quill must exist in the pack');
  assert.equal(lysa.audience, 'public');

  const bram = EMBERFERRY_CROSSING_PACK.npcs.find((npc) => npc.npcId === 'old-bram-halyard');
  assert.ok(bram, 'Old Bram Halyard must exist in the pack');
  assert.equal(bram.audience, 'private');

  // A secret record must never be reachable by relaxing this to "not public".
  assert.notEqual(bellkeeper.audience, 'public');
  assert.notEqual(bellkeeper.audience, 'private');
});

test('Emberferry Crossing keeps at least one public quest and thread for a fresh campaign', () => {
  const publicQuests = EMBERFERRY_CROSSING_PACK.quests.filter((quest) => quest.audience === 'public');
  assert.ok(publicQuests.length >= 1);
  assert.ok(publicQuests.some((quest) => quest.questId === 'find-the-missing-barges'));

  const publicThreads = EMBERFERRY_CROSSING_PACK.openThreads.filter(
    (thread) => thread.audience === 'public',
  );
  assert.ok(publicThreads.length >= 1);
});

test('presentation cue contract bounds concurrent SFX and duration', () => {
  assert.equal(MAX_CONCURRENT_CUE_SOUNDS, 3);
  assert.equal(MAX_CUE_SOUND_DURATION_MS, 450);
  assert.ok(PRESENTATION_CUE_KINDS.length >= 10);
  assert.equal(isPresentationCueKind('critical_hit'), true);
  assert.equal(isPresentationCueKind('director_narrated'), false);
});

test('classifyEvent derives cues only from stable event types and summaries, never narration', () => {
  assert.equal(classifyEvent(fakeEvent({ eventType: 'table.token_moved' })), 'token_moved');
  assert.equal(classifyEvent(fakeEvent({ eventType: 'table.door_opened' })), 'door_opened');
  assert.equal(
    classifyEvent(
      fakeEvent({ eventType: 'combat.attack_resolved', summary: 'Ada hit the Goblin (critical hit).' }),
    ),
    'critical_hit',
  );
  assert.equal(
    classifyEvent(fakeEvent({ eventType: 'combat.attack_resolved', summary: 'Ada missed the Goblin.' })),
    'attack_miss',
  );
  assert.equal(
    classifyEvent(fakeEvent({ eventType: 'combat.attack_resolved', summary: 'Ada hit the Goblin.' })),
    'attack_hit',
  );
  assert.equal(classifyEvent(fakeEvent({ eventType: 'combat.spell_resolved' })), 'spell_cast');
  assert.equal(
    classifyEvent(fakeEvent({ eventType: 'combat.reaction_resolved', summary: 'Ada casts Shield.' })),
    'spell_cast',
  );
  assert.equal(
    classifyEvent(
      fakeEvent({ eventType: 'combat.reaction_resolved', summary: 'Ada makes an opportunity attack and hits.' }),
    ),
    'attack_hit',
  );
  assert.equal(
    classifyEvent(fakeEvent({ eventType: 'combat.death_save_resolved', summary: 'Death Save dead.' })),
    'creature_down',
  );
  assert.equal(
    classifyEvent(fakeEvent({ eventType: 'combat.death_save_resolved', summary: 'Death Save revived.' })),
    'creature_revived',
  );
  assert.equal(
    classifyEvent(fakeEvent({ eventType: 'combat.death_save_resolved', summary: 'Death Save made.' })),
    'death_save_made',
  );
  assert.equal(
    classifyEvent(fakeEvent({ eventType: 'combat.training_drop_resolved' })),
    'creature_down',
  );
  assert.equal(classifyEvent(fakeEvent({ eventType: 'combat.short_rest_completed' })), 'rest_completed');
  assert.equal(classifyEvent(fakeEvent({ eventType: 'combat.long_rest_completed' })), 'rest_completed');
  assert.equal(classifyEvent(fakeEvent({ eventType: 'progression.level_gained' })), 'level_up');
});

test('classifyEvent returns null for event types with no presentation cue', () => {
  for (const eventType of [
    'table.state_synced',
    'encounter.started',
    'initiative.rolled',
    'encounter.turn_advanced',
    'combat.ready_declared',
    'progression.xp_awarded',
    'inventory.item_used',
  ]) {
    assert.equal(classifyEvent(fakeEvent({ eventType })), null, `${eventType} should have no cue`);
  }
});

test('narration density contract offers concise/balanced/cinematic with a validator', () => {
  assert.deepEqual([...NARRATION_DENSITIES], ['concise', 'balanced', 'cinematic']);
  assert.equal(isNarrationDensity('cinematic'), true);
  assert.equal(isNarrationDensity('verbose'), false);
});

test('session suspend/resume error codes and campaign-memory collections are reserved', () => {
  assert.equal(ERROR_CODES.SESSION_ALREADY_SUSPENDED, 'SESSION_ALREADY_SUSPENDED');
  assert.equal(ERROR_CODES.SESSION_NOT_SUSPENDED, 'SESSION_NOT_SUSPENDED');
  assert.equal(COLLECTIONS.campaignMemory, 'campaignMemory');
  assert.equal(COLLECTIONS.campaignSessions, 'campaignSessions');
});
