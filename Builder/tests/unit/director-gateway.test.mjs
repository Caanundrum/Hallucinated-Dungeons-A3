import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AiDirectorUnavailableError,
  answerDirectorAddress,
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

test('NL long rest drafts combat.long_rest outside combat (PQA-214)', async () => {
  const interpreted = await interpretNaturalLanguageIntent({
    firestore: fakeFirestore(),
    campaignId: 'camp-1',
    accountId: 'acc-1',
    text: 'I take a Long Rest to recover spell slots and Arcane Recovery.',
    environmentClass: 'local',
  });
  assert.equal(interpreted.proposedCommandType, 'combat.long_rest');
  assert.match(interpreted.summary, /Ready to take a Long Rest|Confirm/i);
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
  assert.doesNotMatch(interpreted.summary, /table\.open_door|edgeId/i);
  assert.match(interpreted.summary, /no door|open floor|Emberferry/i);
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
