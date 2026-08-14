/**
 * Server-authored tactical map projection for Phase 2b.
 *
 * Builds a small local placeholder map bound to campaign seats. The client
 * renders this projection; it never invents cells, edges, or token anchors.
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
  type MapTokenProjection,
} from '../../shared/map-contract.js';
import { ERROR_CODES } from '../../shared/contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';

export class MapProjectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MapProjectionError';
    this.code = code;
  }
}

const STARTER_COLUMNS = 12;
const STARTER_ROWS = 8;
const PIXELS_PER_SQUARE = 48;

interface StoredSeat {
  readonly seatId: string;
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly characterId: string;
}

interface StoredCharacter {
  readonly characterId: string;
  readonly name?: string;
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
    throw new MapProjectionError(ERROR_CODES.NOT_FOUND, 'No such route.');
  }
  const campaign = await firestore.collection(COLLECTIONS.campaigns).doc(campaignId).get();
  if (!campaign.exists) {
    throw new MapProjectionError(ERROR_CODES.NOT_FOUND, 'No such route.');
  }
}

function buildCells(): MapCellRecord[] {
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
      });
    }
  }
  return cells;
}

function buildInteriorWalls(): MapEdgeRecord[] {
  const edges: MapEdgeRecord[] = [];
  // A short interior wall with a closed door gap on the east face of column 5.
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

function spawnAnchors(): Array<{ column: number; row: number }> {
  return [
    { column: 2, row: 2 },
    { column: 2, row: 5 },
    { column: 8, row: 2 },
    { column: 8, row: 5 },
  ];
}

/**
 * Returns the authorized map projection for a campaign member.
 * Tokens are derived from current seats; empty campaigns still get the map shell.
 */
export async function fetchCampaignMap(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<MapBundleProjection> {
  const { firestore, accountId, campaignId } = options;
  await assertCampaignMember({ firestore, accountId, campaignId });

  const seatSnap = await firestore
    .collection(COLLECTIONS.campaignSeats)
    .where('campaignId', '==', campaignId)
    .limit(12)
    .get();

  const tokens: MapTokenProjection[] = [];
  const anchors = spawnAnchors();
  let index = 0;
  for (const doc of seatSnap.docs) {
    const seat = doc.data() as StoredSeat;
    const characterSnap = await firestore.collection(COLLECTIONS.characters).doc(seat.characterId).get();
    const character = characterSnap.exists ? (characterSnap.data() as StoredCharacter) : null;
    const anchor = anchors[index % anchors.length]!;
    index += 1;
    tokens.push({
      tokenId: `token:${seat.seatId}`,
      seatId: seat.seatId,
      label: character?.name ?? 'Seated character',
      footprint: {
        size: 'medium',
        anchor,
        width: DEFAULT_FOOTPRINT_SQUARES.medium.width,
        height: DEFAULT_FOOTPRINT_SQUARES.medium.height,
        tinySlot: null,
        elevationFeet: 0,
      },
    });
  }

  return {
    campaignId,
    mapBundleId: `starter:${campaignId}`,
    mapVersion: 1,
    title: 'Local starter chamber',
    coordinateSpace: {
      coordinateSpaceId: `space:${campaignId}`,
      schemaVersion: MAP_COORDINATE_SCHEMA_VERSION,
      columns: STARTER_COLUMNS,
      rows: STARTER_ROWS,
      feetPerSquare: FEET_PER_SQUARE,
      pixelsPerSquare: PIXELS_PER_SQUARE,
    },
    cells: buildCells(),
    edges: buildInteriorWalls(),
    tokens,
    artProvenance: 'procedural_local_placeholder',
  };
}

/** Exported for unit tests — square id helper stays shared. */
export { squareId };
