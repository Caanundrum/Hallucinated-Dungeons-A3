import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyClause,
  classifyUtteranceSpeechAct,
} from '../../dist/shared/utterance-understanding.js';
import {
  parsePlayerDeclaration,
  resolveIntentAuthority,
} from '../../dist/shared/play-authority-contract.js';
import {
  nextObjectState,
} from '../../dist/server/table/scene-composition.js';
import {
  rankInteractablesByDeclaration,
  scoreFeatureLabelMatch,
} from '../../dist/server/table/scene-commands.js';
import {
  applyDirectorDispatchToMap,
} from '../../dist/server/ai/director-mechanics-dispatcher.js';
import {
  buildSceneSurveyNarration,
} from '../../dist/server/ai/director-gateway.js';
import {
  matchesExcludedCharacterName,
} from '../../dist/shared/campaign-facts.js';
import {
  buildCampaignBlueprint,
  extractPremiseEntities,
} from '../../dist/server/campaigns/campaign-blueprint.js';
import {
  SRD_CLASS_FEATURES_BY_LEVEL,
  deriveProgression,
  recomputeSheetForLevel,
} from '../../dist/server/rules/engine/xp-progression.js';
import {
  describeEquipmentItemMechanics,
} from '../../dist/shared/container-contents.js';
import {
  deriveSheet,
} from '../../dist/server/rules/character-rules.js';
import {
  applyProgressionTrackers,
} from '../../dist/server/rules/engine/encounter-runtime.js';

const FORBIDDEN_FOURTH_WALL_LECTURE = /Say one clear action your character attempts/i;

test('Packet 1 — Imperative & declarative natural-language actions map to canonical primitives or narrate_only without 5-verb refusal lecture', () => {
  const declarations = [
    { text: 'I read the iron manifest', expected: 'inspect' },
    { text: 'Read the iron manifest', expected: 'inspect' },
    { text: 'I decipher the faded runes on the pillar', expected: 'inspect' },
    { text: 'Listen at the crack in the oak door', expected: 'inspect' },
    { text: 'I check the label on my healing draught', expected: 'inspect' },
    { text: 'I pry the iron coffer open', expected: 'interact' },
    { text: 'Flip the brass switch', expected: 'interact' },
    { text: 'Drink healing draught', expected: 'use_item' },
    { text: 'I follow the footprints toward the sunken cistern', expected: 'travel' },
    { text: 'Follow the trail toward the sunken cistern', expected: 'travel' },
    { text: 'Tap the flagstones with my pole', expected: 'inspect' },
    { text: 'I warm my hands by the hearth and steady my breathing', expected: 'narrate_only' },
  ];

  for (const { text, expected } of declarations) {
    const clause = classifyClause(text);
    assert.equal(
      clause.kind,
      expected,
      `Expected "${text}" to classify as ${expected}, got ${clause.kind}`,
    );

    const speechAct = classifyUtteranceSpeechAct(text);
    assert.equal(speechAct, 'action');

    const parsed = parsePlayerDeclaration(text);
    const decision = resolveIntentAuthority(parsed);
    assert.notEqual(
      decision.disposition,
      'clarify',
      `Expected "${text}" not to fall through to clarify refusal`,
    );
    if (decision.clarificationPrompt) {
      assert.doesNotMatch(decision.clarificationPrompt, FORBIDDEN_FOURTH_WALL_LECTURE);
    }
    assert.doesNotMatch(decision.summary, FORBIDDEN_FOURTH_WALL_LECTURE);
  }
});

test('Packet 1 — Head-noun object disambiguation prioritizes head noun over shared leading modifier adjective', () => {
  const cofferScore = scoreFeatureLabelMatch('I open the iron manifest', 'Iron coffer (closed)');
  const manifestScore = scoreFeatureLabelMatch('I open the iron manifest', 'Iron manifest (intact)');

  assert.equal(cofferScore.headNounMatch, false);
  assert.equal(cofferScore.score, 0, 'Modifier-only match followed by a different noun must score 0');
  assert.equal(manifestScore.headNounMatch, true);
  assert.ok(manifestScore.score >= 100);

  const mockRuntime = {
    activeSceneId: 'scene-1',
    doorStates: {},
    tokens: [],
    sceneInstances: {
      'scene-1': {
        sceneId: 'scene-1',
        title: 'Vault Anteroom',
        summary: 'A vaulted stone room.',
        revealed: true,
        columns: 12,
        rows: 10,
        edges: [],
        doorStates: {},
        features: [
          {
            objectId: 'obj-iron-coffer',
            label: 'Iron coffer (closed)',
            objectKind: 'container',
            column: 3,
            row: 3,
            interactable: true,
            state: 'closed',
          },
          {
            objectId: 'obj-iron-manifest',
            label: 'Iron manifest (intact)',
            objectKind: 'prop',
            column: 5,
            row: 3,
            interactable: true,
            state: 'intact',
          },
        ],
      },
    },
  };

  const rankedForManifest = rankInteractablesByDeclaration(
    mockRuntime,
    'I open the iron manifest',
  );
  assert.ok(rankedForManifest.length > 0);
  assert.equal(rankedForManifest[0].objectId, 'obj-iron-manifest');

  const rankedImperativeManifest = rankInteractablesByDeclaration(
    mockRuntime,
    'Open the manifest',
  );
  assert.equal(rankedImperativeManifest.length, 1);
  assert.equal(rankedImperativeManifest[0].objectId, 'obj-iron-manifest');

  const rankedForCoffer = rankInteractablesByDeclaration(
    mockRuntime,
    'I open the iron coffer',
  );
  assert.ok(rankedForCoffer.length > 0);
  assert.equal(rankedForCoffer[0].objectId, 'obj-iron-coffer');
});

