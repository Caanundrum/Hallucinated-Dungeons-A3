/**
 * Server-authored tactical map projection for Phase 2.
 *
 * Builds a local placeholder map, applies stored token/door/explored runtime,
 * and omits unauthorized fog facts from the viewer payload.
 */

import type { Firestore } from 'firebase-admin/firestore';

import {
  DEFAULT_FOOTPRINT_SQUARES,
  FEET_PER_SQUARE,
  MAP_COORDINATE_SCHEMA_VERSION,
  edgeId,
  squareId,
  type MapBundleProjection,
  type MapCellRecord,
  type MapEdgeRecord,
  type MapNotableFeatureRecord,
  type MapTokenProjection,
} from '../../shared/map-contract.js';
import { DEFAULT_VISION_RADIUS_SQUARES } from '../../shared/movement-contract.js';
import { ERROR_CODES } from '../../shared/contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import { loadAdventureMapPresentation } from '../campaigns/campaign-memory.js';
import { loadMapRuntime, type StoredMapRuntime } from './map-runtime.js';
import { bootstrapBlankFirstScene, mergeRuntimeEdges } from './scene-builder.js';
import { visibleSquaresFrom } from './path-validator.js';

export class MapProjectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MapProjectionError';
    this.code = code;
  }
}

export const STARTER_COLUMNS = 12;
export const STARTER_ROWS = 8;
const PIXELS_PER_SQUARE = 48;

interface StoredSeat {
  readonly seatId: string;
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly characterId: string;
  readonly characterName: string;
}

