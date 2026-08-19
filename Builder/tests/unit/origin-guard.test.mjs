import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appHostingPublicOrigin,
  corsAllowOrigin,
  isAllowedBrowserOrigin,
  servingOriginFromHost,
} from '../../dist/server/http/origin-guard.js';

test('Cloud Run serving origin is derived from Host, not the placeholder client origin', () => {
  assert.equal(
    servingOriginFromHost('hd-a3-staging-in4per6l4a-uc.a.run.app'),
    'https://hd-a3-staging-in4per6l4a-uc.a.run.app',
  );
});

test('App Hosting public origin is constructed from K_SERVICE and project id', () => {
  assert.equal(
    appHostingPublicOrigin({
      cloudRunService: 'hd-a3-player',
      firebaseProjectId: 'hd-a3-staging',
    }),
    'https://hd-a3-player--hd-a3-staging.us-central1.hosted.app',
  );
});

test('same-origin Cloud Run GETs are allowed when HD_CLIENT_ORIGIN is still a placeholder', () => {
  const hosted = {
    clientOrigin: 'https://placeholder.invalid',
    hostHeader: 'hd-a3-staging-in4per6l4a-uc.a.run.app',
    hosted: true,
  };
  assert.equal(
    isAllowedBrowserOrigin({
      ...hosted,
      origin: 'https://hd-a3-staging-in4per6l4a-uc.a.run.app',
      method: 'GET',
    }),
    true,
  );
  assert.equal(
    corsAllowOrigin({
      ...hosted,
      origin: 'https://hd-a3-staging-in4per6l4a-uc.a.run.app',
    }),
    'https://hd-a3-staging-in4per6l4a-uc.a.run.app',
  );
  assert.equal(
    isAllowedBrowserOrigin({
      ...hosted,
      origin: 'https://evil.example',
      method: 'GET',
    }),
    false,
  );
  assert.equal(
    isAllowedBrowserOrigin({
      ...hosted,
      origin: 'https://evil.example',
      method: 'POST',
    }),
    false,
  );
});

test('App Hosting CSS/JS GETs are allowed when Origin is *.hosted.app but Host is Cloud Run', () => {
  const hosted = {
    clientOrigin: 'https://placeholder.invalid',
    hostHeader: 'hd-a3-player-in4per6l4a-uc.a.run.app',
    cloudRunService: 'hd-a3-player',
    firebaseProjectId: 'hd-a3-staging',
    hosted: true,
    staticResource: true,
  };
  const publicOrigin = 'https://hd-a3-player--hd-a3-staging.us-central1.hosted.app';
  assert.equal(
    isAllowedBrowserOrigin({
      ...hosted,
      origin: publicOrigin,
      method: 'GET',
    }),
    true,
  );
  assert.equal(
    corsAllowOrigin({
      ...hosted,
      origin: publicOrigin,
      method: 'GET',
    }),
    publicOrigin,
  );
  assert.equal(
    isAllowedBrowserOrigin({
      ...hosted,
      origin: publicOrigin,
      method: 'POST',
      staticResource: false,
    }),
    true,
    'mutating requests from the App Hosting origin must also be allowed',
  );
  assert.equal(
    isAllowedBrowserOrigin({
      ...hosted,
      origin: 'https://evil.example',
      method: 'POST',
      staticResource: false,
    }),
    false,
  );
  assert.equal(
    corsAllowOrigin({
      ...hosted,
      origin: 'https://evil.example',
      method: 'GET',
      staticResource: false,
    }),
    'https://placeholder.invalid',
    'API CORS must not echo a foreign origin',
  );
});

test('App Hosting X-Forwarded-Host is an allowed origin when it differs from Host', () => {
  const hosted = {
    clientOrigin: 'https://placeholder.invalid',
    hostHeader: '127.0.0.1:8080',
    forwardedHostHeader: 'hd-a3-player--hd-a3-staging.us-central1.hosted.app',
    hosted: true,
  };
  const publicOrigin = 'https://hd-a3-player--hd-a3-staging.us-central1.hosted.app';
  assert.equal(
    isAllowedBrowserOrigin({
      ...hosted,
      origin: publicOrigin,
      method: 'GET',
    }),
    true,
  );
  assert.equal(
    corsAllowOrigin({
      ...hosted,
      origin: publicOrigin,
    }),
    publicOrigin,
  );
});

test('hosted static GETs still load if the public origin is not yet on the allowlist', () => {
  const hosted = {
    clientOrigin: 'https://placeholder.invalid',
    hostHeader: '10.0.0.5:8080',
    hosted: true,
    staticResource: true,
  };
  const publicOrigin = 'https://hd-a3-player--hd-a3-staging.us-central1.hosted.app';
  assert.equal(
    isAllowedBrowserOrigin({
      ...hosted,
      origin: publicOrigin,
      method: 'GET',
    }),
    true,
  );
  assert.equal(
    corsAllowOrigin({
      ...hosted,
      origin: publicOrigin,
      method: 'GET',
    }),
    publicOrigin,
  );
});

test('Local Arena origin checks stay locked to the declared loopback origin', () => {
  assert.equal(
    isAllowedBrowserOrigin({
      origin: 'http://127.0.0.1:5173',
      method: 'GET',
      clientOrigin: 'http://127.0.0.1:5173',
      hostHeader: '127.0.0.1:5174',
      hosted: false,
    }),
    true,
  );
  assert.equal(
    isAllowedBrowserOrigin({
      origin: 'https://hd-a3-staging-in4per6l4a-uc.a.run.app',
      method: 'GET',
      clientOrigin: 'http://127.0.0.1:5173',
      hostHeader: '127.0.0.1:5174',
      hosted: false,
    }),
    false,
  );
});
