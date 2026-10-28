import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  formatArmorClassFormula,
} from '../../dist/shared/character-contract.js';
import {
  deriveSheet,
} from '../../dist/server/rules/character-rules.js';
import {
  CLASSES,
} from '../../dist/server/rules/srd-manifest.js';
import {
  buildCampaignBlueprint,
  classifyNpcRoles,
  detectQuestHook,
  draftCampaignBlueprintOptionsWithAi,
  extractPremiseEntities,
} from '../../dist/server/campaigns/campaign-blueprint.js';
import {
  cleanNpcLabelForMatching,
  expandNpcNameVariants,
  extractCampaignFactsFromPremise,
  extractCampaignNamedFacts,
  isCompoundPlaceWord,
  isPersonBySyntacticContext,
  npcNamesMatch,
  stripPersonalRoleTitle,
} from '../../dist/shared/campaign-facts.js';
import {
  parsePlayerDeclaration,
  resolveIntentAuthority,
} from '../../dist/shared/play-authority-contract.js';
import {
  buildCampaignAssetPrompt,
  checkAndRecordAccountImageQuota,
  formatBattlemapCardinalExits,
  isImageQuotaExemptAccount,
  loadFromAssetBank,
  MAX_LIVE_MAP_FORGES_PER_24H,
  MAX_LIVE_MAP_FORGES_PER_CAMPAIGN,
  MAX_LIVE_PORTRAIT_FORGES_PER_24H,
  resetAccountImageQuota,
  saveToAssetBank,
} from '../../dist/server/assets/campaign-assets.js';
import {
  evaluateGlobalAssetBankEligibility,
} from '../../dist/server/assets/asset-library-guard.js';
import {
  CLEAN_MAP_ZOOM_STEPS,
  clampMapPanOffset,
  computeClampedMapTooltipPosition,
  computeMapDragGesture,
  layoutMapLabels,
  stepMapZoomPercent,
} from '../../dist/shared/map-label-layout.js';
import {
  describeMoveDestination,
  formatMoveTravelSummary,
} from '../../dist/shared/map-presentation.js';
import {
  buildResolvedActionReceipt,
} from '../../dist/shared/resolved-action-receipt.js';
import {
  applyDmNpcDirective,
  applyDmSceneDirective,
  closeCurrentChapter,
} from '../../dist/server/campaigns/campaign-memory.js';
import {
  isTrustedForwardedHost,
  servingOriginFromHost,
} from '../../dist/server/http/origin-guard.js';
import {
  attachExitsToStoredScene,
  extractSceneCardinalExits,
  formatSceneExitPlayerFacingLabel,
  isPerimeterCoordinate,
} from '../../dist/server/table/scene-exit-projection.js';
import {
  resolveObjectSpriteDescriptor,
  resolveObjectSpriteKey,
} from '../../dist/shared/object-sprite-catalog.js';
import {
  contextualContainerLabelForTemplate,
  contextualPropLabelForTemplate,
  deduplicateSceneFeatureLabels,
  nextObjectState,
} from '../../dist/server/table/scene-composition.js';
import {
  buildMapRuntimeFromBlueprint,
  buildStoredSceneFromRoomBlueprint,
  checkExitLockedForTravel,
  interactObjectRuntime,
  isPortableSceneContainer,
  lootContainerRuntime,
  matchInRoomApproachTarget,
  matchTakeContainerByDeclaration,
  rankInteractablesByDeclaration,
  scoreFeatureLabelMatch,
  travelSceneRuntime,
} from '../../dist/server/table/scene-commands.js';
import {
  applyViewerFog,
  buildAuthoritativeMapBundle,
} from '../../dist/server/table/map-projection.js';
import {
  classifyClause,
  isDialogueDeclaration,
  isDocumentOpenOrReadDeclaration,
  isPassageOrTravelThroughDoorway,
  isWholeContainerLootDeclaration,
  splitPrimaryTargetFromLocative,
  stripQuotedSpeech,
} from '../../dist/shared/utterance-understanding.js';
import {
  buildSceneSurveyNarration,
} from '../../dist/server/ai/director-gateway.js';
import {
  pathBesideFeature,
} from '../../dist/server/table/scene-door-intent.js';
import {
  applyDirectorDispatchToMap,
} from '../../dist/server/ai/director-mechanics-dispatcher.js';
import {
  resolveDeterministicIntentFallback,
} from '../../dist/server/ai/deterministic-intent-fallback.js';
import {
  recomputeSheetForLevel,
} from '../../dist/server/rules/engine/xp-progression.js';
import {
  applyProgressionTrackers,
} from '../../dist/server/rules/engine/encounter-runtime.js';

const BASE_ABILITIES = {
  strength: 10,
  dexterity: 16,
  constitution: 14,
  intelligence: 10,
  wisdom: 14,
  charisma: 12,
};

function minimalChoices(overrides = {}) {
  const classId = overrides.classId ?? 'monk';
  const cls = CLASSES.find((c) => c.id === classId) ?? CLASSES[0];
  return {
    name: 'Test Hero',
    classId,
    speciesId: 'human',
    backgroundId: 'soldier',
    abilityMethod: 'standard_array',
    baseAbilityScores: { ...BASE_ABILITIES, ...(overrides.baseAbilityScores ?? {}) },
    backgroundAbilityBonuses: {
      dexterity: 2,
      wisdom: 1,
      ...(overrides.backgroundAbilityBonuses ?? {}),
    },
    classSkillIds: (cls.skillOptions ?? []).slice(0, cls.skillChoose ?? 2),
    classEquipmentOptionId: cls.equipmentOptions[0]?.id ?? 'a',
    backgroundEquipmentOptionId: 'a',
    cantripIds: [],
    spellIds: [],
    spellbookIds: [],
    backgroundFeatCantripIds: [],
    backgroundFeatSpellIds: [],
    originFeatCantripIds: [],
    originFeatSpellIds: [],
    speciesChoiceIds: {},
    ...overrides,
  };
}

test('Packet 1: SRD 5.2.1 Level 1 Armor Class formulas & explicit formula breakdowns across Monk, Barbarian, Draconic Sorcerer, and Armored classes', () => {
  // 1. Monk Unarmored Defense: 10 + DEX (+4 with +2 bg bonus on 16 -> 18) + WIS (+3 with +1 bg bonus on 15 -> 16) = 17
  const monkSheet = deriveSheet(
    minimalChoices({
      classId: 'monk',
      baseAbilityScores: {
        strength: 10,
        dexterity: 16,
        constitution: 12,
        intelligence: 10,
        wisdom: 15,
        charisma: 8,
      },
      backgroundAbilityBonuses: { dexterity: 2, wisdom: 1 },
    }),
  );
  assert.equal(monkSheet.armorClass.value, 10 + 4 + 3);
  const monkFormula = formatArmorClassFormula(monkSheet.armorClass);
  assert.match(monkFormula, /10 base \+ 4 DEX \+ 3 WIS \(Unarmored Defense\)/);

  // 2. Barbarian Unarmored Defense: 10 + DEX + CON
  const barbSheet = deriveSheet(
    minimalChoices({
      classId: 'barbarian',
      baseAbilityScores: {
        strength: 15,
        dexterity: 14,
        constitution: 15,
        intelligence: 8,
        wisdom: 10,
        charisma: 10,
      },
      backgroundAbilityBonuses: { strength: 2, constitution: 1 },
    }),
  );
  assert.equal(barbSheet.armorClass.value, 10 + 2 + 3);
  const barbFormula = formatArmorClassFormula(barbSheet.armorClass);
  assert.match(barbFormula, /10 base \+ 2 DEX \+ 3 CON \(Unarmored Defense\)/);

  // 3. Draconic Sorcerer Unarmored Resilience: 10 + DEX + CHA
  const sorcSheet = deriveSheet(
    minimalChoices({
      classId: 'sorcerer',
      subclassId: 'draconic',
      baseAbilityScores: {
        strength: 8,
        dexterity: 14,
        constitution: 14,
        intelligence: 10,
        wisdom: 10,
        charisma: 16,
      },
      backgroundAbilityBonuses: { charisma: 2, constitution: 1 },
      cantripIds: ['fire-bolt', 'light', 'mage-hand', 'prestidigitation'],
      spellIds: ['magic-missile', 'shield'],
    }),
  );
  assert.equal(sorcSheet.armorClass.value, 10 + 2 + 4);
  const sorcFormula = formatArmorClassFormula(sorcSheet.armorClass);
  assert.match(sorcFormula, /10 base \+ 2 DEX \+ 4 CHA \(Draconic Resilience\)/);

  // 4. Fighter with Chain Mail + Defense Fighting Style
  const fighterCls = CLASSES.find((c) => c.id === 'fighter');
  const fighterSheet = deriveSheet(
    minimalChoices({
      classId: 'fighter',
      baseAbilityScores: {
        strength: 16,
        dexterity: 12,
        constitution: 14,
        intelligence: 10,
        wisdom: 12,
        charisma: 10,
      },
      backgroundAbilityBonuses: { strength: 2, constitution: 1 },
      classEquipmentOptionId: fighterCls.equipmentOptions[0].id,
      speciesChoiceIds: { 'fighter-fighting-style': 'defense' },
    }),
  );
  const fighterFormula = formatArmorClassFormula(fighterSheet.armorClass);
  assert.match(fighterFormula, /base/i);
});

