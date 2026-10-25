import {
  edgeId,
  type MapBundleProjection,
  type MapEdgeRecord,
  type MapSquareCoordinate,
} from '../../shared/map-contract.js';

function cellKey(column: number, row: number): string {
  return `${column},${row}`;
}

function isWalkableCell(map: MapBundleProjection, column: number, row: number): boolean {
  if (
    column < 0 ||
    row < 0 ||
    column >= map.coordinateSpace.columns ||
    row >= map.coordinateSpace.rows
  ) {
    return false;
  }
  const cell = map.cells.find((entry) => entry.column === column && entry.row === row);
  if (cell === undefined) {
    return false;
  }
  return cell.terrain !== 'blocked';
}

function isOccupiedByOther(
  map: MapBundleProjection,
  column: number,
  row: number,
  actorSeatId: string,
): boolean {
  for (const token of map.tokens) {
    if (token.seatId === actorSeatId) {
      continue;
    }
    const anchor = token.footprint.anchor;
    if (anchor.column === column && anchor.row === row) {
      return true;
    }
  }
  return false;
}

function indexEdges(edges: readonly MapEdgeRecord[]): Map<string, MapEdgeRecord> {
  const indexed = new Map<string, MapEdgeRecord>();
  for (const edge of edges) {
    indexed.set(edge.edgeId, edge);
    if (edge.orientation === 'north' && edge.row > 0) {
      const canonicalId = edgeId(edge.column, edge.row - 1, 'south');
      if (!indexed.has(canonicalId)) {
        indexed.set(canonicalId, edge);
      }
    } else if (edge.orientation === 'west' && edge.column > 0) {
      const canonicalId = edgeId(edge.column - 1, edge.row, 'east');
      if (!indexed.has(canonicalId)) {
        indexed.set(canonicalId, edge);
      }
    }
  }
  return indexed;
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

function crossedEdgeId(from: MapSquareCoordinate, to: MapSquareCoordinate): string | null {
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

function canStepBetween(
  map: MapBundleProjection,
  edges: ReadonlyMap<string, MapEdgeRecord>,
  from: MapSquareCoordinate,
  to: MapSquareCoordinate,
  actorSeatId: string,
): boolean {
  if (!isWalkableCell(map, to.column, to.row)) {
    return false;
  }
  if (isOccupiedByOther(map, to.column, to.row, actorSeatId)) {
    return false;
  }
  const dc = to.column - from.column;
  const dr = to.row - from.row;
  if (Math.abs(dc) === 1 && Math.abs(dr) === 1) {
    const orthA = { column: to.column, row: from.row };
    const orthB = { column: from.column, row: to.row };
    if (
      !isWalkableCell(map, orthA.column, orthA.row) ||
      !isWalkableCell(map, orthB.column, orthB.row)
    ) {
      return false;
    }
    const edgeA = crossedEdgeId(from, orthA);
    const edgeB = crossedEdgeId(from, orthB);
    const edgeA2 = crossedEdgeId(orthA, to);
    const edgeB2 = crossedEdgeId(orthB, to);
    if (
      edgeBlocksMovement(edgeA ? edges.get(edgeA) : undefined) ||
      edgeBlocksMovement(edgeB ? edges.get(edgeB) : undefined) ||
      edgeBlocksMovement(edgeA2 ? edges.get(edgeA2) : undefined) ||
      edgeBlocksMovement(edgeB2 ? edges.get(edgeB2) : undefined)
    ) {
      return false;
    }
    return true;
  }
  const edge = crossedEdgeId(from, to);
  if (edge !== null && edgeBlocksMovement(edges.get(edge))) {
    return false;
  }
  return true;
}

const STEP_DELTAS: readonly (readonly [number, number])[] = [
  // Orthogonal steps first so paths naturally route cleanly through open doorways
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  // Diagonal steps second
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * Heuristic walk path for click-to-move. Respects walls, closed doors, and
 * strict diagonal corner-cutting so paths through open doorways never trip
 * DIAGONAL_CORNER_BLOCKED on the server path validator.
 */
export function findWalkPathToTarget(options: {
  readonly map: MapBundleProjection;
  readonly start: { column: number; row: number };
  readonly target: { column: number; row: number };
  readonly actorSeatId: string;
  readonly maxSteps?: number;
}): readonly { readonly column: number; readonly row: number }[] | null {
  const { map, start, target, actorSeatId, maxSteps = 64 } = options;
  if (start.column === target.column && start.row === target.row) {
    return [];
  }
  const edges = indexEdges(map.edges);

  const queue: {
    column: number;
    row: number;
    path: { column: number; row: number }[];
  }[] = [{ column: start.column, row: start.row, path: [] }];
  const visited = new Set<string>([cellKey(start.column, start.row)]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.path.length >= maxSteps) {
      continue;
    }

    for (const [dc, dr] of STEP_DELTAS) {
      const column = current.column + dc;
      const row = current.row + dr;
      const key = cellKey(column, row);
      if (visited.has(key)) {
        continue;
      }
      if (
        !canStepBetween(
          map,
          edges,
          { column: current.column, row: current.row },
          { column, row },
          actorSeatId,
        )
      ) {
        continue;
      }

      const path = [...current.path, { column, row }];
      if (column === target.column && row === target.row) {
        return path;
      }
      visited.add(key);
      queue.push({ column, row, path });
    }
  }

  return null;
}

export function ownTokenAnchor(
  map: MapBundleProjection,
  seatId: string,
): { column: number; row: number } | null {
  const token = map.tokens.find((entry) => entry.seatId === seatId);
  if (token === undefined) {
    return null;
  }
  return token.footprint.anchor;
}
