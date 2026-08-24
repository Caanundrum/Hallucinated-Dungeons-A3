import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hashJoinPassword, verifyJoinPassword } from '../../dist/server/identity/join-password.js';

test('join password hash verifies correct password and rejects wrong password', () => {
  const stored = hashJoinPassword('river-dock');
  assert.ok(stored.startsWith('scrypt:'));
  assert.equal(verifyJoinPassword('river-dock', stored), true);
  assert.equal(verifyJoinPassword('wrong', stored), false);
  assert.equal(verifyJoinPassword('', stored), false);
});

test('join password hash rejects empty plain text', () => {
  assert.throws(() => hashJoinPassword('   '), /cannot be empty/i);
});