test('Packet 1 — nextObjectState opens closed/intact props and containers and never toggles an already-open object closed on open verb', () => {
  const closedProp = { objectKind: 'prop', state: 'intact' };
  assert.equal(nextObjectState(closedProp, 'I open the iron manifest'), 'open');

  const openProp = { objectKind: 'prop', state: 'open' };
  assert.equal(nextObjectState(openProp, 'I open the iron manifest'), 'open');

  const openContainer = { objectKind: 'container', state: 'open' };
  assert.equal(nextObjectState(openContainer, 'I open the iron coffer'), 'open');
  assert.equal(nextObjectState(openContainer, 'I close the iron coffer'), 'closed');
});

test('Packet 1 — AI Mechanics Arbiter dispatch preserves dialogue, narrate_only, and already-open object inspection with deferDirectorNarrate', () => {
  const mockMap = {
    campaignId: 'camp-1',
    sceneId: 'scene-1',
    title: 'Vault Anteroom',
    sceneBanner: 'Vault Anteroom',
    coordinateSpace: { columns: 12, rows: 10, feetPerSquare: 5 },
    cells: [],
    edges: [],
    tokens: [],
    notableFeatures: [
      {
        objectId: 'obj-iron-manifest',
        label: 'Iron manifest (open)',
        objectKind: 'prop',
        column: 5,
        row: 3,
      },
    ],
  };

  const narrateApplied = applyDirectorDispatchToMap({
    dispatch: { actionType: 'narrate_only', reasoning: 'Tap flagstones with pole' },
    map: mockMap,
    seatedSheet: null,
    knownNpcs: [],
    absentRoomNpcs: [],
  });
  assert.ok(narrateApplied !== null);
  assert.equal(narrateApplied.proposedCommandType, 'table.sync');
  assert.equal(narrateApplied.deferDirectorNarrate, true);

  const openInspectApplied = applyDirectorDispatchToMap({
    dispatch: {
      actionType: 'interact_object',
      reasoning: 'Open already-open manifest to read it',
      interactObject: { objectLabel: 'iron manifest', operation: 'open' },
    },
    map: mockMap,
    seatedSheet: null,
    knownNpcs: [],
    absentRoomNpcs: [],
  });
  assert.ok(openInspectApplied !== null);
  assert.equal(openInspectApplied.proposedCommandType, 'table.sync');
  assert.equal(openInspectApplied.deferDirectorNarrate, true);
});

test('Packet 2 — Seated/owned player character names are excluded from NPC extraction and blueprint rooms, and generic Frontier/Campaign boilerplate is eliminated', () => {
  const premise =
    'Warden Theron asks Brenna Ashveil to investigate the sunken cistern beneath Watchtower Keep and recover the brass chronometer.';

  assert.equal(matchesExcludedCharacterName('Brenna', ['Brenna Ashveil']), true);
  assert.equal(matchesExcludedCharacterName('Brenna Ashveil', ['Brenna Ashveil']), true);
  assert.equal(matchesExcludedCharacterName('Warden Theron', ['Brenna Ashveil']), false);

  const entities = extractPremiseEntities(premise, {
    excludeCharacterNames: ['Brenna Ashveil'],
  });
  assert.ok(entities.npcs.some((npc) => /Theron/i.test(npc)));
  assert.equal(
    entities.npcs.some((npc) => /Brenna/i.test(npc)),
    false,
    `Expected Brenna Ashveil to be excluded from NPCs, got: ${JSON.stringify(entities.npcs)}`,
  );

  const blueprint = buildCampaignBlueprint({
    campaignName: 'Campaign',
    premiseSummary: premise,
    excludeCharacterNames: ['Brenna Ashveil'],
  });

  assert.doesNotMatch(blueprint.centralTension, /across the frontier across the frontier/i);
  const firstRoom = blueprint.milestones[0]?.rooms[0];
  assert.ok(firstRoom);
  assert.notEqual(firstRoom.title.toLowerCase(), 'campaign');
  assert.equal(
    firstRoom.npcs.some((npc) => /Brenna/i.test(npc.name)),
    false,
    'Player character must never appear in room NPCs',
  );
});

