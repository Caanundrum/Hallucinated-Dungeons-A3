/**
 * Improvised scene geometry for blank tables (PQA-145 / PQA-187).
 *
 * Blank tables bootstrap a Quiet chamber at projection time. Players can still
 * raise additional walls/doors ahead of a seated token via table.build_scene
 * when no geometry exists yet.
 */

import {
  edgeId,
  type MapEdgeRecord,
  type MapNotableFeatureRecord,
  type MapSquareCoordinate,
} from '../../shared/map-contract.js';
import { STARTER_COLUMNS, STARTER_ROWS } from './map-projection.js';

export interface DoorSceneProposal {
  readonly edges: readonly MapEdgeRecord[];
  readonly doorEdgeId: string;
  readonly sceneTitle: string;
}

/** Default spawn used for blank-table first-scene bootstrap and seat placement. */
export const BLANK_FIRST_SCENE_SPAWN: MapSquareCoordinate = { column: 2, row: 2 };

/** Director-established first scene title for blank tables (PQA-187). */
export const BLANK_FIRST_SCENE_TITLE = 'Quiet chamber';

/**
 * Quiet chamber atmosphere markers (PQA-177).
 * Presentation-only — never affect pathing, combat, or detection.
 */
export const BLANK_FIRST_SCENE_REFERENCE_MARKERS: readonly MapNotableFeatureRecord[] = [
  {
    column: 1,
    row: 1,
    label: 'Wall sconce — lighting reference',
    referenceKind: 'lighting',
  },
  {
    column: 2,
    row: 4,
    label: 'Rubble pile — cover reference',
    referenceKind: 'cover',
  },
  {
    column: 3,
    row: 3,
    label: 'Damp stones — hazard reference',
    referenceKind: 'hazard',
  },
];

/** Places an east-facing wall segment with a closed door on the token's row. */
export function proposeDoorSceneAhead(options: {
  readonly tokenAnchor: MapSquareCoordinate;
  readonly sceneTitle?: string;
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
    sceneTitle: options.sceneTitle ?? 'Improvised chamber',
  };
}

/**
 * Thin first-scene bootstrap for blank tables — walls + one closed door ahead
 * of the default spawn, without seeding Emberferry chapters or pack memory.
 */
export function bootstrapBlankFirstScene(): DoorSceneProposal & {
  readonly sceneBanner: string;
  readonly notableFeatures: readonly MapNotableFeatureRecord[];
} {
  const proposal = proposeDoorSceneAhead({
    tokenAnchor: BLANK_FIRST_SCENE_SPAWN,
    sceneTitle: BLANK_FIRST_SCENE_TITLE,
  });
  return {
    ...proposal,
    sceneBanner: `${BLANK_FIRST_SCENE_TITLE} — walls and a wooden doorway are established for this table.`,
    notableFeatures: BLANK_FIRST_SCENE_REFERENCE_MARKERS,
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
