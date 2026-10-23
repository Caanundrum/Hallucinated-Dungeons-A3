/**
 * Canonical square-grid path validator for Phase 2c.
 *
 * Blueprint ownership: Sections 6.12.2 and 6.12.9 — orthogonal edge clearance
 * and strict diagonal corner policy. Pure functions; no Firestore.
 */

import {
  FEET_PER_SQUARE,
  edgeId,
  footprintFitsCoordinateSpace,
  footprintSquares,
  type MapBundleProjection,
  type MapCellRecord,
  type MapEdgeRecord,
  type MapFootprint,
  type MapSquareCoordinate,
  type MapTokenProjection,
} from '../../shared/map-contract.js';
import {
  GRID_ADJUDICATION_STANDARD_VERSION,
  areAdjacent,
  isDiagonalStep,
  type MovementMode,
  type MovementPreviewProjection,
  type MovementRejectionCode,
  type PathStepProjection,
} from '../../shared/movement-contract.js';

function cellKey(column: number, row: number): string {
  return `${column}:${row}`;
}

function indexCells(cells: readonly MapCellRecord[]): Map<string, MapCellRecord> {
  const map = new Map<string, MapCellRecord>();
  for (const cell of cells) {
    map.set(cellKey(cell.column, cell.row), cell);
  }
  return map;
}

function indexEdges(edges: readonly MapEdgeRecord[]): Map<string, MapEdgeRecord> {
  const map = new Map<string, MapEdgeRecord>();
  for (const edge of edges) {
    map.set(edge.edgeId, edge);
    // Canonicalize north/west edges so crossedEdgeId (which queries south/east) always finds them.
    if (edge.orientation === 'north' && edge.row > 0) {
      const canonicalId = edgeId(edge.column, edge.row - 1, 'south');
      if (!map.has(canonicalId)) {
        map.set(canonicalId, edge);
      }
    } else if (edge.orientation === 'west' && edge.column > 0) {
      const canonicalId = edgeId(edge.column - 1, edge.row, 'east');
      if (!map.has(canonicalId)) {
        map.set(canonicalId, edge);
      }
    }
  }
  return map;
}

function edgeBlocksMovement(edge: MapEdgeRecord | undefined): boolean {
  if (edge === undefined) {
    return false;
  }
  if (edge.kind === 'wall') {
    return true;
  }
  if (edge.kind === 'door') {
    return edge.doorState !== 'open';
  }
  return false;
}

/** Walls and closed/locked doors block line of sight the same way they block movement. */
export function edgeBlocksVision(edge: MapEdgeRecord | undefined): boolean {
  return edgeBlocksMovement(edge);
}

/**
 * Edge crossed when moving from `from` to orthogonally adjacent `to`.
 * Returns the canonical edge id owned by the shared face.
 */
export function crossedEdgeId(
  from: MapSquareCoordinate,
  to: MapSquareCoordinate,
): string | null {
  const dc = to.column - from.column;
  const dr = to.row - from.row;
  if (dc === 1 && dr === 0) {
    return edgeId(from.column, from.row, 'east');
  }
  if (dc === -1 && dr === 0) {
    return edgeId(to.column, to.row, 'east');
  }
  if (dr === 1 && dc === 0) {
    return edgeId(from.column, from.row, 'south');
  }
  if (dr === -1 && dc === 0) {
    return edgeId(to.column, to.row, 'south');
  }
  return null;
}

function enterCostFeet(cell: MapCellRecord | undefined): number | null {
  if (cell === undefined) {
    return null;
  }
  if (cell.terrain === 'blocked') {
    return null;
  }
  if (cell.terrain === 'difficult') {
    return FEET_PER_SQUARE * 2;
  }
  return FEET_PER_SQUARE;
}

function occupiedKeys(
  tokens: readonly MapTokenProjection[],
  ignoreSeatId: string | null,
): Set<string> {
  const occupied = new Set<string>();
  for (const token of tokens) {
    if (ignoreSeatId !== null && token.seatId === ignoreSeatId) {
      continue;
    }
    for (const square of footprintSquares(token.footprint)) {
      occupied.add(cellKey(square.column, square.row));
    }
  }
  return occupied;
}

function reject(
  code: MovementRejectionCode,
  message: string,
  path: readonly PathStepProjection[] = [],
  totalCostFeet = 0,
  remainingBudgetFeet = 0,
): MovementPreviewProjection {
  return {
    legal: false,
    rejectionCode: code,
    rejectionMessage: message,
    path,
    totalCostFeet,
    remainingBudgetFeet,
    gridAdjudicationStandardVersion: GRID_ADJUDICATION_STANDARD_VERSION,
  };
}

/**
 * Validates an ordered path for a Medium (or given) footprint under walk mode.
 * `path` is the destination sequence after the current anchor (not including start).
 */
