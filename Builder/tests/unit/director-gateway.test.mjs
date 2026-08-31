import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AiDirectorUnavailableError,
  answerDirectorAddress,
  buildNpcDialogueReply,
  buildPresenceDeclineNarration,
  buildSceneSurveyNarration,
  interpretNaturalLanguageIntent,
  narrateVisibleBeat,
  PROVIDER_COMPLIANCE_REGISTRY,
} from '../../dist/server/ai/director-gateway.js';
import { scrubPlayerFacingIntentCopy } from '../../dist/shared/ai-director-contract.js';
import { formatDirectorProse } from '../../dist/shared/communication-contract.js';
import {
  GEMINI_DIRECTOR_MAX_OUTPUT_TOKENS,
  sanitizeDirectorProse,
} from '../../dist/server/ai/gemini-director.js';

test('PQA-141: scrub strips internal command identifiers from player-facing copy', () => {
  assert.equal(
    scrubPlayerFacingIntentCopy('Confirm table.open_door with edgeId now.'),
    'Confirm that action with door now.',
  );
  assert.doesNotMatch(scrubPlayerFacingIntentCopy('table.move ready'), /table\.move/i);
});

function fakeFirestore(options = { killSwitch: false }) {
  return {
    collection(name) {
      const collectionApi = {
        doc() {
          return {
            async get() {
              if (name === 'campaigns') {
                return {
                  exists: true,
                  data: () => ({
                    directorIdentity: 'veyra',
                    directorPersonality: 'seasoned_host',
                    directorAvatarKey: 'veyra:seasoned_host',
                  }),
                };
              }
              if (name === 'adminAuditEvents') {
                return {
                  exists: options.killSwitch,
                  data: () => ({ enabled: options.killSwitch }),
                };
              }
              return { exists: false, data: () => undefined };
            },
            async set() {
              return undefined;
            },
          };
        },
        where() {
          return {
            limit() {
              return {
                async get() {
                  return { empty: true, docs: [] };
                },
              };
            },
          };
        },
      };
      return collectionApi;
    },
  };
}

test('sanitizeDirectorProse strips fences and caps length', () => {
  assert.equal(sanitizeDirectorProse('Hello   table.'), 'Hello table.');
  const long = 'a'.repeat(1300);
  const capped = sanitizeDirectorProse(long);
  assert.equal(capped.endsWith('…'), true);
  assert.ok(capped.length <= 1200);
  assert.throws(() => sanitizeDirectorProse('   '));
});

test('scrubIncompleteDirectorProse drops dangling without. truncation', async () => {
  const { looksLikeTruncatedDirectorProse, scrubIncompleteDirectorProse } = await import(
    '../../dist/server/ai/gemini-director.js',
  );
  const truncated =
    'You step smoothly through the open doorway, crossing the threshold without.';
  assert.equal(looksLikeTruncatedDirectorProse(truncated), true);
  const scrubbed = scrubIncompleteDirectorProse(truncated);
  assert.doesNotMatch(scrubbed, /\bwithout\.?\s*$/i);
  assert.match(
    scrubIncompleteDirectorProse(
      'You cross the open doorway. Crossing the threshold without.',
    ),
    /^You cross the open doorway\.$/,
  );
});

test('Gemini Director output budget leaves room for thinking plus prose', () => {
  // Gemini 3.x counts thinking tokens against maxOutputTokens; 400 truncates mid-sentence.
  assert.ok(GEMINI_DIRECTOR_MAX_OUTPUT_TOKENS >= 2048);
});

test('provider registry lists Gemini for hosted Milestone', () => {
  const gemini = PROVIDER_COMPLIANCE_REGISTRY.find((entry) => entry.providerId === 'gemini_agent_platform');
  assert.ok(gemini);
  assert.equal(gemini.category, 'ai_text');
  assert.equal(gemini.milestone, 'configured_provider');
});

test('Local Arena Director Address stays on the simulator', async () => {
  const answered = await answerDirectorAddress({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'What do I see in this room?',
    environmentClass: 'local',
    llm: {
      async generateText() {
        return 'LIVE GEMINI SHOULD NOT RUN';
      },
    },
  });
  assert.equal(answered.mutatesState, false);
  assert.equal(answered.directorIdentityLabel, 'Veyra');
  assert.equal(answered.consultMode, 'scene');
  assert.match(answered.body, /visible scene|play channel|Veyra/i);
  assert.equal(answered.body.includes('LIVE GEMINI'), false);
});

