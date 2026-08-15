/**
 * Mutable tactical runtime for a campaign map (token anchors, doors, explored).
 *
 * Stored beside the table projection so movement commits stay server-authored.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type { DoorState, MapSquareCoordinate } from '../../shared/map-contract.js';
import { squareId } from '../../shared/map-contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';

export interface StoredTokenPosition {
  readonly seatId: string;
  readonly column: number;
  readonly row: number;
}

export interface StoredMapRuntime {
  readonly campaignId: string;
  readonly tokenPositions: StoredTokenPosition[];
  /** edgeId → door state overrides for mutable doors */
  readonly doorStates: Record<string, DoorState>;
  /** accountId → explored square ids */
  readonly exploredByAccount: Record<string, string[]>;
}

export function emptyMapRuntime(campaignId: string): StoredMapRuntime {
  return {
    campaignId,
    tokenPositions: [],
    doorStates: {},
    exploredByAccount: {},
  };
}

export async function loadMapRuntime(
  firestore: Firestore,
  campaignId: string,
): Promise<StoredMapRuntime> {
  const snap = await firestore.collection(COLLECTIONS.campaignTableProjections).doc(campaignId).get();
  if (!snap.exists) {
    return emptyMapRuntime(campaignId);
  }
  const data = snap.data() as Partial<StoredMapRuntime> & { campaignId?: string };
  return {
    campaignId,
    tokenPositions: Array.isArray(data.tokenPositions) ? data.tokenPositions : [],
    doorStates: data.doorStates ?? {},
    exploredByAccount: data.exploredByAccount ?? {},
  };
}

export function mergeExplored(
  existing: readonly string[] | undefined,
  squares: readonly MapSquareCoordinate[],
): string[] {
  const set = new Set(existing ?? []);
  for (const square of squares) {
    set.add(squareId(square.column, square.row));
  }
  return [...set].sort();
}

export function upsertTokenPosition(
  positions: readonly StoredTokenPosition[],
  seatId: string,
  anchor: MapSquareCoordinate,
): StoredTokenPosition[] {
  const next = positions.filter((entry) => entry.seatId !== seatId);
  next.push({ seatId, column: anchor.column, row: anchor.row });
  return next;
}