test('Packet 3 — Grounded improvisation affirms Chronicle/premise clues, describes carried inventory items, and grounds mundane scenery', () => {
  const mockMap = {
    campaignId: 'camp-1',
    sceneId: 'scene-1',
    title: 'Cistern Gatehouse',
    sceneBanner: 'Cold mist curls across the wet stone floor of the Cistern Gatehouse.',
    coordinateSpace: { columns: 12, rows: 10, feetPerSquare: 5 },
    cells: [],
    edges: [
      {
        edgeId: 'edge-1',
        kind: 'door',
        orientation: 'north',
        column: 6,
        row: 1,
        doorState: 'closed',
        destinationSceneTitle: 'Sunken Cistern',
      },
    ],
    tokens: [],
    notableFeatures: [
      {
        objectId: 'obj-coffer',
        label: 'Iron coffer (open)',
        objectKind: 'container',
        column: 4,
        row: 4,
      },
    ],
  };

  // 1. Inspecting a clue established in Chronicle dialogue
  const clueNarration = buildSceneSurveyNarration(mockMap, {
    playerText: 'I inspect the sooty footprints near the northern doorway',
    recentChronicleSummaries: [
      'Warden Theron points toward sooty footprints trailing toward the northern doorway.',
    ],
    campaignPremise: 'Investigate the sunken cistern beneath Watchtower Keep.',
    carriedEquipment: [],
  });
  assert.match(clueNarration, /sooty footprints/i);
  assert.doesNotMatch(clueNarration, FORBIDDEN_FOURTH_WALL_LECTURE);

  // 2. Reading/inspecting a carried inventory item
  const itemNarration = buildSceneSurveyNarration(mockMap, {
    playerText: 'I read the label on my Healing Draught',
    recentChronicleSummaries: [],
    carriedEquipment: [
      {
        name: 'Healing Draught',
        statsSummary: 'Consumable · Bonus Action or Action: Restores 2d4 + 2 Hit Points when consumed',
      },
    ],
  });
  assert.match(itemNarration, /Healing Draught/i);
  assert.match(itemNarration, /2d4 \+ 2 Hit Points/i);

  // 3. Inspecting mundane painted map scenery not tracked as a StoredSceneFeature
  const sceneryNarration = buildSceneSurveyNarration(mockMap, {
    playerText: 'Examine the stone workbench in the corner',
    recentChronicleSummaries: [],
    carriedEquipment: [],
  });
  assert.match(sceneryNarration, /stone workbench/i);
  assert.doesNotMatch(sceneryNarration, FORBIDDEN_FOURTH_WALL_LECTURE);
});

