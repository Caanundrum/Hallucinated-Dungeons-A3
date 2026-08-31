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
import { appendChronicleEntry } from '../communication/chronicle.js';
import {
  assertSessionAllowsPlay,
  CampaignMemoryError,
} from '../campaigns/campaign-memory.js';
import {
  RULES_COMMAND_TYPES,
  acceptRulesCommand,
} from '../rules/engine/rules-commands.js';
import { loadEncounter } from '../rules/engine/encounter-runtime.js';
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
import {
  beginAdventureRuntime,
  interactObjectRuntime,
  loadCampaignPremise,
  travelSceneRuntime,
} from './scene-commands.js';
import { activeSceneInstance } from './map-runtime.js';
import { validateWalkPath, visibleSquaresFrom } from './path-validator.js';
import {
  doorStateAfterUnlockSuccess,
  storedDoorStateFromAuthority,
} from '../../shared/play-authority-contract.js';
import type { MapBundleProjection, MapEdgeRecord, MapSquareCoordinate } from '../../shared/map-contract.js';
import { resolveSkillAttemptFromSummary } from './skill-check-resolve.js';

function isAdjacentToDoorEdge(anchor: MapSquareCoordinate, edge: MapEdgeRecord): boolean {
  return (
    (edge.orientation === 'east' &&
      edge.row === anchor.row &&
      (edge.column === anchor.column || edge.column === anchor.column - 1)) ||
    (edge.orientation === 'north' &&
      edge.column === anchor.column &&
      (edge.row === anchor.row || edge.row === anchor.row - 1)) ||
    (edge.orientation === 'west' &&
      edge.row === anchor.row &&
      (edge.column === anchor.column || edge.column === anchor.column + 1)) ||
    (edge.orientation === 'south' &&
      edge.column === anchor.column &&
      (edge.row === anchor.row || edge.row === anchor.row - 1))
  );
}

/** Prefer an adjacent closed/locked door for unlock success; else nearest on the scene. */
function resolveUnlockTargetEdge(
  map: MapBundleProjection,
  anchor: MapSquareCoordinate | null,
): MapEdgeRecord | null {
  const candidates = map.edges.filter(
    (edge) =>
      edge.kind === 'door' &&
      edge.doorState !== 'open' &&
      edge.doorState !== 'unlocked',
  );
  if (candidates.length === 0) {
    return null;
  }
  if (anchor !== null) {
    const adjacent = candidates.find((edge) => isAdjacentToDoorEdge(anchor, edge));
    if (adjacent !== undefined) {
      return adjacent;
    }
    let nearest = candidates[0]!;
    let nearestDistance = Infinity;
    for (const door of candidates) {
      const distance = Math.abs(anchor.column - door.column) + Math.abs(anchor.row - door.row);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = door;
      }
    }
    return nearest;
  }
  return candidates[0] ?? null;
}
import {
  baseSheetFor,
  loadCharacterRulesSource,
} from '../rules/engine/encounter-runtime.js';
import { proposeDoorSceneAhead } from './scene-builder.js';
import { requireTableCommandTimingAuthority, TimingAuthorityError } from './timing-authority.js';

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
  readonly conflict?: import('../../shared/table-contention-contract.js').TableConflictDetail;

  constructor(
    code: string,
    message: string,
    conflict?: import('../../shared/table-contention-contract.js').TableConflictDetail,
  ) {
    super(message);
    this.name = 'TableCommandError';
    this.code = code;
    if (conflict !== undefined) {
      this.conflict = conflict;
    }
  }
}

interface StoredSeat {
  readonly seatId: string;
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly characterId: string;
  readonly characterName?: string;
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
  readonly npcSpotlight?: import('../../shared/table-contention-contract.js').NpcSpotlightProjection | null;
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
  const spotlight = stored?.npcSpotlight ?? null;
  const spotlightLive =
    spotlight !== null && Date.parse(spotlight.expiresAt) > Date.now() ? spotlight : null;
  return {
    campaignId,
    stateVersion: stored?.stateVersion ?? 0,
    lastEventSequence: stored?.lastEventSequence ?? 0,
    lastEventId: stored?.lastEventId ?? null,
    updatedAt: toIso(stored?.updatedAt ?? null),
    recentEvents,
    npcSpotlight: spotlightLive,
  };
}

function emptyProjection(campaignId: string): StoredProjection {
  return {
    ...emptyMapRuntime(campaignId),
    stateVersion: 0,
    lastEventSequence: 0,
    lastEventId: null,
    updatedAt: null,
    npcSpotlight: null,
  };
}