test('Ask the DM arbiter mode engages for feasibility questions', async () => {
  const answered = await answerDirectorAddress({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'Can I climb that wall and cast Magic Missile in the same turn?',
    environmentClass: 'local',
  });
  assert.equal(answered.mutatesState, false);
  assert.equal(answered.consultMode, 'arbiter');
  assert.equal(answered.manifest.role, 'bounded_ruling');
  assert.match(answered.body, /Veyra|sheet|play channel/i);
});

test('Milestone Director Address uses the live client and still cannot mutate', async () => {
  const answered = await answerDirectorAddress({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'What do I see in this room?',
    environmentClass: 'milestone',
    firebaseProjectId: 'hd-a3-staging',
    llm: {
      async generateText() {
        return 'Veyra studies the doorway. Nothing on the table moves.';
      },
    },
  });
  assert.equal(answered.mutatesState, false);
  assert.equal(answered.body, 'Veyra studies the doorway. Nothing on the table moves.');
  assert.equal(answered.directorIdentityLabel, 'Veyra');
});

test('Gemini failure falls back to the simulator for narration', async () => {
  const narration = await narrateVisibleBeat({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    mechanicsSummary: 'You hit the dummy for 4 damage.',
    environmentClass: 'milestone',
    firebaseProjectId: 'hd-a3-staging',
    llm: {
      async generateText() {
        throw new Error('quota');
      },
    },
  });
  assert.equal(narration.fallbackUsed, true);
  assert.match(narration.body, /You hit the dummy for 4 damage/);
  assert.equal(narration.mechanicsFirstSummary, 'You hit the dummy for 4 damage.');
  assert.equal(narration.directorIdentityLabel, 'Veyra');
});

test('PQA-162: formatDirectorProse strips Markdown punctuation', () => {
  assert.equal(
    formatDirectorProse('Use **Guidance** before you `declare` it.'),
    'Use Guidance before you declare it.',
  );
  assert.equal(formatDirectorProse('***Bold italic*** line'), 'Bold italic line');
});

test('PQA-152/153: trap/lock declarations produce confirmable skill-check sync drafts', async () => {
  const trapLock = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I carefully inspect the doorway for traps, then pick the lock with my thieves tools.',
    environmentClass: 'local',
  });
  assert.equal(trapLock.proposedCommandType, 'table.sync');
  assert.match(trapLock.summary, /^Ready to /i);
  assert.match(trapLock.summary, /Confirm to roll/i);
  assert.equal(trapLock.edgeId, undefined);
  assert.equal(trapLock.path, undefined);

  const lockOnly = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I try to pick the lock on the wooden door.',
    environmentClass: 'local',
  });
  assert.equal(lockOnly.proposedCommandType, 'table.sync');
  assert.match(lockOnly.summary, /^Ready to /i);
});

test('PQA-184: movement drafts use scene language, not column/row', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I walk to the marked square',
    moveTarget: { column: 3, row: 4 },
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'table.move');
  assert.deepEqual(interpreted.path, [{ column: 3, row: 4 }]);
  assert.match(interpreted.summary, /marked destination|Confirm to commit/i);
  assert.doesNotMatch(interpreted.summary, /column\s+\d+|row\s+\d+/i);
});

test('hosted NL interpret keeps deterministic command types', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I walk to the marked square',
    moveTarget: { column: 3, row: 4 },
    environmentClass: 'milestone',
    firebaseProjectId: 'hd-a3-staging',
    llm: {
      async generateText() {
        return 'Draft: you step to column 3, row 4. Confirm to move.';
      },
    },
  });
  assert.equal(interpreted.proposedCommandType, 'table.move');
  assert.deepEqual(interpreted.path, [{ column: 3, row: 4 }]);
  assert.equal(interpreted.interceptState, 'awaiting_confirmation');
  assert.match(interpreted.summary, /marked destination|Confirm to commit/i);
  assert.doesNotMatch(interpreted.summary, /column\s+\d+|row\s+\d+/i);
  assert.doesNotMatch(interpreted.summary, /LIVE GEMINI/i);
});

test('NL attack without active combat drafts encounter.begin (hosted play path)', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I leap down and smash the goblin with my warhammer',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'encounter.begin');
  assert.match(interpreted.summary, /Ready to begin|Confirm/i);
  assert.equal(interpreted.targetCombatantId, undefined);
});

