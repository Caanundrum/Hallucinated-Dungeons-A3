/**
 * Campaign table command gateway — Phase 2 authority core.
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
  type TableEventType,
  type TableStateProjection,
} from '../../shared/command-contract.js';
import {
  DEFAULT_MOVEMENT_BUDGET_FEET,
  DEFAULT_VISION_RADIUS_SQUARES,
  type MovementPreviewProjection,
} from '../../shared/movement-contract.js';
import { ERROR_CODES } from '../../shared/contract.js';
import type { RulesCommandFields } from '../../shared/rules-combat-contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import {
  RULES_COMMAND_TYPES,
  acceptRulesCommand,
} from '../rules/engine/rules-commands.js';
import {
  buildAuthoritativeMapBundle,
  loadCampaignSeats,
} from './map-projection.js';
import {
  emptyMapRuntime,
  loadMapRuntime,
  mergeExplored,
  upsertTokenPosition,
  type StoredMapRuntime,
} from './map-runtime.js';
import { validateWalkPath, visibleSquaresFrom } from './path-validator.js';
import { requireTimingAuthority, TimingAuthorityError } from './timing-authority.js';

export { TimingAuthorityError };

async function loadMapBuildContext(
  firestore: Firestore,
  campaignId: string,
): Promise<{
  readonly adventureTemplateId: string | null;
  readonly currentChapterId: string | null;
  readonly seats: Awaited<ReturnType<typeof loadCampaignSeats>>;
  readonly runtime: StoredMapRuntime;
}> {
  const [campaignSnap, seats, runtime, memorySnap] = await Promise.all([
    firestore.collection(COLLECTIONS.campaigns).doc(campaignId).get(),
    loadCampaignSeats(firestore, campaignId),
    loadMapRuntime(firestore, campaignId),
    firestore.collection(COLLECTIONS.campaignMemory).doc(campaignId).get(),
  ]);
  const campaignData = campaignSnap.exists
    ? (campaignSnap.data() as { adventureTemplateId?: string | null })
    : null;
  const memoryData = memorySnap.exists
    ? (memorySnap.data() as { currentChapterId?: string | null })
    : null;
  return {
    adventureTemplateId: campaignData?.adventureTemplateId ?? null,
    currentChapterId: memoryData?.currentChapterId ?? null,
    seats,
    runtime,
  };
}

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
  readonly eventType: TableEventType;
  readonly commandId: string;
  readonly requestId: string;
  readonly actorAccountId: string;
  readonly seatId: string;
  readonly priorStateVersion: number;
  readonly resultStateVersion: number;
  readonly committedAt: Timestamp | Date;
  readonly path?: readonly { readonly column: number; readonly row: number }[];
  readonly edgeId?: string;
  readonly summary?: string;
  readonly rolls?: readonly number[];
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
  readonly path?: readonly { readonly column: number; readonly row: number }[];
  readonly edgeId?: string;
}

interface StoredProjection extends StoredMapRuntime {
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
    ...(stored.summary === undefined ? {} : { summary: stored.summary }),
    ...(stored.rolls === undefined ? {} : { rolls: stored.rolls }),
  };
}

async function loadRecentEvents(
  firestore: Firestore,
  campaignId: string,
): Promise<TableEventProjection[]> {
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

function emptyProjection(campaignId: string): StoredProjection {
  return {
    ...emptyMapRuntime(campaignId),
    stateVersion: 0,
    lastEventSequence: 0,
    lastEventId: null,
    updatedAt: null,
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

export async function previewTableMove(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
  readonly path: readonly { readonly column: number; readonly row: number }[];
  readonly movementBudgetFeet?: number;
}): Promise<MovementPreviewProjection> {
  const { firestore, accountId, campaignId, path } = options;
  await assertCampaignMember({ firestore, accountId, campaignId });
  const seat = await loadOwnSeat({ firestore, accountId, campaignId });
  const context = await loadMapBuildContext(firestore, campaignId);
  const map = buildAuthoritativeMapBundle({
    campaignId,
    seats: context.seats,
    runtime: context.runtime,
    adventureTemplateId: context.adventureTemplateId,
    currentChapterId: context.currentChapterId,
  });
  const token = map.tokens.find((entry) => entry.seatId === seat.seatId);
  if (token === undefined) {
    throw new TableCommandError(ERROR_CODES.NOT_SEATED, 'No token is bound to your seat.');
  }
  return validateWalkPath({
    map,
    start: token.footprint.anchor,
    path,
    footprintTemplate: {
      size: token.footprint.size,
      width: token.footprint.width,
      height: token.footprint.height,
      tinySlot: token.footprint.tinySlot,
      elevationFeet: token.footprint.elevationFeet,
    },
    movementBudgetFeet: options.movementBudgetFeet ?? DEFAULT_MOVEMENT_BUDGET_FEET,
    movementMode: 'walk',
    actorSeatId: seat.seatId,
  });
}

/**
 * Accepts table.sync / table.move / table.open_door from a seated member.
 */
