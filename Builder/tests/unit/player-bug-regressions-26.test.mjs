import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parsePlayerDeclaration,
  resolveIntentAuthority,
} from '../../dist/shared/play-authority-contract.js';
import {
  resolveDoorIntentForMap,
  wantsBesideDoorIntent,
} from '../../dist/server/table/scene-door-intent.js';
import {
  buildSkillCheckDraftSummary,
  resolveSkillAttemptFromSummary,
} from '../../dist/server/table/skill-check-resolve.js';
import { buildResolvedActionReceipt } from '../../dist/shared/resolved-action-receipt.js';
import { buildCampaignBlueprint } from '../../dist/server/campaigns/campaign-blueprint.js';

function kaelenSheet() {
  return {
    characterId: 'char-kaelen',
    level: 1,
    skills: [
      {
        id: 'investigation',
        label: 'Investigation',
        ability: 'intelligence',
        proficient: true,
        expertise: false,
        bonus: { value: 4, components: [] },
      },
      {
        id: 'stealth',
        label: 'Stealth',
        ability: 'dexterity',
        proficient: true,
        expertise: false,
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
      {
        id: 'sleight-of-hand',
        label: 'Sleight of Hand',
        ability: 'dexterity',
        proficient: true,
        expertise: true,
        bonus: { value: 7, components: [] },
      },
    ],
    abilityModifiers: {
      strength: 0,
      dexterity: 3,
      constitution: 1,
      intelligence: 2,
      wisdom: -1,
      charisma: 0,
    },
    equipment: [
      { name: 'Studded Leather Armor' },
      { name: 'Dagger' },
      { name: "Thieves' Tools" },
    ],
  };
}

function mockTavernMap(options = {}) {
  const tokenColumn = options.tokenColumn ?? 3;
  const tokenRow = options.tokenRow ?? 4;
  return {
    mapBundleId: 'map-tavern-m1-r1',
    title: 'Drowned Crow Tavern',
    sceneBanner: 'Warm tavern interior',
    coordinateSpace: {
      columns: 12,
      rows: 8,
      feetPerSquare: 5,
    },
    cells: [],
    edges: [
      // Dividing wall at column 6 with closed east door at row 4
      { edgeId: 'e:6:4:east', column: 6, row: 4, orientation: 'east', kind: 'door', doorState: options.doorState ?? 'closed' },
      { edgeId: 'e:6:3:east', column: 6, row: 3, orientation: 'east', kind: 'wall', doorState: null },
      { edgeId: 'e:6:5:east', column: 6, row: 5, orientation: 'east', kind: 'wall', doorState: null },
    ],
    tokens: [
      {
        tokenId: 'token-kaelen',
        seatId: 'seat-kaelen',
        label: 'Kaelen Vance',
        footprint: { anchor: { column: tokenColumn, row: tokenRow } },
      },
    ],
    notableFeatures: [
      { objectId: 'feat-counter', label: 'Service counter', column: 4, row: 4, referenceKind: 'prop', objectKind: 'container' },
      { objectId: 'feat-lamp', label: 'Hearth lamp', column: 2, row: 2, referenceKind: 'prop', objectKind: 'prop' },
      { objectId: 'feat-elira', label: 'Warden Elira', column: 2, row: 3, referenceKind: 'npc', objectKind: 'npc' },
      { objectId: 'feat-cellar', label: 'Cellar stairs', column: 9, row: 5, referenceKind: 'exit', objectKind: 'exit' },
    ],
    mapVersion: 1,
    viewerSeatId: 'seat-kaelen',
  };
}

test('F26-01: Counter movement with door mention does not hijack movement to the door', () => {
  const text = 'I walk up beside the service counter, keeping an eye on the closed east doorway.';
  
  // 1. wantsBesideDoorIntent should NOT bind to doorway when the preposition was for counter
  assert.equal(wantsBesideDoorIntent(text), false);

  // 2. Parsed declaration should be general movement, NOT beside_door hint
  const parsed = parsePlayerDeclaration(text);
  assert.equal(parsed.actionSequence[0]?.kind, 'move');
  assert.notEqual(parsed.actionSequence[0]?.outcomeHint, 'beside_door');

  // 3. Door resolver must not claim a door approach path
  const map = mockTavernMap({ tokenColumn: 3, tokenRow: 4 });
  const doorRes = resolveDoorIntentForMap(map, { column: 3, row: 4 }, text);
  assert.equal(doorRes, null);
});

test('F26-01: Standing beside closed door when declaring counter movement must NOT open the door', () => {
  const text = 'I walk up beside the service counter.';
  
  // Token is at column 6, row 4 (directly adjacent to closed door at edge e:6:4:east)
  const map = mockTavernMap({ tokenColumn: 6, tokenRow: 4 });
  const doorRes = resolveDoorIntentForMap(map, { column: 6, row: 4 }, text);

  // Must NOT propose table.open_door!
  if (doorRes !== null) {
    assert.notEqual(doorRes.proposedCommandType, 'table.open_door');
  }
});

test('F26-02: Preposition phrase "in a low voice" does not promote "in" to an NPC', () => {
  const text = 'I lean across the counter and ask in a low voice, "Who was the last patron seen entering the backroom with the masked courier?"';
  const parsed = parsePlayerDeclaration(text);

  // Addressee must be null, never "in"
  assert.notEqual(parsed.addressee?.toLowerCase(), 'in');
  assert.equal(parsed.addressee, null);

  const auth = resolveIntentAuthority(parsed);
  // Must NOT clarify with "in is not an established NPC"
  assert.notEqual(auth.clarificationPrompt?.includes('in is not an established NPC'), true);
  // It is ordinary room speech / question
  assert.equal(auth.disposition, 'director_narrate_only');
});

test('F26-10: Multi-word NPC "Warden Elira" is matched completely, not truncated to "Warden"', () => {
  const knownNpcs = [{ id: 'npc-elira', label: 'Warden Elira' }];
  const text = 'I ask Warden Elira, "Who followed the masked courier?"';
  const parsed = parsePlayerDeclaration(text, { knownNpcs });

  assert.equal(parsed.addressee, 'Warden Elira');
  const auth = resolveIntentAuthority(parsed);
  assert.equal(auth.disposition, 'director_narrate_only');
  assert.equal(auth.actionSequence[0]?.kind, 'dialogue');
  assert.equal(auth.actionSequence[0]?.targetRef, 'Warden Elira');
});

test('F26-10: Addressing known NPC by single name "Elira" resolves canonical "Warden Elira"', () => {
  const knownNpcs = [{ id: 'npc-elira', label: 'Warden Elira' }];
  const text = 'I ask Elira, "Who followed the masked courier?"';
  const parsed = parsePlayerDeclaration(text, { knownNpcs });

  assert.equal(parsed.addressee, 'Warden Elira');
});

test('F26-03: Sneak declaration produces confirmable Stealth draft with +5 modifier and DC 12', () => {
  const text = 'I try to sneak past Warden Elira without being noticed, using the shadows as cover.';
  const parsed = parsePlayerDeclaration(text);

  assert.ok(parsed.actionSequence.length > 0);
  assert.equal(parsed.actionSequence[0]?.kind, 'inspect');
  assert.equal(parsed.actionSequence[0]?.outcomeHint, 'stealth_hide');

  const sheet = kaelenSheet();
  const draftSummary = buildSkillCheckDraftSummary(sheet, text);
  assert.match(draftSummary, /Ready to sneak/i);
  assert.match(draftSummary, /Stealth proficient, \+5/i);
  assert.match(draftSummary, /DC 12/i);

  // Resolving the draft rolls Stealth and returns formatted receipt
  const resolved = resolveSkillAttemptFromSummary(sheet, draftSummary);
  assert.ok(resolved);
  assert.ok(resolved.rolls.length > 0);
  assert.match(resolved.summary, /Stealth check to sneak past/i);
  assert.match(resolved.summary, /\+5 =/i);
  assert.match(resolved.summary, /vs DC 12/i);
});

test('F26-03: Explicit hide produces confirmable Stealth draft', () => {
  const text = 'I hide in the shadows beside the cellar stairs and listen without being seen.';
  const sheet = kaelenSheet();
  const draftSummary = buildSkillCheckDraftSummary(sheet, text);

  assert.match(draftSummary, /Ready to hide/i);
  assert.match(draftSummary, /Stealth proficient, \+5/i);
  assert.match(draftSummary, /DC 12/i);
});

test('F26-04: Return route declarations are recognized as travel/movement, not rejected', () => {
  const text1 = 'I return up the cellar stairs to Drowned Crow Tavern.';
  const parsed1 = parsePlayerDeclaration(text1);
  // Must NOT have 0 actions and fall into verb rejection
  assert.ok(parsed1.actionSequence.length > 0);
  assert.equal(parsed1.actionSequence[0]?.kind, 'move');

  const text2 = 'I move through the passage back to Drowned Crow Tavern.';
  const parsed2 = parsePlayerDeclaration(text2);
  assert.ok(parsed2.actionSequence.length > 0);
  assert.equal(parsed2.actionSequence[0]?.kind, 'move');
});

test('F26-04: Door crossing receipt does not contain fourth-wall "No authored destination"', () => {
  const receipt = buildResolvedActionReceipt({
    commandType: 'table.move',
    declaration: 'I step through the east doorway to Drowned Crow Tavern.',
    targetLabel: 'Wooden doorway east — open',
    targetKind: 'door',
    mutations: [],
    doorStatesAfter: { 'e:6:4:east': 'open' },
    openCross: true,
    sceneTitle: 'Drowned Crow Tavern — Side Passage',
  });

  assert.doesNotMatch(receipt.narrationSeed, /No authored destination beyond this threshold/i);
  assert.match(receipt.narrationSeed, /passage ahead continues/i);
});

test('F26-04: Campaign blueprint room 2 exit direction aligns east to return to room 1', () => {
  const blueprint = buildCampaignBlueprint(
    'The Drowned Crow Tavern sits on rotting piers above the tidal marshes of Blackwater Reach.',
  );
  const milestone1 = blueprint.milestones?.[0];
  assert.ok(milestone1);
  const room2 = milestone1.rooms?.[1];
  assert.ok(room2);
  const backExit = room2.exits.find((e) => e.targetSceneId === 'scene-m1-r1');
  assert.ok(backExit);
  assert.equal(backExit.direction, 'east');
});

test('FRESH-09: Inspecting eastern passage for clues left by the courier targets eastern passage, never courier', () => {
  const sheet = kaelenSheet();
  const text = 'I inspect the eastern passage for hidden exits and clues left by the courier.';
  const draftSummary = buildSkillCheckDraftSummary(sheet, text);
  assert.match(draftSummary, /Ready to inspect the eastern passage/i);
  assert.doesNotMatch(draftSummary, /inspect the courier/i);
});

test('FRESH-05 & FRESH-11: Saltmark Tavern premise extracts Marta Vane, both props without contested prefix, and indoor templates', () => {
  const premise =
    'In the fog-shrouded harbor town of Saltmere, a missing courier was last seen entering the Saltmark Tavern carrying a brass cypher and an iron key. The party meets informant Marta Vane inside the tavern to trace the vanished courier into the flooded under-wharf vaults.';
  const bp = buildCampaignBlueprint({
    summary: premise,
    name: 'Shadows of Saltmere',
    startLevel: 1,
    targetEndLevel: 3,
    campaignTone: 'mystery_intrigue',
  });
  assert.ok(bp.namedProps.some((p) => /brass cypher/i.test(p)));
  assert.ok(bp.namedProps.some((p) => /iron key/i.test(p)));
  for (const act of bp.acts) {
    assert.doesNotMatch(act.title, /Levels 3–3/i);
    assert.doesNotMatch(act.currentActGoal, /contested iron key/i);
  }
  const m1 = bp.milestones?.[0];
  assert.ok(m1);
  assert.equal(m1.rooms[0]?.npcs[0]?.name, 'Marta Vane');
  assert.equal(m1.rooms[0]?.templateId, 'interior_inn_common');
  assert.equal(m1.rooms[1]?.templateId, 'interior_stone_crypt');
});
