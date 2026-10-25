import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  queryDirectorMechanicsArbiter,
  applyDirectorDispatchToMap,
} from '../../dist/server/ai/director-mechanics-dispatcher.js';

function kaelenSheet() {
  return {
    level: 1,
    experiencePoints: 180,
    proficiencyBonus: { value: 2, components: [] },
    abilityScores: {
      strength: { value: 10, components: [] },
      dexterity: { value: 16, components: [] },
      constitution: { value: 12, components: [] },
      intelligence: { value: 14, components: [] },
      wisdom: { value: 8, components: [] },
      charisma: { value: 10, components: [] },
    },
    abilityModifiers: {
      strength: 0,
      dexterity: 3,
      constitution: 1,
      intelligence: 2,
      wisdom: -1,
      charisma: 0,
    },
    hitPoints: { value: 9, components: [] },
    hitPointsCurrent: 9,
    hitDice: '1d8',
    armorClass: { value: 15, components: [] },
    initiative: { value: 5, components: [] },
    speed: { value: 30, components: [] },
    passivePerception: { value: 13, components: [] },
    savingThrows: {},
    savingThrowProficiencies: ['dexterity', 'intelligence'],
    skills: [
      {
        id: 'investigation',
        label: 'Investigation',
        ability: 'intelligence',
        proficient: true,
        bonus: { value: 4, components: [] },
      },
      {
        id: 'stealth',
        label: 'Stealth',
        ability: 'dexterity',
        proficient: true,
        bonus: { value: 5, components: [] },
      },
      {
        id: 'perception',
        label: 'Perception',
        ability: 'wisdom',
        proficient: true,
        expertise: true,
        bonus: { value: 3, components: [] },
      },
    ],
    senses: [],
    proficiencies: [],
    languages: ['Common'],
    features: [],
    attacks: [],
  };
}

function mockTavernMap() {
  return {
    mapBundleId: 'map-tavern-m1-r1',
    title: 'Drowned Crow Tavern',
    sceneBanner: 'Warm tavern interior with torchlight and hearth glow',
    coordinateSpace: {
      columns: 12,
      rows: 8,
      feetPerSquare: 5,
    },
    cells: [],
    edges: [
      { edgeId: 'e:6:4:east', column: 6, row: 4, orientation: 'east', kind: 'door', doorState: 'closed' },
      { edgeId: 'e:6:3:east', column: 6, row: 3, orientation: 'east', kind: 'wall', doorState: null },
    ],
    tokens: [
      {
        tokenId: 'token-kaelen',
        seatId: 'seat-kaelen',
        label: 'Kaelen Vance',
        footprint: { anchor: { column: 1, row: 2 } },
      },
    ],
    notableFeatures: [
      { objectId: 'feat-counter', label: 'Service counter', column: 4, row: 4, referenceKind: 'prop', objectKind: 'container' },
      { objectId: 'feat-elira', label: 'Warden Elira', column: 2, row: 3, referenceKind: 'npc', objectKind: 'npc' },
      { objectId: 'feat-cellar', label: 'Cellar stairs', column: 9, row: 5, referenceKind: 'exit', objectKind: 'exit' },
    ],
    mapVersion: 1,
    viewerSeatId: 'seat-kaelen',
  };
}

test('DM Dispatcher [F26-01]: Counter movement with incidental door focus moves to counter, not door', async () => {
  const text = 'I walk up beside the service counter, keeping an eye on the closed east doorway.';
  
  // Mock LLM returning DM adjudication
  const mockLlm = {
    async generateText() {
      return JSON.stringify({
        actionType: 'move_feature',
        reasoning: 'Player intends to walk to the service counter; doorway is observational focus only.',
        moveFeature: {
          featureLabel: 'service counter',
        },
      });
    },
  };

  const dispatch = await queryDirectorMechanicsArbiter({
    rawText: text,
    sceneTitle: 'Drowned Crow Tavern',
    visibleFeatures: ['Service counter', 'Warden Elira'],
    doors: ['Wooden doorway east (closed)'],
    presentNpcs: ['Warden Elira'],
    knownNpcs: ['Warden Elira'],
    characterName: 'Kaelen Vance',
    characterClass: 'Rogue',
    characterLevel: 1,
    llm: mockLlm,
  });

  assert.ok(dispatch);
  assert.equal(dispatch.actionType, 'move_feature');
  assert.equal(dispatch.moveFeature?.featureLabel, 'service counter');

  const map = mockTavernMap();
  const applied = applyDirectorDispatchToMap({
    dispatch,
    map,
    seatedSheet: kaelenSheet(),
    knownNpcs: [{ id: 'npc-elira', label: 'Warden Elira' }],
  });

  assert.ok(applied);
  assert.equal(applied.proposedCommandType, 'table.move');
  assert.match(applied.summary, /Walk beside the Service counter/i);
  assert.ok(applied.path);
  assert.ok(applied.path.length > 0);
  // Door edge must never be set
  assert.equal(applied.edgeId, undefined);
});

