import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadServerEnvironment } from '../../dist/server/config/environment.js';

/**
 * Fail-closed environment isolation (Sections 1.11.6, 1.11.8, 1.14.3).
 *
 * These run against the compiled server output, so they assert the behavior of
 * the bytes the arena actually executes.
 */

function validEnvironment(overrides = {}) {
  return {
    HD_ENV_SCHEMA_VERSION: '1',
    HD_ENVIRONMENT_CLASS: 'local',
    HD_RUNTIME_MODE: 'rapid_builder',
    HD_CANDIDATE_ID: 'cand-abcdef123456',
    HD_BLUEPRINT_VERSION: 'ALPHA_3_V1',
    HD_FIREBASE_PROJECT_ID: 'hallucinated-dungeons-local',
    HD_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    HD_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    HD_SERVER_HOST: '127.0.0.1',
    HD_SERVER_PORT: '5174',
    HD_CLIENT_ORIGIN: 'http://127.0.0.1:5173',
    HD_SEED_VERSION: 'phase0-baseline-v1',
    ...overrides,
  };
}

function expectRejection(env, expectedFragment) {
  assert.throws(
    () => loadServerEnvironment(env),
    (error) => {
      assert.equal(error.name, 'EnvironmentError');
      assert.match(error.message, expectedFragment);
      return true;
    },
  );
}

test('a complete local environment is accepted and frozen', () => {
  const env = loadServerEnvironment(validEnvironment());
  assert.equal(env.environmentClass, 'local');
  assert.equal(env.firebaseProjectId, 'hallucinated-dungeons-local');
  assert.equal(env.firestoreEmulator.port, 8080);
  assert.equal(env.clientOrigin, 'http://127.0.0.1:5173');
  assert.equal(env.clientBundleDir, null);
});

test('an unrecognized HD_ variable is refused rather than ignored', () => {
  expectRejection(
    validEnvironment({ HD_ALLOW_REMOTE_WRITES: 'true' }),
    /Unrecognized HD_\* environment variable/,
  );
});

test('a non-local environment class is refused', () => {
  expectRejection(
    validEnvironment({ HD_ENVIRONMENT_CLASS: 'launch' }),
    /Local Execution Environment only/,
  );
  expectRejection(
    validEnvironment({ HD_ENVIRONMENT_CLASS: 'production' }),
    /HD_ENVIRONMENT_CLASS must be one of/,
  );
});

test('a production credential variable blocks local startup', () => {
  for (const name of [
    'GOOGLE_APPLICATION_CREDENTIALS',
    'FIREBASE_TOKEN',
    'FIREBASE_SERVICE_ACCOUNT',
    'GOOGLE_CLOUD_KEYFILE_JSON',
    'GCLOUD_SERVICE_KEY',
  ]) {
    expectRejection(
      validEnvironment({ [name]: '/somewhere/service-account.json' }),
      /production credential variables are set/,
    );
  }
});

test('a live-looking project identifier is refused', () => {
  expectRejection(
    validEnvironment({ HD_FIREBASE_PROJECT_ID: 'hallucinated-dungeons-prod' }),
    /binds only to the emulator project/,
  );
});

test('a non-loopback emulator or server host is refused', () => {
  expectRejection(
    validEnvironment({ HD_FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }),
    /must resolve to a loopback host/,
  );
  expectRejection(
    validEnvironment({ HD_AUTH_EMULATOR_HOST: '10.0.0.5:9099' }),
    /must resolve to a loopback host/,
  );
  expectRejection(
    validEnvironment({ HD_SERVER_HOST: '0.0.0.0' }),
    /must resolve to a loopback host/,
  );
});

test('a public client origin is refused', () => {
  expectRejection(
    validEnvironment({ HD_CLIENT_ORIGIN: 'https://hallucinated-dungeons.example' }),
    /must resolve to a loopback host/,
  );
});

test('a missing required variable names itself', () => {
  const env = validEnvironment();
  delete env.HD_CANDIDATE_ID;
  expectRejection(env, /Missing required environment variable HD_CANDIDATE_ID/);
});

test('frozen certification requires a built client bundle', () => {
  expectRejection(
    validEnvironment({ HD_RUNTIME_MODE: 'frozen_certification' }),
    /HD_CLIENT_BUNDLE_DIR is required in frozen_certification mode/,
  );

  const env = loadServerEnvironment(
    validEnvironment({
      HD_RUNTIME_MODE: 'frozen_certification',
      HD_CLIENT_BUNDLE_DIR: '/tmp/frozen/dist/client',
    }),
  );
  assert.equal(env.runtimeMode, 'frozen_certification');
  assert.equal(env.clientBundleDir, '/tmp/frozen/dist/client');
});

test('a malformed host:port is refused', () => {
  expectRejection(
    validEnvironment({ HD_FIRESTORE_EMULATOR_HOST: '127.0.0.1' }),
    /must use the form host:port/,
  );
  expectRejection(
    validEnvironment({ HD_FIRESTORE_EMULATOR_HOST: '127.0.0.1:99999' }),
    /out-of-range port/,
  );
});