test('NL begin encounter and roll initiative drafts encounter.begin when no combat', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I begin the encounter and roll initiative as the hostile guardian attacks from beyond the doorway.',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'encounter.begin');
  assert.match(interpreted.summary, /Ready to begin|initiative|Confirm/i);
});

test('NL begin encounter with named hostile carries declaredFoes (PQA-170/171)', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I begin the encounter and roll initiative as a hostile ashfang raider named Kest attacks from beyond the doorway.',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'encounter.begin');
  assert.ok(interpreted.declaredFoes);
  assert.equal(interpreted.declaredFoes.length, 1);
  assert.match(interpreted.declaredFoes[0].name, /Kest/i);
  assert.match(interpreted.summary, /Kest/i);
  assert.doesNotMatch(interpreted.summary, /practice foes/i);
});

test('extractDeclaredFoesFromText prefers kind + personal name', async () => {
  const { extractDeclaredFoesFromText } = await import(
    '../../dist/server/ai/director-gateway.js'
  );
  const foes = extractDeclaredFoesFromText(
    'a hostile ashfang raider named Kest lunges from the doorway',
  );
  assert.equal(foes.length, 1);
  assert.match(foes[0].name, /Ashfang Raider Kest/i);
});

test('NL end encounter without an open fight clarifies instead of drafting end', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'End the encounter so we can take a Short Rest.',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'table.sync');
  assert.match(interpreted.summary, /no active encounter/i);
});

test('NL Arcane Recovery drafts short rest with recovery flag (PQA-214)', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I take a Short Rest and use Arcane Recovery to restore one level-1 spell slot.',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'combat.short_rest');
  assert.equal(interpreted.arcaneRecovery, true);
  assert.match(interpreted.summary, /Arcane Recovery|level-1/i);
});

test('NL long rest drafts combat.long_rest outside combat (PQA-214)', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I take a Long Rest and camp for the night.',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'combat.long_rest');
  assert.match(interpreted.summary, /Ready to take a Long Rest|Confirm/i);
  assert.equal(interpreted.arcaneRecovery, undefined);
});

test('NL short rest drafts combat.short_rest outside combat', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I take a Short Rest to recover Second Wind and Action Surge.',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'combat.short_rest');
  assert.match(interpreted.summary, /Ready to take a Short Rest|Confirm/i);
});

test('PQA-141/143/145: door intent without scene doors clarifies instead of leaking open_door', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I walk to the far wall, open the wooden door, and enter the room beyond.',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'table.sync');
  assert.equal(interpreted.edgeId, undefined);
  assert.doesNotMatch(interpreted.summary, /table\.open_door|edgeId|Emberferry|^Ready to open/i);
  // A1 authority: compound move+open asks for sequence; blank scenes may also say no door.
  assert.match(
    interpreted.summary,
    /no door|interact with here|explore the chamber|more than one action|one at a time/i,
  );
});

test('PQA-142: compound walk+door ignores stale non-adjacent moveTarget', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I walk to the far wall, open the wooden door, and enter the room beyond.',
    moveTarget: { column: 0, row: 0 },
    environmentClass: 'local',
  });
  assert.notEqual(interpreted.proposedCommandType, 'table.move');
  assert.equal(interpreted.path, undefined);
});

test('narration framing tags emphasize epic beats without changing mechanics summary', async () => {
  const narration = await narrateVisibleBeat({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    mechanicsSummary: 'Critical hit! Practice Goblin drops to 0 Hit Points.',
    rolls: [20, 12],
    environmentClass: 'local',
  });
  assert.equal(narration.mechanicsFirstSummary, 'Critical hit! Practice Goblin drops to 0 Hit Points.');
  assert.ok(narration.framingTags.includes('crit'));
  assert.ok(narration.framingTags.includes('finishing_blow'));
});

test('kill switch still refuses Director AI before Gemini', async () => {
  await assert.rejects(
    () =>
      answerDirectorAddress({
        firestore: fakeFirestore({ killSwitch: true }),
        campaignId: 'camp-1',
        accountId: 'acc-1',
        text: 'Hello',
        environmentClass: 'milestone',
        firebaseProjectId: 'hd-a3-staging',
        llm: {
          async generateText() {
            return 'should not be called';
          },
        },
      }),
    (error) => error instanceof AiDirectorUnavailableError,
  );
});

test('A1: which-door interrogative clarifies instead of opening', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'Which door leads to the old archive?',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'table.sync');
  assert.doesNotMatch(interpreted.summary, /^Ready to open/i);
  assert.match(interpreted.summary, /question|door action|ask/i);
});

