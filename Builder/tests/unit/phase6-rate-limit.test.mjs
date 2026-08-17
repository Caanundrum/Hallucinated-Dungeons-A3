import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkRateLimit,
  rateLimitKeyForAiGateway,
  rateLimitKeyForCommands,
  rateLimitKeyForPartyChat,
  readArenaRateLimitDefaults,
  resetRateLimitBuckets,
} from '../../dist/server/security/rate-limit.js';
import { ERROR_CODES } from '../../dist/shared/contract.js';

test('ERROR_CODES.RATE_LIMITED is stable', () => {
  assert.equal(ERROR_CODES.RATE_LIMITED, 'RATE_LIMITED');
});

test('readArenaRateLimitDefaults honors Local Arena defaults and env overrides', () => {
  const defaults = readArenaRateLimitDefaults({});
  assert.equal(defaults.windowMs, 60_000);
  assert.equal(defaults.commandsPerWindow, 60);
  assert.equal(defaults.chatPerWindow, 30);
  assert.equal(defaults.aiPerWindow, 20);

  const overridden = readArenaRateLimitDefaults({
    HD_RATE_LIMIT_WINDOW_MS: '60000',
    HD_RATE_LIMIT_COMMANDS_PER_WINDOW: '5',
    HD_RATE_LIMIT_CHAT_PER_WINDOW: '3',
    HD_RATE_LIMIT_AI_PER_WINDOW: '2',
  });
  assert.equal(overridden.windowMs, 60_000);
  assert.equal(overridden.commandsPerWindow, 5);
  assert.equal(overridden.chatPerWindow, 3);
  assert.equal(overridden.aiPerWindow, 2);
});

test('bucket key helpers are account-scoped', () => {
  assert.equal(rateLimitKeyForCommands('dev-1'), 'commands:dev-1');
  assert.equal(rateLimitKeyForPartyChat('dev-1'), 'party-chat:dev-1');
  assert.equal(rateLimitKeyForAiGateway('dev-1'), 'ai:dev-1');
});

test('sliding-window limiter allows up to limit then refuses with retryAfterMs', () => {
  resetRateLimitBuckets();
  const key = 'unit-commands:a';
  const windowMs = 1_000;
  const limit = 3;
  const t0 = 1_000_000;

  assert.equal(checkRateLimit({ key, limit, windowMs, nowMs: t0 }).allowed, true);
  assert.equal(checkRateLimit({ key, limit, windowMs, nowMs: t0 + 10 }).allowed, true);
  assert.equal(checkRateLimit({ key, limit, windowMs, nowMs: t0 + 20 }).allowed, true);

  const blocked = checkRateLimit({ key, limit, windowMs, nowMs: t0 + 30 });
  assert.equal(blocked.allowed, false);
  assert.equal(typeof blocked.retryAfterMs, 'number');
  assert.ok((blocked.retryAfterMs ?? 0) > 0);
  assert.ok((blocked.retryAfterMs ?? 0) <= windowMs);
});

test('sliding window frees capacity once the oldest attempt ages out', () => {
  resetRateLimitBuckets();
  const key = 'unit-chat:b';
  const windowMs = 100;
  const limit = 2;
  const t0 = 5_000;

  assert.equal(checkRateLimit({ key, limit, windowMs, nowMs: t0 }).allowed, true);
  assert.equal(checkRateLimit({ key, limit, windowMs, nowMs: t0 + 10 }).allowed, true);
  assert.equal(checkRateLimit({ key, limit, windowMs, nowMs: t0 + 20 }).allowed, false);

  // Oldest at t0 falls out at t0 + windowMs.
  const after = checkRateLimit({ key, limit, windowMs, nowMs: t0 + windowMs + 1 });
  assert.equal(after.allowed, true);
});

test('distinct keys do not share budgets', () => {
  resetRateLimitBuckets();
  const windowMs = 1_000;
  const limit = 1;
  assert.equal(
    checkRateLimit({ key: 'commands:one', limit, windowMs, nowMs: 1 }).allowed,
    true,
  );
  assert.equal(
    checkRateLimit({ key: 'commands:two', limit, windowMs, nowMs: 1 }).allowed,
    true,
  );
  assert.equal(
    checkRateLimit({ key: 'commands:one', limit, windowMs, nowMs: 2 }).allowed,
    false,
  );
});