test('Packet 1: Level 1 spellcasting eligibility across all 12 SRD classes and Origin Feat attribution', () => {
  const nonCastersAtLevel1 = ['barbarian', 'fighter', 'monk', 'rogue'];
  const halfCastersAtLevel1 = ['paladin', 'ranger'];
  const fullCastersAtLevel1 = ['bard', 'cleric', 'druid', 'sorcerer', 'warlock', 'wizard'];

  for (const classId of nonCastersAtLevel1) {
    const cls = CLASSES.find((c) => c.id === classId);
    assert.ok(cls, `Class ${classId} exists in SRD manifest`);
    assert.equal(
      cls.spellcasting,
      null,
      `${classId} must not prompt for class cantrips or spells at Level 1`,
    );
    const sheet = deriveSheet(
      minimalChoices({
        classId,
        backgroundId: 'soldier', // Savage Attacker (non-spell Origin Feat)
        originFeatId: 'Tough',
      }),
    );
    assert.equal(
      sheet.spellcasting,
      null,
      `${classId} with non-spell background must have null sheet.spellcasting at Level 1`,
    );
  }

  for (const classId of halfCastersAtLevel1) {
    const cls = CLASSES.find((c) => c.id === classId);
    assert.ok(cls?.spellcasting !== null, `${classId} has SRD 5.2.1 Level 1 spellcasting`);
    assert.equal(
      cls.spellcasting.cantripsKnown,
      0,
      `${classId} must not prompt for class cantrips at Level 1`,
    );
  }

  for (const classId of fullCastersAtLevel1) {
    const cls = CLASSES.find((c) => c.id === classId);
    assert.ok(cls?.spellcasting !== null, `${classId} must have Level 1 spellcasting`);
    assert.ok(cls.spellcasting.cantripsKnown > 0, `${classId} knows cantrips at Level 1`);
  }

  // When a Monk selects the Guide background (Magic Initiate: Druid), spells come only from the Origin Feat
  const monkWithGuide = deriveSheet(
    minimalChoices({
      classId: 'monk',
      backgroundId: 'guide',
      originFeatId: 'Tough',
      backgroundFeatCantripIds: ['guidance', 'produce-flame'],
      backgroundFeatSpellIds: ['healing-word'],
    }),
  );
  assert.ok(monkWithGuide.spellcasting !== null);
  assert.deepEqual(
    monkWithGuide.spellcasting.cantrips.map((c) => c.id),
    ['guidance', 'produce-flame'],
  );
  assert.deepEqual(
    monkWithGuide.spellcasting.spells.map((s) => s.id),
    ['healing-word'],
  );
});

