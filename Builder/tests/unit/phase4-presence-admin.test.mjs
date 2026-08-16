import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  PRESENCE_RECONNECT_GRACE_MS,
  BOOTSTRAP_ADMIN_EMAIL,
} from '../../dist/shared/presence-contract.js';
import { projectCampaignPresence } from '../../dist/server/presence/presence-runtime.js';
import { isBootstrapAdminEmail } from '../../dist/server/admin/admin-auth.js';
import { PROVIDER_COMPLIANCE_REGISTRY } from '../../dist/server/ai/director-gateway.js';
import { DOCK_TABS, DIRECTOR_ADDRESS_NOTICE } from '../../dist/shared/communication-contract.js';

test('presence heartbeat and grace windows are explicit', () => {
  assert.equal(PRESENCE_HEARTBEAT_INTERVAL_MS, 5_000);
  assert.equal(PRESENCE_RECONNECT_GRACE_MS, 45_000);
});

test('bootstrap admin email is exact and case-insensitive', () => {
  assert.equal(BOOTSTRAP_ADMIN_EMAIL, 'nick.donner@gmail.com');
  assert.equal(isBootstrapAdminEmail('nick.donner@gmail.com'), true);
  assert.equal(isBootstrapAdminEmail('Nick.Donner@gmail.com'), true);
  assert.equal(isBootstrapAdminEmail('spoof@example.com'), false);
  assert.equal(isBootstrapAdminEmail(null), false);
});

test('presence projection separates online and grace accounts', () => {
  const now = new Date('2026-08-16T17:00:00.000Z');
  const onlineAt = new Date(now.getTime() - 1_000).toISOString();
  const graceAt = new Date(now.getTime() - 20_000).toISOString();
  const projection = projectCampaignPresence(
    'camp-1',
    [
      {
        presenceId: 'a',
        campaignId: 'camp-1',
        accountId: 'acc-online',
        displayLabel: 'Online',
        deviceSessionId: 'dev-1',
        tabId: 'tab-1',
        seatId: 'seat-1',
        spectator: false,
        lastHeartbeatAt: onlineAt,
        connectedAt: onlineAt,
        status: 'online',
      },
      {
        presenceId: 'b',
        campaignId: 'camp-1',
        accountId: 'acc-grace',
        displayLabel: 'Grace',
        deviceSessionId: 'dev-2',
        tabId: 'tab-2',
        seatId: 'seat-2',
        spectator: false,
        lastHeartbeatAt: graceAt,
        connectedAt: graceAt,
        status: 'online',
      },
    ],
    3,
    now,
  );
  assert.deepEqual([...projection.onlineAccountIds], ['acc-online']);
  assert.deepEqual([...projection.graceAccountIds], ['acc-grace']);
  assert.equal(projection.stateVersion, 3);
});

test('provider compliance registry covers AI, speech, and identity', () => {
  const categories = new Set(PROVIDER_COMPLIANCE_REGISTRY.map((entry) => entry.category));
  assert.equal(categories.has('ai_text'), true);
  assert.equal(categories.has('speech_tts'), true);
  assert.equal(categories.has('speech_stt'), true);
  assert.equal(categories.has('identity'), true);
});

test('Director Address is a dock peer destination with nonmutation notice', () => {
  assert.equal(DOCK_TABS.includes('director_address'), true);
  assert.match(DIRECTOR_ADDRESS_NOTICE, /never mutates/i);
});