export async function acceptTableCommand(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
  readonly requestId: string;
  readonly commandType: TableCommandType;
  readonly expectedStateVersion: number;
  readonly deviceSessionId: string;
  readonly timingAuthorityId?: string;
  readonly path?: readonly { readonly column: number; readonly row: number }[];
  readonly edgeId?: string;
} & RulesCommandFields): Promise<TableCommandAcceptResponse> {
  const {
    firestore,
    accountId,
    campaignId,
    requestId,
    commandType,
    expectedStateVersion,
    deviceSessionId,
    timingAuthorityId,
    path,
    edgeId,
    targetCombatantId,
    attackId,
    spellId,
    area,
    reactionKind,
    decisionWindowId,
    readyTrigger,
    xpAmount,
    itemId,
  } = options;

  if ((RULES_COMMAND_TYPES as readonly string[]).includes(commandType)) {
    return acceptRulesCommand({
      firestore,
      accountId,
      campaignId,
      requestId,
      commandType,
      expectedStateVersion,
      deviceSessionId,
      ...(timingAuthorityId === undefined ? {} : { timingAuthorityId }),
      ...(targetCombatantId === undefined ? {} : { targetCombatantId }),
      ...(attackId === undefined ? {} : { attackId }),
      ...(spellId === undefined ? {} : { spellId }),
      ...(area === undefined ? {} : { area }),
      ...(reactionKind === undefined ? {} : { reactionKind }),
      ...(decisionWindowId === undefined ? {} : { decisionWindowId }),
      ...(readyTrigger === undefined ? {} : { readyTrigger }),
      ...(xpAmount === undefined ? {} : { xpAmount }),
      ...(itemId === undefined ? {} : { itemId }),
    });
  }

  if (
    commandType !== 'table.sync' &&
    commandType !== 'table.move' &&
    commandType !== 'table.open_door'
  ) {
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

  // Duplicate recovery must not require a still-valid Timing Authority.
  const priorDuplicate = await firestore
    .collection(COLLECTIONS.campaignCommands)
    .where('idempotencyKey', '==', idempotencyKey)
    .limit(1)
    .get();
  if (!priorDuplicate.empty) {
    const existingCommand = priorDuplicate.docs[0]!.data() as StoredCommand;
    const eventSnap = await firestore
      .collection(COLLECTIONS.campaignEvents)
      .doc(existingCommand.eventId)
      .get();
    if (!eventSnap.exists) {
      throw new TableCommandError(
        ERROR_CODES.UPSTREAM_UNAVAILABLE,
        'A prior command commit could not be recovered.',
      );
    }
    const projectionSnap = await projectionRef.get();
    const stored = projectionSnap.exists
      ? ({ ...emptyProjection(campaignId), ...(projectionSnap.data() as StoredProjection) } as StoredProjection)
      : emptyProjection(campaignId);
    const recentEvents = await loadRecentEvents(firestore, campaignId);
    const eventProjection = toEventProjection(eventSnap.data() as StoredEvent);
    return {
      duplicate: true,
      commandId: existingCommand.commandId,
      requestId: existingCommand.requestId,
      event: eventProjection,
      table: toTableProjection(campaignId, stored, recentEvents),
    };
  }

  await requireTimingAuthority({
    firestore,
    accountId,
    campaignId,
    seatId: seat.seatId,
    timingAuthorityId,
    commandType,
    consume: false,
  });
  const mapContext = await loadMapBuildContext(firestore, campaignId);

  // Pre-validate movement / door outside the transaction using current runtime.
  let movePath: readonly { readonly column: number; readonly row: number }[] | undefined;
  let openEdgeId: string | undefined;
  let eventType: TableEventType = 'table.state_synced';
  let syncVisionSquares: { column: number; row: number }[] = [];

  if (commandType === 'table.move') {
    if (!Array.isArray(path) || path.length === 0) {
      throw new TableCommandError(ERROR_CODES.BAD_REQUEST, 'table.move requires a path.');
    }
    const map = buildAuthoritativeMapBundle({
      campaignId,
      seats: mapContext.seats,
      runtime: mapContext.runtime,
      adventureTemplateId: mapContext.adventureTemplateId,
      currentChapterId: mapContext.currentChapterId,
    });
    const token = map.tokens.find((entry) => entry.seatId === seat.seatId);
    if (token === undefined) {
      throw new TableCommandError(ERROR_CODES.NOT_SEATED, 'No token is bound to your seat.');
    }
    const preview = validateWalkPath({
      map,
      start: token.footprint.anchor,
      path,
      footprintTemplate: {
        size: token.footprint.size,
        width: token.footprint.width,
        height: token.footprint.height,
        tinySlot: token.footprint.tinySlot,
        elevationFeet: token.footprint.elevationFeet,
      },
      movementBudgetFeet: DEFAULT_MOVEMENT_BUDGET_FEET,
      movementMode: 'walk',
      actorSeatId: seat.seatId,
    });
    if (!preview.legal) {
      throw new TableCommandError(
        ERROR_CODES.ILLEGAL_PATH,
        preview.rejectionMessage ?? 'That path is not legal.',
      );
    }
    movePath = path;
    eventType = 'table.token_moved';
  }

  if (commandType === 'table.open_door') {
    if (typeof edgeId !== 'string' || edgeId.length === 0) {
      throw new TableCommandError(ERROR_CODES.BAD_REQUEST, 'table.open_door requires edgeId.');
    }
    const map = buildAuthoritativeMapBundle({
      campaignId,
      seats: mapContext.seats,
      runtime: mapContext.runtime,
      adventureTemplateId: mapContext.adventureTemplateId,
      currentChapterId: mapContext.currentChapterId,
    });
    const edge = map.edges.find((entry) => entry.edgeId === edgeId);
    if (edge === undefined || edge.kind !== 'door') {
      throw new TableCommandError(ERROR_CODES.BAD_REQUEST, 'That door edge does not exist.');
    }
    if (edge.doorState === 'open') {
      throw new TableCommandError(ERROR_CODES.BAD_REQUEST, 'That door is already open.');
    }
    const token = map.tokens.find((entry) => entry.seatId === seat.seatId);
    if (token === undefined) {
      throw new TableCommandError(ERROR_CODES.NOT_SEATED, 'No token is bound to your seat.');
    }
    const doorNeighbor = { column: edge.column + 1, row: edge.row };
    const nearDoor =
      Math.max(
        Math.abs(token.footprint.anchor.column - edge.column),
        Math.abs(token.footprint.anchor.row - edge.row),
      ) <= 1 ||
      Math.max(
        Math.abs(token.footprint.anchor.column - doorNeighbor.column),
        Math.abs(token.footprint.anchor.row - doorNeighbor.row),
      ) <= 1;
    if (!nearDoor) {
      throw new TableCommandError(
        ERROR_CODES.ILLEGAL_PATH,
        'Move adjacent to the door before opening it.',
      );
    }
    openEdgeId = edgeId;
    eventType = 'table.door_opened';
  }

  if (commandType === 'table.sync') {
    const map = buildAuthoritativeMapBundle({
      campaignId,
      seats: mapContext.seats,
      runtime: mapContext.runtime,
      adventureTemplateId: mapContext.adventureTemplateId,
      currentChapterId: mapContext.currentChapterId,
    });
    const token = map.tokens.find((entry) => entry.seatId === seat.seatId);
    if (token !== undefined) {
      syncVisionSquares = visibleSquaresFrom(
        token.footprint.anchor,
        DEFAULT_VISION_RADIUS_SQUARES,
        map.coordinateSpace,
      );
    }
  }

  const committed = await firestore.runTransaction(async (transaction) => {
    const duplicateQuery = firestore
      .collection(COLLECTIONS.campaignCommands)
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1);
    const duplicateSnapshot = await transaction.get(duplicateQuery);
    const projectionSnapshot = await transaction.get(projectionRef);
    const current: StoredProjection = projectionSnapshot.exists
      ? ({ ...emptyProjection(campaignId), ...(projectionSnapshot.data() as StoredProjection) } as StoredProjection)
      : emptyProjection(campaignId);

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

    let tokenPositions = current.tokenPositions ?? [];
    let doorStates = { ...(current.doorStates ?? {}) };
    let exploredByAccount = { ...(current.exploredByAccount ?? {}) };

    if (commandType === 'table.move' && movePath !== undefined && movePath.length > 0) {
      const destination = movePath[movePath.length - 1]!;
      tokenPositions = upsertTokenPosition(tokenPositions, seat.seatId, destination);
      const vision = visibleSquaresFrom(destination, DEFAULT_VISION_RADIUS_SQUARES, {
        columns: 12,
        rows: 8,
      });
      exploredByAccount[accountId] = mergeExplored(exploredByAccount[accountId], [
        ...movePath,
        destination,
        ...vision,
      ]);
    }

    if (commandType === 'table.open_door' && openEdgeId !== undefined) {
      doorStates[openEdgeId] = 'open';
    }

    if (commandType === 'table.sync' && syncVisionSquares.length > 0) {
      exploredByAccount[accountId] = mergeExplored(
        exploredByAccount[accountId],
        syncVisionSquares,
      );
    }

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
      ...(movePath !== undefined ? { path: movePath } : {}),
      ...(openEdgeId !== undefined ? { edgeId: openEdgeId } : {}),
    };

    const event: StoredEvent = {
      eventId,
      campaignId,
      eventSequence: nextSequence,
      eventType,
      commandId,
      requestId,
      actorAccountId: accountId,
      seatId: seat.seatId,
      priorStateVersion: current.stateVersion,
      resultStateVersion: nextVersion,
      committedAt,
      ...(movePath !== undefined ? { path: movePath } : {}),
      ...(openEdgeId !== undefined ? { edgeId: openEdgeId } : {}),
    };

    const nextProjection: StoredProjection = {
      campaignId,
      stateVersion: nextVersion,
      lastEventSequence: nextSequence,
      lastEventId: eventId,
      updatedAt: committedAt,
      tokenPositions,
      doorStates,
      exploredByAccount,
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