export async function assertCampaignMember(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<{ readonly adventureTemplateId: string | null }> {
  const { firestore, accountId, campaignId } = options;
  const membership = await firestore
    .collection(COLLECTIONS.campaignMemberships)
    .where('campaignId', '==', campaignId)
    .where('accountId', '==', accountId)
    .limit(1)
    .get();
  if (membership.empty) {
    throw new MapProjectionError(ERROR_CODES.NOT_FOUND, 'No such route.');
  }
  const campaign = await firestore.collection(COLLECTIONS.campaigns).doc(campaignId).get();
  if (!campaign.exists) {
    throw new MapProjectionError(ERROR_CODES.NOT_FOUND, 'No such route.');
  }
  const data = campaign.data() as { adventureTemplateId?: string | null };
  return { adventureTemplateId: data.adventureTemplateId ?? null };
}

export function buildStarterCells(): MapCellRecord[] {
  const cells: MapCellRecord[] = [];
  for (let row = 0; row < STARTER_ROWS; row += 1) {
    for (let column = 0; column < STARTER_COLUMNS; column += 1) {
      const blockedBorder =
        row === 0 || column === 0 || row === STARTER_ROWS - 1 || column === STARTER_COLUMNS - 1;
      const difficult = !blockedBorder && (row + column) % 7 === 0;
      cells.push({
        column,
        row,
        terrain: blockedBorder ? 'blocked' : difficult ? 'difficult' : 'floor',
        elevationFeet: 0,
        known: true,
      });
    }
  }
  return cells;
}

/** Open floor grid — used only when a blank table has no first-scene geometry yet. */
export function buildBlankOpenCells(): MapCellRecord[] {
  const cells: MapCellRecord[] = [];
  for (let row = 0; row < STARTER_ROWS; row += 1) {
    for (let column = 0; column < STARTER_COLUMNS; column += 1) {
      cells.push({
        column,
        row,
        terrain: 'floor',
        elevationFeet: 0,
        known: true,
      });
    }
  }
  return cells;
}

/** Chamber floor with a blocked perimeter so blank tables read as a room, not open void. */
export function buildBlankChamberCells(): MapCellRecord[] {
  const cells: MapCellRecord[] = [];
  for (let row = 0; row < STARTER_ROWS; row += 1) {
    for (let column = 0; column < STARTER_COLUMNS; column += 1) {
      const blockedBorder =
        row === 0 || column === 0 || row === STARTER_ROWS - 1 || column === STARTER_COLUMNS - 1;
      cells.push({
        column,
        row,
        terrain: blockedBorder ? 'blocked' : 'floor',
        elevationFeet: 0,
        known: true,
      });
    }
  }
  return cells;
}

export function buildStarterInteriorWalls(): MapEdgeRecord[] {
  const edges: MapEdgeRecord[] = [];
  for (const row of [2, 3, 4, 5]) {
    const kind = row === 3 ? 'door' : 'wall';
    edges.push({
      edgeId: edgeId(5, row, 'east'),
      column: 5,
      row,
      orientation: 'east',
      kind,
      doorState: kind === 'door' ? 'closed' : null,
    });
  }
  return edges;
}

function spawnAnchors(options: {
  readonly adventureTemplateId?: string | null;
  readonly currentChapterId?: string | null;
}): Array<{ column: number; row: number }> {
  const presentation = loadAdventureMapPresentation(
    options.adventureTemplateId ?? null,
    options.currentChapterId ?? null,
  );
  if (presentation?.scene !== undefined && presentation.scene !== null) {
    return [...presentation.scene.spawnAnchors];
  }
  return [
    { column: 2, row: 2 },
    { column: 2, row: 5 },
    { column: 8, row: 2 },
    { column: 8, row: 5 },
  ];
}

function applyDoorOverrides(
  edges: readonly MapEdgeRecord[],
  runtime: StoredMapRuntime,
): MapEdgeRecord[] {
  return edges.map((edge) => {
    const override = runtime.doorStates[edge.edgeId];
    if (override === undefined || edge.kind !== 'door') {
      return edge;
    }
    return { ...edge, doorState: override };
  });
}

function buildTokens(
  seats: readonly StoredSeat[],
  runtime: StoredMapRuntime,
  options: {
    readonly adventureTemplateId?: string | null;
    readonly currentChapterId?: string | null;
  },
): MapTokenProjection[] {
  const anchors = spawnAnchors(options);
  const bySeat = new Map(runtime.tokenPositions.map((entry) => [entry.seatId, entry]));
  return seats.map((seat, index) => {
    const stored = bySeat.get(seat.seatId);
    const fallback = anchors[index % anchors.length]!;
    const anchor = stored
      ? { column: stored.column, row: stored.row }
      : fallback;
    return {
      tokenId: `token:${seat.seatId}`,
      seatId: seat.seatId,
      label: seat.characterName || 'Seated character',
      footprint: {
        size: 'medium',
        anchor,
        width: DEFAULT_FOOTPRINT_SQUARES.medium.width,
        height: DEFAULT_FOOTPRINT_SQUARES.medium.height,
        tinySlot: null,
        elevationFeet: 0,
      },
    };
  });
}

function applyViewerFog(
  full: MapBundleProjection,
  options: {
    readonly accountId: string;
    readonly viewerSeatId: string | null;
    readonly runtime: StoredMapRuntime;
  },
): MapBundleProjection {
  const { accountId, viewerSeatId, runtime } = options;
  const ownToken = full.tokens.find((token) => token.seatId === viewerSeatId) ?? null;
  const visible = ownToken
    ? visibleSquaresFrom(
        ownToken.footprint.anchor,
        DEFAULT_VISION_RADIUS_SQUARES,
        full.coordinateSpace,
      )
    : [];
  const visibleIds = new Set(visible.map((square) => squareId(square.column, square.row)));
  const exploredIds = new Set(runtime.exploredByAccount[accountId] ?? []);
  for (const id of visibleIds) {
    exploredIds.add(id);
  }

  const cells = full.cells.map((cell) => {
    const id = squareId(cell.column, cell.row);
    const known = visibleIds.has(id) || exploredIds.has(id);
    if (!known) {
      return {
        column: cell.column,
        row: cell.row,
        terrain: 'blocked' as const,
        elevationFeet: 0,
        known: false,
      };
    }
    return { ...cell, known: true };
  });

  const edges = full.edges.filter((edge) => {
    const a = squareId(edge.column, edge.row);
    let neighborColumn = edge.column;
    let neighborRow = edge.row;
    if (edge.orientation === 'east') neighborColumn += 1;
    if (edge.orientation === 'west') neighborColumn -= 1;
    if (edge.orientation === 'south') neighborRow += 1;
    if (edge.orientation === 'north') neighborRow -= 1;
    const b = squareId(neighborColumn, neighborRow);
    // Omit edges that would reveal geometry the viewer has never known.
    return exploredIds.has(a) || exploredIds.has(b) || visibleIds.has(a) || visibleIds.has(b);
  });

  const tokens = full.tokens.filter((token) => {
    const id = squareId(token.footprint.anchor.column, token.footprint.anchor.row);
    return visibleIds.has(id) || token.seatId === viewerSeatId;
  });

  return {
    ...full,
    cells,
    edges,
    tokens,
    viewerSeatId,
    exploredSquareIds: [...exploredIds].sort(),
    visibleSquareIds: [...visibleIds].sort(),
  };
}

const DEFAULT_SCENE_BANNER = 'A quiet chamber waits for the party to explore.';
const DEFAULT_NOTABLE_FEATURES: readonly MapNotableFeatureRecord[] = [];

function movementRevision(runtime: StoredMapRuntime): number {
  return runtime.tokenPositions.reduce(
    (sum, entry) => sum + (entry.column + 1) * 17 + (entry.row + 1) * 31,
    runtime.tokenPositions.length,
  );
}

/** Full geometry without viewer fog — used by the movement validator. */
export function buildAuthoritativeMapBundle(options: {
  readonly campaignId: string;
  readonly seats: readonly StoredSeat[];
  readonly runtime: StoredMapRuntime;
  /** Starter pack id backing this campaign, or null/omitted for a blank table. */
  readonly adventureTemplateId?: string | null;
  /** Current Emberferry chapter — selects dock / caves / bell-tower scene. */
  readonly currentChapterId?: string | null;
}): MapBundleProjection {
  const { campaignId, seats, runtime } = options;
  const presentation = loadAdventureMapPresentation(
    options.adventureTemplateId ?? null,
    options.currentChapterId ?? null,
  );
  const scene = presentation?.scene ?? null;
  const isBlankTable = (options.adventureTemplateId ?? null) === null && scene === null;
  const hasRuntimeGeometry = (runtime.runtimeEdges ?? []).length > 0;
  const blankBootstrap =
    isBlankTable && !hasRuntimeGeometry ? bootstrapBlankFirstScene() : null;
  const cells =
    scene !== null
      ? [...scene.cells]
      : isBlankTable
        ? blankBootstrap !== null
          ? buildBlankChamberCells()
          : buildBlankOpenCells()
        : buildStarterCells();
  const baseEdges =
    scene !== null
      ? scene.edges
      : isBlankTable
        ? (blankBootstrap?.edges ?? [])
        : buildStarterInteriorWalls();
  const mergedEdges = mergeRuntimeEdges(baseEdges, runtime.runtimeEdges ?? []);
  const improvisedTitle = runtime.sceneTitle?.trim();
  const sceneBanner =
    improvisedTitle !== undefined && improvisedTitle.length > 0
      ? `${improvisedTitle} — walls and doorways are committed on this table.`
      : hasRuntimeGeometry
        ? 'Improvised scene geometry is committed on this table.'
        : (presentation?.sceneBanner ??
          (blankBootstrap?.sceneBanner ??
            (isBlankTable ? 'An empty table with no seeded chapters or map story.' : DEFAULT_SCENE_BANNER)));
  return {
    campaignId,
    mapBundleId: scene !== null ? `${scene.sceneId}:${campaignId}` : isBlankTable ? `blank:${campaignId}` : `starter:${campaignId}`,
    mapVersion: 1 + movementRevision(runtime),
    title:
      runtime.sceneTitle ??
      presentation?.title ??
      (blankBootstrap?.sceneTitle ?? (isBlankTable ? 'Blank table' : 'Local starter chamber')),
    coordinateSpace: {
      coordinateSpaceId: `space:${campaignId}`,
      schemaVersion: MAP_COORDINATE_SCHEMA_VERSION,
      columns: STARTER_COLUMNS,
      rows: STARTER_ROWS,
      feetPerSquare: FEET_PER_SQUARE,
      pixelsPerSquare: PIXELS_PER_SQUARE,
    },
    cells,
    edges: applyDoorOverrides(mergedEdges, runtime),
    tokens: buildTokens(seats, runtime, {
      adventureTemplateId: options.adventureTemplateId ?? null,
      currentChapterId: options.currentChapterId ?? null,
    }),
    artProvenance: presentation?.artProvenance ?? 'procedural_local_placeholder',
    sceneBanner,
    notableFeatures: presentation?.notableFeatures ?? (isBlankTable ? [] : DEFAULT_NOTABLE_FEATURES),
    viewerSeatId: null,
    exploredSquareIds: [],
    visibleSquareIds: [],
  };
}

export async function loadCampaignSeats(
  firestore: Firestore,
  campaignId: string,
): Promise<StoredSeat[]> {
  const seatSnap = await firestore
    .collection(COLLECTIONS.campaignSeats)
    .where('campaignId', '==', campaignId)
    .limit(12)
    .get();
  return seatSnap.docs.map((doc) => doc.data() as StoredSeat);
}

/**
 * Returns the authorized map projection for a campaign member.
 * Hidden geometry is omitted or fogged for the requesting account.
 */
export async function fetchCampaignMap(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<MapBundleProjection> {
  const { firestore, accountId, campaignId } = options;
  const { adventureTemplateId } = await assertCampaignMember({ firestore, accountId, campaignId });

  const [seats, runtime, memorySnap] = await Promise.all([
    loadCampaignSeats(firestore, campaignId),
    loadMapRuntime(firestore, campaignId),
    firestore.collection(COLLECTIONS.campaignMemory).doc(campaignId).get(),
  ]);
  const memoryData = memorySnap.exists
    ? (memorySnap.data() as { currentChapterId?: string | null })
    : null;
  const currentChapterId = memoryData?.currentChapterId ?? null;
  const ownSeat = seats.find((seat) => seat.ownerAccountId === accountId) ?? null;
  const full = buildAuthoritativeMapBundle({
    campaignId,
    seats,
    runtime,
    adventureTemplateId,
    currentChapterId,
  });
  return applyViewerFog(full, {
    accountId,
    viewerSeatId: ownSeat?.seatId ?? null,
    runtime,
  });
}

export { squareId };
