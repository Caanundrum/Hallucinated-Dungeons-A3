/**
 * Development Test Identity minting and session authority.
 *
 * Blueprint ownership: Sections 1.5.20 (development identity, no interim
 * username/password system), 19.11.3 (Development Test Identity record), and
 * 25 Phase 0 ("temporary development identity sufficient for local testing").
 *
 * The identity is server-minted, has no repeatable password, carries a stable
 * internal account identifier, expires, and is refused outside the Local
 * Execution Environment.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { Auth } from 'firebase-admin/auth';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import type { DevelopmentIdentityProjection } from '../../shared/contract.js';
import type { ServerEnvironment } from '../config/environment.js';
import { COLLECTIONS } from '../persistence/firestore.js';

/** Lifetime of a minted development identity and its session. */
export const DEVELOPMENT_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

export interface MintedSession {
  readonly sessionToken: string;
  readonly identity: DevelopmentIdentityProjection;
}

export interface ResolvedSession {
  readonly accountId: string;
  readonly identity: DevelopmentIdentityProjection;
}

export class IdentityUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityUnavailableError';
  }
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two hex digests. Session lookup is by digest, so
 * this guards the final equality check against timing analysis.
 */
function digestsMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function toIsoString(value: Timestamp | Date): string {
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

/**
 * Creates a Development Test Identity in the Auth emulator, records it in
 * Firestore, and issues an opaque single-account session token.
 *
 * The raw token is returned once, to be placed in an http-only cookie. Only
 * its SHA-256 digest is persisted, so a leaked database export cannot be
 * replayed as a session.
 */
export async function mintDevelopmentIdentity(options: {
  readonly env: ServerEnvironment;
  readonly firestore: Firestore;
  readonly auth: Auth;
  readonly now?: Date;
}): Promise<MintedSession> {
  const { env, firestore, auth } = options;
  if (env.environmentClass !== 'local') {
    throw new IdentityUnavailableError(
      'Development identities exist only inside the Local Arena.',
    );
  }

  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + DEVELOPMENT_SESSION_TTL_MS);
  const accountId = `dev-${randomUUID()}`;
  const displayLabel = `Local Builder ${accountId.slice(4, 10)}`;

  await auth.createUser({
    uid: accountId,
    displayName: displayLabel,
    disabled: false,
  });

  await firestore.collection(COLLECTIONS.developmentIdentities).doc(accountId).set({
    accountId,
    displayLabel,
    identityMode: 'development_test_identity',
    createdAt: now,
    expiresAt,
    creationAuthority: 'local_arena_server',
    environmentClass: env.environmentClass,
    candidateId: env.candidateId,
  });

  const sessionToken = randomBytes(32).toString('base64url');
  const sessionTokenHash = hashSessionToken(sessionToken);

  await firestore.collection(COLLECTIONS.developmentSessions).doc(sessionTokenHash).set({
    sessionTokenHash,
    accountId,
    createdAt: now,
    expiresAt,
    environmentClass: env.environmentClass,
    candidateId: env.candidateId,
  });

  return {
    sessionToken,
    identity: {
      accountId,
      displayLabel,
      identityMode: 'development_test_identity',
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/**
 * Resolves a session token to its owning account, or null when the token is
 * absent, unknown, or expired. An expired session is deleted so a stale
 * browser cookie cannot be reused.
 */
export async function resolveSession(options: {
  readonly firestore: Firestore;
  readonly sessionToken: string | null;
  readonly now?: Date;
}): Promise<ResolvedSession | null> {
  const { firestore, sessionToken } = options;
  if (sessionToken === null || sessionToken === '') {
    return null;
  }

  const now = options.now ?? new Date();
  const sessionTokenHash = hashSessionToken(sessionToken);
  const sessionRef = firestore.collection(COLLECTIONS.developmentSessions).doc(sessionTokenHash);
  const sessionSnapshot = await sessionRef.get();
  if (!sessionSnapshot.exists) {
    return null;
  }

  const session = sessionSnapshot.data() as {
    sessionTokenHash: string;
    accountId: string;
    expiresAt: Timestamp;
  };

  if (!digestsMatch(session.sessionTokenHash, sessionTokenHash)) {
    return null;
  }

  const expiresAt = session.expiresAt.toDate();
  if (expiresAt.getTime() <= now.getTime()) {
    await sessionRef.delete();
    return null;
  }

  const identitySnapshot = await firestore
    .collection(COLLECTIONS.developmentIdentities)
    .doc(session.accountId)
    .get();
  if (!identitySnapshot.exists) {
    await sessionRef.delete();
    return null;
  }

  const identity = identitySnapshot.data() as {
    accountId: string;
    displayLabel: string;
    expiresAt: Timestamp;
  };

  return {
    accountId: identity.accountId,
    identity: {
      accountId: identity.accountId,
      displayLabel: identity.displayLabel,
      identityMode: 'development_test_identity',
      expiresAt: toIsoString(identity.expiresAt),
    },
  };
}

/** Ends a session by deleting its server-side record. */
export async function endSession(options: {
  readonly firestore: Firestore;
  readonly sessionToken: string | null;
}): Promise<void> {
  const { firestore, sessionToken } = options;
  if (sessionToken === null || sessionToken === '') {
    return;
  }
  await firestore
    .collection(COLLECTIONS.developmentSessions)
    .doc(hashSessionToken(sessionToken))
    .delete();
}
