import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
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
