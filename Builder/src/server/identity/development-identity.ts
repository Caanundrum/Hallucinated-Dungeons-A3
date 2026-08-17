/**
 * Development Test Identity, Google emulator identity, and QA fixture sessions.
 *
 * Blueprint ownership: Sections 1.5.20, 19.11.3, 25 Phase 0/4.
 *
 * Development identities: Local Arena only, no password.
 * Google Sign-In mode: Auth emulator locally with server-verified email;
 * real Google on Milestone (this module still refuses development mint off local).
 * QA fixtures: machine-only, Local Arena only, never hosted.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { Auth } from 'firebase-admin/auth';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import type { DevelopmentIdentityProjection } from '../../shared/contract.js';
import type { IdentityProviderMode } from '../../shared/presence-contract.js';
import type { ServerEnvironment } from '../config/environment.js';
import { isBootstrapAdminEmail } from '../admin/admin-auth.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import { isLocalArenaPublicSurface } from '../release/public-surface.js';

/** Lifetime of a minted development identity and its session. */
export const DEVELOPMENT_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

export interface MintedSession {
  readonly sessionToken: string;
  readonly identity: DevelopmentIdentityProjection;
}

export interface ResolvedSession {
  readonly accountId: string;
  readonly identity: DevelopmentIdentityProjection;
  /** Opaque device-session identifier used when binding a seat (Section 7.7.2). */
  readonly deviceSessionId: string;
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

function projectIdentity(stored: {
  accountId: string;
  displayLabel: string;
  identityMode?: IdentityProviderMode;
  email?: string | null;
  expiresAt: Timestamp | Date;
}): DevelopmentIdentityProjection {
  const email =
    typeof stored.email === 'string' && stored.email.trim().length > 0
      ? stored.email.trim().toLowerCase()
      : null;
  const identityMode: IdentityProviderMode = stored.identityMode ?? 'development_test_identity';
  return {
    accountId: stored.accountId,
    displayLabel: stored.displayLabel,
    identityMode,
    expiresAt: toIsoString(stored.expiresAt),
    email,
    isBootstrapAdmin: isBootstrapAdminEmail(email),
  };
}

async function issueSession(options: {
  readonly firestore: Firestore;
  readonly env: ServerEnvironment;
  readonly accountId: string;
  readonly identity: DevelopmentIdentityProjection;
  readonly now: Date;
  readonly expiresAt: Date;
}): Promise<MintedSession> {
  const sessionToken = randomBytes(32).toString('base64url');
  const sessionTokenHash = hashSessionToken(sessionToken);
  await options.firestore.collection(COLLECTIONS.developmentSessions).doc(sessionTokenHash).set({
    sessionTokenHash,
    accountId: options.accountId,
    createdAt: options.now,
    expiresAt: options.expiresAt,
    environmentClass: options.env.environmentClass,
    candidateId: options.env.candidateId,
    identityMode: options.identity.identityMode,
  });
  return { sessionToken, identity: options.identity };
}

/**
 * Creates a Development Test Identity in the Auth emulator, records it in
 * Firestore, and issues an opaque single-account session token.
 */
export async function mintDevelopmentIdentity(options: {
  readonly env: ServerEnvironment;
  readonly firestore: Firestore;
  readonly auth: Auth;
  readonly now?: Date;
}): Promise<MintedSession> {
  const { env, firestore, auth } = options;
  if (!isLocalArenaPublicSurface(env)) {
    throw new IdentityUnavailableError(
      'Development identities exist only inside the Local Arena public surface and are stripped from Gold Master artifacts.',
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
    email: null,
    createdAt: now,
    expiresAt,
    creationAuthority: 'local_arena_server',
    environmentClass: env.environmentClass,
    candidateId: env.candidateId,
  });

  return issueSession({
    firestore,
    env,
    accountId,
    now,
    expiresAt,
    identity: projectIdentity({
      accountId,
      displayLabel,
      identityMode: 'development_test_identity',
      email: null,
      expiresAt,
    }),
  });
}

/**
 * Mints a Google Sign-In mode identity against the Auth emulator with a
 * server-verified email. Used for Local Arena Admin/bootstrap proof and Google
 * contract tests. Hosted Milestone uses real Google tokens through the same
 * projection shape — never client-supplied email.
 */
export async function mintGoogleEmulatorIdentity(options: {
  readonly env: ServerEnvironment;
  readonly firestore: Firestore;
  readonly auth: Auth;
  readonly email: string;
  readonly displayLabel?: string;
  readonly now?: Date;
}): Promise<MintedSession> {
  const { env, firestore, auth } = options;
  if (env.environmentClass !== 'local') {
    throw new IdentityUnavailableError(
      'Google emulator identities exist only inside the Local Arena.',
    );
  }
  const email = options.email.trim().toLowerCase();
  if (!email.includes('@')) {
    throw new IdentityUnavailableError('A verified email is required for Google emulator identity.');
  }

  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + DEVELOPMENT_SESSION_TTL_MS);
  const accountId = `google-${createHash('sha256').update(email).digest('hex').slice(0, 16)}`;
  const displayLabel = options.displayLabel ?? email.split('@')[0] ?? 'Google Player';

