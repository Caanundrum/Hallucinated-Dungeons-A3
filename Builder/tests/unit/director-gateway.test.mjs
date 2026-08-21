import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AiDirectorUnavailableError,
  answerDirectorAddress,
  interpretNaturalLanguageIntent,
  narrateVisibleBeat,
  PROVIDER_COMPLIANCE_REGISTRY,
} from '../../dist/server/ai/director-gateway.js';
import {
  GEMINI_DIRECTOR_MAX_OUTPUT_TOKENS,
  sanitizeDirectorProse,
} from '../../dist/server/ai/gemini-director.js';

function fakeFirestore(options = { killSwitch: false }) {
  return {
    collection(name) {
      return {
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
      };
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
  assert.match(answered.body, /visible scene|Actions thread|Veyra/i);
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
  assert.match(answered.body, /Veyra|sheet|Actions thread/i);
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
  assert.equal(interpreted.summary, 'Draft: you step to column 3, row 4. Confirm to move.');
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
