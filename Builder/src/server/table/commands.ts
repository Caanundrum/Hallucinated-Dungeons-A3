/**
 * Campaign table command gateway — Phase 2a authority core.
 *
 * Accepts seated-member commands with expected state version + requestId,
 * appends an immutable event, and publishes a new table projection inside one
 * Firestore transaction. Duplicates return the original commit without
 * advancing the version (Section 19.7–19.8).
 */

import { randomUUID } from 'node:crypto';

import { type Firestore, type Timestamp } from 'firebase-admin/firestore';

import {
  TABLE_EVENT_PAGE_SIZE,
  type TableCommandAcceptResponse,
  type TableCommandType,
  type TableEventProjection,
  type TableStateProjection,
} from '../../shared/command-contract.js';
import { ERROR_CODES } from '../../shared/contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';

export class TableCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TableCommandError';
    this.code = code;
  }
}

interface StoredSeat {
  readonly seatId: string;
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly characterId: string;
  readonly deviceSessionId: string;
  lastAcknowledgedEventSequence: number;
}

interface StoredEvent {
  readonly eventId: string;
  readonly campaignId: string;
  readonly eventSequence: number;
  readonly eventType: 'table.state_synced';
  readonly commandId: string;
  readonly requestId: string;
  readonly actorAccountId: string;
  readonly seatId: string;
  readonly priorStateVersion: number;
  readonly resultStateVersion: number;
  readonly committedAt: Timestamp | Date;
}

interface StoredCommand {
  readonly commandId: string;
  readonly campaignId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly commandType: TableCommandType;
  readonly actorAccountId: string;
  readonly seatId: string;
  readonly expectedStateVersion: number;
  readonly eventId: string;
  readonly acceptedAt: Timestamp | Date;
}

interface StoredProjection {
  readonly campaignId: string;
  readonly stateVersion: number;
  readonly lastEventSequence: number;
  readonly lastEventId: string | null;
  readonly updatedAt: Timestamp | Date | null;
}

function toIso(value: Timestamp | Date | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value.toDate().toISOString();
}

function toEventProjection(stored: StoredEvent): TableEventProjection {
  return {
    eventId: stored.eventId,
    eventSequence: stored.eventSequence,
    eventType: stored.eventType,
    commandId: stored.commandId,
    requestId: stored.requestId,
    actorAccountId: stored.actorAccountId,
    seatId: stored.seatId,
    priorStateVersion: stored.priorStateVersion,
    resultStateVersion: stored.resultStateVersion,
    committedAt: toIso(stored.committedAt) ?? new Date(0).toISOString(),
  };
}

async function loadRecentEvents(
  firestore: Firestore,
  campaignId: string,
): Promise<TableEventProjection[]> {
  // Equality-only query + in-memory sort (same pattern as Chronicle) so the
  // Local Arena does not depend on a composite index for this feed.
  const snapshot = await firestore
    .collection(COLLECTIONS.campaignEvents)
    .where('campaignId', '==', campaignId)
    .limit(200)
    .get();
  return snapshot.docs
    .map((doc) => toEventProjection(doc.data() as StoredEvent))
    .sort((left, right) => left.eventSequence - right.eventSequence)
    .slice(-TABLE_EVENT_PAGE_SIZE);
}

function toTableProjection(
  campaignId: string,
  stored: StoredProjection | null,
  recentEvents: readonly TableEventProjection[],
): TableStateProjection {
  return {
    campaignId,
    stateVersion: stored?.stateVersion ?? 0,
    lastEventSequence: stored?.lastEventSequence ?? 0,
    lastEventId: stored?.lastEventId ?? null,
    updatedAt: toIso(stored?.updatedAt ?? null),
    recentEvents,
  };
}