export function classifyExplorationConflict(options: {
  readonly commandType: TableCommandType;
  readonly current: StoredProjection;
  readonly expectedStateVersion: number;
  readonly openEdgeId?: string;
  readonly movePath?: readonly { readonly column: number; readonly row: number }[];
  readonly actorSeatId: string;
  readonly encounterActive: boolean;
}): import('../../shared/table-contention-contract.js').TableConflictDetail {
  const {
    commandType,
    current,
    expectedStateVersion,
    openEdgeId,
    movePath,
    actorSeatId,
    encounterActive,
  } = options;
  if (encounterActive && (commandType === 'table.move' || commandType === 'table.open_door' || commandType === 'table.build_scene' || commandType === 'table.begin_adventure' || commandType === 'table.interact_object' || commandType === 'table.travel_scene')) {
    return {
      reason: 'scene_lock',
      message:
        'Combat started while your free-roam action was in flight. Initiative owns the scene now — re-declare on your turn.',
      competingSummary: 'Encounter is active.',
      serverStateVersion: current.stateVersion,
    };
  }
  if (
    commandType === 'table.open_door' &&
    typeof openEdgeId === 'string' &&
    current.doorStates?.[openEdgeId] === 'open'
  ) {
    return {
      reason: 'same_door',
      message:
        'Someone else already opened that door. The latch is free — choose another beat or sync the table.',
      edgeId: openEdgeId,
      competingSummary: 'Door is already open.',
      serverStateVersion: current.stateVersion,
    };
  }
  if (commandType === 'table.move' && movePath !== undefined && movePath.length > 0) {
    const destination = movePath[movePath.length - 1]!;
    const occupant = (current.tokenPositions ?? []).find(
      (token) =>
        token.seatId !== actorSeatId &&
        token.column === destination.column &&
        token.row === destination.row,
    );
    if (occupant !== undefined) {
      return {
        reason: 'overlapping_move',
        message:
          'Another adventurer already stands on that square. Pick a different path or wait for them to move.',
        contestedSquares: [{ column: destination.column, row: destination.row }],
        competingSummary: 'That destination square is occupied.',
        serverStateVersion: current.stateVersion,
      };
    }
  }
  return {
    reason: 'version_race',
    message: `This table moved on (server version ${current.stateVersion}; you had ${expectedStateVersion}). Reload, then retry — or re-declare if another beat landed first.`,
    competingSummary: `Table is now at version ${current.stateVersion}.`,
    serverStateVersion: current.stateVersion,
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
  readonly objectId?: string;
  readonly destinationHint?: string;
  readonly returnToPrevious?: boolean;
  readonly premise?: string;
  /** Player-facing beat summary for Chronicle (table commands only). */
  readonly summary?: string;
  /** Confirmed player declaration — chronicled only after Confirm (TQA-005). */
  readonly declaration?: string;
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
    objectId,
    destinationHint,
    returnToPrevious,
    premise: premiseOverride,
    targetCombatantId,
    attackId,
    spellId,
    area,
    reactionKind,
    decisionWindowId,
    readyTrigger,
    xpAmount,
    itemId,
    declaredFoes,
    arcaneRecovery,
    summary: playBeatSummary,
    declaration: playDeclaration,
  } = options;

  const trimmedPlaySummary =
    typeof playBeatSummary === 'string' && playBeatSummary.trim().length > 0
      ? playBeatSummary.trim().slice(0, 500)
      : undefined;
  const trimmedDeclaration =
    typeof playDeclaration === 'string' && playDeclaration.trim().length > 0
      ? playDeclaration.trim().slice(0, 500)
      : undefined;

  try {
    await assertSessionAllowsPlay(firestore, campaignId);
  } catch (error) {
    if (error instanceof CampaignMemoryError) {
      throw new TableCommandError(ERROR_CODES.BAD_REQUEST, error.message);
    }
    throw error;
  }

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
      ...(declaredFoes === undefined ? {} : { declaredFoes }),
      ...(arcaneRecovery === true ? { arcaneRecovery: true } : {}),
    });
  }

  if (
    commandType !== 'table.sync' &&
    commandType !== 'table.move' &&
    commandType !== 'table.open_door' &&
    commandType !== 'table.build_scene' &&
    commandType !== 'table.begin_adventure' &&
    commandType !== 'table.interact_object' &&
    commandType !== 'table.travel_scene'
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
  const encounter = await loadEncounter(firestore, campaignId);

  if (commandType !== 'table.sync' && encounter !== null && encounter.status === 'active') {
    const ownCombatant = encounter.combatants.find((combatant) => combatant.seatId === seat.seatId);
    if (
      ownCombatant !== undefined &&
      (ownCombatant.currentHitPoints <= 0 ||
        ownCombatant.conditions.some((condition) => condition.conditionId === 'unconscious') ||
        ownCombatant.deathSaves.dead)
    ) {
      throw new TableCommandError(
        ERROR_CODES.BAD_REQUEST,
        'Your character is incapacitated and cannot commit table actions.',
      );
    }
  }

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

  await requireTableCommandTimingAuthority({
    firestore,
    accountId,
    campaignId,
    seatId: seat.seatId,
    timingAuthorityId,
    commandType,
    encounter,
  });
  const mapContext = await loadMapBuildContext(firestore, campaignId);

  // Pre-validate movement / door outside the transaction using current runtime.
  let movePath: readonly { readonly column: number; readonly row: number }[] | undefined;
  let openEdgeId: string | undefined;
  let buildSceneEdges: StoredMapRuntime['runtimeEdges'] | undefined;
  let buildSceneTitle: string | null | undefined;
  let eventType: TableEventType = 'table.state_synced';
  let syncVisionSquares: { column: number; row: number }[] = [];
  let skillResolution: {
    summary: string;
    rolls: readonly number[];
    lockYielded: boolean;
  } | null = null;
  let unlockEdgeId: string | undefined;
  let nextSceneRuntime: StoredMapRuntime | undefined;
  let sceneChronicleBody: string | undefined;

  if (commandType === 'table.begin_adventure') {
    const premise =
      typeof premiseOverride === 'string' && premiseOverride.trim().length > 0
        ? premiseOverride.trim()
        : await loadCampaignPremise(firestore, campaignId);
    try {
      const result = beginAdventureRuntime({
        runtime: mapContext.runtime,
        premise,
        campaignId,
        accountId,
        seatTokens: mapContext.runtime.tokenPositions.length
          ? mapContext.runtime.tokenPositions
          : [{ seatId: seat.seatId, column: 2, row: 2 }],
      });
      nextSceneRuntime = result.runtime;
      buildSceneTitle = result.composed.title;
      sceneChronicleBody = result.chronicle;
      eventType = 'table.scene_built';
    } catch (error) {
      if (error instanceof Error && error.message === 'ADVENTURE_ALREADY_STARTED') {
        throw new TableCommandError(
          ERROR_CODES.BAD_REQUEST,
          'This adventure already has an established scene.',
        );
      }
      throw error;
    }
  }

  if (commandType === 'table.interact_object') {
    const targetObjectId =
      typeof objectId === 'string' && objectId.length > 0
        ? objectId
        : null;
    if (targetObjectId === null) {
      throw new TableCommandError(
        ERROR_CODES.BAD_REQUEST,
        'Name the object you want to change on this scene.',
      );
    }
    try {
      const result = interactObjectRuntime({
        runtime: mapContext.runtime,
        objectId: targetObjectId,
        declaration: trimmedDeclaration ?? trimmedPlaySummary ?? '',
      });
      nextSceneRuntime = result.runtime;
      sceneChronicleBody = result.chronicle;
      eventType = 'table.object_changed';
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'NO_ACTIVE_SCENE') {
        throw new TableCommandError(
          ERROR_CODES.BAD_REQUEST,
          'Begin the adventure before changing scene objects.',
        );
      }
      if (code === 'OBJECT_NOT_INTERACTABLE') {
        throw new TableCommandError(
          ERROR_CODES.BAD_REQUEST,
          'That object is not interactable on this scene.',
        );
      }
      if (code === 'OBJECT_STATE_UNCHANGED') {
        throw new TableCommandError(
          ERROR_CODES.BAD_REQUEST,
          'That object is already in that state.',
        );
      }
      throw error;
    }
  }

  if (commandType === 'table.travel_scene') {
    const hint =
      typeof destinationHint === 'string' && destinationHint.trim().length > 0
        ? destinationHint.trim()
        : trimmedDeclaration ?? 'travel onward';
    try {
      const result = travelSceneRuntime({
        runtime: mapContext.runtime,
        campaignId,
        accountId,
        destinationHint: hint,
        returnToPrevious: returnToPrevious === true,
        seatTokens: mapContext.runtime.tokenPositions.length
          ? mapContext.runtime.tokenPositions
          : [{ seatId: seat.seatId, column: 2, row: 2 }],
      });
      nextSceneRuntime = result.runtime;
      buildSceneTitle = result.composed?.title ?? activeSceneInstance(result.runtime)?.title ?? null;
      sceneChronicleBody = result.chronicle;
      eventType = 'table.scene_traveled';
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'NO_ACTIVE_SCENE') {
        throw new TableCommandError(
          ERROR_CODES.BAD_REQUEST,
          'Begin the adventure before traveling to another scene.',
        );
      }
      if (code === 'NO_PRIOR_SCENE') {
        throw new TableCommandError(
          ERROR_CODES.BAD_REQUEST,
          'There is no earlier scene to return to yet.',
        );
      }
      throw error;
    }
  }

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
      throw new TableCommandError(
        ERROR_CODES.BAD_REQUEST,
        'That door could not be identified on the map. Move next to a closed door and declare opening it again.',
      );
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
      throw new TableCommandError(ERROR_CODES.BAD_REQUEST, 'That door is not on this scene.');
    }
    if (edge.doorState === 'open') {
      throw new TableCommandError(ERROR_CODES.BAD_REQUEST, 'That door is already open.');
    }
    if (edge.doorState === 'locked') {
      throw new TableCommandError(
        ERROR_CODES.BAD_REQUEST,
        'That door is locked. Declare a lock attempt before opening it.',
      );
    }
    const token = map.tokens.find((entry) => entry.seatId === seat.seatId);
    if (token === undefined) {
      throw new TableCommandError(ERROR_CODES.NOT_SEATED, 'No token is bound to your seat.');
    }
    const anchor = token.footprint.anchor;
    const doorNeighbor =
      edge.orientation === 'north'
        ? { column: edge.column, row: edge.row - 1 }
        : { column: edge.column + 1, row: edge.row };
    const nearDoor =
      Math.max(Math.abs(anchor.column - edge.column), Math.abs(anchor.row - edge.row)) <= 1 ||
      Math.max(
        Math.abs(anchor.column - doorNeighbor.column),
        Math.abs(anchor.row - doorNeighbor.row),
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

  if (commandType === 'table.build_scene') {
    const map = buildAuthoritativeMapBundle({
      campaignId,
      seats: mapContext.seats,
      runtime: mapContext.runtime,
      adventureTemplateId: mapContext.adventureTemplateId,
      currentChapterId: mapContext.currentChapterId,
    });
    if (!map.mapBundleId.startsWith('blank:')) {
      throw new TableCommandError(
        ERROR_CODES.BAD_REQUEST,
        'Scene construction is only available on blank tables.',
      );
    }
    if ((mapContext.runtime.runtimeEdges ?? []).length > 0 || map.edges.length > 0) {
      throw new TableCommandError(
        ERROR_CODES.BAD_REQUEST,
        'This table already has scene geometry.',
      );
    }
    const token = map.tokens.find((entry) => entry.seatId === seat.seatId);
    if (token === undefined) {
      throw new TableCommandError(ERROR_CODES.NOT_SEATED, 'No token is bound to your seat.');
    }
    const proposal = proposeDoorSceneAhead({ tokenAnchor: token.footprint.anchor });
    buildSceneEdges = proposal.edges;
    buildSceneTitle = proposal.sceneTitle;
    if (typeof edgeId === 'string' && edgeId.length > 0) {
      const doorEdge = proposal.edges.find((entry) => entry.edgeId === edgeId);
      if (doorEdge === undefined || doorEdge.kind !== 'door') {
        throw new TableCommandError(
          ERROR_CODES.BAD_REQUEST,
          'That door could not be placed on the improvised scene.',
        );
      }
      openEdgeId = edgeId;
    }
    eventType = 'table.scene_built';
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
    if (trimmedPlaySummary !== undefined && /^Ready to /i.test(trimmedPlaySummary)) {
      let sheet = null;
      try {
        const source = await loadCharacterRulesSource(firestore, seat.characterId);
        sheet = baseSheetFor(source);
      } catch {
        sheet = null;
      }
      skillResolution = resolveSkillAttemptFromSummary(sheet, trimmedPlaySummary);
      if (skillResolution?.lockYielded === true) {
        const unlockTarget = resolveUnlockTargetEdge(
          map,
          token?.footprint.anchor ?? null,
        );
        if (unlockTarget !== null) {
          unlockEdgeId = unlockTarget.edgeId;
        }
      }
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
      const conflict = classifyExplorationConflict({
        commandType,
        current,
        expectedStateVersion,
        actorSeatId: seat.seatId,
        encounterActive: encounter !== null && encounter.status === 'active',
        ...(openEdgeId !== undefined ? { openEdgeId } : {}),
        ...(movePath !== undefined ? { movePath } : {}),
      });
      throw new TableCommandError(ERROR_CODES.STALE_STATE_VERSION, conflict.message, conflict);
    }

    if (
      commandType === 'table.open_door' &&
      openEdgeId !== undefined &&
      current.doorStates?.[openEdgeId] === 'open'
    ) {
      const conflict = classifyExplorationConflict({
        commandType,
        current,
        expectedStateVersion,
        openEdgeId,
        actorSeatId: seat.seatId,
        encounterActive: false,
      });
      throw new TableCommandError(ERROR_CODES.STALE_STATE_VERSION, conflict.message, conflict);
    }

    const commandId = randomUUID();
    const eventId = randomUUID();
    const committedAt = new Date();
    const nextVersion = current.stateVersion + 1;
    const nextSequence = current.lastEventSequence + 1;

    let tokenPositions = current.tokenPositions ?? [];
    let doorStates = { ...(current.doorStates ?? {}) };
    let runtimeEdges = [...(current.runtimeEdges ?? [])];
    let sceneTitle = current.sceneTitle ?? null;
    let exploredByAccount = { ...(current.exploredByAccount ?? {}) };
    let activeSceneId = current.activeSceneId ?? null;
    let sceneInstances = { ...(current.sceneInstances ?? {}) };
    let sceneStack = [...(current.sceneStack ?? [])];
    let adventureStarted = current.adventureStarted === true;
    let premiseKey = current.premiseKey ?? null;

    if (nextSceneRuntime !== undefined) {
      tokenPositions = nextSceneRuntime.tokenPositions;
      doorStates = { ...nextSceneRuntime.doorStates };
      runtimeEdges = [...(nextSceneRuntime.runtimeEdges ?? [])];
      sceneTitle = nextSceneRuntime.sceneTitle ?? sceneTitle;
      exploredByAccount = { ...nextSceneRuntime.exploredByAccount };
      activeSceneId = nextSceneRuntime.activeSceneId ?? null;
      sceneInstances = { ...(nextSceneRuntime.sceneInstances ?? {}) };
      sceneStack = [...(nextSceneRuntime.sceneStack ?? [])];
      adventureStarted = nextSceneRuntime.adventureStarted === true;
      premiseKey = nextSceneRuntime.premiseKey ?? premiseKey;
    }

    if (commandType === 'table.move' && movePath !== undefined && movePath.length > 0) {
      const destination = movePath[movePath.length - 1]!;
      tokenPositions = upsertTokenPosition(tokenPositions, seat.seatId, destination);
      const active = activeSceneId ? sceneInstances[activeSceneId] : null;
      const vision = visibleSquaresFrom(destination, DEFAULT_VISION_RADIUS_SQUARES, {
        columns: active?.columns ?? 12,
        rows: active?.rows ?? 8,
      });
      exploredByAccount[accountId] = mergeExplored(exploredByAccount[accountId], [
        ...movePath,
        destination,
        ...vision,
      ]);
      if (activeSceneId && sceneInstances[activeSceneId]) {
        sceneInstances = {
          ...sceneInstances,
          [activeSceneId]: {
            ...sceneInstances[activeSceneId]!,
            tokenPositions,
            exploredByAccount,
            doorStates: { ...sceneInstances[activeSceneId]!.doorStates, ...doorStates },
          },
        };
      }
    }

    if (commandType === 'table.open_door' && openEdgeId !== undefined) {
      doorStates[openEdgeId] = 'open';
      if (activeSceneId && sceneInstances[activeSceneId]) {
        sceneInstances = {
          ...sceneInstances,
          [activeSceneId]: {
            ...sceneInstances[activeSceneId]!,
            doorStates: { ...sceneInstances[activeSceneId]!.doorStates, [openEdgeId]: 'open' },
          },
        };
      }
    }

    if (commandType === 'table.build_scene' && buildSceneEdges !== undefined) {
      runtimeEdges = [...buildSceneEdges];
      sceneTitle = buildSceneTitle ?? sceneTitle;
      if (openEdgeId !== undefined) {
        doorStates[openEdgeId] = 'open';
      }
    }

    if (commandType === 'table.sync') {
      if (syncVisionSquares.length > 0) {
        exploredByAccount[accountId] = mergeExplored(
          exploredByAccount[accountId],
          syncVisionSquares,
        );
      }
      if (unlockEdgeId !== undefined) {
        doorStates[unlockEdgeId] = storedDoorStateFromAuthority(doorStateAfterUnlockSuccess());
      }
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
      ...(skillResolution !== null
        ? { summary: skillResolution.summary, rolls: [...skillResolution.rolls] }
        : trimmedPlaySummary !== undefined
          ? { summary: trimmedPlaySummary }
          : sceneChronicleBody !== undefined
            ? { summary: sceneChronicleBody }
            : {}),
    };

    const nextProjection: StoredProjection = {
      campaignId,
      stateVersion: nextVersion,
      lastEventSequence: nextSequence,
      lastEventId: eventId,
      updatedAt: committedAt,
      tokenPositions,
      doorStates,
      runtimeEdges,
      sceneTitle,
      exploredByAccount,
      activeSceneId,
      sceneInstances,
      sceneStack,
      adventureStarted,
      premiseKey,
      npcSpotlight: current.npcSpotlight ?? null,
    };

    transaction.set(firestore.collection(COLLECTIONS.campaignCommands).doc(commandId), command);
    transaction.set(firestore.collection(COLLECTIONS.campaignEvents).doc(eventId), event);
    transaction.set(projectionRef, nextProjection);
    transaction.update(firestore.collection(COLLECTIONS.campaignSeats).doc(seat.seatId), {
      lastAcknowledgedEventSequence: nextSequence,
      deviceSessionId,
    });
    transaction.update(firestore.collection(COLLECTIONS.campaigns).doc(campaignId), {
      updatedAt: committedAt,
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

  if (!committed.duplicate) {
    if (trimmedDeclaration !== undefined) {
      await appendChronicleEntry({
        firestore,
        campaignId,
        kind: 'play_declaration',
        body: trimmedDeclaration,
      });
    }
    if (eventType === 'table.scene_built') {
      const title = buildSceneTitle?.trim();
      await appendChronicleEntry({
        firestore,
        campaignId,
        kind: 'scene_built',
        body:
          sceneChronicleBody ??
          (title !== undefined && title.length > 0
            ? `${seat.characterName || 'A player'} built ${title} on the table.`
            : `${seat.characterName || 'A player'} built an improvised chamber on the table.`),
      });
    } else if (eventType === 'table.scene_traveled') {
      await appendChronicleEntry({
        firestore,
        campaignId,
        kind: 'scene_built',
        body:
          sceneChronicleBody ??
          `${seat.characterName || 'The party'} traveled to a new scene.`,
      });
    } else if (eventType === 'table.object_changed') {
      await appendChronicleEntry({
        firestore,
        campaignId,
        kind: 'play_resolved',
        body:
          sceneChronicleBody ??
          `${seat.characterName || 'A player'} changed an object on the scene.`,
      });
    } else if (eventType === 'table.door_opened' && openEdgeId !== undefined) {
      await appendChronicleEntry({
        firestore,
        campaignId,
        kind: 'door_opened',
        body: `${seat.characterName || 'A player'} opened a door on the table.`,
      });
    } else if (eventType === 'table.token_moved' && movePath !== undefined && movePath.length > 0) {
      await appendChronicleEntry({
        firestore,
        campaignId,
        kind: 'token_moved',
        body: `${seat.characterName || 'A player'} moved across the table toward a marked destination.`,
      });
    }
    if (skillResolution !== null) {
      await appendChronicleEntry({
        firestore,
        campaignId,
        kind: 'play_resolved',
        body: skillResolution.summary,
      });
    } else if (
      trimmedPlaySummary !== undefined &&
      // Never persist Intent Intercept "Ready to… Confirm to…" drafts after commit.
      !/^Ready to /i.test(trimmedPlaySummary) &&
      !/\bConfirm to\b/i.test(trimmedPlaySummary)
    ) {
      await appendChronicleEntry({
        firestore,
        campaignId,
        kind: 'play_resolved',
        body: trimmedPlaySummary,
      });
    }
  }

  return {
    duplicate: committed.duplicate,
    commandId: committed.command.commandId,
    requestId: committed.command.requestId,
    event: eventProjection,
    table: toTableProjection(campaignId, committed.projection, withEvent),
  };
}