export function validateWalkPath(options: {
  readonly map: MapBundleProjection;
  readonly start: MapSquareCoordinate;
  readonly path: readonly MapSquareCoordinate[];
  readonly footprintTemplate: Omit<MapFootprint, 'anchor'>;
  readonly movementBudgetFeet: number;
  readonly movementMode: MovementMode;
  readonly actorSeatId: string;
}): MovementPreviewProjection {
  const {
    map,
    start,
    path,
    footprintTemplate,
    movementBudgetFeet,
    movementMode,
    actorSeatId,
  } = options;

  if (movementMode !== 'walk') {
    return reject('EMPTY_PATH', 'Only walk movement is available in this Phase 2 slice.');
  }
  if (path.length === 0) {
    return reject('EMPTY_PATH', 'Choose at least one square to move into.');
  }
  if (path.length > 64) {
    return reject('PATH_TOO_LONG', 'That path is longer than this table accepts.');
  }

  const cells = indexCells(map.cells);
  const edges = indexEdges(map.edges);
  const occupied = occupiedKeys(map.tokens, actorSeatId);
  const steps: PathStepProjection[] = [];
  let cursor = start;
  let total = 0;

  for (const next of path) {
    if (
      !Number.isInteger(next.column) ||
      !Number.isInteger(next.row) ||
      next.column < 0 ||
      next.row < 0 ||
      next.column >= map.coordinateSpace.columns ||
      next.row >= map.coordinateSpace.rows
    ) {
      return reject('OUT_OF_BOUNDS', 'That path leaves the map.', steps, total, movementBudgetFeet - total);
    }
    if (!areAdjacent(cursor, next)) {
      return reject(
        'NOT_ADJACENT',
        'Each step must enter an orthogonally or diagonally adjacent square.',
        steps,
        total,
        movementBudgetFeet - total,
      );
    }

    const trialFootprint: MapFootprint = {
      ...footprintTemplate,
      anchor: next,
    };
    if (!footprintFitsCoordinateSpace(trialFootprint, map.coordinateSpace)) {
      return reject('OUT_OF_BOUNDS', 'The footprint would leave the map.', steps, total, movementBudgetFeet - total);
    }

    for (const square of footprintSquares(trialFootprint)) {
      const cell = cells.get(cellKey(square.column, square.row));
      const cost = enterCostFeet(cell);
      if (cost === null) {
        return reject(
          'BLOCKED_TERRAIN',
          'That square is blocked terrain.',
          steps,
          total,
          movementBudgetFeet - total,
        );
      }
      if (occupied.has(cellKey(square.column, square.row))) {
        return reject(
          'OCCUPIED',
          'Another creature already occupies that space.',
          steps,
          total,
          movementBudgetFeet - total,
        );
      }
    }

    if (isDiagonalStep(cursor, next)) {
      const orthA = { column: next.column, row: cursor.row };
      const orthB = { column: cursor.column, row: next.row };
      const edgeA = crossedEdgeId(cursor, orthA);
      const edgeB = crossedEdgeId(cursor, orthB);
      const edgeA2 = crossedEdgeId(orthA, next);
      const edgeB2 = crossedEdgeId(orthB, next);
      const blockedCorner =
        edgeBlocksMovement(edgeA ? edges.get(edgeA) : undefined) ||
        edgeBlocksMovement(edgeB ? edges.get(edgeB) : undefined) ||
        edgeBlocksMovement(edgeA2 ? edges.get(edgeA2) : undefined) ||
        edgeBlocksMovement(edgeB2 ? edges.get(edgeB2) : undefined) ||
        enterCostFeet(cells.get(cellKey(orthA.column, orthA.row))) === null ||
        enterCostFeet(cells.get(cellKey(orthB.column, orthB.row))) === null;
      if (blockedCorner) {
        return reject(
          'DIAGONAL_CORNER_BLOCKED',
          'That diagonal cuts a blocked corner.',
          steps,
          total,
          movementBudgetFeet - total,
        );
      }
    } else {
      const edge = crossedEdgeId(cursor, next);
      if (edge !== null && edgeBlocksMovement(edges.get(edge))) {
        return reject(
          'BLOCKED_EDGE',
          'A wall or closed door blocks that step.',
          steps,
          total,
          movementBudgetFeet - total,
        );
      }
    }

    const destinationCell = cells.get(cellKey(next.column, next.row));
    const stepCost = enterCostFeet(destinationCell);
    if (stepCost === null) {
      return reject('BLOCKED_TERRAIN', 'That square is blocked terrain.', steps, total, movementBudgetFeet - total);
    }
    total += stepCost;
    if (total > movementBudgetFeet) {
      return reject(
        'INSUFFICIENT_MOVEMENT',
        `That path costs ${total} feet; only ${movementBudgetFeet} feet remain.`,
        steps,
        total,
        0,
      );
    }

    steps.push({
      column: next.column,
      row: next.row,
      enterCostFeet: stepCost,
      cumulativeCostFeet: total,
    });
    cursor = next;
  }

  return {
    legal: true,
    rejectionCode: null,
    rejectionMessage: null,
    path: steps,
    totalCostFeet: total,
    remainingBudgetFeet: movementBudgetFeet - total,
    gridAdjudicationStandardVersion: GRID_ADJUDICATION_STANDARD_VERSION,
  };
}

