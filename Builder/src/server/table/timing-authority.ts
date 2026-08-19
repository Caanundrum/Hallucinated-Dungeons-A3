/**
 * Server-issued Timing Authority for Phase 2d Active Turn opportunities.
 *
 * Blueprint ownership: Section 11.10 — clients cannot mint authorities; every
 * encounter mutation validates a current authority before acceptance.
 */

import { randomUUID } from 'node:crypto';

import type { Firestore, Timestamp, Transaction } from 'firebase-admin/firestore';

import {
  ACTIVE_TURN_PERMITTED_COMMANDS,
  TIMING_AUTHORITY_SCHEMA_VERSION,
  type TimingAuthorityClaimResponse,
  type TimingAuthorityProjection,
  type TimingAuthorityState,
  type TimingOpportunityClass,
} from '../../shared/timing-authority-contract.js';
import { ERROR_CODES } from '../../shared/contract.js';
import type { EncounterProjection } from '../../shared/rules-combat-contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';

/** Table commands allowed without Timing Authority outside active combat. */
export const EXPLORATION_TABLE_COMMANDS = ['table.move', 'table.open_door', 'table.sync'] as const;

export class TimingAuthorityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TimingAuthorityError';
    this.code = code;
  }
}

/** Active Turn lifetime for local Phase 2d proof. */
export const ACTIVE_TURN_TTL_MS = 15 * 60 * 1000;

interface StoredSeat {
  readonly seatId: string;
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly characterId: string;
}

interface StoredTimingAuthority {
  readonly timingAuthorityId: string;
  readonly schemaVersion: typeof TIMING_AUTHORITY_SCHEMA_VERSION;
  readonly opportunityClass: TimingOpportunityClass;
  readonly campaignId: string;
  readonly seatId: string;
  readonly characterId: string;
  readonly accountId: string;
  readonly permittedCommandTypes: readonly string[];
  readonly projectionVersionAtIssue: number;
  readonly issuedAt: Timestamp | Date;
  readonly expiresAt: Timestamp | Date;
  state: TimingAuthorityState;
  readonly singleUse: boolean;
  readonly encounterId: string;
  readonly resolutionFrameId: string;
}

