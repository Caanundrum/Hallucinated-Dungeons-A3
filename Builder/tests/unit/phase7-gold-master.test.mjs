import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadServerEnvironment } from '../../dist/server/config/environment.js';
import {
  IdentityUnavailableError,
  mintDevelopmentIdentity,
  mintQaFixtureSession,
} from '../../dist/server/identity/development-identity.js';
import { buildGoldMasterPackage } from '../../dist/server/release/gold-master.js';
import { isLocalArenaPublicSurface } from '../../dist/server/release/public-surface.js';
import { qaHarnessStatus, runQaHarnessOperation } from '../../dist/server/release/qa-harness.js';
import { listLegalDocuments } from '../../dist/server/legal/legal-registry.js';
import {
  GOLD_MASTER_STRIPPED_CAPABILITIES,
  ELIGIBILITY_POLICY,
} from '../../dist/shared/public-surface-contract.js';
import { GOOGLE_SIGN_IN_NOTICE } from '../../dist/shared/identity-contract.js';

function localEnv(overrides = {}) {
  return loadServerEnvironment({
    HD_ENV_SCHEMA_VERSION: '1',
    HD_ENVIRONMENT_CLASS: 'local',
    HD_RUNTIME_MODE: 'rapid_builder',
    HD_CANDIDATE_ID: 'cand-phase7test',
    HD_BLUEPRINT_VERSION: 'ALPHA_3_V1',
    HD_FIREBASE_PROJECT_ID: 'hallucinated-dungeons-local',
    HD_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    HD_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    HD_SERVER_HOST: '127.0.0.1',
    HD_SERVER_PORT: '5174',
    HD_CLIENT_ORIGIN: 'http://127.0.0.1:5173',
    HD_SEED_VERSION: 'phase0-baseline-v1',
    ...overrides,
  });
}

test('Gold Master rehearsal stays local but is not a Local Arena public surface', () => {
  const local = localEnv();
  const gold = localEnv({ HD_PUBLIC_SURFACE: 'gold_master' });
  assert.equal(isLocalArenaPublicSurface(local), true);
  assert.equal(isLocalArenaPublicSurface(gold), false);
  assert.equal(gold.environmentClass, 'local');
});

test('development identity and QA fixtures fail closed on gold_master before touching persistence', async () => {
  const env = localEnv({ HD_PUBLIC_SURFACE: 'gold_master' });
  const dummy = /** @type {never} */ ({});
  await assert.rejects(
    () => mintDevelopmentIdentity({ env, firestore: dummy, auth: dummy }),
    (error) => error instanceof IdentityUnavailableError,
  );
  await assert.rejects(
    () => mintQaFixtureSession({ env, firestore: dummy, auth: dummy, fixtureLabel: 'player' }),
    (error) => error instanceof IdentityUnavailableError,
  );
});

test('QA harness is available on local_arena and stripped on gold_master', () => {
  const local = qaHarnessStatus(localEnv());
  assert.equal(local.available, true);
  assert.deepEqual([...local.operations], ['status']);
  assert.equal(runQaHarnessOperation(localEnv(), 'status').available, true);

  assert.throws(
    () => qaHarnessStatus(localEnv({ HD_PUBLIC_SURFACE: 'gold_master' })),
    (error) => error instanceof IdentityUnavailableError,
  );
});

test('Gold Master package names stripped capabilities and does not claim a deploy', () => {
  const pack = buildGoldMasterPackage(localEnv());
  assert.equal(pack.recordType, 'gold_master_package');
  assert.equal(pack.launchProduction, 'NOT_DEPLOYED');
  assert.equal(pack.productOwnerAuthorization, 'NOT_GRANTED');
  assert.equal(pack.hostedSmoke, 'NOT_RUN');
  assert.equal(pack.localArenaStillExposesStrippedCapabilities, true);
  for (const capability of GOLD_MASTER_STRIPPED_CAPABILITIES) {
    assert.ok(pack.strippedFromHostedArtifacts.includes(capability), capability);
  }
  assert.equal(pack.eligibilityPolicy.status, ELIGIBILITY_POLICY.status);
  assert.equal(pack.ops.healthMutatesGameplay, false);
  assert.match(pack.honestBounds.join(' '), /Launch Production is not configured/);

  const goldPack = buildGoldMasterPackage(localEnv({ HD_PUBLIC_SURFACE: 'gold_master' }));
  assert.equal(goldPack.localArenaStillExposesStrippedCapabilities, false);
});

test('legal Gold Master documents are current and name Google hosted identity', () => {
  const documents = listLegalDocuments();
  assert.ok(
    documents.every(
      (document) =>
        document.version === 'V2' ||
        (document.route === '/legal/privacy' && document.version === 'V2.1'),
    ),
  );
  assert.ok(documents.every((document) => document.reConsentRequired === true));
  const terms = documents.find((document) => document.route === '/legal/terms');
  assert.match(terms.sections.map((section) => section.paragraphs.join(' ')).join(' '), /Google Sign-In only/);
  const privacy = documents.find((document) => document.route === '/legal/privacy');
  assert.match(
    privacy.sections.map((section) => section.paragraphs.join(' ')).join(' '),
    /Gold Master and Launch Production/,
  );
  assert.match(
    privacy.sections.map((section) => section.paragraphs.join(' ')).join(' '),
    /When you choose Sign in with Google/,
  );
  const safety = documents.find((document) => document.route === '/legal/content-and-safety');
  assert.match(
    safety.sections.map((section) => section.paragraphs.join(' ')).join(' '),
    /deterministic simulator/,
  );
  assert.match(GOOGLE_SIGN_IN_NOTICE, /Gold Master artifacts strip/);
});
