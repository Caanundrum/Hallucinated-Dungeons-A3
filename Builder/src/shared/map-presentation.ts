/**
 * Shared map presentation helpers — accessible edge names, route summaries,
 * and move destination prose used by client stage, table page, and server chronicle.
 */

import type {
  MapBundleProjection,
  MapEdgeRecord,
  MapSquareCoordinate,
} from './map-contract.js';
import {
  doorAuthorityFromStored,
  formatDoorPlayerFacingLabel,
} from './play-authority-contract.js';

export function edgeFacingLabel(orientation: MapEdgeRecord['orientation']): string {
  return orientation;
}

/** True when a token anchor is beside a door edge (both faces). */
export function isAdjacentToDoorEdge(
  anchor: MapSquareCoordinate,
  edge: MapEdgeRecord,
): boolean {
  return (
    (edge.orientation === 'east' &&
      edge.row === anchor.row &&
      (edge.column === anchor.column || edge.column === anchor.column - 1)) ||
    (edge.orientation === 'north' &&
      edge.column === anchor.column &&
      (edge.row === anchor.row || edge.row === anchor.row - 1)) ||
    (edge.orientation === 'west' &&
      edge.row === anchor.row &&
      (edge.column === anchor.column || edge.column === anchor.column + 1)) ||
    (edge.orientation === 'south' &&
      edge.column === anchor.column &&
      (edge.row === anchor.row || edge.row === anchor.row - 1))
  );
}

/**
 * One unique accessible name per structural edge.
 * Walls always include square coordinates; doors disambiguate when multiple share a facing.
 */
export function formatEdgeAccessibleLabel(
  edge: MapEdgeRecord,
  peers: readonly MapEdgeRecord[] = [],
): string {
  const facing = edgeFacingLabel(edge.orientation);
  const atSquare = `at column ${edge.column}, row ${edge.row}`;
  if (edge.kind === 'door') {
    const base = formatDoorPlayerFacingLabel(doorAuthorityFromStored(edge.doorState), facing);
    const sameFacing = peers.filter(
      (peer) => peer.kind === 'door' && peer.orientation === edge.orientation,
    );
    if (sameFacing.length > 1) {
      return `${base} ${atSquare}`;
    }
    return base;
  }
  return `Wall facing ${facing} ${atSquare}`;
}

/** Nearest door edge within one square of a destination, if any. */
export function doorNearSquare(
  map: Pick<MapBundleProjection, 'edges'>,
  square: MapSquareCoordinate,
): MapEdgeRecord | null {
  const doors = map.edges.filter((edge) => edge.kind === 'door');
  let best: MapEdgeRecord | null = null;
  let bestDistance = Infinity;
  for (const door of doors) {
    if (isAdjacentToDoorEdge(square, door)) {
      return door;
    }
    const distance = Math.abs(square.column - door.column) + Math.abs(square.row - door.row);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = door;
    }
  }
  return bestDistance <= 1 ? best : null;
}

/** Exit feature label near a square, if present. */
export function exitLabelNearSquare(
  map: Pick<MapBundleProjection, 'notableFeatures'>,
  square: MapSquareCoordinate,
): string | null {
  const exit = map.notableFeatures.find(
    (feature) =>
      (feature.referenceKind === 'exit' || feature.objectKind === 'exit') &&
      Math.abs(feature.column - square.column) + Math.abs(feature.row - square.row) <= 1 &&
      feature.label.trim().length > 0,
  );
  return exit?.label.trim() ?? null;
}

/**
 * Name a path destination for player-facing move prose.
 * Prefers exit/door labels over anonymous "marked destination".
 */
export function describeMoveDestination(
  map: Pick<MapBundleProjection, 'edges' | 'notableFeatures' | 'title'>,
  destination: MapSquareCoordinate,
): string {
  const exit = exitLabelNearSquare(map, destination);
  if (exit !== null) {
    return exit;
  }
  const door = doorNearSquare(map, destination);
  if (door !== null) {
    return formatDoorPlayerFacingLabel(
      doorAuthorityFromStored(door.doorState),
      edgeFacingLabel(door.orientation),
    );
  }
  return `column ${destination.column}, row ${destination.row}`;
}

