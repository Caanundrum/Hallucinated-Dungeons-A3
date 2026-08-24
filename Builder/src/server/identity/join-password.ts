/**
 * Join-password hashing for public tables. Passwords are never stored in plain text.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { JOIN_PASSWORD_MAX_LENGTH } from '../../shared/campaign-contract.js';

const SCRYPT_KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export class JoinPasswordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JoinPasswordValidationError';
  }
}

/** Stored as `scrypt:<saltHex>:<hashHex>`. */
export function hashJoinPassword(plain: string): string {
  const trimmed = plain.trim();
  if (trimmed.length === 0) {
    throw new JoinPasswordValidationError('Join password cannot be empty when provided.');
  }
  if (trimmed.length > JOIN_PASSWORD_MAX_LENGTH) {
    throw new JoinPasswordValidationError(
      `Join password must be at most ${JOIN_PASSWORD_MAX_LENGTH} characters.`,
    );
  }
  const salt = randomBytes(SALT_LENGTH);
  const hash = scryptSync(trimmed, salt, SCRYPT_KEY_LENGTH);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyJoinPassword(plain: string, stored: string): boolean {
  const trimmed = plain.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  const actual = scryptSync(trimmed, salt, expected.length);
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
