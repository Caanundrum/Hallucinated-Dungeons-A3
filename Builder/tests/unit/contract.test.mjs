import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import {
  ERROR_CODES,
  FOUNDATION_NOTE_MAX_LENGTH,
  isValidRequestId,
  validateNote,
} from '../../dist/shared/contract.js';

test('a well-formed request identifier is accepted', () => {
  assert.equal(isValidRequestId(randomUUID()), true);
});

test('a malformed or absent request identifier is rejected', () => {
  for (const value of [undefined, null, '', 'not-a-uuid', 12345, randomUUID().slice(0, -1)]) {
    assert.equal(isValidRequestId(value), false, `expected rejection for ${String(value)}`);
  }
});

test('a note is trimmed and accepted', () => {
  const result = validateNote('  a foundation check  ');
  assert.equal(result.ok, true);
  assert.equal(result.note, 'a foundation check');
});

test('an empty or whitespace-only note is rejected with its own code', () => {
  for (const value of ['', '   ', '\t\n']) {
    const result = validateNote(value);
    assert.equal(result.ok, false);
    assert.equal(result.code, ERROR_CODES.NOTE_EMPTY);
  }
});

test('a note longer than the accepted length is rejected', () => {
  const result = validateNote('x'.repeat(FOUNDATION_NOTE_MAX_LENGTH + 1));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.NOTE_TOO_LONG);

  const atLimit = validateNote('x'.repeat(FOUNDATION_NOTE_MAX_LENGTH));
  assert.equal(atLimit.ok, true);
});

test('a non-string note is rejected as a bad request', () => {
  for (const value of [undefined, null, 42, {}, []]) {
    const result = validateNote(value);
    assert.equal(result.ok, false);
    assert.equal(result.code, ERROR_CODES.BAD_REQUEST);
  }
});
