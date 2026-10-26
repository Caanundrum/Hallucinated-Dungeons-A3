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
} from '../../dist/server/campaigns/campaign-blueprint.js';
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
} from '../../dist/server/table/scene-composition.js';
import {
  buildMapRuntimeFromBlueprint,
  buildStoredSceneFromRoomBlueprint,
  checkExitLockedForTravel,
  interactObjectRuntime,
  isPortableSceneContainer,
  lootContainerRuntime,
  matchTakeContainerByDeclaration,
  travelSceneRuntime,
} from '../../dist/server/table/scene-commands.js';
import {
  applyViewerFog,
  buildAuthoritativeMapBundle,
} from '../../dist/server/table/map-projection.js';
import {
  classifyClause,
} from '../../dist/shared/utterance-understanding.js';
import {
  applyDirectorDispatchToMap,
} from '../../dist/server/ai/director-mechanics-dispatcher.js';

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