test('A1: addressing unknown Nib clarifies — NPC not established', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'Nib, which door leads to the old archive?',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'table.sync');
  assert.doesNotMatch(interpreted.summary, /^Ready to open/i);
  // Without known NPCs in fake firestore, Nib is not established.
  assert.match(interpreted.summary, /not established|Game Director/i);
});

test('A1: asks Nib mid-sentence clarifies not established — not Say who you ask', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'Loophole Lantern asks Nib, “Who are you, and what lies beyond the wooden door?”',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'table.sync');
  assert.match(interpreted.summary, /not an established NPC|not established/i);
  assert.doesNotMatch(interpreted.summary, /Say who you ask/i);
  assert.doesNotMatch(interpreted.summary, /^Ready to open/i);
});

test('A1: calling for who is present yields presence fiction, not policy handbook', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'Loophole Lantern calls into the chamber and waits for whoever is present.',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'table.sync');
  assert.match(interpreted.summary, /Nobody answers|no other person|Nib|present/i);
  assert.doesNotMatch(interpreted.summary, /What is your character attempting/i);
  assert.doesNotMatch(interpreted.summary, /employee handbook|Looking and listening — the Game Director narrates/i);
});

test('A1: scene survey yields perceptible-scene fiction, not combat or policy copy', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'Loophole Lantern pauses and surveys the current chamber, looking and listening carefully. Garrick, describe only what she can perceive and reveal any scene change only if the established fiction requires one.',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'table.sync');
  assert.doesNotMatch(interpreted.summary, /encounter|attack|combat setup|Confirm to start/i);
  assert.match(interpreted.summary, /look and listen|visible scene|holds steady|doorway|chamber|Quiet/i);
  assert.doesNotMatch(
    interpreted.summary,
    /Looking and listening — the Game Director narrates what is perceptible here/i,
  );
});

