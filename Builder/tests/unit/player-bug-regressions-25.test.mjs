import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCampaignBlueprint,
  extractPremiseEntities,
  ARCHITECTURAL_ROOM_NOUNS,
} from '../../dist/server/campaigns/campaign-blueprint.js';
import {
  buildSkillCheckDraftSummary,
  resolveSkillAttemptFromSummary,
  namedInspectTargetFromDraft,
} from '../../dist/server/table/skill-check-resolve.js';
import {
  scrubInventedContainerContents,
  scrubClosedDoorCalledOpen,
} from '../../dist/server/ai/director-gateway.js';
import { formatMap } from '../../dist/server/ai/director-context.js';
import { buildRulesCatalog } from '../../dist/server/rules/rules-catalog.js';
import { combineStartingEquipment } from '../../dist/server/rules/character-rules.js';
import { findClass, findBackground } from '../../dist/server/rules/srd-manifest.js';

function stubSheet(options = {}) {
  return {
    skills: [
      {
        id: 'investigation',
        label: 'Investigation',
        ability: 'intelligence',
        proficient: true,
        expertise: true,
        bonus: { value: 6, components: [] },
      },
      {
        id: 'stealth',
        label: 'Stealth',
        ability: 'dexterity',
        proficient: true,
        expertise: true,
        bonus: { value: 7, components: [] },
      },
      {
        id: 'sleight-of-hand',
        label: 'Sleight of Hand',
        ability: 'dexterity',
        proficient: true,
        bonus: { value: 5, components: [] },
      },
    ],
    abilityModifiers: {
      strength: 0,
      dexterity: 3,
      constitution: 1,
      intelligence: 2,
      wisdom: 1,
      charisma: 0,
    },
    equipment: options.tools
      ? [{ name: 'Thieves’ Tools', quantity: 1, equipped: true }]
      : [],
    proficiencies: [],
  };
}

test('HD18-01: Forge keeps person Mira Vale as NPC and Riverside Mill as location', () => {
  const premise =
    'In Brindlefen village, courier Mira Vale vanished with a copper bell. Nim arrives at the riverside mill to find Mira alive and recover the bell. The miller Orin is waiting at the entrance.';
  const blueprint = buildCampaignBlueprint({
    summary: premise,
    name: 'The Copper Bell Mystery',
    startLevel: 1,
    targetEndLevel: 3,
  });

  assert.ok(blueprint.namedNpcs.some((npc) => /Mira Vale/i.test(npc)));
  assert.ok(blueprint.namedPlaces.some((place) => /Mill|Brindlefen/i.test(place)));
  // Room titles must not name the missing person as a building
  for (const m of blueprint.milestones ?? []) {
    for (const r of m.rooms ?? []) {
      assert.doesNotMatch(r.title, /^Mira Vale$/i);
    }
  }
});

test('HD18-02: Specific quest prop "copper bell" is preserved in hook and blueprint props', () => {
  const premise =
    'In Brindlefen village, courier Mira Vale vanished with a copper bell. Nim arrives at the riverside mill to find Mira alive and recover the bell.';
  const blueprint = buildCampaignBlueprint({
    summary: premise,
    name: 'The Copper Bell Mystery',
    startLevel: 1,
    targetEndLevel: 3,
  });

  assert.ok(blueprint.namedProps.some((prop) => /copper bell/i.test(prop)));
  assert.match(blueprint.questHook ?? '', /copper bell/i);
});

test('HD18-03: Explicitly present opening contact miller Orin is selected as local contact, missing courier Mira Vale is climax rescue objective', () => {
  const premise =
    'In Brindlefen village, courier Mira Vale vanished with a copper bell. Nim arrives at the riverside mill to find Mira alive and recover the bell. The miller Orin is waiting at the entrance.';
  const blueprint = buildCampaignBlueprint({
    summary: 'A nonlethal mystery in Brindlefen. Question miller Orin, find missing courier Mira Vale alive.',
    premise,
    name: 'The Copper Bell Mystery',
    startLevel: 1,
    targetEndLevel: 3,
  });

  assert.ok(blueprint.namedNpcs.includes('Orin') || blueprint.namedNpcs.some((n) => /Orin/i.test(n)));
  const openingRoom = blueprint.milestones?.[0]?.rooms?.[0];
  assert.ok(openingRoom?.npcs.some((npc) => /Orin/i.test(npc.name)));
  // Missing courier Mira Vale must NOT be waiting at the entrance
  assert.ok(!openingRoom?.npcs.some((npc) => /Mira Vale/i.test(npc.name)));
  // Climax room must contain Mira Vale as rescue objective
  const climaxRoom = blueprint.milestones?.[0]?.rooms?.[2];
  assert.ok(climaxRoom?.npcs.some((npc) => /Mira Vale/i.test(npc.name)));
  assert.match(blueprint.milestones?.[0]?.climaxObjective ?? '', /Mira Vale/i);
});