/**
 * Squares currently visible from an anchor within Chebyshev radius.
 * When `edges` are provided, vision cannot cross walls or closed/locked doors
 * (BFS flood-fill through non-blocking faces, including careful diagonal steps).
 * Perimeter / blocked terrain is opaque so vision cannot slip around a room divider
 * through the map border.
 */
export function visibleSquaresFrom(
  origin: MapSquareCoordinate,
  radius: number,
  space: {
    readonly columns: number;
    readonly rows: number;
    readonly cells?: readonly MapCellRecord[];
  },
  edges?: readonly MapEdgeRecord[],
): MapSquareCoordinate[] {
  if (edges === undefined || edges.length === 0) {
    const squares: MapSquareCoordinate[] = [];
    for (let row = origin.row - radius; row <= origin.row + radius; row += 1) {
      for (let column = origin.column - radius; column <= origin.column + radius; column += 1) {
        if (column < 0 || row < 0 || column >= space.columns || row >= space.rows) {
          continue;
        }
        if (Math.max(Math.abs(column - origin.column), Math.abs(row - origin.row)) <= radius) {
          squares.push({ column, row });
        }
      }
    }
    return squares;
  }

  const edgeIndex = indexEdges(edges);
  const cellIndex = space.cells !== undefined ? indexCells(space.cells) : null;
  const isOpaqueTerrain = (column: number, row: number): boolean => {
    if (cellIndex === null) {
      // Without explicit cells, treat the outer frame as solid stone.
      return (
        column === 0 ||
        row === 0 ||
        column === space.columns - 1 ||
        row === space.rows - 1
      );
    }
    const cell = cellIndex.get(cellKey(column, row));
    return cell !== undefined && cell.terrain === 'blocked';
  };

  const seen = new Set<string>();
  const visible: MapSquareCoordinate[] = [];
  const queue: MapSquareCoordinate[] = [origin];
  seen.add(cellKey(origin.column, origin.row));
  visible.push(origin);

  const inBounds = (column: number, row: number): boolean =>
    column >= 0 && row >= 0 && column < space.columns && row < space.rows;

  const withinRadius = (column: number, row: number): boolean =>
    Math.max(Math.abs(column - origin.column), Math.abs(row - origin.row)) <= radius;

  const canStep = (from: MapSquareCoordinate, to: MapSquareCoordinate): boolean => {
    if (!inBounds(to.column, to.row) || !withinRadius(to.column, to.row)) {
      return false;
    }
    // Opaque stone cannot be entered (except the origin itself, already queued).
    if (isOpaqueTerrain(to.column, to.row)) {
      return false;
    }
    const dc = to.column - from.column;
    const dr = to.row - from.row;
    if (Math.abs(dc) > 1 || Math.abs(dr) > 1 || (dc === 0 && dr === 0)) {
      return false;
    }
    if (dc !== 0 && dr !== 0) {
      // Diagonal: both orthogonal faces must be clear (no corner cutting through walls).
      const orthA = { column: to.column, row: from.row };
      const orthB = { column: from.column, row: to.row };
      if (isOpaqueTerrain(orthA.column, orthA.row) || isOpaqueTerrain(orthB.column, orthB.row)) {
        return false;
      }
      const edgeA = crossedEdgeId(from, orthA);
      const edgeB = crossedEdgeId(from, orthB);
      const edgeA2 = crossedEdgeId(orthA, to);
      const edgeB2 = crossedEdgeId(orthB, to);
      if (
        edgeBlocksVision(edgeA ? edgeIndex.get(edgeA) : undefined) ||
        edgeBlocksVision(edgeB ? edgeIndex.get(edgeB) : undefined) ||
        edgeBlocksVision(edgeA2 ? edgeIndex.get(edgeA2) : undefined) ||
        edgeBlocksVision(edgeB2 ? edgeIndex.get(edgeB2) : undefined)
      ) {
        return false;
      }
      return true;
    }
    const edge = crossedEdgeId(from, to);
    return edge === null || !edgeBlocksVision(edgeIndex.get(edge));
  };

  while (queue.length > 0) {
    const cursor = queue.shift()!;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dc === 0 && dr === 0) {
          continue;
        }
        const next = { column: cursor.column + dc, row: cursor.row + dr };
        const key = cellKey(next.column, next.row);
        if (seen.has(key) || !canStep(cursor, next)) {
          continue;
        }
        seen.add(key);
        visible.push(next);
        queue.push(next);
      }
    }
  }
  return visible;
}
