import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { join } from 'node:path';

/**
 * Stable-identifier inventory must stay synchronized with the published
 * Phase 1 checkpoint and the shared contracts that produce those ids.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');

test('Phase 1 stable identifier inventory names every required id class', async () => {
  const inventory = await readFile(
    join(ROOT, 'Checkpoints/phase-1/PHASE_1_STABLE_IDENTIFIERS.md'),
    'utf8',
  );
  for (const token of [
    'accountId',
    'ownerAccountId',
    'characterId',
    'campaignId',
    'membershipId',
    'seatId',
    'deviceSessionId',
    'inviteCode',
    'directorAvatarKey',
    'rulesVersion',
    'requestId',
    'projectionVersion',
    'lastAcknowledgedEventSequence',
  ]) {
    assert.match(inventory, new RegExp(token), `missing ${token}`);
  }
  assert.match(inventory, /Explicitly not Phase 1 identifiers/);
  assert.doesNotMatch(inventory, /\bcoming\s+soon\b/i);
});

test('shared contracts still expose the Phase 1 continuity identifiers', async () => {
  const campaign = await import('../../dist/shared/campaign-contract.js');
  const { RULES_VERSION } = await import('../../dist/server/rules/srd-manifest.js');
  const foundation = await import('../../dist/shared/contract.js');
  assert.equal(typeof campaign.directorAvatarKey, 'function');
  assert.equal(campaign.directorAvatarKey('veyra', 'seasoned_host'), 'veyra__seasoned_host');
  assert.equal(typeof RULES_VERSION, 'string');
  assert.match(RULES_VERSION, /^srd-/);
  assert.ok(foundation.ERROR_CODES);
  assert.ok(foundation.CANDIDATE_HEADER);
});
