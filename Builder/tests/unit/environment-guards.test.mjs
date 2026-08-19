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
  assert.equal(env.publicSurface, 'local_arena');
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

test('Launch Production class is refused until separately authorized', () => {
  expectRejection(
    validEnvironment({ HD_ENVIRONMENT_CLASS: 'launch' }),
    /Launch Production is not authorized/,
  );
  expectRejection(
    validEnvironment({ HD_ENVIRONMENT_CLASS: 'production' }),
    /HD_ENVIRONMENT_CLASS must be one of/,
  );
});

test('Milestone class is refused without hosted credentials and public origin', () => {
  expectRejection(
    validEnvironment({ HD_ENVIRONMENT_CLASS: 'milestone' }),
    /refuses emulator host variables/,
  );
});

function validMilestone(overrides = {}) {
  return {
    HD_ENV_SCHEMA_VERSION: '1',
    HD_ENVIRONMENT_CLASS: 'milestone',
    HD_RUNTIME_MODE: 'frozen_certification',
    HD_CANDIDATE_ID: 'cand-milestone1',
    HD_BLUEPRINT_VERSION: 'ALPHA_3_V1',
    HD_FIREBASE_PROJECT_ID: 'hd-alpha3-milestone',
    HD_SERVER_HOST: '0.0.0.0',
    HD_SERVER_PORT: '8080',
    HD_CLIENT_ORIGIN: 'https://hd-alpha3-milestone.web.app',
    HD_SEED_VERSION: 'phase7-gold-master-v1',
    HD_PUBLIC_SURFACE: 'gold_master',
    HD_CLIENT_BUNDLE_DIR: '/app/dist/client',
    HD_GOOGLE_OAUTH_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
    HD_FIREBASE_WEB_API_KEY: 'AIzaSyMilestoneTestKey',
    ...overrides,
  };
}

test('Milestone uses Cloud Run default credentials without a JSON env var', () => {
  const env = loadServerEnvironment(validMilestone());
  assert.equal(env.environmentClass, 'milestone');
  assert.equal(env.googleOAuthClientId, '1234567890-abc.apps.googleusercontent.com');
});

test('Cloud Run PORT and K_SERVICE fill hosted Milestone defaults', () => {
  const env = loadServerEnvironment({
    K_SERVICE: 'hd-a3-staging',
    PORT: '8080',
    HD_CANDIDATE_ID: 'cand-milestone1',
    HD_BLUEPRINT_VERSION: 'ALPHA_3_V1',
    HD_FIREBASE_PROJECT_ID: 'hd-alpha3-milestone',
    HD_CLIENT_ORIGIN: 'https://hd-alpha3-milestone.web.app',
    HD_SEED_VERSION: 'phase7-gold-master-v1',
    HD_GOOGLE_OAUTH_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
    HD_FIREBASE_WEB_API_KEY: 'AIzaSyMilestoneTestKey',
  });
  assert.equal(env.environmentClass, 'milestone');
  assert.equal(env.publicSurface, 'gold_master');
  assert.equal(env.serverHost, '0.0.0.0');
  assert.equal(env.serverPort, 8080);
  assert.match(env.clientBundleDir ?? '', /dist[/\\]client$/);
});

test('Firebase App Hosting can omit HD_CLIENT_ORIGIN on first rollout', () => {
  const env = loadServerEnvironment({
    K_SERVICE: 'hd-a3-player',
    PORT: '8080',
    HD_CANDIDATE_ID: 'cand-milestone1',
    HD_BLUEPRINT_VERSION: 'ALPHA_3_V1',
    HD_FIREBASE_PROJECT_ID: 'hd-a3-staging',
    HD_SEED_VERSION: 'phase7-gold-master-v1',
    HD_GOOGLE_OAUTH_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
    HD_FIREBASE_WEB_API_KEY: 'AIzaSyMilestoneTestKey',
  });
  assert.equal(env.clientOrigin, 'https://placeholder.invalid');
  assert.equal(env.environmentClass, 'milestone');
});

test('Milestone refuses emulator hosts, local project id, loopback origin, and local_arena surface', () => {
  expectRejection(
    validMilestone({ HD_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }),
    /refuses emulator host variables/,
  );
  expectRejection(
    validMilestone({ HD_FIREBASE_PROJECT_ID: 'hallucinated-dungeons-local' }),
    /cannot bind to the Local Arena emulator project/,
  );
  expectRejection(
    validMilestone({ HD_CLIENT_ORIGIN: 'http://127.0.0.1:8080' }),
    /must be https/,
  );
  expectRejection(
    validMilestone({ HD_PUBLIC_SURFACE: 'local_arena' }),
    /HD_PUBLIC_SURFACE=gold_master/,
  );
});

test('Local Arena refuses hosted Google variables', () => {
  expectRejection(
    validEnvironment({ HD_GOOGLE_OAUTH_CLIENT_ID: '123.apps.googleusercontent.com' }),
    /refused in the Local Arena/,
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

test('public surface defaults to local_arena and accepts gold_master rehearsal', () => {
  const local = loadServerEnvironment(validEnvironment());
  assert.equal(local.publicSurface, 'local_arena');

  const gold = loadServerEnvironment(validEnvironment({ HD_PUBLIC_SURFACE: 'gold_master' }));
  assert.equal(gold.publicSurface, 'gold_master');
  assert.equal(gold.environmentClass, 'local');

  expectRejection(
    validEnvironment({ HD_PUBLIC_SURFACE: 'launch_production' }),
    /HD_PUBLIC_SURFACE must be local_arena or gold_master/,
  );
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