test('HD18-04: Distinct room identities across milestones', () => {
  const blueprint = buildCampaignBlueprint({
    summary: 'Search the riverside mill and recover the stolen copper bell.',
    name: 'The Copper Bell Mystery',
    startLevel: 1,
    targetEndLevel: 3,
  });

  const m1 = blueprint.milestones?.[0];
  const m2 = blueprint.milestones?.[1];
  assert.ok(m1 && m2);
  const m1RoomTitles = m1.rooms.map((r) => r.title);
  const m2RoomTitles = m2.rooms.map((r) => r.title);

  // Milestone 1 and 2 room titles must not be completely identical
  assert.notDeepEqual(m1RoomTitles, m2RoomTitles);
});

test('HD18-05: Generated NPCs never ship with numbered placeholder names like Informant #2', () => {
  const blueprint = buildCampaignBlueprint({
    summary: 'Search the riverside mill and recover the stolen copper bell.',
    name: 'The Copper Bell Mystery',
    startLevel: 1,
    targetEndLevel: 3,
  });

  for (const m of blueprint.milestones ?? []) {
    for (const r of m.rooms ?? []) {
      for (const npc of r.npcs ?? []) {
        assert.doesNotMatch(npc.name, /#\d+/);
        assert.doesNotMatch(npc.role, /#\d+/);
      }
    }
  }
});

test('HD18-10: Director-recommended Investigation on mark drafts and resolves check', () => {
  const sheet = stubSheet();
  const draft = buildSkillCheckDraftSummary(
    sheet,
    'I investigate the Mira Vale mark for clues using Investigation.',
  );
  assert.match(draft, /Ready to inspect the Mira Vale mark \(Investigation proficient, \+6; DC 13\)/i);
  assert.match(draft, /Confirm to roll the check on the table/i);

  const resolved = resolveSkillAttemptFromSummary(sheet, draft);
  assert.ok(resolved);
  assert.match(resolved.summary, /Investigation on the Mira Vale mark \(Investigation \+6\): d20 \d+ \+6 = \d+ vs DC 13/i);
  assert.equal(resolved.rolls.length, 1);
});

test('HD18-10: Approach + Investigation declaration drafts and resolves Investigation check', () => {
  const sheet = stubSheet();
  const draft = buildSkillCheckDraftSummary(
    sheet,
    'I approach the Mira Vale mark to closely inspect its carvings and details, using my Investigation.',
  );
  assert.match(draft, /Ready to inspect the Mira Vale mark \(Investigation proficient, \+6; DC 13\)/i);
  assert.match(draft, /Confirm to roll the check on the table/i);

  const resolved = resolveSkillAttemptFromSummary(sheet, draft);
  assert.ok(resolved);
  assert.match(resolved.summary, /Investigation on the Mira Vale mark \(Investigation \+6\): d20 \d+ \+6 = \d+ vs DC 13/i);
  assert.equal(resolved.rolls.length, 1);
});

test('HD18-11: Workbench search drafts and resolves Search check without circular loop', () => {
  const sheet = stubSheet();
  const draft = buildSkillCheckDraftSummary(
    sheet,
    'I search the workbench for a note, tool marks, or a clue about Mira and the bell.',
  );
  assert.match(draft, /Ready to search the workbench \(Investigation proficient, \+6; DC 13\)/i);

  const resolved = resolveSkillAttemptFromSummary(sheet, draft);
  assert.ok(resolved);
  assert.match(resolved.summary, /Search on the workbench \(Investigation \+6\): d20 \d+ \+6 = \d+ vs DC 13/i);
});

test('HD18-12: Satchel narration scrubber replaces hallucinated loot with honest empty interior', () => {
  const rawProse = 'Nim opens the satchel. He takes in its contents and sees what the courier left behind.';
  const mechanicsSummary = 'Nim opened the Courier satchel.';
  const scrubbed = scrubInventedContainerContents(rawProse, mechanicsSummary);
  assert.doesNotMatch(scrubbed, /takes in its contents/i);
  assert.doesNotMatch(scrubbed, /left behind/i);
  assert.match(scrubbed, /empty interior/i);
});

test('HD18-18: Architectural room nouns like Side Passage are never treated as present NPCs', () => {
  assert.ok(ARCHITECTURAL_ROOM_NOUNS.has('side passage'));
  assert.ok(ARCHITECTURAL_ROOM_NOUNS.has('passage'));
  assert.ok(ARCHITECTURAL_ROOM_NOUNS.has('sanctum'));

  const entities = extractPremiseEntities('Side Passage — A shadowy passage littered with crates.');
  assert.doesNotMatch(entities.npcs.join('; '), /Side Passage/i);
});

test('HD18-19: Closed door scrubber replaces open door references with closed', () => {
  const rawProse = 'Before you stands an open wooden door leading onward.';
  const mechanicsSummary = 'Wooden doorway east — closed, unlocked.';
  const scrubbed = scrubClosedDoorCalledOpen(rawProse, mechanicsSummary);
  assert.doesNotMatch(scrubbed, /an open wooden door/i);
  assert.match(scrubbed, /a closed wooden door/i);
});

test('HD18-20: Mapped exits do not duplicate door edges and exit features in visible features', () => {
  const mapProjection = {
    title: 'Side Passage',
    sceneBanner: 'Quiet side passage',
    viewerSeatId: 'seat-1',
    visibleSquareIds: ['0,0', '1,0'],
    exploredSquareIds: ['0,0', '1,0'],
    tokens: [{ seatId: 'seat-1', column: 0, row: 0 }],
    edges: [
      {
        id: 'door-north',
        column: 4,
        row: 0,
        orientation: 'north',
        kind: 'door',
        doorState: 'closed',
      },
      {
        id: 'door-east',
        column: 7,
        row: 4,
        orientation: 'east',
        kind: 'door',
        doorState: 'open',
      },
    ],
    notableFeatures: [
      {
        objectId: 'obj-1:exit',
        label: 'Sanctum archway (wooden doorway north)',
        referenceKind: 'exit',
        objectKind: 'exit',
        column: 4,
        row: 0,
      },
      {
        objectId: 'obj-2',
        label: 'Courier satchel',
        referenceKind: 'container',
        objectKind: 'prop',
        column: 2,
        row: 2,
      },
    ],
  };

  const formatted = formatMap(mapProjection);
  // Visible features must NOT list Sanctum archway or exit
  assert.match(formatted, /Visible features: Courier satchel/);
  assert.doesNotMatch(formatted, /Visible features:.*Sanctum archway/i);
  // Doors / Exits known lists the aliased doorway once
  assert.match(formatted, /Doors \/ Exits known.*Sanctum archway \(wooden doorway north\) — closed/i);
  assert.match(formatted, /Wooden doorway east — open/i);
});

test('HD18-22: Rules catalog contains Sneak Attack for Rogue class', () => {
  const catalog = buildRulesCatalog();
  const rogueEntry = catalog.entries.find((e) => e.entryId === 'class:rogue');
  assert.ok(rogueEntry);
  assert.match(rogueEntry.details.join(' '), /Sneak Attack/i);

  const sneakAttackEntry = catalog.entries.find(
    (e) => e.entryId.includes('sneak-attack') || e.title.includes('Sneak Attack'),
  );
  assert.ok(sneakAttackEntry, 'Sneak Attack should have a dedicated catalog entry');
  assert.match(sneakAttackEntry.title, /Sneak Attack/i);
});

test('HD18-23: Standalone Hide declaration drafts and resolves Stealth check', () => {
  const sheet = stubSheet();
  const draft = buildSkillCheckDraftSummary(
    sheet,
    'I hide behind the workbench.',
  );
  assert.match(draft, /Ready to hide behind the workbench \(Stealth proficient, \+7; DC 12\)/i);
  assert.match(draft, /Confirm to roll the check on the table/i);

  const resolved = resolveSkillAttemptFromSummary(sheet, draft);
  assert.ok(resolved);
  assert.match(resolved.summary, /Stealth check to hide behind the workbench \(Stealth \+7\): d20 \d+ \+7 = \d+ vs DC 12/i);
  assert.equal(resolved.rolls.length, 1);
});

test('HD18-25: Starting equipment marks armor as equipped by default', () => {
  const rogue = findClass('rogue');
  const criminal = findBackground('criminal');
  assert.ok(rogue);
  assert.ok(criminal);
  const { equipment } = combineStartingEquipment(
    rogue.equipmentOptions[0] ?? null,
    criminal.equipmentOptions[0] ?? null,
  );

  const leatherArmor = equipment.find((item) => /leather armor/i.test(item.name));
  assert.ok(leatherArmor, 'Leather armor should be in rogue starting equipment');
  assert.equal(leatherArmor.equipped, true, 'Armor should be equipped: true by default so AC matches equipment state');
});