test('Packet 1 & Packet 2: Portrait lightbox modal, Forge Theater cadence, and CSS notice layout rules are wired', () => {
  const charCreateSrc = fs.readFileSync(
    path.resolve('src/client/pages/character-create.ts'),
    'utf8',
  );
  assert.match(charCreateSrc, /data-testid="portrait-lightbox-modal"/);
  assert.match(charCreateSrc, /data-testid="confirm-lightbox-portrait"/);
  assert.match(charCreateSrc, /Granted by Origin Feat:/);

  const campaignCreateSrc = fs.readFileSync(
    path.resolve('src/client/pages/campaign-create.ts'),
    'utf8',
  );
  assert.match(campaignCreateSrc, /FORGE_THEATER_ROTATION_MS\s*=\s*4800/);
  assert.match(campaignCreateSrc, /campaign-draft-actions-stack/);

  const stylesSrc = fs.readFileSync(path.resolve('src/client/styles.css'), 'utf8');
  assert.match(stylesSrc, /p\.message\.notice\s*\{[\s\S]*?display:\s*block/);
});

test('Packet 3 & Guardrail 2: Two-step container opening vs looting and banner-free map clicks', () => {
  const bp = buildCampaignBlueprint({
    summary: 'Explore the ruined watchtower at the edge of the marsh.',
    startLevel: 1,
    targetEndLevel: 2,
  });
  const runtime = buildMapRuntimeFromBlueprint({
    campaignId: 'camp-2step',
    blueprint: bp,
    accountIds: ['acc-1'],
    activateFirstScene: true,
  });
  const active = runtime.sceneInstances[runtime.activeSceneId];
  const container = active.features.find((f) => f.objectKind === 'container');
  assert.ok(container, 'Opening scene has a contextual container');
  assert.ok((container.contents ?? []).length > 0, 'Container starts with contents');
  const initialContents = [...container.contents];

  // Step 1: Opening the container transitions state to 'open', lists contents in chronicle, and does NOT auto-loot
  const opened = interactObjectRuntime({
    runtime,
    objectId: container.objectId,
    declaration: `I open the ${container.label.replace(/\s*\([^)]+\)\s*$/, '')}.`,
  });
  assert.equal(opened.nextState, 'open');
  assert.deepEqual(opened.lootedItems, []);
  assert.match(opened.chronicle, /Inside you see:/i);
  for (const item of initialContents) {
    assert.ok(opened.chronicle.includes(item), `Chronicle lists ${item}`);
  }
  const afterOpenContainer = opened.runtime.sceneInstances[runtime.activeSceneId].features.find(
    (f) => f.objectId === container.objectId,
  );
  assert.deepEqual(afterOpenContainer.contents, initialContents);

  // Step 2a: Taking a specific item transfers only that item
  const firstItem = initialContents[0];
  const tookOne = lootContainerRuntime({
    runtime: opened.runtime,
    objectId: container.objectId,
    itemHint: firstItem,
    declaration: `I take the ${firstItem}.`,
  });
  assert.deepEqual(tookOne.lootedItems, [firstItem]);
  const afterTakeOne = tookOne.runtime.sceneInstances[runtime.activeSceneId].features.find(
    (f) => f.objectId === container.objectId,
  );
  assert.equal(afterTakeOne.contents.includes(firstItem), false);

  // Step 2b: Looting the rest empties the container
  if (afterTakeOne.contents.length > 0) {
    const tookRest = lootContainerRuntime({
      runtime: tookOne.runtime,
      objectId: container.objectId,
      declaration: 'I take everything left inside.',
    });
    assert.ok(tookRest.lootedItems.length > 0);
    const afterEmpty = tookRest.runtime.sceneInstances[runtime.activeSceneId].features.find(
      (f) => f.objectId === container.objectId,
    );
    assert.deepEqual(afterEmpty.contents, []);
  }

  // Verify campaign-table.ts removed the map-click banner elements and added dm-thinking-indicator
  const tableSrc = fs.readFileSync(
    path.resolve('src/client/pages/campaign-table.ts'),
    'utf8',
  );
  assert.doesNotMatch(tableSrc, /data-testid="move-target-meta"/);
  assert.doesNotMatch(tableSrc, /data-testid="door-selection-detail"/);
  assert.match(tableSrc, /data-testid="dm-thinking-indicator"/);
});

test('Packet 4 & Guardrail 1: Perimeter-locked exits, fog visibility, wall-anchored levers, mechanism lock enforcement, and trail/path travel classification', () => {
  const bp = buildCampaignBlueprint({
    summary:
      'Beyond the mist-shrouded forest clearing of Elderwood, a sunken watchtower hides a stolen relic.',
    startLevel: 1,
    targetEndLevel: 2,
  });
  const runtime = buildMapRuntimeFromBlueprint({
    campaignId: 'camp-spatial',
    blueprint: bp,
    accountIds: ['acc-1'],
    seatTokens: [{ seatId: 'seat-1', characterId: 'char-1', column: 2, row: 4 }],
    activateFirstScene: true,
  });

  // 1. Every materialized scene has its exits strictly on the outer perimeter
  for (const scene of Object.values(runtime.sceneInstances)) {
    const exitFeatures = scene.features.filter((f) => f.objectKind === 'exit');
    assert.ok(exitFeatures.length >= 1, `Scene ${scene.sceneId} has at least 1 exit feature`);
    for (const exitFeature of exitFeatures) {
      assert.equal(
        isPerimeterCoordinate(exitFeature.column, exitFeature.row, scene.columns, scene.rows),
        true,
        `Exit "${exitFeature.label}" in ${scene.sceneId} at (${exitFeature.column},${exitFeature.row}) must be on perimeter of ${scene.columns}x${scene.rows}`,
      );
      const exitCell = scene.cells.find(
        (c) => c.column === exitFeature.column && c.row === exitFeature.row,
      );
      assert.notEqual(
        exitCell?.terrain,
        'blocked',
        `Perimeter exit cell (${exitFeature.column},${exitFeature.row}) must be walkable floor`,
      );
    }
  }

  // 2. Exit visibility in Fog of War: open clearing perimeter exit is immediately visible & known from spawn
  const fullBundle = buildAuthoritativeMapBundle({
    campaignId: 'camp-spatial',
    seats: [
      {
        seatId: 'seat-1',
        campaignId: 'camp-spatial',
        ownerAccountId: 'acc-1',
        characterId: 'char-1',
        characterName: 'Test Hero',
      },
    ],
    runtime,
  });
  const projectedR1 = applyViewerFog(fullBundle, {
    accountId: 'acc-1',
    viewerSeatId: 'seat-1',
    runtime,
  });
  const r1ExitFeature = projectedR1.notableFeatures.find((f) => f.objectKind === 'exit');
  assert.ok(r1ExitFeature, 'Perimeter exit is present in viewer fog-filtered notableFeatures');

  // 3. Path/Trail disambiguation: "I take the winding forest trail" classifies as travel, NEVER take_item
  const trailClause = classifyClause('I take the winding forest trail');
  assert.equal(trailClause.kind, 'travel');
  assert.equal(isPortableSceneContainer('Winding forest trail'), false);
  assert.equal(isPortableSceneContainer('Rusted wall lever'), false);
  assert.equal(
    matchTakeContainerByDeclaration(
      runtime.sceneInstances['scene-m1-r1'].features,
      'I take the winding forest trail',
    ),
    null,
  );
  // Even if AI Arbiter returns take_prop for an exit/trail feature, applyDirectorDispatchToMap reroutes to table.travel_scene
  const reroutedTrail = applyDirectorDispatchToMap({
    dispatch: {
      actionType: 'take_prop',
      takeProp: { propLabel: r1ExitFeature.label },
    },
    map: projectedR1,
    seatedSheet: null,
    knownNpcs: [],
  });
  assert.equal(reroutedTrail?.proposedCommandType, 'table.travel_scene');

  // 4. Travel to room 2 (scene-m1-r2) and verify wall-anchored lever & Guardrail 1 lock enforcement
  const step1 = travelSceneRuntime({
    runtime,
    campaignId: 'camp-spatial',
    accountId: 'acc-1',
    destinationHint: 'scene-m1-r2',
    blueprint: bp,
  });
  const r2 = step1.runtime.sceneInstances['scene-m1-r2'];
  const lever = r2.features.find((f) => f.objectKind === 'lever');
  assert.ok(lever, 'Room 2 has a lever feature');
  assert.ok(lever.targetEdgeOrObjectId, 'Lever has a wired targetEdgeOrObjectId');
  // Lever is anchored along the north wall (row === 1) or adjacent to a wall/door edge
  assert.equal(lever.row <= 2, true, `Lever at (${lever.column},${lever.row}) is wall-anchored`);

  // Guardrail 1: While lever is unpulled, checkExitLockedForTravel reports locked byLever,
  // and travelSceneRuntime throws EXIT_LOCKED_BY_MECHANISM
  const lockCheckBefore = checkExitLockedForTravel(r2, 'Sanctum archway', false);
  assert.equal(lockCheckBefore.locked, true);
  assert.equal(lockCheckBefore.byLever, true);

  assert.throws(
    () =>
      travelSceneRuntime({
        runtime: step1.runtime,
        campaignId: 'camp-spatial',
        accountId: 'acc-1',
        destinationHint: 'Sanctum archway',
        blueprint: bp,
      }),
    /EXIT_LOCKED_BY_MECHANISM/,
  );

  // Pulling the wall lever unseals the linked exit and allows travel
  const pulled = interactObjectRuntime({
    runtime: step1.runtime,
    objectId: lever.objectId,
    declaration: 'I pull the rusted wall lever.',
  });
  assert.match(pulled.chronicle, /unseal the locked passage/i);
  const r2AfterPull = pulled.runtime.sceneInstances['scene-m1-r2'];
  const lockCheckAfter = checkExitLockedForTravel(r2AfterPull, 'Sanctum archway', false);
  assert.equal(lockCheckAfter.locked, false);

  const step2 = travelSceneRuntime({
    runtime: pulled.runtime,
    campaignId: 'camp-spatial',
    accountId: 'acc-1',
    destinationHint: 'Sanctum archway',
    blueprint: bp,
  });
  assert.equal(step2.runtime.activeSceneId, 'scene-m1-r3');
});

test('Packet 5: Topological battlemap prompts include PERIMETER EXIT TOPOLOGY and outdoor premises maintain biome continuity and contextual props', () => {
  const bp = buildCampaignBlueprint({
    summary:
      'In the sun-dappled forest clearing of Whispering Pines, rangers search for a vanished scout along the mossy ridge.',
    startLevel: 1,
    targetEndLevel: 2,
  });
  const r1 = bp.milestones[0].rooms[0];
  const r2 = bp.milestones[0].rooms[1];

  // Room 1 in a forest clearing uses contextual outdoor container & prop labels (not "Sturdy oak chest" or "iron lantern")
  assert.equal(
    contextualContainerLabelForTemplate('exterior_forest_clearing'),
    'Weatherproof ranger pack',
  );
  assert.equal(
    contextualPropLabelForTemplate('exterior_forest_clearing'),
    'weathered wayfinder compass',
  );
  assert.equal(
    r1.structuredProps.some((p) => /sturdy oak chest/i.test(p.label)),
    false,
  );

  // Room 2 maintains outdoor-to-ruin-threshold continuity instead of jumping to an unmotivated subterranean crypt
  assert.doesNotMatch(r2.summary, /crypt catacomb subterranean/i);
  const storedR2 = buildStoredSceneFromRoomBlueprint(r2, 'camp-biome');
  assert.equal(storedR2.sceneBanner, r2.summary);

  const storedR1 = attachExitsToStoredScene(
    buildStoredSceneFromRoomBlueprint(r1, 'camp-biome'),
  );
  const cardinalExits = extractSceneCardinalExits(storedR1);
  assert.ok(cardinalExits.length >= 1);
  const cardinalText = formatBattlemapCardinalExits(cardinalExits);
  assert.match(cardinalText, /PERIMETER EXIT TOPOLOGY/);
  assert.match(cardinalText, /closed, impassable boundaries[\s\S]*NORTH, SOUTH, WEST/i);

  const fullPrompt = buildCampaignAssetPrompt({
    kind: 'battlemap',
    rawPrompt: r1.battlemapPrompt,
    gridLayout: {
      columns: storedR1.columns,
      rows: storedR1.rows,
      cardinalExits,
    },
  });
  assert.match(fullPrompt, /PERIMETER EXIT TOPOLOGY/);
});

test('RS-01 & Guardrail 1: Syntactic Place vs. Person classification, active contact vs. vanished NPC role priority, and role-titled NPC lookup continuity', () => {
  const premise =
    'At Clockhouse, a stilted lantern station on the edge of Glimmerfen, Warden Corin Vale asks Ironfist to investigate why Apprentice Talia vanished after sealing a brass astrolabe inside a reinforced supply locker.';

  const entities = extractPremiseEntities(premise, {
    excludeCharacterNames: ['Ironfist'],
  });
  assert.equal(entities.npcs.includes('Clockhouse'), false, 'Building is never classified as an NPC');
  assert.equal(entities.npcs.includes('Glimmerfen'), false, 'Compound region is never classified as an NPC');
  assert.equal(entities.npcs.includes('Ironfist'), false, 'Excluded PC is never classified as an NPC');
  assert.equal(entities.places.includes('Clockhouse'), true, 'Prepositional/appositive building is in places');
  assert.equal(entities.places.includes('Glimmerfen'), true, 'Compound place is in places');
  assert.equal(
    entities.npcs.some((n) => npcNamesMatch(n, 'Warden Corin Vale')),
    true,
    'Active contact is extracted in npcs',
  );
  assert.equal(
    entities.npcs.some((n) => npcNamesMatch(n, 'Apprentice Talia')),
    true,
    'Vanished person is extracted in npcs',
  );
  assert.equal(entities.places[0], 'Clockhouse');

  const roles = classifyNpcRoles(entities.npcs, premise);
  assert.equal(
    npcNamesMatch(roles.presentNpcs[0], 'Warden Corin Vale'),
    true,
    'Active interpersonal contact is presentNpcs[0]',
  );
  assert.equal(
    roles.missingNpcs.some((n) => npcNamesMatch(n, 'Apprentice Talia')),
    true,
    'Vanished person is placed in missingNpcs',
  );
  assert.equal(
    roles.presentNpcs.some((n) => npcNamesMatch(n, 'Apprentice Talia')),
    false,
    'Vanished person never spawns in Room 1 presentNpcs',
  );

  const bp = buildCampaignBlueprint({
    summary: premise,
    startLevel: 1,
    targetEndLevel: 2,
    excludeCharacterNames: ['Ironfist'],
  });
  const room1 = bp.milestones[0].rooms[0];
  assert.equal(room1.title, 'Clockhouse', 'Room 1 title preserves primary named location');
  assert.equal(
    npcNamesMatch(room1.npcs[0].name, 'Warden Corin Vale'),
    true,
    'Room 1 NPC is the active contact, not the building or the missing apprentice',
  );

  // Guardrail 1: Role-titled NPC lookup continuity across all natural forms
  const variants = expandNpcNameVariants('Corin Vale', 'Warden');
  assert.equal(variants.includes('Warden Corin Vale'), true);
  assert.equal(variants.includes('Warden Corin'), true);
  assert.equal(variants.includes('Corin Vale'), true);
  assert.equal(variants.includes('Corin'), true);

  for (const queryForm of ['Warden Corin Vale', 'Warden Corin', 'Corin Vale', 'Corin']) {
    assert.equal(npcNamesMatch('Warden Corin Vale', queryForm), true, `Matches ${queryForm}`);
    assert.equal(npcNamesMatch('Corin Vale', queryForm, 'Warden'), true, `Matches ${queryForm} with roleHint`);
    const parsed = parsePlayerDeclaration(`I ask ${queryForm} what happened here`, {
      knownNpcs: [{ id: 'npc-corin', label: 'Warden Corin Vale' }],
    });
    assert.ok(parsed.addressee, `parsePlayerDeclaration resolves ${queryForm}`);
    assert.equal(npcNamesMatch(parsed.addressee, 'Warden Corin Vale'), true);
  }
});

test('RS-02 & RS-03: Locative prepositional stripping, container deduplication, open-container loot attribution, and verb/state/position-aware tie-breaker', () => {
  // Locative stripping
  const split = splitPrimaryTargetFromLocative('I inspect the brass astrolabe in the reinforced supply locker');
  assert.equal(split.primaryClause, 'I inspect the brass astrolabe');
  assert.equal(split.locativeQualifier, 'in the reinforced supply locker');

  // Feature label deduplication
  const deduped = deduplicateSceneFeatureLabels([
    {
      objectId: 'scene:poi',
      label: 'Weatherproof ranger pack (closed)',
      objectKind: 'container',
      referenceKind: 'loot',
      column: 4,
      row: 3,
      state: 'closed',
    },
    {
      objectId: 'scene:east-chest',
      label: 'Weatherproof ranger pack (closed)',
      objectKind: 'container',
      referenceKind: 'loot',
      column: 9,
      row: 5,
      state: 'closed',
    },
  ]);
  assert.notEqual(deduped[0].label, deduped[1].label, 'Duplicate container labels are disambiguated');

  // Blueprint with two containers that share the head noun "locker"
  const bp = buildCampaignBlueprint({
    summary:
      'At Clockhouse, a stilted lantern station, Warden Corin Vale asks the party to recover a brass astrolabe from a reinforced supply locker.',
    startLevel: 1,
    targetEndLevel: 2,
  });
  const baseRuntime = buildMapRuntimeFromBlueprint({
    campaignId: 'camp-loot',
    blueprint: bp,
    accountIds: ['acc-1'],
    seatTokens: [{ seatId: 'seat-1', characterId: 'char-1', column: 2, row: 4 }],
    activateFirstScene: true,
  });
  const r1 = baseRuntime.sceneInstances['scene-m1-r1'];
  const customR1 = {
    ...r1,
    features: [
      {
        objectId: 'scene-m1-r1:locker-west',
        label: 'Reinforced supply locker (open)',
        objectKind: 'container',
        referenceKind: 'loot',
        interactable: true,
        column: 3,
        row: 4,
        state: 'open',
        lockState: 'unlocked',
        contents: ['Brass Astrolabe', 'Healing Draught'],
      },
      {
        objectId: 'scene-m1-r1:locker-east',
        label: 'Ironbound storage locker (closed)',
        objectKind: 'container',
        referenceKind: 'loot',
        interactable: true,
        column: 10,
        row: 4,
        state: 'closed',
        lockState: 'unlocked',
        contents: ['Rations'],
      },
    ],
  };
  const runtimeWithTwoLockers = {
    ...baseRuntime,
    sceneInstances: {
      ...baseRuntime.sceneInstances,
      'scene-m1-r1': customR1,
    },
  };

  // Taking the item attributes it to the OPEN container ("Reinforced supply locker"), not the closed one
  const lootRes = lootContainerRuntime({
    runtime: runtimeWithTwoLockers,
    itemHint: 'brass astrolabe',
    declaration: 'I take the brass astrolabe from the reinforced supply locker.',
  });
  assert.deepEqual(lootRes.lootedItems, ['Brass Astrolabe']);
  assert.equal(lootRes.containerLabel, 'Reinforced supply locker');

  // Inspecting the item "in the reinforced supply locker" scores the open locker when qualified
  const rankedForOpenQualifier = rankInteractablesByDeclaration(
    runtimeWithTwoLockers,
    'I check the open locker on the west side',
  );
  assert.equal(rankedForOpenQualifier[0].objectId, 'scene-m1-r1:locker-west');
});

test('RS-04: Doorway passage travel intent routing and accurate destination title resolution', () => {
  const bp = buildCampaignBlueprint({
    summary:
      'At Clockhouse, a stilted lantern station on the edge of Glimmerfen, Warden Corin Vale asks the party to trace a vanished apprentice.',
    startLevel: 1,
    targetEndLevel: 2,
  });
  const runtime = buildMapRuntimeFromBlueprint({
    campaignId: 'camp-travel',
    blueprint: bp,
    accountIds: ['acc-1'],
    seatTokens: [{ seatId: 'seat-1', characterId: 'char-1', column: 2, row: 4 }],
    activateFirstScene: true,
  });
  const mapBundle = buildAuthoritativeMapBundle({
    campaignId: 'camp-travel',
    seats: [
      {
        seatId: 'seat-1',
        campaignId: 'camp-travel',
        ownerAccountId: 'acc-1',
        characterId: 'char-1',
        characterName: 'Test Hero',
      },
    ],
    runtime,
  });
  const r2Title = bp.milestones[0].rooms[1].title;

  assert.equal(
    isPassageOrTravelThroughDoorway('I head east through the doorway into the next area.'),
    true,
    'Doorway passage utterance is recognized as travel',
  );
  assert.equal(
    isPassageOrTravelThroughDoorway('I take the eastern doorway and follow the trail.'),
    true,
    'Taking the eastern doorway and following the trail is recognized as travel',
  );

  // Executing travelSceneRuntime with "east doorway" transitions from scene-m1-r1 to scene-m1-r2 and uses Room 2's title
  const traveled = travelSceneRuntime({
    runtime,
    campaignId: 'camp-travel',
    accountId: 'acc-1',
    destinationHint: 'east doorway',
    blueprint: bp,
  });
  assert.equal(traveled.runtime.activeSceneId, 'scene-m1-r2');
  assert.equal(traveled.chronicle.includes(r2Title), true);
  assert.notEqual(r2Title, mapBundle.title);
});

test('RS-05 & Guardrail 2: Monk Martial Arts weapon derivation at Level 1, Unarmored Movement at Level 2+, and applyProgressionTrackers self-healing', () => {
  const monkChoices = minimalChoices({
    classId: 'monk',
    baseAbilityScores: {
      strength: 12,
      dexterity: 15,
      constitution: 14,
      intelligence: 10,
      wisdom: 14,
      charisma: 8,
    },
    backgroundAbilityBonuses: {
      dexterity: 2,
      wisdom: 1,
    },
  });

  const l1Sheet = deriveSheet(monkChoices);
  // Level 1 Monk has DEX 17 (+3), STR 12 (+1), WIS 15 (+2), Prof +2
  assert.equal(l1Sheet.speed.value, 30, 'Level 1 Monk speed is 30 ft');
  const l1SpearAttack = l1Sheet.attacks.find((a) => a.name === 'Spear');
  assert.ok(l1SpearAttack, 'Level 1 Monk has Spear attack');
  assert.equal(l1SpearAttack.attackBonus.value, 5, 'Spear uses DEX (+3) + Prof (+2) = +5 to hit');
  assert.equal(l1SpearAttack.damage, '1d6', 'Spear uses Martial Arts 1d6 base die');
  const l1Unarmed = l1Sheet.attacks.find((a) => a.name === 'Unarmed Strike');
  assert.ok(l1Unarmed, 'Level 1 Monk has Unarmed Strike attack');
  assert.equal(l1Unarmed.attackBonus.value, 5, 'Unarmed Strike uses DEX (+3) + Prof (+2) = +5');
  assert.equal(l1Unarmed.damage, '1d6', 'Unarmed Strike uses 1d6 Martial Arts die');
  const l1SpearEquip = l1Sheet.equipment.find((e) => e.name === 'Spear');
  assert.ok(l1SpearEquip);
  assert.match(l1SpearEquip.statsSummary ?? '', /\+5 to hit · 1d6\+3 piercing/i);

  // Level 2 Monk gains Unarmored Movement (+10 ft => 40 ft)
  const l2Sheet = recomputeSheetForLevel(l1Sheet, 'monk', 2, 300);
  assert.equal(l2Sheet.speed.value, 40, 'Level 2 unarmored Monk speed is 40 ft');
  assert.match(l2Sheet.speed.formulaSummary ?? '', /30 base \+ 10 Unarmored Movement = 40 ft/);

  // Guardrail 2: applyProgressionTrackers self-heals a stale saved sheet even when level matches
  const staleSheet = {
    ...l1Sheet,
    speed: {
      value: 30,
      components: [{ label: 'Human Speed', amount: 30, ruleId: 'species.human.speed' }],
    },
    attacks: l1Sheet.attacks.map((a) =>
      a.name === 'Spear'
        ? {
            ...a,
            attackBonus: {
              value: 3,
              components: [
                { label: 'Strength', amount: 1, ruleId: 'ability.strength' },
                { label: 'Proficiency Bonus', amount: 2, ruleId: 'proficiency-bonus' },
              ],
            },
          }
        : a,
    ),
  };
  const healedL2 = applyProgressionTrackers(staleSheet, {
    characterId: 'char-monk',
    classId: 'monk',
    level: 2,
    experiencePoints: 300,
    updatedAt: new Date().toISOString(),
  });
  assert.equal(healedL2.speed.value, 40, 'applyProgressionTrackers synchronizes Level 2 Monk speed to 40 ft');
  const healedSpear = healedL2.attacks.find((a) => a.name === 'Spear');
  assert.equal(healedSpear.attackBonus.value, 5, 'applyProgressionTrackers heals Spear attack bonus to +5');
});

test('RS-06 & RS-07: Walkable gate-adjacent lever placement on outdoor Room 2 maps and non-destructive Ask DM info toggle', () => {
  const bp = buildCampaignBlueprint({
    summary:
      'At Clockhouse, a stilted lantern station on the edge of Glimmerfen, Warden Corin Vale asks the party to trace a vanished apprentice.',
    startLevel: 1,
    targetEndLevel: 2,
  });
  const runtime = buildMapRuntimeFromBlueprint({
    campaignId: 'camp-outdoor-lever',
    blueprint: bp,
    accountIds: ['acc-1'],
    seatTokens: [{ seatId: 'seat-1', characterId: 'char-1', column: 2, row: 4 }],
    activateFirstScene: true,
  });
  const r2 = runtime.sceneInstances['scene-m1-r2'];
  assert.doesNotMatch(r2.title, /Side Passage/i, 'Outdoor Room 2 title avoids indoor Side Passage');
  assert.doesNotMatch(r2.sceneBanner, /cellar stairs|stone wall/i, 'Outdoor Room 2 banner avoids cellar stairs / stone wall prose');

  const lever = r2.features.find((f) => f.objectKind === 'lever');
  assert.ok(lever, 'Room 2 has a mechanism lever');
  assert.doesNotMatch(lever.label, /wall lever/i, 'Outdoor lever avoids indoor wall lever label');
  const leverCell = r2.cells.find((c) => c.column === lever.column && c.row === lever.row);
  assert.equal(leverCell?.terrain, 'floor', 'Lever cell is walkable floor terrain, never blocked');

  const targetExit = r2.exits.find((e) => e.id === lever.targetEdgeOrObjectId);
  if (targetExit) {
    const manhattan =
      Math.abs(lever.column - targetExit.column) + Math.abs(lever.row - targetExit.row);
    assert.equal(
      manhattan >= 1 && manhattan <= 2,
      true,
      `Lever at (${lever.column},${lever.row}) is within Manhattan distance 1-2 of target exit (${targetExit.column},${targetExit.row})`,
    );
  }
});

test('RV-01, RV-02, & RV-03: Whole-container loot routing on open containers, support-surface preposition splitting & document open-to-read narration, and intra-scene feature approach vs scene travel', () => {
  // 1. RV-01: Whole-container loot routing & runtime transfer on an already-open container
  assert.equal(isWholeContainerLootDeclaration('I loot the open ironbound coffer'), true);
  assert.equal(isWholeContainerLootDeclaration('I empty the carved chest'), true);
  assert.equal(isWholeContainerLootDeclaration('I take everything from the supply locker'), true);
  assert.equal(
    classifyClause('I loot the open ironbound coffer').kind,
    'take_item',
    'Whole-container loot with adjectival "open" classifies as take_item, never interact',
  );
  const parsedLoot = parsePlayerDeclaration('I loot the open ironbound coffer');
  assert.equal(parsedLoot.actionSequence[0]?.outcomeHint, 'take_from_container');

  const bp = buildCampaignBlueprint({
    summary:
      'At Clockhouse, a stilted lantern station on the edge of Glimmerfen, Warden Corin Vale asks the party to trace a vanished apprentice who left behind a brass astrolabe.',
    startLevel: 1,
    targetEndLevel: 2,
  });
  const runtime = buildMapRuntimeFromBlueprint({
    campaignId: 'camp-rv',
    blueprint: bp,
    accountIds: ['acc-1'],
    seatTokens: [{ seatId: 'seat-1', characterId: 'char-1', column: 2, row: 4 }],
    activateFirstScene: true,
  });
  const r1 = runtime.sceneInstances[runtime.activeSceneId];
  const container = r1.features.find((f) => f.objectKind === 'container');
  assert.ok(container, 'Scene 1 has a container');
  const cleanContainerLabel = container.label.replace(/\s*\([^)]+\)\s*$/, '').trim();

  // Open the container first
  const opened = interactObjectRuntime({
    runtime,
    objectId: container.objectId,
    declaration: `I open the ${cleanContainerLabel}`,
  });
  assert.equal(opened.nextState, 'open');
  assert.deepEqual(opened.lootedItems, []);

  // Follow up with whole-container loot by container label ("I loot the open <container>")
  const lootedAll = lootContainerRuntime({
    runtime: opened.runtime,
    objectId: container.objectId,
    itemHint: 'all',
    declaration: `I loot the open ${cleanContainerLabel}`,
  });
  assert.deepEqual(lootedAll.lootedItems, container.contents);
  assert.equal(
    lootedAll.chronicle,
    `Took ${container.contents.join(', ')} from ${cleanContainerLabel}.`,
  );
  const afterLootContainer = lootedAll.runtime.sceneInstances[runtime.activeSceneId].features.find(
    (f) => f.objectId === container.objectId,
  );
  assert.deepEqual(afterLootContainer.contents, []);

  // 2. RV-02: Support-surface preposition splitting, non-openable furniture, & document open-to-read narration
  const splitDoc = splitPrimaryTargetFromLocative('I open the harbor manifest on the oak table');
  assert.equal(splitDoc.primaryClause, 'I open the harbor manifest');
  assert.equal(splitDoc.locativeQualifier, 'on the oak table');
  assert.equal(isDocumentOpenOrReadDeclaration('I open the harbor manifest on the oak table'), true);
  assert.equal(isDocumentOpenOrReadDeclaration('I unfold the parchment scroll atop the stone altar'), true);
  assert.equal(isDocumentOpenOrReadDeclaration('I open the harbor manifest'), true);
  assert.equal(isDocumentOpenOrReadDeclaration('I take the harbor manifest from the chest'), false);

  // Locative support surface must score 0 when primaryClause names a different direct-object noun
  const surfaceMatchScore = scoreFeatureLabelMatch(
    'I open the harbor manifest on the oak table',
    'Oak table (intact)',
  );
  assert.equal(
    surfaceMatchScore.score,
    0,
    'Support surface mentioned only in locativeQualifier ("on the oak table") must score 0',
  );

  // Solid surface furniture must never transition to 'open' in nextObjectState
  assert.equal(
    nextObjectState(
      {
        objectId: 'prop-table',
        label: 'Oak table',
        objectKind: 'prop',
        referenceKind: 'prop',
        column: 5,
        row: 3,
        state: 'intact',
        interactable: true,
      },
      'I open the oak table',
    ),
    null,
  );

  // Guardrail check: buildSceneSurveyNarration returns identical rich document clue prose for "I open the <document>" and "I read the <document>"
  const mapBundle = buildAuthoritativeMapBundle({
    campaignId: 'camp-rv',
    seats: [
      {
        seatId: 'seat-1',
        campaignId: 'camp-rv',
        ownerAccountId: 'acc-1',
        characterId: 'char-1',
        characterName: 'Test Hero',
      },
    ],
    runtime,
  });
  const openDocNarration = buildSceneSurveyNarration(mapBundle, {
    playerText: 'I open the station logbook on the oak table',
    campaignPremise: bp.summary,
  });
  const readDocNarration = buildSceneSurveyNarration(mapBundle, {
    playerText: 'I read the station logbook on the oak table',
    campaignPremise: bp.summary,
  });
  assert.equal(openDocNarration, readDocNarration);
  assert.match(openDocNarration, /Inspecting the station logbook closely in Clockhouse/i);
  assert.doesNotMatch(openDocNarration, /You look and listen|scene settles/i);

  // 3. RV-03: Intra-scene feature approach vs scene exit travel
  const r2Step = travelSceneRuntime({
    runtime,
    campaignId: 'camp-rv',
    accountId: 'acc-1',
    destinationHint: 'scene-m1-r2',
    blueprint: bp,
  });
  const r2Bundle = buildAuthoritativeMapBundle({
    campaignId: 'camp-rv',
    seats: [
      {
        seatId: 'seat-1',
        campaignId: 'camp-rv',
        ownerAccountId: 'acc-1',
        characterId: 'char-1',
        characterName: 'Test Hero',
      },
    ],
    runtime: r2Step.runtime,
  });
  const r2Lever = r2Bundle.notableFeatures.find((f) => f.objectKind === 'lever');
  assert.ok(r2Lever, 'Room 2 has a lever feature');
  const cleanLeverLabel = r2Lever.label.replace(/\s*\([^)]+\)\s*$/, '').trim();

  const approachedFeature = matchInRoomApproachTarget(
    r2Bundle.notableFeatures,
    `I walk up to the ${cleanLeverLabel}`,
  );
  assert.ok(approachedFeature, 'matchInRoomApproachTarget resolves in-room lever');
  assert.equal(approachedFeature.objectId, r2Lever.objectId);

  const leverPath = pathBesideFeature(
    { column: 2, row: 4 },
    { column: r2Lever.column, row: r2Lever.row },
    r2Bundle,
  );
  assert.ok(leverPath && leverPath.length > 0, 'pathBesideFeature computes a walkable path to the lever');
  const finalStep = leverPath[leverPath.length - 1];
  const finalManhattan =
    Math.abs(finalStep.column - r2Lever.column) + Math.abs(finalStep.row - r2Lever.row);
  assert.equal(
    finalManhattan,
    1,
    `Final step (${finalStep.column},${finalStep.row}) is orthogonally adjacent to lever (${r2Lever.column},${r2Lever.row})`,
  );

  // Explicit exit travel does NOT match matchInRoomApproachTarget
  assert.equal(
    matchInRoomApproachTarget(r2Bundle.notableFeatures, 'I follow the trail into the next area'),
    null,
  );

  // 4. Universal Rule 1 & RV-03: applyViewerFog flood-fills all contiguous walkable floor cells in Scene 2
  // so pathBesideFeature works on the fog-filtered viewer map bundle without any "fog island" gap
  const r2Fogged = applyViewerFog(r2Bundle, {
    accountId: 'acc-1',
    viewerSeatId: 'seat-1',
    runtime: r2Step.runtime,
  });
  const foggedLeverPath = pathBesideFeature(
    r2Fogged.tokens[0].footprint.anchor,
    { column: r2Lever.column, row: r2Lever.row },
    r2Fogged,
  );
  assert.ok(
    foggedLeverPath && foggedLeverPath.length > 0,
    'pathBesideFeature succeeds on fog-projected viewer map across the entire undivided corridor',
  );

  // 5. CV-01 & Universal Rule 5: Dialogue & Quoted-Speech Immunity From Travel/Action Hijacking
  const singleQuotedAsk =
    "I ask Warden Halden, 'Did Clerk Orin leave any warning before the dawn inspection?'";
  const doubleQuotedAsk =
    'I ask Archivist Sera, "Where did the night courier go after opening the iron gate?"';
  assert.equal(stripQuotedSpeech(singleQuotedAsk), 'I ask Warden Halden,');
  assert.equal(stripQuotedSpeech(doubleQuotedAsk), 'I ask Archivist Sera,');
  // Contractions and possessives are preserved by stripQuotedSpeech
  assert.equal(
    stripQuotedSpeech("I don't touch the warden's ledger"),
    "I don't touch the warden's ledger",
  );
  assert.equal(isDialogueDeclaration(singleQuotedAsk, ['Warden Halden']), true);
  assert.equal(isDialogueDeclaration(doubleQuotedAsk, ['Archivist Sera']), true);
  assert.equal(classifyClause(singleQuotedAsk).kind, 'speak');
  assert.equal(classifyClause(doubleQuotedAsk).kind, 'speak');

  const parsedSingleAsk = parsePlayerDeclaration(singleQuotedAsk, {
    knownNpcs: [{ id: 'npc-halden', label: 'Warden Halden' }],
  });
  assert.equal(parsedSingleAsk.addressee, 'Warden Halden');
  assert.equal(
    parsedSingleAsk.actionSequence.some((step) => step.kind === 'dialogue'),
    true,
  );
  assert.equal(
    parsedSingleAsk.actionSequence.some(
      (step) => step.kind === 'move' || step.kind === 'open_door',
    ),
    false,
  );
  const authSingleAsk = resolveIntentAuthority(parsedSingleAsk);
  assert.equal(authSingleAsk.disposition, 'director_narrate_only');
  assert.equal(authSingleAsk.proposedCommandType, 'table.sync');

  // Even if LLM dispatcher hallucinated travel_scene for an NPC question, applyDirectorDispatchToMap overrides to dialogue
  const overriddenDispatch = applyDirectorDispatchToMap({
    dispatch: {
      actionType: 'travel_scene',
      travelScene: { destinationHint: 'the next area', returnToPrevious: false },
    },
    map: mapBundle,
    seatedSheet: null,
    knownNpcs: [{ id: 'npc-corin', label: 'Warden Corin Vale' }],
    rawText:
      "I ask Warden Corin Vale, 'Did Apprentice Talia leave any warning before the dawn inspection?'",
  });
  assert.equal(overriddenDispatch?.proposedCommandType, 'table.sync');
  assert.equal(overriddenDispatch?.deferDirectorNarrate, true);
  assert.match(overriddenDispatch?.summary ?? '', /Speak with Warden Corin Vale/i);
});