  try {
    await auth.createUser({
      uid: accountId,
      email,
      emailVerified: true,
      displayName: displayLabel,
      disabled: false,
    });
  } catch {
    // Reuse existing Auth emulator user for the same email/uid.
  }

  await firestore.collection(COLLECTIONS.developmentIdentities).doc(accountId).set({
    accountId,
    displayLabel,
    identityMode: 'google_sign_in',
    email,
    createdAt: now,
    expiresAt,
    creationAuthority: 'local_arena_google_emulator',
    environmentClass: env.environmentClass,
    candidateId: env.candidateId,
  });

  return issueSession({
    firestore,
    env,
    accountId,
    now,
    expiresAt,
    identity: projectIdentity({
      accountId,
      displayLabel,
      identityMode: 'google_sign_in',
      email,
      expiresAt,
    }),
  });
}

/**
 * Machine-only QA fixture session. Unavailable outside Local Arena.
 */
export async function mintQaFixtureSession(options: {
  readonly env: ServerEnvironment;
  readonly firestore: Firestore;
  readonly auth: Auth;
  readonly fixtureLabel: string;
  readonly now?: Date;
}): Promise<MintedSession> {
  const { env, firestore, auth } = options;
  if (!isLocalArenaPublicSurface(env)) {
    throw new IdentityUnavailableError('QA fixture sessions exist only inside the Local Arena public surface and are stripped from Gold Master artifacts.');
  }

  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + DEVELOPMENT_SESSION_TTL_MS);
  const accountId = `qa-${randomUUID()}`;
  const displayLabel = `QA Fixture ${options.fixtureLabel}`.slice(0, 64);

  await auth.createUser({
    uid: accountId,
    displayName: displayLabel,
    disabled: false,
  });

  await firestore.collection(COLLECTIONS.developmentIdentities).doc(accountId).set({
    accountId,
    displayLabel,
    identityMode: 'qa_fixture_session',
    email: null,
    createdAt: now,
    expiresAt,
    creationAuthority: 'local_arena_qa_fixture',
    environmentClass: env.environmentClass,
    candidateId: env.candidateId,
  });

  return issueSession({
    firestore,
    env,
    accountId,
    now,
    expiresAt,
    identity: projectIdentity({
      accountId,
      displayLabel,
      identityMode: 'qa_fixture_session',
      email: null,
      expiresAt,
    }),
  });
}

/**
 * Resolves a session token to its owning account, or null when the token is
 * absent, unknown, or expired.
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
    identityMode?: IdentityProviderMode;
    email?: string | null;
    expiresAt: Timestamp;
  };

  return {
    accountId: identity.accountId,
    identity: projectIdentity(identity),
    deviceSessionId: sessionTokenHash,
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