test('buildNpcDialogueReply answers the question instead of echoing description', () => {
  const npc = {
    name: 'Nib',
    role: 'A wary goblin cartographer',
    motive: 'Disposition: wary.',
  };
  const beyond = buildNpcDialogueReply({
    npc,
    playerText:
      'Loophole Lantern asks Nib, “What is past the east door, and why should I keep my boots dry?”',
    mapTitle: 'Quiet chamber',
  });
  assert.match(beyond, /^Nib:/);
  assert.match(beyond, /wet|boots dry|door/i);
  assert.doesNotMatch(beyond, /A wary goblin cartographer/i);
  assert.doesNotMatch(beyond, /answers carefully/i);

  const who = buildNpcDialogueReply({
    npc,
    playerText: 'Nib, who are you?',
    mapTitle: 'Quiet chamber',
  });
  assert.match(who, /Name's Nib/i);
  assert.doesNotMatch(who, /"A wary goblin cartographer"/i);
});

test('buildSceneSurveyNarration stays inside the validated map', () => {
  const narration = buildSceneSurveyNarration({
    campaignId: 'camp-1',
    mapBundleId: 'map-1',
    mapVersion: 1,
    title: 'Quiet chamber',
    artProvenance: 'procedural',
    coordinateSpace: {
      coordinateSpaceId: 'space-1',
      schemaVersion: 'map-coordinate-v1',
      columns: 12,
      rows: 8,
      feetPerSquare: 5,
      pixelsPerSquare: 48,
    },
    cells: [],
    edges: [
      {
        edgeId: 'e1',
        column: 4,
        row: 2,
        orientation: 'east',
        kind: 'door',
        doorState: 'closed',
      },
    ],
    tokens: [],
    exploredSquareIds: [],
    visibleSquareIds: [],
    sceneBanner: 'Quiet chamber — walls and a wooden doorway are established for this table.',
    notableFeatures: [
      { column: 1, row: 1, label: 'Wall sconce — lighting reference', referenceKind: 'lighting' },
      { column: 3, row: 3, label: 'Damp stones — hazard reference', referenceKind: 'hazard' },
    ],
    viewerSeatId: null,
  });
  assert.match(narration, /Quiet chamber/i);
  assert.match(narration, /wooden doorway|doorway|route/i);
  assert.match(narration, /wall sconce|lit/i);
  assert.match(narration, /damp stones|hazard|active/i);
  assert.doesNotMatch(narration, /flooded crypt|Game Director narrates/i);
  const decline = buildPresenceDeclineNarration(null);
  assert.match(decline, /Nobody answers/i);
  assert.doesNotMatch(decline, /no other person is present/i);
});

test('FQA-001: scrubFalseTrapCertainty blocks omniscient safety claims', async () => {
  const { scrubFalseTrapCertainty } = await import('../../dist/server/ai/director-gateway.js');
  const mechanics =
    'Trap search on the wooden doorway east (Investigation +5): d20 14 +5 = 19 vs DC 13 — no trap found on the wooden doorway east.';
  const embellished =
    'Your keen eye confirms the area is completely safe and free of traps.';
  const scrubbed = scrubFalseTrapCertainty(embellished, mechanics);
  assert.doesNotMatch(scrubbed, /completely safe|free of traps/i);
  assert.match(scrubbed, /no sign of a trap|wooden doorway east/i);
});

test('FQA-003: scrubExpandedInspectScope keeps narration on the confirmed target', async () => {
  const { scrubExpandedInspectScope } = await import('../../dist/server/ai/director-gateway.js');
  const mechanics = 'Inspect doorway (Investigation +5): d20 12 +5 = 17 vs DC 13 — success.';
  const expanded =
    'You carefully examine the timber floorboards, doorframe, and nearby furnishings for anything unusual.';
  const scrubbed = scrubExpandedInspectScope(expanded, mechanics);
  assert.doesNotMatch(scrubbed, /floorboards|furnishings/i);
  assert.match(scrubbed, /doorway/i);
});

test('FQA-003: scrubExpandedInspectScope renames the area from trap-search mechanics', async () => {
  const { scrubExpandedInspectScope } = await import('../../dist/server/ai/director-gateway.js');
  const mechanics =
    'Trap search on the wooden doorway east (Investigation +5): d20 14 +5 = 19 vs DC 13 — no trap found on the wooden doorway east.';
  const scrubbed = scrubExpandedInspectScope(
    'You probe the area carefully and spot no mechanisms.',
    mechanics,
  );
  assert.doesNotMatch(scrubbed, /\bthe area\b/i);
  assert.match(scrubbed, /wooden doorway east/i);
});

test('FQA-R05: scrubEngineCoordinates removes grid ids from Ask DM prose', async () => {
  const { scrubEngineCoordinates } = await import('../../dist/server/ai/director-gateway.js');
  const scrubbed = scrubEngineCoordinates(
    'The wooden doorway east at c4r3 is closed. Check Investigation against DC 13.',
  );
  assert.doesNotMatch(scrubbed, /c4r3/i);
  assert.match(scrubbed, /wooden doorway east/i);
});

test('FQA-017: inspect candidates dedupe doorway vs door labels', async () => {
  const { dedupeInspectCandidateLabels } = await import('../../dist/server/ai/director-gateway.js');
  const deduped = dedupeInspectCandidateLabels([
    'Wooden doorway east',
    'Wooden doorway east — closed',
    'Wooden door east — closed',
    'Hearth lamp (lit)',
  ]);
  assert.equal(deduped.filter((label) => /door/i.test(label)).length, 1);
  assert.match(deduped.join('; '), /Wooden doorway east — closed/i);
  assert.match(deduped.join('; '), /Hearth lamp/i);
});

test('A1: unlocked-door state reference is not a lockpick draft', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'Beyond the unlocked door I see mist.',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'table.sync');
  assert.doesNotMatch(interpreted.summary, /Sleight of Hand|attempt the lock|Confirm to roll/i);
});

test('A1: opens unlocked doorway and steps through is open, not lockpick', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'Loophole opens the unlocked doorway and steps through.',
    environmentClass: 'local',
  });
  assert.doesNotMatch(interpreted.summary, /Sleight of Hand|attempt the lock|burglary|Confirm to roll/i);
  assert.match(interpreted.summary, /open|door|Ready to|chamber|no door/i);
});

test('A1: invent scenery keeps movement when no map target yet', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I walk toward the flooded crypt that materializes ahead.',
    environmentClass: 'local',
  });
  assert.doesNotMatch(interpreted.summary, /Sleight of Hand|attempt the lock|Confirm to roll/i);
  assert.match(interpreted.summary, /move|square|map|ignored|Game Director/i);
});

test('A1: pick lock still drafts a skill check', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I try to unlock the wooden door with thieves tools.',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'table.sync');
  assert.match(interpreted.summary, /^Ready to /i);
  assert.match(interpreted.summary, /lock|Confirm to roll/i);
});