test('DM Dispatcher [F26-02]: Adverbial dialogue phrase "in a low voice" does not treat "in" as an NPC', async () => {
  const text = 'I lean across the counter and ask in a low voice, "Who was the last patron seen entering the backroom with the masked courier?"';

  const mockLlm = {
    async generateText() {
      return JSON.stringify({
        actionType: 'dialogue',
        reasoning: 'Player speaks quietly across the counter to Warden Elira; "in a low voice" describes delivery, not an entity.',
        dialogue: {
          addressee: 'Warden Elira',
          topic: 'last patron seen entering the backroom with the masked courier',
        },
      });
    },
  };

  const dispatch = await queryDirectorMechanicsArbiter({
    rawText: text,
    sceneTitle: 'Drowned Crow Tavern',
    visibleFeatures: ['Service counter', 'Warden Elira'],
    doors: ['Wooden doorway east (closed)'],
    presentNpcs: ['Warden Elira'],
    knownNpcs: ['Warden Elira'],
    characterName: 'Kaelen Vance',
    llm: mockLlm,
  });

  assert.ok(dispatch);
  assert.equal(dispatch.actionType, 'dialogue');
  assert.notEqual(dispatch.dialogue?.addressee?.toLowerCase(), 'in');
  assert.equal(dispatch.dialogue?.addressee, 'Warden Elira');
});

test('DM Dispatcher [F26-03]: Sneak past Warden Elira triggers active Stealth DC 12 check with +5 modifier', async () => {
  const text = 'I try to sneak past Warden Elira without being noticed, using the shadows as cover.';

  const mockLlm = {
    async generateText() {
      return JSON.stringify({
        actionType: 'skill_check',
        reasoning: 'Sneaking past a watchful NPC in the room carries stakes and risk of discovery; DC 12 Stealth check required.',
        skillCheck: {
          skill: 'stealth',
          ability: 'dexterity',
          dc: 12,
          targetNoun: 'Warden Elira',
        },
      });
    },
  };

  const dispatch = await queryDirectorMechanicsArbiter({
    rawText: text,
    sceneTitle: 'Drowned Crow Tavern',
    visibleFeatures: ['Service counter', 'Warden Elira'],
    doors: ['Wooden doorway east (closed)'],
    presentNpcs: ['Warden Elira'],
    knownNpcs: ['Warden Elira'],
    characterName: 'Kaelen Vance',
    characterClass: 'Rogue',
    characterLevel: 1,
    llm: mockLlm,
  });

  assert.ok(dispatch);
  assert.equal(dispatch.actionType, 'skill_check');
  assert.equal(dispatch.skillCheck?.skill, 'stealth');
  assert.equal(dispatch.skillCheck?.dc, 12);

  const applied = applyDirectorDispatchToMap({
    dispatch,
    map: mockTavernMap(),
    seatedSheet: kaelenSheet(),
    knownNpcs: [{ id: 'npc-elira', label: 'Warden Elira' }],
  });

  assert.ok(applied);
  assert.equal(applied.proposedCommandType, 'table.sync');
  assert.match(applied.summary, /Ready to sneak past Warden Elira/i);
  assert.match(applied.summary, /Stealth proficient, \+5/i);
  assert.match(applied.summary, /DC 12/i);
});

test('DM Dispatcher [F26-04]: Return declaration triggers scene travel back to Drowned Crow Tavern', async () => {
  const text = 'I return up the cellar stairs to Drowned Crow Tavern.';

  const mockLlm = {
    async generateText() {
      return JSON.stringify({
        actionType: 'travel_scene',
        reasoning: 'Player is returning up the cellar stairs back to the previous tavern scene.',
        travelScene: {
          destinationHint: 'Drowned Crow Tavern',
          returnToPrevious: true,
        },
      });
    },
  };

  const dispatch = await queryDirectorMechanicsArbiter({
    rawText: text,
    sceneTitle: 'Drowned Crow Tavern — Side Passage',
    visibleFeatures: ['Cellar stairs'],
    doors: ['Wooden doorway north (closed)'],
    presentNpcs: [],
    knownNpcs: ['Warden Elira'],
    characterName: 'Kaelen Vance',
    llm: mockLlm,
  });

  assert.ok(dispatch);
  assert.equal(dispatch.actionType, 'travel_scene');
  assert.equal(dispatch.travelScene?.returnToPrevious, true);

  const applied = applyDirectorDispatchToMap({
    dispatch,
    map: mockTavernMap(),
    seatedSheet: kaelenSheet(),
    knownNpcs: [{ id: 'npc-elira', label: 'Warden Elira' }],
  });

  assert.ok(applied);
  assert.equal(applied.proposedCommandType, 'table.travel_scene');
  assert.equal(applied.returnToPrevious, true);
  assert.match(applied.summary, /Ready to return to Drowned Crow Tavern/i);
});

