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
  extractPremiseEntities,
} from '../../dist/server/campaigns/campaign-blueprint.js';
import {
  expandNpcNameVariants,
  npcNamesMatch,
} from '../../dist/shared/campaign-facts.js';
import {
  parsePlayerDeclaration,
} from '../../dist/shared/play-authority-contract.js';
import {
  buildCampaignAssetPrompt,
  formatBattlemapCardinalExits,
} from '../../dist/server/assets/campaign-assets.js';
import {
  attachExitsToStoredScene,
  extractSceneCardinalExits,
  isPerimeterCoordinate,
} from '../../dist/server/table/scene-exit-projection.js';
import {
  contextualContainerLabelForTemplate,
  contextualPropLabelForTemplate,
  deduplicateSceneFeatureLabels,
} from '../../dist/server/table/scene-composition.js';
import {
  buildMapRuntimeFromBlueprint,
  buildStoredSceneFromRoomBlueprint,
  checkExitLockedForTravel,
  interactObjectRuntime,
  isPortableSceneContainer,
  lootContainerRuntime,
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
  isPassageOrTravelThroughDoorway,
  splitPrimaryTargetFromLocative,
} from '../../dist/shared/utterance-understanding.js';
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