test('FC-01 & Anti-Laziness Rule 1: Position-agnostic multi-token NPC alias matching, metadata stripping, unquoted addressee extraction, and present-NPC priority', () => {
  // 1a. Metadata stripping before tokenizing: parentheticals and dash suffixes never pollute aliases
  const rawWithMeta = 'Conservator Corin Vale (Local Contact) — helpful guide';
  assert.equal(cleanNpcLabelForMatching(rawWithMeta), 'Conservator Corin Vale');
  const metaVariants = expandNpcNameVariants(rawWithMeta).map((v) => v.toLowerCase());
  assert.equal(metaVariants.includes('missing'), false);
  assert.equal(metaVariants.includes('local'), false);
  assert.equal(metaVariants.includes('contact'), false);
  assert.equal(metaVariants.includes('guide'), false);
  assert.equal(metaVariants.includes('helpful'), false);
  assert.equal(npcNamesMatch(rawWithMeta, 'Contact'), false);
  assert.equal(npcNamesMatch(rawWithMeta, 'Guide'), false);
  assert.equal(npcNamesMatch('Apprentice Talia (Missing)', 'Missing'), false);

  // 1b. True position-agnostic N-grams: 3-word NPC name with an unlisted title ("Conservator" / "Arch-Verger")
  // matches full name, contiguous sub-phrases, middle token (given name at tokens[1]), and surname (tokens[2])
  const unlistedThreeWord = 'Arch-Verger Ilwen Thorne';
  const stripped = stripPersonalRoleTitle(unlistedThreeWord);
  assert.equal(stripped.strippedName, 'Ilwen Thorne');
  assert.equal(stripped.givenName, 'Ilwen');

  const variants = expandNpcNameVariants(unlistedThreeWord);
  assert.equal(variants.includes('Arch-Verger Ilwen Thorne'), true);
  assert.equal(variants.includes('Arch-Verger Ilwen'), true);
  assert.equal(variants.includes('Ilwen Thorne'), true);
  assert.equal(variants.includes('Ilwen'), true, 'Indexes middle given-name token at tokens[1]');
  assert.equal(variants.includes('Thorne'), true, 'Indexes surname token at tokens[2]');

  for (const queryForm of [
    'Arch-Verger Ilwen Thorne',
    'Arch-Verger Ilwen',
    'Ilwen Thorne',
    'Ilwen',
    'Thorne',
  ]) {
    assert.equal(
      npcNamesMatch(unlistedThreeWord, queryForm),
      true,
      `npcNamesMatch matches "${queryForm}" against "${unlistedThreeWord}"`,
    );
  }
  // Two distinct multi-word NPCs sharing only tokens[0] must NOT false-match each other
  assert.equal(
    npcNamesMatch('Arch-Verger Ilwen Thorne', 'Arch-Verger Hadrin Moss'),
    false,
  );

  // 1c & 1d. Extract addressee strictly outside quoted speech & prioritize present-scene NPCs
  const quotedQuestionWithAbsentNpc =
    "I ask Ilwen, 'Did Hadrin Moss leave any warning before the dawn inspection?'";
  const parsed = parsePlayerDeclaration(quotedQuestionWithAbsentNpc, {
    presentNpcs: [{ id: 'npc-ilwen', label: 'Arch-Verger Ilwen Thorne (Local Contact)' }],
    knownNpcs: [
      { id: 'npc-hadrin', label: 'Hadrin Moss (Missing)' },
      { id: 'npc-ilwen', label: 'Arch-Verger Ilwen Thorne (Local Contact)' },
    ],
  });
  assert.equal(
    parsed.addressee,
    'Arch-Verger Ilwen Thorne (Local Contact)',
    'Addressee is extracted strictly from framing clause outside quotes and matched to present 3-word NPC by given name',
  );
  const authority = resolveIntentAuthority(parsed, [
    { id: 'npc-ilwen', label: 'Arch-Verger Ilwen Thorne', kind: 'npc' },
  ]);
  assert.equal(authority.disposition, 'director_narrate_only');
  assert.equal(authority.proposedCommandType, 'table.sync');
});

