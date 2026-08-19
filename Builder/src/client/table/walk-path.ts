import type { MapBundleProjection } from '../../shared/map-contract.js';
import { areAdjacent } from '../../shared/movement-contract.js';

function cellKey(column: number, row: number): string {
  return `${column},${row}`;
}

function isWalkableCell(map: MapBundleProjection, column: number, row: number): boolean {
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

/**
 * Heuristic walk path for click-to-move. The server path validator remains
 * authoritative; this only proposes a candidate path for preview/commit.
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
  if (
    areAdjacent(start, target) &&
    isWalkableCell(map, target.column, target.row) &&
    !isOccupiedByOther(map, target.column, target.row, actorSeatId)
  ) {
    return [target];
  }

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

    for (let dc = -1; dc <= 1; dc += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        if (dc === 0 && dr === 0) {
          continue;
        }
        const column = current.column + dc;
        const row = current.row + dr;
        const key = cellKey(column, row);
        if (visited.has(key)) {
          continue;
        }
        if (
          column < 0 ||
          row < 0 ||
          column >= map.coordinateSpace.columns ||
          row >= map.coordinateSpace.rows
        ) {
          continue;
        }
        if (!isWalkableCell(map, column, row)) {
          continue;
        }
        if (isOccupiedByOther(map, column, row, actorSeatId)) {
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
