/**
 * Deterministic one-step movement toward an open doorway (PQA-142).
 */

import type { MapBundleProjection, MapSquareCoordinate } from '../../shared/map-contract.js';

/** Square beyond an edge doorway (the far side of the door cell). */
export function doorPassageSquare(edge: {
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

/** Near-side square the door edge belongs to (opposite the passage square). */
export function doorApproachSquare(edge: {
  readonly column: number;
  readonly row: number;
}): MapSquareCoordinate {
  return { column: edge.column, row: edge.row };
}

/** True when the token already stands on the far side of an open doorway. */
export function isOnOpenDoorPassage(
  anchor: MapSquareCoordinate,
  map: MapBundleProjection,
): boolean {
  return map.edges.some((edge) => {
    if (edge.kind !== 'door' || edge.doorState !== 'open') {
      return false;
    }
    const passage = doorPassageSquare(edge);
    return passage.column === anchor.column && passage.row === anchor.row;
  });
}

function isBlocked(map: MapBundleProjection, square: MapSquareCoordinate): boolean {
  const cell = map.cells.find(
    (entry) => entry.column === square.column && entry.row === square.row,
  );
  return cell?.terrain === 'blocked';
}

function nearestOpenDoor(
  anchor: MapSquareCoordinate,
  map: MapBundleProjection,
): {
  readonly column: number;
  readonly row: number;
  readonly orientation: 'north' | 'south' | 'east' | 'west';
  readonly edgeId: string;
} | null {
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
  return nearestDoor;
}

/**
 * Next legal step through an open doorway in either direction:
 * toward the far (passage) square, or back to the near (approach) square.
 */
export function nextStepThroughOpenDoor(
  anchor: MapSquareCoordinate,
  map: MapBundleProjection,
): MapSquareCoordinate | null {
  const nearestDoor = nearestOpenDoor(anchor, map);
  if (nearestDoor === null) {
    return null;
  }
  const passage = doorPassageSquare(nearestDoor);
  const approach = doorApproachSquare(nearestDoor);
  const onPassage = anchor.column === passage.column && anchor.row === passage.row;
  const destination = onPassage ? approach : passage;
  if (anchor.column === destination.column && anchor.row === destination.row) {
    return null;
  }

  // Already adjacent to the destination — step onto it when legal.
  if (
    Math.abs(destination.column - anchor.column) <= 1 &&
    Math.abs(destination.row - anchor.row) <= 1 &&
    !isBlocked(map, destination)
  ) {
    return destination;
  }

  // Otherwise walk toward the destination one square at a time.
  const columnDelta = destination.column - anchor.column;
  const rowDelta = destination.row - anchor.row;
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

/** Returns the next legal adjacent step toward the nearest open door, or null when done. */
export function nextStepTowardOpenDoor(
  anchor: MapSquareCoordinate,
  map: MapBundleProjection,
): MapSquareCoordinate | null {
  return nextStepThroughOpenDoor(anchor, map);
}