test('DM Dispatcher [F26-10]: Addressing absent NPC in another room explains in-fiction that they are out of earshot', async () => {
  const text = 'I ask Warden Elira, "Who followed the masked courier?"';

  const mockLlm = {
    async generateText() {
      return JSON.stringify({
        actionType: 'dialogue',
        reasoning: 'Player addresses Warden Elira, but she is located upstairs in the tavern and not present in this room.',
        dialogue: {
          addressee: 'Warden Elira',
          topic: 'who followed the masked courier',
        },
      });
    },
  };

  const dispatch = await queryDirectorMechanicsArbiter({
    rawText: text,
    sceneTitle: 'Drowned Crow Tavern — Side Passage',
    visibleFeatures: ['Cellar stairs'],
    doors: ['Wooden doorway north (closed)'],
    presentNpcs: [], // Elira is NOT in this room
    knownNpcs: ['Warden Elira'],
    characterName: 'Kaelen Vance',
    llm: mockLlm,
  });

  assert.ok(dispatch);
  assert.equal(dispatch.actionType, 'dialogue');

  const cellarMap = {
    ...mockTavernMap(),
    title: 'Drowned Crow Tavern — Side Passage',
    notableFeatures: [{ objectId: 'feat-cellar', label: 'Cellar stairs', column: 3, row: 4, referenceKind: 'exit', objectKind: 'exit' }],
  };

  const applied = applyDirectorDispatchToMap({
    dispatch,
    map: cellarMap,
    seatedSheet: kaelenSheet(),
    knownNpcs: [{ id: 'npc-elira', label: 'Warden Elira' }],
  });

  assert.ok(applied);
  assert.equal(applied.proposedCommandType, 'table.sync');
  assert.match(applied.summary, /Warden Elira is not in this room right now/i);
  assert.match(applied.summary, /out of earshot/i);
});