test('Packet 4 — All 12 SRD classes have complete Level 1–20 feature progressions and Rogue Level 2 grants Cunning Action', () => {
  const expectedClasses = [
    'barbarian',
    'bard',
    'cleric',
    'druid',
    'fighter',
    'monk',
    'paladin',
    'ranger',
    'rogue',
    'sorcerer',
    'warlock',
    'wizard',
  ];

  for (const classId of expectedClasses) {
    const table = SRD_CLASS_FEATURES_BY_LEVEL[classId];
    assert.ok(Array.isArray(table) && table.length >= 12, `Missing progression table for ${classId}`);
    assert.ok(table.some((f) => f.level === 1), `${classId} missing Level 1 features`);
    assert.ok(table.some((f) => f.level === 2), `${classId} missing Level 2 features`);
    assert.ok(table.some((f) => f.level === 20), `${classId} missing Level 20 capstone`);
    for (const entry of table) {
      assert.ok(entry.summary.length >= 20, `${classId} feature ${entry.label} missing mechanical summary`);
    }
  }

  const rogueL1Choices = {
    name: 'Shade',
    speciesId: 'human',
    speciesSize: 'Medium',
    speciesSkillId: 'perception',
    chosenOriginFeatId: 'Alert',
    chosenOriginFeatAbilityId: null,
    chosenOriginFeatSpellIds: [],
    classId: 'rogue',
    classSkillIds: ['stealth', 'sleight-of-hand', 'investigation', 'acrobatics'],
    expertiseSkillIds: ['stealth', 'sleight-of-hand'],
    weaponMasteryWeaponNames: ['Shortsword', 'Dagger'],
    fightingStyleId: null,
    divineOrderId: null,
    primalOrderId: null,
    cantripIds: [],
    preparedSpellIds: [],
    backgroundId: 'criminal',
    backgroundAbilityMode: 'two-one',
    backgroundPlusTwoAbility: 'dexterity',
    backgroundPlusOneAbility: 'intelligence',
    backgroundThreeAbilities: [],
    abilityMethod: 'standard-array',
    baseAbilityScores: {
      strength: 8,
      dexterity: 15,
      constitution: 14,
      intelligence: 13,
      wisdom: 12,
      charisma: 10,
    },
    classEquipmentOptionId: 'rogue-a',
    backgroundEquipmentOptionId: 'package',
    Languages: ['Common', 'Thieves’ Cant', 'Elvish'],
  };

  const baseRogueSheet = deriveSheet(rogueL1Choices);
  const level2RogueSheet = recomputeSheetForLevel(baseRogueSheet, 'rogue', 2, 300);
  assert.equal(level2RogueSheet.level, 2);
  const cunningAction = level2RogueSheet.features.find((f) => /Cunning Action/i.test(f.name));
  assert.ok(cunningAction, 'Level 2 Rogue sheet must include Cunning Action');
  assert.match(cunningAction.summary, /Dash, Disengage, or Hide/i);

  const level20RogueProg = deriveProgression(baseRogueSheet, 'rogue', 20);
  assert.ok(level20RogueProg.classFeatures.includes('Cunning Action'));
  assert.ok(level20RogueProg.classFeatures.includes('Uncanny Dodge'));
  assert.ok(level20RogueProg.classFeatures.includes('Evasion'));
  assert.ok(level20RogueProg.classFeatures.includes('Reliable Talent'));
  assert.ok(level20RogueProg.classFeatures.includes('Stroke of Luck'));
});

test('Packet 4 — Starting and looted equipment items always carry mechanical statsSummary descriptions', () => {
  const draughtMeta = describeEquipmentItemMechanics('Healing Draught');
  assert.match(draughtMeta.statsSummary, /2d4 \+ 2 Hit Points/i);

  const lanternMeta = describeEquipmentItemMechanics('Iron lantern');
  assert.match(lanternMeta.statsSummary, /30-ft radius/i);

  const rogueL1Choices = {
    name: 'Shade',
    speciesId: 'human',
    speciesSize: 'Medium',
    speciesSkillId: 'perception',
    chosenOriginFeatId: 'Alert',
    chosenOriginFeatAbilityId: null,
    chosenOriginFeatSpellIds: [],
    classId: 'rogue',
    classSkillIds: ['stealth', 'sleight-of-hand', 'investigation', 'acrobatics'],
    expertiseSkillIds: ['stealth', 'sleight-of-hand'],
    weaponMasteryWeaponNames: ['Shortsword', 'Dagger'],
    fightingStyleId: null,
    divineOrderId: null,
    primalOrderId: null,
    cantripIds: [],
    preparedSpellIds: [],
    backgroundId: 'criminal',
    backgroundAbilityMode: 'two-one',
    backgroundPlusTwoAbility: 'dexterity',
    backgroundPlusOneAbility: 'intelligence',
    backgroundThreeAbilities: [],
    abilityMethod: 'standard-array',
    baseAbilityScores: {
      strength: 8,
      dexterity: 15,
      constitution: 14,
      intelligence: 13,
      wisdom: 12,
      charisma: 10,
    },
    classEquipmentOptionId: 'rogue-a',
    backgroundEquipmentOptionId: 'package',
  };

  const sheet = deriveSheet(rogueL1Choices);
  for (const item of sheet.equipment) {
    assert.ok(
      typeof item.statsSummary === 'string' && item.statsSummary.length > 0,
      `Expected starting item "${item.name}" to have statsSummary`,
    );
  }

  const withLootedItems = applyProgressionTrackers(sheet, {
    characterId: 'char-1',
    classId: 'rogue',
    level: 2,
    experiencePoints: 300,
    updatedAt: new Date().toISOString(),
    equipmentOverrides: [
      ...sheet.equipment.map((e) => ({ name: e.name, quantity: e.quantity, equipped: e.equipped })),
      { name: 'Healing Draught', quantity: 1 },
      { name: 'Iron lantern', quantity: 1 },
    ],
  });

  const lootedDraught = withLootedItems.equipment.find((e) => e.name === 'Healing Draught');
  assert.ok(lootedDraught);
  assert.match(lootedDraught.statsSummary ?? '', /2d4 \+ 2 Hit Points/i);

  const lootedLantern = withLootedItems.equipment.find((e) => e.name === 'Iron lantern');
  assert.ok(lootedLantern);
  assert.match(lootedLantern.statsSummary ?? '', /30-ft radius/i);
});
