import assert from 'node:assert/strict';
import { test } from 'node:test';

import { exchangeGoogleIdToken } from '../../dist/server/identity/google-hosted.js';
import { issueHostedGoogleSession } from '../../dist/server/identity/development-identity.js';
import { loadServerEnvironment } from '../../dist/server/config/environment.js';

test('Google ID token exchange refuses a short token before calling Google', async () => {
  await assert.rejects(
    () =>
      exchangeGoogleIdToken({
        webApiKey: 'test-key',
        googleIdToken: 'short',
        requestUri: 'https://example.web.app',
        fetchImpl: async () => {
          throw new Error('fetch should not run');
        },
      }),
    /usable identity token/,
  );
});

test('Google ID token exchange maps Identity Toolkit email and uid', async () => {
  const profile = await exchangeGoogleIdToken({
    webApiKey: 'test-key',
    googleIdToken: 'a'.repeat(40),
    requestUri: 'https://example.web.app',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          localId: 'firebase-uid-1',
          email: 'Codex.Tester@example.com',
          displayName: 'Codex Tester',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  });
  assert.equal(profile.uid, 'firebase-uid-1');
  assert.equal(profile.email, 'codex.tester@example.com');
  assert.equal(profile.displayName, 'Codex Tester');
});

test('hosted Google session mint is refused on Local Arena', async () => {
  const env = loadServerEnvironment({
    HD_ENV_SCHEMA_VERSION: '1',
    HD_ENVIRONMENT_CLASS: 'local',
    HD_RUNTIME_MODE: 'rapid_builder',
    HD_CANDIDATE_ID: 'cand-local',
    HD_BLUEPRINT_VERSION: 'ALPHA_3_V1',
    HD_FIREBASE_PROJECT_ID: 'hallucinated-dungeons-local',
    HD_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    HD_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    HD_SERVER_HOST: '127.0.0.1',
    HD_SERVER_PORT: '5174',
    HD_CLIENT_ORIGIN: 'http://127.0.0.1:5173',
    HD_SEED_VERSION: 'phase0-baseline-v1',
    HD_PUBLIC_SURFACE: 'gold_master',
  });
  const dummy = /** @type {never} */ ({});
  await assert.rejects(
    () =>
      issueHostedGoogleSession({
        env,
        firestore: dummy,
        profile: { uid: 'x', email: 'a@b.c', displayName: 'A' },
      }),
    /Hosted Google Sign-In exists only on Milestone/,
  );
});