export function formatMoveTravelSummary(options: {
  readonly path: readonly MapSquareCoordinate[];
  readonly map: Pick<
    MapBundleProjection,
    'edges' | 'notableFeatures' | 'title' | 'coordinateSpace'
  >;
  readonly start?: MapSquareCoordinate;
  readonly actorLabel?: string;
}): string {
  const { path, map } = options;
  if (path.length === 0) {
    return 'No move prepared.';
  }
  const destination = path[path.length - 1]!;
  const squares = path.length;
  const feet = squares * map.coordinateSpace.feetPerSquare;
  const scene = map.title.trim().length > 0 ? map.title : 'the map';
  const dest = describeMoveDestination(map, destination);
  const origin =
    options.start !== undefined
      ? ` from column ${options.start.column}, row ${options.start.row}`
      : '';
  const actor = options.actorLabel?.trim();
  const prefix = actor && actor.length > 0 ? `${actor} moved` : 'Moved';
  return `${prefix} ${squares} square${squares === 1 ? '' : 's'} (${feet} ft)${origin} across ${scene} toward ${dest}.`;
}

/** Route line for the map summary live region — uses door labels, not "unmarked opening". */
export function formatMapRouteSummary(map: Pick<MapBundleProjection, 'edges' | 'notableFeatures'>): string {
  const exitLabels = map.notableFeatures
    .filter((feature) => feature.referenceKind === 'exit' || feature.objectKind === 'exit')
    .map((feature) => feature.label.trim())
    .filter((label) => label.length > 0);
  if (exitLabels.length > 0) {
    return exitLabels.join('; ');
  }
  const doors = map.edges.filter((edge) => edge.kind === 'door');
  if (doors.length === 0) {
    return 'no marked exits';
  }
  return doors
    .map((edge) =>
      formatDoorPlayerFacingLabel(
        doorAuthorityFromStored(edge.doorState),
        edgeFacingLabel(edge.orientation),
      ),
    )
    .join('; ');
}

/**
 * When a party token stands beside a door, name that adjacency for the map summary.
 */
export function formatPartyDoorAdjacency(
  map: Pick<MapBundleProjection, 'edges' | 'tokens'>,
): string | null {
  if (map.tokens.length === 0) {
    return null;
  }
  const parts: string[] = [];
  for (const token of map.tokens) {
    const anchor = token.footprint.anchor;
    const door = map.edges.find(
      (edge) => edge.kind === 'door' && isAdjacentToDoorEdge(anchor, edge),
    );
    if (door === undefined) {
      continue;
    }
    const facing = edgeFacingLabel(door.orientation);
    parts.push(`${token.label} is beside the ${facing} door`);
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.join('; ');
}

export function formatMapTerrainSummary(map: MapBundleProjection): string {
  const scene = map.title.trim().length > 0 ? map.title : 'Scene';
  const routes = formatMapRouteSummary(map);
  const props = map.notableFeatures
    .filter((feature) => feature.referenceKind !== 'exit' && feature.objectKind !== 'exit')
    .slice(0, 4)
    .map((feature) => feature.label);
  const party =
    map.tokens.length > 0
      ? map.tokens.map((token) => token.label).join(', ')
      : 'no party token';
  const adjacency = formatPartyDoorAdjacency(map);
  const propLine = props.length > 0 ? ` · Nearby: ${props.join('; ')}` : '';
  const adjacencyLine = adjacency !== null ? ` · ${adjacency}` : '';
  return `${scene} · Routes: ${routes} · Party: ${party}${adjacencyLine}${propLine}`;
}

/** Door edge nearest an exit feature (for a11y ownership). */
export function doorBoundToExitFeature(
  map: Pick<MapBundleProjection, 'edges'>,
  feature: { readonly column: number; readonly row: number },
): MapEdgeRecord | null {
  return (
    map.edges.find(
      (edge) =>
        edge.kind === 'door' &&
        Math.abs(edge.column - feature.column) + Math.abs(edge.row - feature.row) <= 1,
    ) ?? null
  );
}
