/**
 * Deterministic one-step movement toward an open doorway (PQA-142).
 */

import type { MapBundleProjection, MapSquareCoordinate } from '../../shared/map-contract.js';

function doorPassageSquare(edge: {
  readonly column: number;
  readonly row: number;
  readonly orientation: 'north' | 'south' | 'east' | 'west';
}): MapSquareCoordinate {
  if (edge.orientation === 'east') {
    return { column: edge.column + 1, row: edge.row };
  }
  if (edge.orientation === 'west') {
    return { column: edge.column - 1, row: edge.row };
  }
  if (edge.orientation === 'south') {
    return { column: edge.column, row: edge.row + 1 };
  }
  return { column: edge.column, row: edge.row - 1 };
}

function isBlocked(map: MapBundleProjection, square: MapSquareCoordinate): boolean {
  const cell = map.cells.find(
    (entry) => entry.column === square.column && entry.row === square.row,
  );
  return cell?.terrain === 'blocked';
}

/** Returns the next legal adjacent step toward the nearest open door, or null when done. */
export function nextStepTowardOpenDoor(
  anchor: MapSquareCoordinate,
  map: MapBundleProjection,
): MapSquareCoordinate | null {
  const openDoors = map.edges.filter(
    (edge) => edge.kind === 'door' && edge.doorState === 'open',
  );
  if (openDoors.length === 0) {
    return null;
  }

  let nearestDoor = openDoors[0]!;
  let nearestDistance = Infinity;
  for (const door of openDoors) {
    const distance = Math.abs(anchor.column - door.column) + Math.abs(anchor.row - door.row);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestDoor = door;
    }
  }

  const passage = doorPassageSquare(nearestDoor);
  if (anchor.column === passage.column && anchor.row === passage.row) {
    return null;
  }

  const columnDelta = passage.column - anchor.column;
  const rowDelta = passage.row - anchor.row;
  const candidates: MapSquareCoordinate[] = [];
  if (columnDelta !== 0) {
    candidates.push({ column: anchor.column + Math.sign(columnDelta), row: anchor.row });
  }
  if (rowDelta !== 0) {
    candidates.push({ column: anchor.column, row: anchor.row + Math.sign(rowDelta) });
  }

  for (const candidate of candidates) {
    if (
      Math.abs(candidate.column - anchor.column) <= 1 &&
      Math.abs(candidate.row - anchor.row) <= 1 &&
      (candidate.column !== anchor.column || candidate.row !== anchor.row) &&
      !isBlocked(map, candidate)
    ) {
      return candidate;
    }
  }

  return null;
}