test('Codex Retest [F26-01, R26-03, F26-02, R26-02]: deterministic parsing and door/feature resolution honor exact retest declarations', async () => {
  const {
    parsePlayerDeclaration,
    resolveIntentAuthority,
    textRequestsLockPicking,
  } = await import('../../dist/shared/play-authority-contract.js');
  const {
    pathBesideFeature,
    resolveDoorIntentForMap,
    wantsBesideDoorIntent,
  } = await import('../../dist/server/table/scene-door-intent.js');
  const { buildNpcDialogueReply } = await import('../../dist/server/ai/director-gateway.js');

  // F26-01: Subordinate observation clause ("keeping an eye on the closed east doorway") must not hijack movement
  const f2601 = 'I walk up beside the service counter, keeping an eye on the closed east doorway.';
  const parsedF2601 = parsePlayerDeclaration(f2601, {
    knownNpcs: [{ id: 'npc-elira', label: 'Warden Elira' }],
  });
  const authF2601 = resolveIntentAuthority(parsedF2601);
  assert.equal(authF2601.disposition, 'propose_command');
  assert.equal(authF2601.actionSequence[0]?.kind, 'move');
  assert.notEqual(authF2601.actionSequence[0]?.outcomeHint, 'beside_door');
  // Even if token starts at (3,4) adjacent to (4,4), pathBesideFeature steps along the counter
  const mapAtSpawn = {
    ...mockTavernMap(),
    tokens: [
      {
        tokenId: 'token-kaelen',
        seatId: 'seat-kaelen',
        label: 'Kaelen Vance',
        footprint: { anchor: { column: 3, row: 4 } },
      },
    ],
  };
  const stepPath = pathBesideFeature({ column: 3, row: 4 }, { column: 4, row: 4 }, mapAtSpawn);
  assert.ok(stepPath && stepPath.length >= 1);

  // R26-03: Both negated beside-door movement prompts propose table.move without opening or crossing
  const r2603a = 'I move three squares east to stand beside the doorway without opening it.';
  const r2603b = 'I move east to the closed wooden doorway and stop beside it without crossing.';
  assert.equal(wantsBesideDoorIntent(r2603a), true);
  assert.equal(wantsBesideDoorIntent(r2603b), true);
  const doorResA = resolveDoorIntentForMap(mapAtSpawn, { column: 3, row: 4 }, r2603a);
  const doorResB = resolveDoorIntentForMap(mapAtSpawn, { column: 3, row: 4 }, r2603b);
  assert.ok(doorResA);
  assert.equal(doorResA.proposedCommandType, 'table.move');
  assert.doesNotMatch(doorResA.summary, /and open it/i);
  assert.ok(doorResB);
  assert.equal(doorResB.proposedCommandType, 'table.move');
  assert.doesNotMatch(doorResB.summary, /and open it/i);

  // F26-02: Delivery-phrase dialogue without naming NPC binds to present room NPC and ignores verbs inside quotes
  const f2602 =
    "I lean across the counter and ask in a low voice, 'Who was the last patron seen entering the backroom with the masked courier?'";
  const parsedF2602 = parsePlayerDeclaration(f2602, {
    knownNpcs: [{ id: 'npc-elira', label: 'Warden Elira' }],
    presentNpcs: [{ id: 'npc-elira', label: 'Warden Elira' }],
  });
  assert.equal(parsedF2602.addressee, 'Warden Elira');
  const authF2602 = resolveIntentAuthority(parsedF2602);
  assert.equal(authF2602.disposition, 'director_narrate_only');
  assert.equal(authF2602.actionSequence[0]?.kind, 'dialogue');
  const replyF2602 = buildNpcDialogueReply({
    npc: {
      name: 'Warden Elira',
      role: 'contact',
      motive: 'find courier',
      knowledge: 'The masked courier slipped down the cellar stairs.',
    },
    playerText: f2602,
    mapTitle: 'Drowned Crow Tavern',
  });
  assert.match(replyF2602, /Warden Elira:/);
  assert.match(replyF2602, /masked courier|passages beyond/i);

  // R26-02: Negated lock clause on chest Investigation does not trigger lock-picking
  const r2602 = 'Quietly, I investigate the sturdy oak chest for clues without opening or unlocking it.';
  assert.equal(textRequestsLockPicking(r2602), false);
  const parsedR2602 = parsePlayerDeclaration(r2602, {
    knownNpcs: [{ id: 'npc-elira', label: 'Warden Elira' }],
  });
  assert.equal(parsedR2602.addressee, null);
  const authR2602 = resolveIntentAuthority(parsedR2602);
  assert.equal(authR2602.disposition, 'propose_command');
  assert.equal(authR2602.actionSequence[0]?.kind, 'inspect');
  assert.equal(authR2602.actionSequence[0]?.outcomeHint, 'investigate_mark');
});

test('Packet 4: applyDirectorDispatchToMap enforces orthogonal door adjacency and attaches structured skillCheckIntent', () => {
  const mapDiagonal = {
    ...mockTavernMap(),
    tokens: [
      {
        tokenId: 'token-kaelen',
        seatId: 'seat-kaelen',
        label: 'Kaelen Vance',
        // (5, 3) is diagonally offset from door at (6, 4) east — NOT orthogonally adjacent to the door edge!
        footprint: { anchor: { column: 5, row: 3 } },
      },
    ],
  };

  const lockDispatch = {
    actionType: 'skill_check',
    skillCheck: {
      skill: 'sleight_of_hand',
      ability: 'dexterity',
      dc: 13,
      targetNoun: 'locked east doorway',
    },
  };

  const blocked = applyDirectorDispatchToMap({
    dispatch: lockDispatch,
    map: mapDiagonal,
    seatedSheet: kaelenSheet(),
    knownNpcs: [],
  });
  assert.ok(blocked);
  assert.match(blocked.summary, /Move your token next to the doorway/i);
  assert.equal(blocked.skillCheckIntent, undefined);

  // Now move token to (6, 4) — orthogonally adjacent to e:6:4:east
  const mapAdjacent = {
    ...mockTavernMap(),
    tokens: [
      {
        tokenId: 'token-kaelen',
        seatId: 'seat-kaelen',
        label: 'Kaelen Vance',
        footprint: { anchor: { column: 6, row: 4 } },
      },
    ],
  };
  const allowed = applyDirectorDispatchToMap({
    dispatch: lockDispatch,
    map: mapAdjacent,
    seatedSheet: kaelenSheet(),
    knownNpcs: [],
  });
  assert.ok(allowed);
  assert.ok(allowed.skillCheckIntent);
  assert.equal(allowed.skillCheckIntent.targetKind, 'door');
  assert.equal(allowed.skillCheckIntent.targetId, 'e:6:4:east');
  assert.equal(allowed.skillCheckIntent.onSuccessMutation, 'unlock_door');
});