test('Packets 1–5 (C12-01, C12-02, Exit Terminology, Top-Down Object Sprites, & Delete-Proof Account Image Quotas)', async () => {
  // 1. Packet 1 (C12-01): Person-First Entity Grammar — -ate titles & place-like surnames never wipe NPCs
  assert.equal(isCompoundPlaceWord('Legate'), false, '"Legate" ends in -ate, never -gate');
  assert.equal(isCompoundPlaceWord('Magistrate'), false, '"Magistrate" ends in -ate, never -gate');
  assert.equal(isCompoundPlaceWord('Delegate'), false);
  assert.equal(isCompoundPlaceWord('Prelate'), false);
  assert.equal(isCompoundPlaceWord('Northgate'), true, 'True -gate compound place word still matches');

  const premise =
    'Inside the Frostwatch Glasshouse, Legate Aveline Marr asks Rhea Calder to find Master Toren Quill, who vanished near the Cinderwatch Archway after inspecting a silver reliquary.';
  assert.equal(
    isPersonBySyntacticContext('Legate Aveline Marr', premise),
    true,
    'Subject of speech verb "asks" is classified as a Person by syntactic context',
  );
  assert.equal(
    isPersonBySyntacticContext('Master Toren Quill', premise),
    true,
    'Object of "to find" / subject of "who vanished" is classified as a Person',
  );

  const extracted = extractPremiseEntities(premise, {
    excludeCharacterNames: ['Rhea Calder'],
  });
  assert.equal(
    extracted.npcs.some((n) => /Legate Aveline Marr/i.test(n)),
    true,
    'extractPremiseEntities keeps Legate Aveline Marr as an NPC',
  );
  assert.equal(
    extracted.places.some((p) => /Legate Aveline Marr/i.test(p)),
    false,
    'Legate Aveline Marr is never classified as a place',
  );

  const bp = buildCampaignBlueprint({
    summary: premise,
    startLevel: 1,
    targetEndLevel: 2,
    excludeCharacterNames: ['Rhea Calder'],
  });
  assert.equal(
    bp.namedNpcs.some((n) => /Legate Aveline Marr/i.test(n)),
    true,
    'buildCampaignBlueprint preserves Legate Aveline Marr in namedNpcs (never wiped to Warden Elira)',
  );
  assert.equal(
    bp.namedNpcs.some((n) => /Warden Elira/i.test(n)),
    false,
    'Fallback Warden Elira is not injected when custom contact Legate Aveline Marr is present',
  );
  const r1Npcs = bp.milestones[0].rooms[0].npcs;
  assert.equal(
    r1Npcs.some((n) => /Legate Aveline Marr/i.test(n.name)),
    true,
    'Room 1 spawns Legate Aveline Marr as the local contact NPC',
  );

  // Also verify an NPC with a place-like surname ("Blackwood" / "Ashford") in a person syntactic slot stays an NPC
  const surnamePremise =
    'At the Old Granary, Bailiff Harlan Blackwood asks the party to locate Archivist Sera Ashford, who vanished near the river sluice.';
  const surnameBp = buildCampaignBlueprint({
    summary: surnamePremise,
    startLevel: 1,
    targetEndLevel: 2,
  });
  assert.equal(
    surnameBp.namedNpcs.some((n) => /Bailiff Harlan Blackwood/i.test(n)),
    true,
    'NPC with place-suffix surname (Blackwood) in person syntactic position is preserved as NPC',
  );
  assert.equal(
    surnameBp.namedNpcs.some((n) => /Archivist Sera Ashford/i.test(n)),
    true,
    'NPC with place-suffix surname (Ashford) in person syntactic position is preserved as NPC',
  );

  // 2. Packet 2 (C12-02): Verb-First Object Targeting & "Exit" Terminology
  const runtime = buildMapRuntimeFromBlueprint({
    campaignId: 'camp-c12',
    blueprint: bp,
    accountIds: ['acc-1'],
    seatTokens: [{ seatId: 'seat-1', characterId: 'char-1', column: 2, row: 4 }],
    activateFirstScene: true,
  });
  // Ensure Scene 1 has an "Iron-hasped travel trunk" container with contents
  const r1 = runtime.sceneInstances[runtime.activeSceneId];
  const trunkFeature = {
    objectId: 'obj-travel-trunk',
    label: 'Iron-hasped travel trunk',
    objectKind: 'container',
    referenceKind: 'prop',
    column: 3,
    row: 4,
    state: 'closed',
    lockState: 'unlocked',
    interactable: true,
    contents: ['Silver reliquary key', 'Wax-sealed ledger'],
  };
  const customRuntime = {
    ...runtime,
    sceneInstances: {
      ...runtime.sceneInstances,
      [runtime.activeSceneId]: {
        ...r1,
        features: [
          ...r1.features.filter((f) => f.objectKind !== 'container'),
          trunkFeature,
        ],
      },
    },
  };
  const customBundle = buildAuthoritativeMapBundle({
    campaignId: 'camp-c12',
    seats: [
      {
        seatId: 'seat-1',
        campaignId: 'camp-c12',
        ownerAccountId: 'acc-1',
        characterId: 'char-1',
        characterName: 'Rhea Calder',
      },
    ],
    runtime: customRuntime,
  });

  // 2a. Exit features use explicit "Exit" terminology
  const exitFeatures = customBundle.notableFeatures.filter(
    (f) => f.objectKind === 'exit' || f.referenceKind === 'exit',
  );
  assert.equal(exitFeatures.length > 0, true, 'Scene projects exit features');
  for (const exitFeat of exitFeatures) {
    assert.match(
      exitFeat.label,
      /\bExit\b/i,
      `Exit feature label "${exitFeat.label}" explicitly includes "Exit"`,
    );
  }
  assert.match(
    formatSceneExitPlayerFacingLabel({
      rawLabel: 'Wooden doorway',
      orientation: 'east',
      destinationHint: 'Cinderwatch Archway',
      doorState: 'closed',
    }),
    /^East Exit → Cinderwatch Archway — closed$/,
  );

  // 2b. "I open the Iron-hasped travel trunk." routes to table.interact_object (NEVER table.travel_scene or table.door_state)
  const openTrunkClause = classifyClause('I open the Iron-hasped travel trunk.', undefined, [
    'Iron-hasped travel trunk',
  ]);
  assert.notEqual(
    openTrunkClause.kind,
    'travel',
    '"I open the Iron-hasped travel trunk." must never classify as travel despite the word "travel" in the container name',
  );
  const openTrunkDispatch = applyDirectorDispatchToMap({
    dispatch: {
      actionType: 'travel_scene',
      travelScene: { destinationHint: 'Iron-hasped travel trunk', returnToPrevious: false },
    },
    map: customBundle,
    seatedSheet: null,
    rawText: 'I open the Iron-hasped travel trunk.',
  });
  assert.equal(
    openTrunkDispatch?.proposedCommandType,
    'table.interact_object',
    'applyDirectorDispatchToMap overrides travel_scene to table.interact_object when opening the Iron-hasped travel trunk',
  );
  assert.equal(openTrunkDispatch?.objectId, 'obj-travel-trunk');

  // 2c. "I loot the open Iron-hasped travel trunk." routes to table.take_scene_prop with itemId: 'all' (NEVER table.travel_scene)
  const openTrunkBundle = {
    ...customBundle,
    notableFeatures: customBundle.notableFeatures.map((f) =>
      f.objectId === 'obj-travel-trunk'
        ? { ...f, label: 'Iron-hasped travel trunk (open)', objectState: 'open' }
        : f,
    ),
  };
  const lootTrunkDispatch = applyDirectorDispatchToMap({
    dispatch: {
      actionType: 'travel_scene',
      travelScene: { destinationHint: 'open Iron-hasped travel trunk', returnToPrevious: false },
    },
    map: openTrunkBundle,
    seatedSheet: null,
    rawText: 'I loot the open Iron-hasped travel trunk.',
  });
  assert.equal(
    lootTrunkDispatch?.proposedCommandType,
    'table.take_scene_prop',
    'applyDirectorDispatchToMap routes looting the open Iron-hasped travel trunk to table.take_scene_prop',
  );
  assert.equal(lootTrunkDispatch?.objectId, 'obj-travel-trunk');
  assert.equal(lootTrunkDispatch?.itemId, 'all');

  // 3. Packet 4: Top-Down Object Sprites & State-Driven Sprite Swapping
  const closedSprite = resolveObjectSpriteDescriptor({
    label: 'Iron-hasped travel trunk',
    objectKind: 'container',
    state: 'closed',
  });
  const openSprite = resolveObjectSpriteDescriptor({
    label: 'Iron-hasped travel trunk (open)',
    objectKind: 'container',
    state: 'open',
  });
  assert.equal(closedSprite.spriteKey, 'container:trunk:closed');
  assert.equal(openSprite.spriteKey, 'container:trunk:open');
  assert.notEqual(
    closedSprite.spriteUrl,
    openSprite.spriteUrl,
    'Opening a container swaps its top-down sprite URL from closed to open',
  );
  assert.match(closedSprite.spriteUrl, /^data:image\/svg\+xml;utf8,/);

  const leverClosedSprite = resolveObjectSpriteKey({
    label: 'Rusted iron lever',
    objectKind: 'lever',
    state: 'closed',
  });
  const leverOpenSprite = resolveObjectSpriteKey({
    label: 'Rusted iron lever (pulled)',
    objectKind: 'lever',
    state: 'open',
  });
  assert.equal(leverClosedSprite, 'mechanism:lever:closed');
  assert.equal(leverOpenSprite, 'mechanism:lever:open');

  // Every projected notableFeature in buildAuthoritativeMapBundle has spriteKey and spriteUrl
  for (const feat of customBundle.notableFeatures) {
    assert.equal(
      typeof feat.spriteKey === 'string' && feat.spriteKey.length > 0,
      true,
      `Projected feature "${feat.label}" includes spriteKey`,
    );
    assert.equal(
      typeof feat.spriteUrl === 'string' && feat.spriteUrl.length > 0,
      true,
      `Projected feature "${feat.label}" includes spriteUrl`,
    );
  }

  // 4. Packet 5: Delete-Proof Account Image Quotas (3/day + 15s cooldown, unaffected by character/campaign deletion)
  const store = new Map();
  const mockFirestore = {
    collection(colName) {
      return {
        doc(docId) {
          const key = `${colName}/${docId}`;
          return {
            async get() {
              const val = store.get(key);
              return { exists: val !== undefined, data: () => val };
            },
            async set(val) {
              store.set(key, val);
            },
          };
        },
      };
    },
  };
  const t0 = 1_700_000_000_000;
  const q1 = await checkAndRecordAccountImageQuota({
    firestore: mockFirestore,
    accountId: 'acc-quota-test',
    kind: 'portrait',
    nowMs: t0,
  });
  assert.equal(q1.allowed, true);
  assert.equal(q1.usedToday, 1);

  // Calling 2 seconds later hits 15s cooldown
  const qCooldown = await checkAndRecordAccountImageQuota({
    firestore: mockFirestore,
    accountId: 'acc-quota-test',
    kind: 'portrait',
    nowMs: t0 + 2_000,
  });
  assert.equal(qCooldown.allowed, false);
  assert.equal(qCooldown.reason, 'cooldown');

  // Calling after 20s..100s succeeds up to 6/day (Packet 2)
  assert.equal(MAX_LIVE_PORTRAIT_FORGES_PER_24H, 6);
  assert.equal(MAX_LIVE_MAP_FORGES_PER_CAMPAIGN, 12);
  assert.equal(MAX_LIVE_MAP_FORGES_PER_24H, 12);
  for (let i = 2; i <= 6; i += 1) {
    const qNext = await checkAndRecordAccountImageQuota({
      firestore: mockFirestore,
      accountId: 'acc-quota-test',
      kind: 'portrait',
      nowMs: t0 + i * 20_000,
    });
    assert.equal(qNext.allowed, true, `Portrait forge #${i} is allowed within 6/24h`);
    assert.equal(qNext.usedToday, i);
  }

  // 7th portrait call within 24h is blocked by daily_cap
  const q7 = await checkAndRecordAccountImageQuota({
    firestore: mockFirestore,
    accountId: 'acc-quota-test',
    kind: 'portrait',
    nowMs: t0 + 140_000,
  });
  assert.equal(q7.allowed, false);
  assert.equal(q7.reason, 'daily_cap');

  // Battlemap quota: up to 12 per campaign / 24h, 13th blocked
  for (let i = 1; i <= 12; i += 1) {
    const mNext = await checkAndRecordAccountImageQuota({
      firestore: mockFirestore,
      accountId: 'acc-map-quota-test',
      campaignId: 'camp-map-12',
      kind: 'battlemap',
      nowMs: t0 + 200_000 + i * 20_000,
    });
    assert.equal(mNext.allowed, true, `Battlemap forge #${i} is allowed within 12/campaign`);
  }
  const m13 = await checkAndRecordAccountImageQuota({
    firestore: mockFirestore,
    accountId: 'acc-map-quota-test',
    campaignId: 'camp-map-12',
    kind: 'battlemap',
    nowMs: t0 + 500_000,
  });
  assert.equal(m13.allowed, false);
  assert.equal(m13.reason, 'campaign_cap');
});

