import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PORTRAIT_DWARF_FIGHTER,
  PORTRAIT_ELF_ROGUE,
  appendStoryScar,
  archetypePortraitUrl,
  isTrustedAvatarUrl,
  validateAppearancePrompt,
} from '../../dist/shared/portrait-contract.js';
import { resolvePortrait } from '../../dist/server/characters/portrait.js';
import {
  PortraitCreditRequiredError,
  PortraitRequestError,
  generateCharacterPortrait,
  withMilestonePortraitCredit,
} from '../../dist/server/characters/characters.js';

function fakeFirestore(seed) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`;
          return {
            async get() {
              return { exists: store.has(key), data: () => store.get(key) };
            },
            async set(value) {
              store.set(key, value);
            },
          };
        },
      };
    },
  };
}

test('archetype fallback maps dwarf+fighter and elf+rogue, defaults to dwarf fighter', () => {
  assert.equal(archetypePortraitUrl({ ancestryId: 'dwarf', classId: 'fighter' }), PORTRAIT_DWARF_FIGHTER);
  assert.equal(archetypePortraitUrl({ ancestryId: 'elf', classId: 'rogue' }), PORTRAIT_ELF_ROGUE);
  assert.equal(archetypePortraitUrl({ ancestryId: 'human', classId: 'wizard' }), PORTRAIT_DWARF_FIGHTER);
  assert.equal(archetypePortraitUrl({ ancestryId: 'human', classId: 'rogue' }), PORTRAIT_ELF_ROGUE);
  assert.equal(archetypePortraitUrl({}), PORTRAIT_DWARF_FIGHTER);
});

test('appearance validation caps length and blocks modern / sci-fi / adult terms', () => {
  assert.equal(validateAppearancePrompt('Braided beard, a notch in the ear').ok, true);
  assert.equal(validateAppearancePrompt('x'.repeat(241)).ok, false);
  assert.equal(validateAppearancePrompt('wearing a Cyberpunk hoodie').ok, false);
  assert.equal(validateAppearancePrompt('holding a laser pistol').ok, false);
  assert.equal(validateAppearancePrompt('NSFW art').ok, false);
  assert.equal(validateAppearancePrompt('a gunmetal grey cloak').ok, true);
});

test('story scar note appends within the appearance cap', () => {
  assert.equal(appendStoryScar('Red beard', 'burned hand'), 'Red beard. Scar: burned hand');
  assert.ok(appendStoryScar('y'.repeat(235), 'burned hand').length <= 240);
});

test('trusted avatar urls: curated assets and inline images only', () => {
  assert.equal(isTrustedAvatarUrl('/assets/portraits/dwarf_fighter.jpg'), true);
  assert.equal(isTrustedAvatarUrl('/assets/portraits/../secret'), false);
  assert.equal(isTrustedAvatarUrl('https://evil.example/x.png'), false);
  assert.equal(isTrustedAvatarUrl('javascript:alert(1)'), false);
  assert.equal(isTrustedAvatarUrl('data:image/png;base64,AAAA'), true);
});

test('resolvePortrait falls back to archetype without an API key (no network call)', async () => {
  let called = false;
  const result = await resolvePortrait({
    appearancePrompt: 'grim',
    ancestryId: 'elf',
    classId: 'rogue',
    env: {},
    fetchImpl: async () => {
      called = true;
      throw new Error('should not be called');
    },
  });
  assert.equal(called, false);
  assert.deepEqual(result, { avatarUrl: PORTRAIT_ELF_ROGUE, source: 'archetype' });
});

test('resolvePortrait uses Imagen when a key is present and falls back on failure', async () => {
  const env = { GEMINI_API_KEY: 'k'.repeat(30) };
  const generated = await resolvePortrait({
    appearancePrompt: 'grim',
    ancestryId: 'dwarf',
    classId: 'fighter',
    env,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ predictions: [{ bytesBase64Encoded: 'QUJD', mimeType: 'image/png' }] }),
    }),
  });
  assert.equal(generated.source, 'generated');
  assert.equal(generated.avatarUrl, 'data:image/png;base64,QUJD');

  const failed = await resolvePortrait({
    appearancePrompt: 'grim',
    ancestryId: 'dwarf',
    classId: 'fighter',
    env,
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  });
  assert.deepEqual(failed, { avatarUrl: PORTRAIT_DWARF_FIGHTER, source: 'archetype' });
});

test('generateCharacterPortrait persists on the draft and spends a character credit', async () => {
  const firestore = fakeFirestore({
    'characterDrafts/d1': {
      draftId: 'd1',
      ownerAccountId: 'a1',
      choices: { speciesId: 'dwarf', classId: 'fighter', identity: { name: 'Brom' } },
    },
    'characters/c1': {
      characterId: 'c1',
      ownerAccountId: 'a1',
      choices: { speciesId: 'elf', classId: 'rogue', identity: { name: 'Vess' } },
      revisions: [],
      milestonePortraitCredits: 1,
    },
    'characters/c2': {
      characterId: 'c2',
      ownerAccountId: 'a1',
      choices: { speciesId: 'elf', classId: 'rogue', identity: { name: 'Nil' } },
      revisions: [],
    },
  });
  const env = {};
  const draftResult = await generateCharacterPortrait({
    firestore,
    accountId: 'a1',
    body: { appearancePrompt: 'Braided beard', draftId: 'd1' },
    env,
  });
  assert.equal(draftResult.avatarUrl, PORTRAIT_DWARF_FIGHTER);
  assert.equal(firestore.store.get('characterDrafts/d1').avatarUrl, PORTRAIT_DWARF_FIGHTER);
  assert.equal(firestore.store.get('characterDrafts/d1').appearancePrompt, 'Braided beard');

  const characterResult = await generateCharacterPortrait({
    firestore,
    accountId: 'a1',
    body: { appearancePrompt: 'Scar on cheek', characterId: 'c1' },
    env,
  });
  assert.equal(characterResult.avatarUrl, PORTRAIT_ELF_ROGUE);
  assert.equal(characterResult.milestonePortraitCredits, 0);
  assert.equal(firestore.store.get('characters/c1').milestonePortraitCredits, 0);

  await assert.rejects(
    generateCharacterPortrait({
      firestore,
      accountId: 'a1',
      body: { appearancePrompt: 'again', characterId: 'c2' },
      env,
    }),
    PortraitCreditRequiredError,
  );
  await assert.rejects(
    generateCharacterPortrait({ firestore, accountId: 'a1', body: { appearancePrompt: 'laser eyes' }, env }),
    PortraitRequestError,
  );
});

test('withMilestonePortraitCredit increments from zero', () => {
  assert.equal(withMilestonePortraitCredit({}).milestonePortraitCredits, 1);
  assert.equal(withMilestonePortraitCredit({ milestonePortraitCredits: 2 }).milestonePortraitCredits, 3);
});

test('loadCampaignSeats joins trusted character avatars for map tokens', async () => {
  const { loadCampaignSeats, buildAuthoritativeMapBundle } = await import(
    '../../dist/server/table/map-projection.js'
  );
  const docs = {
    'characters/c1': { avatarUrl: '/assets/portraits/elf_rogue.jpg' },
    'characters/c2': { avatarUrl: 'https://evil.example/x.png' },
  };
  const seats = [
    { seatId: 's1', campaignId: 'camp', ownerAccountId: 'a', characterId: 'c1', characterName: 'Vess' },
    { seatId: 's2', campaignId: 'camp', ownerAccountId: 'b', characterId: 'c2', characterName: 'Nil' },
    { seatId: 's3', campaignId: 'camp', ownerAccountId: 'c', characterId: 'missing', characterName: 'Ghost' },
  ];
  const firestore = {
    collection(name) {
      return {
        where: () => ({
          limit: () => ({ get: async () => ({ docs: seats.map((seat) => ({ data: () => seat })) }) }),
        }),
        doc: (id) => ({
          async get() {
            const value = docs[`${name}/${id}`];
            return { exists: value !== undefined, data: () => value };
          },
        }),
      };
    },
  };
  const loaded = await loadCampaignSeats(firestore, 'camp');
  assert.deepEqual(
    loaded.map((seat) => seat.avatarUrl),
    ['/assets/portraits/elf_rogue.jpg', null, null],
  );
  const bundle = buildAuthoritativeMapBundle({
    campaignId: 'camp',
    seats: loaded,
    runtime: {
      campaignId: 'camp',
      tokenPositions: [],
      doorStates: {},
      exploredByAccount: {},
      movementRevision: 0,
      lastMovementEventSequence: 0,
    },
  });
  assert.equal(bundle.tokens[0].avatarUrl, '/assets/portraits/elf_rogue.jpg');
  assert.equal(bundle.tokens[1].avatarUrl, null);
});