async function assertCampaignMember(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<void> {
  const { firestore, accountId, campaignId } = options;
  const membership = await firestore
    .collection(COLLECTIONS.campaignMemberships)
    .where('campaignId', '==', campaignId)
    .where('accountId', '==', accountId)
    .limit(1)
    .get();
  if (membership.empty) {
    throw new TableCommandError(ERROR_CODES.NOT_FOUND, 'No such route.');
  }
  const campaign = await firestore.collection(COLLECTIONS.campaigns).doc(campaignId).get();
  if (!campaign.exists) {
    throw new TableCommandError(ERROR_CODES.NOT_FOUND, 'No such route.');
  }
}

async function loadOwnSeat(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<StoredSeat> {
  const { firestore, accountId, campaignId } = options;
  const seatSnap = await firestore
    .collection(COLLECTIONS.campaignSeats)
    .where('campaignId', '==', campaignId)
    .where('ownerAccountId', '==', accountId)
    .limit(1)
    .get();
  if (seatSnap.empty) {
    throw new TableCommandError(
      ERROR_CODES.NOT_SEATED,
      'Seat a character you own in this campaign before submitting table commands.',
    );
  }
  return seatSnap.docs[0]!.data() as StoredSeat;
}

/** Returns the current table projection for a campaign the account belongs to. */
export async function fetchTableState(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<TableStateProjection> {
  const { firestore, accountId, campaignId } = options;
  await assertCampaignMember({ firestore, accountId, campaignId });

  const projectionRef = firestore.collection(COLLECTIONS.campaignTableProjections).doc(campaignId);
  const snapshot = await projectionRef.get();
  const stored = snapshot.exists ? (snapshot.data() as StoredProjection) : null;
  const recentEvents = await loadRecentEvents(firestore, campaignId);
  return toTableProjection(campaignId, stored, recentEvents);
}

/**
 * Accepts a `table.sync` command from a seated member.
 *
 * Idempotency key: `(campaignId, actorAccountId, requestId)`.
 * State precondition: `expectedStateVersion` must equal the current projection.
 */
export async function acceptTableCommand(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
  readonly requestId: string;
  readonly commandType: TableCommandType;
  readonly expectedStateVersion: number;
  readonly deviceSessionId: string;
}): Promise<TableCommandAcceptResponse> {
  const {
    firestore,
    accountId,
    campaignId,
    requestId,
    commandType,
    expectedStateVersion,
    deviceSessionId,
  } = options;

  if (commandType !== 'table.sync') {
    throw new TableCommandError(ERROR_CODES.BAD_REQUEST, 'That table command type is not supported.');
  }
  if (
    typeof expectedStateVersion !== 'number' ||
    !Number.isInteger(expectedStateVersion) ||
    expectedStateVersion < 0
  ) {
    throw new TableCommandError(
      ERROR_CODES.BAD_REQUEST,
      'expectedStateVersion must be a non-negative integer.',
    );
  }
  if (
    typeof deviceSessionId !== 'string' ||
    deviceSessionId.length === 0 ||
    deviceSessionId.length > 128
  ) {
    throw new TableCommandError(ERROR_CODES.BAD_REQUEST, 'deviceSessionId is required.');
  }

  await assertCampaignMember({ firestore, accountId, campaignId });
  const seat = await loadOwnSeat({ firestore, accountId, campaignId });

  const projectionRef = firestore.collection(COLLECTIONS.campaignTableProjections).doc(campaignId);
  const idempotencyKey = `${campaignId}:${accountId}:${requestId}`;

  const committed = await firestore.runTransaction(async (transaction) => {
    const duplicateQuery = firestore
      .collection(COLLECTIONS.campaignCommands)
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1);
    const duplicateSnapshot = await transaction.get(duplicateQuery);
    const projectionSnapshot = await transaction.get(projectionRef);
    const current: StoredProjection = projectionSnapshot.exists
      ? (projectionSnapshot.data() as StoredProjection)
      : {
          campaignId,
          stateVersion: 0,
          lastEventSequence: 0,
          lastEventId: null,
          updatedAt: null,
        };

    if (!duplicateSnapshot.empty) {
      const existingCommand = duplicateSnapshot.docs[0]!.data() as StoredCommand;
      const eventSnap = await transaction.get(
        firestore.collection(COLLECTIONS.campaignEvents).doc(existingCommand.eventId),
      );
      if (!eventSnap.exists) {
        throw new TableCommandError(
          ERROR_CODES.UPSTREAM_UNAVAILABLE,
          'A prior command commit could not be recovered.',
        );
      }
      return {
        duplicate: true as const,
        command: existingCommand,
        event: eventSnap.data() as StoredEvent,
        projection: current,
      };
    }

    if (current.stateVersion !== expectedStateVersion) {
      throw new TableCommandError(
        ERROR_CODES.STALE_STATE_VERSION,
        `This table moved on (server version ${current.stateVersion}). Reload the table state, then retry.`,
      );
    }

    const commandId = randomUUID();
    const eventId = randomUUID();
    const committedAt = new Date();
    const nextVersion = current.stateVersion + 1;
    const nextSequence = current.lastEventSequence + 1;

    const command: StoredCommand = {
      commandId,
      campaignId,
      requestId,
      idempotencyKey,
      commandType,
      actorAccountId: accountId,
      seatId: seat.seatId,
      expectedStateVersion,
      eventId,
      acceptedAt: committedAt,
    };

    const event: StoredEvent = {
      eventId,
      campaignId,
      eventSequence: nextSequence,
      eventType: 'table.state_synced',
      commandId,
      requestId,
      actorAccountId: accountId,
      seatId: seat.seatId,
      priorStateVersion: current.stateVersion,
      resultStateVersion: nextVersion,
      committedAt,
    };

    const nextProjection: StoredProjection = {
      campaignId,
      stateVersion: nextVersion,
      lastEventSequence: nextSequence,
      lastEventId: eventId,
      updatedAt: committedAt,
    };

    transaction.set(firestore.collection(COLLECTIONS.campaignCommands).doc(commandId), command);
    transaction.set(firestore.collection(COLLECTIONS.campaignEvents).doc(eventId), event);
    transaction.set(projectionRef, nextProjection);
    transaction.update(firestore.collection(COLLECTIONS.campaignSeats).doc(seat.seatId), {
      lastAcknowledgedEventSequence: nextSequence,
      deviceSessionId,
    });

    return {
      duplicate: false as const,
      command,
      event,
      projection: nextProjection,
    };
  });

  const recentEvents = await loadRecentEvents(firestore, campaignId);
  const eventProjection = toEventProjection(committed.event);
  const withEvent = recentEvents.some((entry) => entry.eventId === eventProjection.eventId)
    ? recentEvents
    : [...recentEvents, eventProjection];

  return {
    duplicate: committed.duplicate,
    commandId: committed.command.commandId,
    requestId: committed.command.requestId,
    event: eventProjection,
    table: toTableProjection(campaignId, committed.projection, withEvent),
  };
}