test('VP-01..VP-05, 6/12 Quotas + Admin/Codex/Antigravity Bypass, Global Asset Bank Guard, & Security Hardening', async () => {
  // 1. VP-01: Map chips preserve "Exit" and right-edge tooltips flip left & clamp within stage
  const placements = layoutMapLabels(
    [
      {
        id: 'exit-east',
        kind: 'poi',
        fullLabel: 'East Exit → Sunken Vault — closed',
        referenceKind: 'exit',
        objectKind: 'exit',
        x: 720,
        y: 256,
        obstacle: { x: 704, y: 240, w: 32, h: 32 },
        priority: 30,
      },
    ],
    {
      mapWidth: 768,
      mapHeight: 512,
      zoomScale: 1,
    },
  );
  assert.equal(placements.length, 1);
  assert.match(placements[0].displayText, /\bEast Exit\b/i, 'Exit map chip keeps "Exit" in displayText');

  const rightEdgeTip = computeClampedMapTooltipPosition({
    anchorX: 730,
    anchorY: 250,
    stageWidth: 768,
    stageHeight: 512,
    tooltipWidth: 220,
    tooltipHeight: 36,
    featureColumn: 11,
    mapColumns: 12,
  });
  assert.equal(rightEdgeTip.flippedLeft, true, 'Right-edge exit marker flips tooltip to the left');
  assert.equal(
    rightEdgeTip.left + 220 <= 768 - 8,
    true,
    'Clamped tooltip right edge stays inside stageWidth - 8',
  );
  assert.equal(rightEdgeTip.left >= 8, true, 'Clamped tooltip left edge stays >= 8');

  // 2. VP-03: Scenery/furniture prepositional clauses ("Near a fallen parcel rack...") never hijack a Missing Person questHook
  const missingPersonWithSceneryPremise =
    'At the Weighhouse, Bailiff Maelis asks the party to find Curator Pelan Rusk, who vanished before dawn. Near a fallen parcel rack, violet wool tufts catch on a rusted grate.';
  const hook = detectQuestHook(missingPersonWithSceneryPremise);
  assert.doesNotMatch(
    hook,
    /missing\s+courier|parcel\s+rack/i,
    'Incidental scenery ("Near a fallen parcel rack...") never spawns a competing missing courier hook',
  );
  assert.match(
    hook,
    /disappearance\s+of\s+Curator\s+Pelan\s+Rusk/i,
    'Missing person questHook names the disappearance of Curator Pelan Rusk',
  );
  const vp03Bp = buildCampaignBlueprint({
    summary: missingPersonWithSceneryPremise,
    startLevel: 1,
    targetEndLevel: 2,
  });
  assert.doesNotMatch(vp03Bp.questHook, /missing\s+courier/i);
  assert.equal(
    vp03Bp.namedProps.some((p) => /parcel\s+rack/i.test(p)),
    false,
    'Furniture noun "parcel rack" is excluded from namedProps',
  );

  // 3. VP-04: In-room approach movement receipt preserves the declared feature name ("Brass-bound strongbox") over an adjacent doorway
  const vp04Map = {
    title: 'Weighhouse',
    coordinateSpace: { columns: 12, rows: 8, feetPerSquare: 5 },
    edges: [
      {
        edgeId: 'door-east',
        kind: 'door',
        column: 10,
        row: 4,
        orientation: 'east',
        doorState: 'closed',
      },
    ],
    notableFeatures: [
      {
        objectId: 'obj-strongbox',
        label: 'Brass-bound strongbox (closed)',
        objectKind: 'container',
        referenceKind: 'prop',
        column: 9,
        row: 4,
      },
    ],
  };
  const moveDest = describeMoveDestination(
    vp04Map,
    { column: 10, row: 4 },
    'I walk up to the Brass-bound strongbox.',
  );
  assert.equal(
    moveDest,
    'Brass-bound strongbox',
    'describeMoveDestination names the declared feature ("Brass-bound strongbox") even when stopping beside a doorway square',
  );
  const moveSummary = formatMoveTravelSummary({
    path: [
      { column: 8, row: 4 },
      { column: 9, row: 3 },
      { column: 10, row: 4 },
    ],
    map: vp04Map,
    actorLabel: 'Oren',
    declaration: 'I walk up to the Brass-bound strongbox.',
  });
  assert.match(moveSummary, /toward Brass-bound strongbox\./);
  assert.doesNotMatch(moveSummary, /Wooden doorway/i);
  const moveReceipt = buildResolvedActionReceipt({
    commandType: 'table.move',
    targetLabel: moveDest,
    targetKind: 'object',
    doorStatesAfter: { 'door-east': 'closed' },
    sceneTitle: 'Weighhouse',
    declaration: 'I walk up to the Brass-bound strongbox.',
  });
  assert.equal(moveReceipt.target.label, 'Brass-bound strongbox');
  assert.match(moveReceipt.narrationSeed, /Moved on the table to Brass-bound strongbox in Weighhouse\./);

  // 4. VP-05: Clean zoom percentage steps (100% baseline) and 5px drag threshold pan math
  assert.deepEqual(CLEAN_MAP_ZOOM_STEPS, [50, 75, 100, 125, 150, 175, 200, 250, 300]);
  assert.equal(stepMapZoomPercent(100, 'in'), 125);
  assert.equal(stepMapZoomPercent(125, 'in'), 150);
  assert.equal(stepMapZoomPercent(100, 'out'), 75);
  assert.equal(stepMapZoomPercent(175, 'fit'), 100);

  const microClick = computeMapDragGesture({
    startClientX: 200,
    startClientY: 200,
    currentClientX: 203,
    currentClientY: 202,
    originPanX: 0,
    originPanY: 0,
  });
  assert.equal(microClick.isPanning, false, 'Movement <= 5px is treated as a click, not a pan');
  assert.equal(microClick.panX, 0);

  const realDrag = computeMapDragGesture({
    startClientX: 200,
    startClientY: 200,
    currentClientX: 260,
    currentClientY: 240,
    originPanX: 10,
    originPanY: -5,
    stageWidth: 800,
    stageHeight: 600,
    scaledMapWidth: 960,
    scaledMapHeight: 640,
  });
  assert.equal(realDrag.isPanning, true, 'Movement > 5px pans the camera');
  assert.equal(realDrag.panX, 70);
  assert.equal(realDrag.panY, 35);

  const clampedPan = clampMapPanOffset({
    panX: 99999,
    panY: -99999,
    stageWidth: 800,
    stageHeight: 600,
    scaledMapWidth: 800,
    scaledMapHeight: 600,
  });
  assert.equal(clampedPan.panX < 2000, true);
  assert.equal(clampedPan.panY > -2000, true);

  // 5. Packet 2: Admin, HD Codex User, & Antigravity User Quota Bypass + Battlemaps never stored in assetBank
  assert.equal(
    isImageQuotaExemptAccount({ email: 'nick.donner@gmail.com' }),
    true,
    'Bootstrap Admin is exempt from image quotas',
  );
  assert.equal(
    isImageQuotaExemptAccount({ accountId: 'qa-fixture-codex', displayLabel: 'HD Codex User' }),
    true,
    'HD Codex User is exempt from image quotas',
  );
  assert.equal(
    isImageQuotaExemptAccount({ accountId: 'dev-antigravity', displayLabel: 'Antigravity User' }),
    true,
    'Antigravity User is exempt from image quotas',
  );
  assert.equal(
    isImageQuotaExemptAccount({
      accountId: 'regular-player-99',
      email: 'player99@example.com',
      displayLabel: 'Thorne',
    }),
    false,
    'Regular player account is subject to 6/12 quotas',
  );

  // 6. Packet 3: Global Asset Library Guard blocks anachronistic/meme prompts & hyper-specific descriptions
  const memeCheck = evaluateGlobalAssetBankEligibility({
    assetKind: 'portrait',
    speciesId: 'elf',
    classId: 'bard',
    customDescription: 'Wearing a pink tuxedo and sunglasses while holding a laser rifle',
    promptText: 'Elf bard portrait',
  });
  assert.equal(memeCheck.eligibleForGlobalBank, false);
  assert.equal(memeCheck.quarantineReason, 'off_genre_or_restricted_token');

  const hyperSpecificCheck = evaluateGlobalAssetBankEligibility({
    assetKind: 'portrait',
    speciesId: 'human',
    classId: 'fighter',
    customDescription: 'He shouts "For House Valerius!" while carrying a banner.',
    promptText: 'Human fighter portrait',
  });
  assert.equal(hyperSpecificCheck.eligibleForGlobalBank, false);
  assert.equal(hyperSpecificCheck.quarantineReason, 'hyper_specific_custom_description');

  const battlemapBankCheck = evaluateGlobalAssetBankEligibility({
    assetKind: 'battlemap',
    promptText: 'Stone dungeon crypt battlemap',
  });
  assert.equal(
    battlemapBankCheck.eligibleForGlobalBank,
    false,
    'Battlemaps are never eligible for the global cross-campaign assetBank',
  );

  const validFantasyCheck = evaluateGlobalAssetBankEligibility({
    assetKind: 'portrait',
    speciesId: 'dwarf',
    classId: 'cleric',
    pronouns: 'she/her',
    customDescription: 'A weathered dwarf cleric in chainmail holding a warhammer and shield with a braided beard',
    promptText: 'Dwarf cleric portrait',
  });
  assert.equal(validFantasyCheck.eligibleForGlobalBank, true);
  assert.equal(validFantasyCheck.canonicalTags.includes('dwarf'), true);
  assert.equal(validFantasyCheck.canonicalTags.includes('cleric'), true);
  assert.equal(validFantasyCheck.canonicalTags.includes('feminine'), true);
  assert.equal(validFantasyCheck.canonicalTags.includes('chainmail'), true);
  assert.equal(validFantasyCheck.canonicalTags.includes('warhammer'), true);
  assert.equal(validFantasyCheck.canonicalTags.includes('shield'), true);

  // 7. Packet 4: Security Hardening (Trusted X-Forwarded-Host, Owner-Only Directives, & Fail-Soft AI Kill Switch)
  assert.equal(
    isTrustedForwardedHost('evil.example.com', 'https://hd-a3-staging.web.app'),
    false,
    'Untrusted X-Forwarded-Host is rejected',
  );
  assert.equal(
    servingOriginFromHost('evil.example.com', {
      clientOrigin: 'https://hd-a3-staging.web.app',
      fallbackHostHeader: 'hd-a3-player--hd-a3-staging.us-central1.hosted.app',
    }),
    'https://hd-a3-player--hd-a3-staging.us-central1.hosted.app',
    'servingOriginFromHost ignores untrusted X-Forwarded-Host and falls back to trusted Host',
  );

  const secStore = new Map();
  secStore.set('campaigns/camp-sec', {
    campaignId: 'camp-sec',
    ownerAccountId: 'owner-acc',
  });
  secStore.set('campaignMemberships/mem-non-owner', {
    membershipId: 'mem-non-owner',
    campaignId: 'camp-sec',
    accountId: 'non-owner-acc',
  });
  secStore.set('adminAuditEvents/ai_kill_switch_meta', {
    id: 'ai_kill_switch_meta',
    enabled: true,
  });
  const secFirestore = {
    collection(colName) {
      return {
        doc(docId) {
          const key = `${colName}/${docId}`;
          return {
            async get() {
              const val = secStore.get(key);
              return { exists: val !== undefined, data: () => val };
            },
            async set(val) {
              secStore.set(key, val);
            },
          };
        },
        where(field, _op, val) {
          return {
            where(field2, _op2, val2) {
              return {
                limit() {
                  return {
                    async get() {
                      const docs = [];
                      for (const [k, v] of secStore.entries()) {
                        if (k.startsWith(`${colName}/`) && v[field] === val && v[field2] === val2) {
                          docs.push({ data: () => v });
                        }
                      }
                      return { empty: docs.length === 0, docs };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  // Non-owner campaign member cannot call applyDmNpcDirective, applyDmSceneDirective, or closeCurrentChapter
  await assert.rejects(
    async () =>
      await applyDmNpcDirective(secFirestore, 'camp-sec', 'non-owner-acc', {
        schemaVersion: 'play-authority-npc-v1',
        npcId: 'npc-injected',
        name: 'Injected NPC',
        publicDescription: 'Intruder',
        disposition: 'hostile',
        location: null,
        placeToken: false,
        firstDialogue: null,
        audience: 'public',
        causeActionId: null,
      }),
    (err) => err.code === 'FORBIDDEN',
    'Non-owner campaign member is rejected with FORBIDDEN on applyDmNpcDirective',
  );

  await assert.rejects(
    async () => await closeCurrentChapter(secFirestore, 'camp-sec', 'non-owner-acc'),
    (err) => err.code === 'FORBIDDEN',
    'Non-owner campaign member is rejected with FORBIDDEN on closeCurrentChapter',
  );

  // Fail-soft AI Kill Switch: draftCampaignBlueprintOptionsWithAi returns 3 deterministic outlines without throwing
  const killSwitchOutlines = await draftCampaignBlueprintOptionsWithAi({
    summary: 'At the Weighhouse, Bailiff Maelis asks the party to find Curator Pelan Rusk.',
    startLevel: 1,
    targetEndLevel: 2,
    firestore: secFirestore,
  });
  assert.equal(killSwitchOutlines.length, 3, 'AI Kill Switch falls back to 3 deterministic outlines');

  // 7. Surgical Closure VP-03: extractCampaignNamedFacts excludes furniture compounds ("parcel rack") and prioritizes missing person
  const frostmerePremise =
    'At Frostmere Watchhouse, a rain-swept customs hall, Archivist Teren Sol vanished during an inspection. Legate Ivara Fenbrook asks Dalia Kestrel to find Teren Sol before the evening bell. Near a fallen parcel rack, silver chalk marks trail from the entry floor toward an inner chamber containing a cracked jade astrolabe.';
  const frostmereNamedFacts = extractCampaignNamedFacts(frostmerePremise, ['Dalia Kestrel']);
  assert.notEqual(frostmereNamedFacts.questHook, 'parcel');
  assert.match(frostmereNamedFacts.questHook ?? '', /Teren Sol/i);
  assert.match(frostmereNamedFacts.questHook ?? '', /missing/i);
  assert.equal(
    frostmereNamedFacts.chips.some((chip) => /Quest hook:\s*parcel/i.test(chip)),
    false,
    'Visible Quest hook chip must never output Quest hook: parcel for a fallen parcel rack',
  );
  assert.equal(
    frostmereNamedFacts.chips.some((chip) => /Quest hook:.*Teren Sol.*missing/i.test(chip)),
    true,
    'Visible Quest hook chip must reflect the missing person objective',
  );

  // 8. Surgical Closure VP-04: 1-square named feature approach produces "<Actor> moved 1 square (5 ft) ... toward <targetFeatureLabel>." in both receipt narrationSeed and Chronicle
  const oneSquareMoveSummary = formatMoveTravelSummary({
    path: [{ column: 9, row: 4 }],
    start: { column: 8, row: 4 },
    map: vp04Map,
    actorLabel: 'Dalia Kestrel',
    targetLabel: 'Brass-bound strongbox',
    declaration: 'I walk over to the Brass-bound strongbox.',
  });
  assert.equal(
    oneSquareMoveSummary,
    'Dalia Kestrel moved 1 square (5 ft) from column 8, row 4 across Weighhouse toward Brass-bound strongbox.',
  );
  const oneSquareReceipt = buildResolvedActionReceipt({
    commandType: 'table.move',
    targetLabel: 'Brass-bound strongbox',
    targetKind: 'token_path',
    doorStatesAfter: { 'door-east': 'closed' },
    sceneTitle: 'Weighhouse',
    declaration: 'I walk over to the Brass-bound strongbox.',
    eventSummary: oneSquareMoveSummary,
  });
  assert.equal(oneSquareReceipt.narrationSeed, oneSquareMoveSummary);
  assert.doesNotMatch(oneSquareReceipt.narrationSeed, /Wooden doorway/i);
});