function toIso(value: Timestamp | Date): string {
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

function toDate(value: Timestamp | Date): Date {
  return value instanceof Date ? value : value.toDate();
}

function projectAuthority(stored: StoredTimingAuthority): TimingAuthorityProjection {
  return {
    timingAuthorityId: stored.timingAuthorityId,
    schemaVersion: stored.schemaVersion,
    opportunityClass: stored.opportunityClass,
    campaignId: stored.campaignId,
    seatId: stored.seatId,
    characterId: stored.characterId,
    accountId: stored.accountId,
    permittedCommandTypes: stored.permittedCommandTypes,
    projectionVersionAtIssue: stored.projectionVersionAtIssue,
    issuedAt: toIso(stored.issuedAt),
    expiresAt: toIso(stored.expiresAt),
    state: stored.state,
    singleUse: stored.singleUse,
  };
}

async function assertMember(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<void> {
  const membership = await options.firestore
    .collection(COLLECTIONS.campaignMemberships)
    .where('campaignId', '==', options.campaignId)
    .where('accountId', '==', options.accountId)
    .limit(1)
    .get();
  if (membership.empty) {
    throw new TimingAuthorityError(ERROR_CODES.NOT_FOUND, 'No such route.');
  }
}

async function loadOwnSeat(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<StoredSeat> {
  const seatSnap = await options.firestore
    .collection(COLLECTIONS.campaignSeats)
    .where('campaignId', '==', options.campaignId)
    .where('ownerAccountId', '==', options.accountId)
    .limit(1)
    .get();
  if (seatSnap.empty) {
    throw new TimingAuthorityError(
      ERROR_CODES.NOT_SEATED,
      'Seat a character you own before claiming Timing Authority.',
    );
  }
  return seatSnap.docs[0]!.data() as StoredSeat;
}

function refreshExpired(stored: StoredTimingAuthority, now: Date): StoredTimingAuthority {
  if (stored.state === 'issued' && toDate(stored.expiresAt).getTime() <= now.getTime()) {
    return { ...stored, state: 'expired' };
  }
  return stored;
}

function isActiveCombat(encounter: EncounterProjection | null): encounter is EncounterProjection {
  return encounter !== null && encounter.status === 'active';
}

/** Marks issued Active Turn credentials superseded inside an open transaction. */
export async function supersedeIssuedActiveTurnAuthorities(options: {
  readonly transaction: Transaction;
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly now: Date;
}): Promise<void> {
  const { transaction, firestore, campaignId, now } = options;
  const existingQuery = firestore
    .collection(COLLECTIONS.timingAuthorities)
    .where('campaignId', '==', campaignId)
    .limit(20);
  const existing = await transaction.get(existingQuery);
  for (const doc of existing.docs) {
    const prior = refreshExpired(doc.data() as StoredTimingAuthority, now);
    if (prior.state === 'issued' && prior.opportunityClass === 'active_turn') {
      transaction.update(doc.ref, { state: 'superseded' });
    } else if (prior.state === 'expired' && (doc.data() as StoredTimingAuthority).state === 'issued') {
      transaction.update(doc.ref, { state: 'expired' });
    }
  }
}

/** Issues Active Turn Authority to the active party combatant during initiative. */
export function writeCombatTurnAuthority(options: {
  readonly transaction: Transaction;
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly seatId: string;
  readonly characterId: string;
  readonly accountId: string;
  readonly encounterId: string;
  readonly projectionVersion: number;
  readonly issuedAt: Date;
}): string {
  const timingAuthorityId = randomUUID();
  const expiresAt = new Date(options.issuedAt.getTime() + ACTIVE_TURN_TTL_MS);
  const record: StoredTimingAuthority = {
    timingAuthorityId,
    schemaVersion: TIMING_AUTHORITY_SCHEMA_VERSION,
    opportunityClass: 'active_turn',
    campaignId: options.campaignId,
    seatId: options.seatId,
    characterId: options.characterId,
    accountId: options.accountId,
    permittedCommandTypes: [...ACTIVE_TURN_PERMITTED_COMMANDS],
    projectionVersionAtIssue: options.projectionVersion,
    issuedAt: options.issuedAt,
    expiresAt,
    state: 'issued',
    singleUse: false,
    encounterId: options.encounterId,
    resolutionFrameId: `frame:${timingAuthorityId}`,
  };
  options.transaction.set(
    options.firestore.collection(COLLECTIONS.timingAuthorities).doc(timingAuthorityId),
    record,
  );
  return timingAuthorityId;
}

/**
 * Validates Timing Authority for table commands.
 * Exploration movement and doors do not require a credential until combat is active.
 */
export async function requireTableCommandTimingAuthority(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
  readonly seatId: string;
  readonly timingAuthorityId: string | undefined;
  readonly commandType: string;
  readonly encounter: EncounterProjection | null;
}): Promise<void> {
  const { encounter, commandType, ...authorityOptions } = options;
  if (
    !isActiveCombat(encounter) &&
    (EXPLORATION_TABLE_COMMANDS as readonly string[]).includes(commandType)
  ) {
    return;
  }
  await requireTimingAuthority({ ...authorityOptions, commandType, consume: false });
}

/** Returns the current viewer-safe Active Turn authority for this campaign, if any. */
export async function fetchActiveTimingAuthority(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<TimingAuthorityProjection | null> {
  await assertMember(options);
  const snap = await options.firestore
    .collection(COLLECTIONS.timingAuthorities)
    .where('campaignId', '==', options.campaignId)
    .where('state', '==', 'issued')
    .limit(5)
    .get();
  const now = new Date();
  const available: StoredTimingAuthority[] = [];
  for (const doc of snap.docs) {
    const stored = refreshExpired(doc.data() as StoredTimingAuthority, now);
    if (stored.state !== 'issued') {
      await doc.ref.update({ state: 'expired' });
      continue;
    }
    available.push(stored);
  }
  const own = available
    .filter((stored) => stored.accountId === options.accountId)
    .sort((left, right) => {
      const priority = (opportunityClass: TimingOpportunityClass) =>
        opportunityClass === 'reaction' ? 0 : opportunityClass === 'decision' ? 1 : 2;
      return priority(left.opportunityClass) - priority(right.opportunityClass);
    })[0];
  if (own !== undefined) {
    return projectAuthority(own);
  }
  const heldByOther = available.find((stored) => stored.opportunityClass === 'active_turn');
  if (heldByOther !== undefined) {
    return {
      ...projectAuthority(heldByOther),
      // Other viewers learn that someone holds the turn, not the credential.
      timingAuthorityId: 'held-by-other',
      permittedCommandTypes: [],
    };
  }
  return null;
}

/**
 * Issues Active Turn Authority to the caller's seat, superseding any prior
 * issued Active Turn on the campaign.
 */
export async function claimActiveTurnAuthority(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<TimingAuthorityClaimResponse> {
  const { firestore, accountId, campaignId } = options;
  await assertMember({ firestore, accountId, campaignId });
  const seat = await loadOwnSeat({ firestore, accountId, campaignId });

  const projectionSnap = await firestore
    .collection(COLLECTIONS.campaignTableProjections)
    .doc(campaignId)
    .get();
  const projectionVersion = projectionSnap.exists
    ? ((projectionSnap.data() as { stateVersion?: number }).stateVersion ?? 0)
    : 0;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ACTIVE_TURN_TTL_MS);
  const timingAuthorityId = randomUUID();
  let supersededAuthorityId: string | null = null;

  await firestore.runTransaction(async (transaction) => {
    const existingQuery = firestore
      .collection(COLLECTIONS.timingAuthorities)
      .where('campaignId', '==', campaignId)
      .limit(20);
    const existing = await transaction.get(existingQuery);

    for (const doc of existing.docs) {
      const prior = refreshExpired(doc.data() as StoredTimingAuthority, now);
      if (prior.state === 'issued' && prior.opportunityClass === 'active_turn') {
        transaction.update(doc.ref, { state: 'superseded' });
        supersededAuthorityId = prior.timingAuthorityId;
      } else if (prior.state === 'expired' && (doc.data() as StoredTimingAuthority).state === 'issued') {
        transaction.update(doc.ref, { state: 'expired' });
      }
    }

    const record: StoredTimingAuthority = {
      timingAuthorityId,
      schemaVersion: TIMING_AUTHORITY_SCHEMA_VERSION,
      opportunityClass: 'active_turn',
      campaignId,
      seatId: seat.seatId,
      characterId: seat.characterId,
      accountId,
      permittedCommandTypes: [...ACTIVE_TURN_PERMITTED_COMMANDS],
      projectionVersionAtIssue: projectionVersion,
      issuedAt: now,
      expiresAt,
      state: 'issued',
      singleUse: false,
      encounterId: `exploration:${campaignId}`,
      resolutionFrameId: `frame:${timingAuthorityId}`,
    };
    transaction.set(
      firestore.collection(COLLECTIONS.timingAuthorities).doc(timingAuthorityId),
      record,
    );
  });

  const created = await firestore
    .collection(COLLECTIONS.timingAuthorities)
    .doc(timingAuthorityId)
    .get();
  return {
    authority: projectAuthority(created.data() as StoredTimingAuthority),
    supersededAuthorityId,
  };
}

export async function endActiveTurnAuthority(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
  readonly timingAuthorityId: string;
}): Promise<TimingAuthorityProjection> {
  const { firestore, accountId, campaignId, timingAuthorityId } = options;
  await assertMember({ firestore, accountId, campaignId });
  const ref = firestore.collection(COLLECTIONS.timingAuthorities).doc(timingAuthorityId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new TimingAuthorityError(
      ERROR_CODES.TIMING_AUTHORITY_INVALID,
      'That Timing Authority is not available.',
    );
  }
  const stored = refreshExpired(snap.data() as StoredTimingAuthority, new Date());
  if (stored.accountId !== accountId || stored.campaignId !== campaignId) {
    throw new TimingAuthorityError(
      ERROR_CODES.TIMING_AUTHORITY_INVALID,
      'That Timing Authority is not available.',
    );
  }
  if (stored.state !== 'issued') {
    throw new TimingAuthorityError(
      ERROR_CODES.TIMING_AUTHORITY_INVALID,
      'That Timing Authority is no longer active.',
    );
  }
  await ref.update({ state: 'revoked' });
  return projectAuthority({ ...stored, state: 'revoked' });
}

/**
 * Active-Initiative disconnect lock (Phase 4): when a seated authority holder
 * enters reconnect grace / offline, revoke their issued Active Turn so the
 * table cannot accept stale mechanical commands from a disconnected device.
 */
export async function lockActiveTurnOnDisconnect(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly accountId: string;
}): Promise<TimingAuthorityProjection | null> {
  const { firestore, campaignId, accountId } = options;
  const snap = await firestore
    .collection(COLLECTIONS.timingAuthorities)
    .where('campaignId', '==', campaignId)
    .where('accountId', '==', accountId)
    .where('state', '==', 'issued')
    .get();
  if (snap.empty) {
    return null;
  }
  let locked: TimingAuthorityProjection | null = null;
  for (const doc of snap.docs) {
    const stored = refreshExpired(doc.data() as StoredTimingAuthority, new Date());
    if (stored.state !== 'issued' || stored.opportunityClass !== 'active_turn') {
      continue;
    }
    await doc.ref.update({ state: 'revoked' });
    locked = projectAuthority({ ...stored, state: 'revoked' });
  }
  return locked;
}

/**
 * Validates and optionally consumes a Timing Authority inside a command path.
 * Returns the verified stored authority when valid.
 */
export async function requireTimingAuthority(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
  readonly seatId: string;
  readonly timingAuthorityId: string | undefined;
  readonly commandType: string;
  readonly consume: boolean;
}): Promise<StoredTimingAuthority> {
  const { firestore, accountId, campaignId, seatId, timingAuthorityId, commandType, consume } =
    options;
  if (typeof timingAuthorityId !== 'string' || timingAuthorityId.length === 0) {
    throw new TimingAuthorityError(
      ERROR_CODES.TIMING_AUTHORITY_REQUIRED,
      'A current Timing Authority is required before that table command can be accepted.',
    );
  }
  if (timingAuthorityId === 'held-by-other') {
    throw new TimingAuthorityError(
      ERROR_CODES.TIMING_AUTHORITY_INVALID,
      'Another seat currently holds Active Turn Authority.',
    );
  }

  const ref = firestore.collection(COLLECTIONS.timingAuthorities).doc(timingAuthorityId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new TimingAuthorityError(
      ERROR_CODES.TIMING_AUTHORITY_INVALID,
      'That Timing Authority is not available.',
    );
  }
  const now = new Date();
  let stored = refreshExpired(snap.data() as StoredTimingAuthority, now);
  if (stored.state === 'expired') {
    await ref.update({ state: 'expired' });
    throw new TimingAuthorityError(
      ERROR_CODES.TIMING_AUTHORITY_INVALID,
      'That Timing Authority expired.',
    );
  }
  if (stored.state !== 'issued') {
    throw new TimingAuthorityError(
      ERROR_CODES.TIMING_AUTHORITY_INVALID,
      'That Timing Authority is no longer active.',
    );
  }
  if (
    stored.accountId !== accountId ||
    stored.campaignId !== campaignId ||
    stored.seatId !== seatId
  ) {
    throw new TimingAuthorityError(
      ERROR_CODES.TIMING_AUTHORITY_INVALID,
      'That Timing Authority does not match this seat.',
    );
  }
  if (!stored.permittedCommandTypes.includes(commandType)) {
    throw new TimingAuthorityError(
      ERROR_CODES.TIMING_AUTHORITY_INVALID,
      'That Timing Authority does not permit this command type.',
    );
  }
  if (consume && stored.singleUse) {
    await ref.update({ state: 'consumed' });
    stored = { ...stored, state: 'consumed' };
  }
  return stored;
}
