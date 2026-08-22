/**
 * Improvised scene geometry for blank tables (PQA-145).
 *
 * The Director can raise walls and doors ahead of a seated token so door
 * declarations become confirmable table commits instead of dead-end clarifications.
 */

import {
  edgeId,
  type MapEdgeRecord,
  type MapSquareCoordinate,
} from '../../shared/map-contract.js';
import { STARTER_COLUMNS, STARTER_ROWS } from './map-projection.js';

export interface DoorSceneProposal {
  readonly edges: readonly MapEdgeRecord[];
  readonly doorEdgeId: string;
  readonly sceneTitle: string;
}

/** Places an east-facing wall segment with a closed door on the token's row. */
export function proposeDoorSceneAhead(options: {
  readonly tokenAnchor: MapSquareCoordinate;
}): DoorSceneProposal {
  const { column, row } = options.tokenAnchor;
  const wallColumn = Math.min(Math.max(column + 2, 3), STARTER_COLUMNS - 2);
  const rowStart = Math.max(0, row - 1);
  const rowEnd = Math.min(STARTER_ROWS - 1, row + 1);
  const edges: MapEdgeRecord[] = [];

  for (let edgeRow = rowStart; edgeRow <= rowEnd; edgeRow += 1) {
    const kind = edgeRow === row ? 'door' : 'wall';
    edges.push({
      edgeId: edgeId(wallColumn, edgeRow, 'east'),
      column: wallColumn,
      row: edgeRow,
      orientation: 'east',
      kind,
      doorState: kind === 'door' ? 'closed' : null,
    });
  }

  return {
    edges,
    doorEdgeId: edgeId(wallColumn, row, 'east'),
    sceneTitle: 'Improvised chamber',
  };
}

export function mergeRuntimeEdges(
  baseEdges: readonly MapEdgeRecord[],
  runtimeEdges: readonly MapEdgeRecord[],
): MapEdgeRecord[] {
  const byId = new Map(baseEdges.map((edge) => [edge.edgeId, edge]));
  for (const edge of runtimeEdges) {
    byId.set(edge.edgeId, edge);
  }
  return [...byId.values()];
}
