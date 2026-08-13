import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CAMPAIGN_NAME_MAX_LENGTH,
  DIRECTOR_CREATION_PREVIEW,
  DIRECTOR_IDENTITIES,
  DIRECTOR_PERSONALITIES,
  RECOMMENDED_DIRECTOR_PERSONALITY,
  directorAvatarKey,
  isDirectorIdentity,
  isDirectorPersonality,
} from '../../dist/shared/campaign-contract.js';
import { buildDirectorCatalog } from '../../dist/server/campaigns/director-catalog.js';

test('director catalog exposes both identities and five personalities', () => {
  const catalog = buildDirectorCatalog();
  assert.equal(catalog.identities.length, DIRECTOR_IDENTITIES.length);
  assert.equal(catalog.personalities.length, DIRECTOR_PERSONALITIES.length);
  assert.ok(catalog.configurationNotice.includes('later AI-enabled table'));
  assert.ok(!/\bcoming\s+soon\b/i.test(catalog.configurationNotice));

  const recommended = catalog.personalities.filter((entry) => entry.recommended);
  assert.equal(recommended.length, 1);
  assert.equal(recommended[0].id, RECOMMENDED_DIRECTOR_PERSONALITY);
});

test('every personality has creation preview copy for sample scene and rhythm', () => {
  for (const id of DIRECTOR_PERSONALITIES) {
    const preview = DIRECTOR_CREATION_PREVIEW[id];
    assert.ok(preview.sampleScene.length > 20, `${id} sample scene`);
    assert.ok(preview.playRhythm.length > 20, `${id} play rhythm`);
  }
});

test('avatar keys are deterministic from identity and personality', () => {
  assert.equal(directorAvatarKey('veyra', 'friendly_adventurer'), 'veyra__friendly_adventurer');
  assert.equal(directorAvatarKey('garrick', 'dramatic_chronicler'), 'garrick__dramatic_chronicler');
});

test('director guards reject forged catalog ids', () => {
  assert.equal(isDirectorIdentity('veyra'), true);
  assert.equal(isDirectorIdentity('Veyra'), false);
  assert.equal(isDirectorIdentity('other'), false);
  assert.equal(isDirectorPersonality('sassy_companion'), true);
  assert.equal(isDirectorPersonality('friendly'), false);
});

test('campaign name max length is bounded for Phase 1 forms', () => {
  assert.equal(CAMPAIGN_NAME_MAX_LENGTH, 80);
});
