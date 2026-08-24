/**
 * Door and movement intent against the committed map projection (PQA-146/147).
 */

import type { MapBundleProjection, MapEdgeRecord, MapSquareCoordinate } from '../../shared/map-contract.js';

import { nextStepTowardOpenDoor } from './move-planner.js';
import { proposeDoorSceneAhead } from './scene-builder.js';

export interface SceneDoorIntentResolution {
  readonly proposedCommandType: 'table.move' | 'table.sync' | 'table.open_door' | 'table.build_scene';
  readonly summary: string;
  readonly path?: readonly MapSquareCoordinate[];
  readonly edgeId?: string;
}

function mentionsMovementIntent(text: string): boolean {
  return /(move|walk|go|step|approach|enter)/.test(text);
}

function isAdjacentToDoor(
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

function nextStepTowardClosedDoor(
  anchor: MapSquareCoordinate,
  map: MapBundleProjection,
): MapSquareCoordinate | null {
  const closedDoors = map.edges.filter((edge) => edge.kind === 'door' && edge.doorState !== 'open');
  if (closedDoors.length === 0) {
    return null;
  }
  let nearest = closedDoors[0]!;
  let nearestDistance = Infinity;
  for (const door of closedDoors) {
    const distance = Math.abs(anchor.column - door.column) + Math.abs(anchor.row - door.row);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = door;
    }
  }
  if (isAdjacentToDoor(anchor, nearest)) {
    return null;
  }
  const columnDelta = nearest.column - anchor.column;
  const rowDelta = nearest.row - anchor.row;
  const candidates: MapSquareCoordinate[] = [];
  if (columnDelta !== 0) {
    candidates.push({ column: anchor.column + Math.sign(columnDelta), row: anchor.row });
  }
  if (rowDelta !== 0) {
    candidates.push({ column: anchor.column, row: anchor.row + Math.sign(rowDelta) });
  }
  for (const candidate of candidates) {
    const cell = map.cells.find(
      (entry) => entry.column === candidate.column && entry.row === candidate.row,
    );
    if (cell?.terrain !== 'blocked') {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolves door-related declarations against persisted scene geometry.
 * Returns null when the table is still a blank open floor with no edges.
 */
export function resolveDoorIntentForMap(
  map: MapBundleProjection,
  tokenAnchor: MapSquareCoordinate,
  text: string,
): SceneDoorIntentResolution | null {
  if (map.edges.length === 0) {
    return null;
  }

  const sceneTitle = map.title.trim().length > 0 ? map.title : 'this chamber';
  const closedDoors = map.edges.filter((edge) => edge.kind === 'door' && edge.doorState !== 'open');
  const openDoors = map.edges.filter((edge) => edge.kind === 'door' && edge.doorState === 'open');
  const adjacentClosed = closedDoors.find((edge) => isAdjacentToDoor(tokenAnchor, edge));

  if (adjacentClosed !== undefined) {
    return {
      proposedCommandType: 'table.open_door',
      edgeId: adjacentClosed.edgeId,
      summary: 'Ready to open the door beside you. Confirm to commit it on the map.',
    };
  }

  if (mentionsMovementIntent(text)) {
    const approachOpen = nextStepTowardOpenDoor(tokenAnchor, map);
    if (approachOpen !== null) {
      return {
        proposedCommandType: 'table.move',
        path: [approachOpen],
        summary: `Ready to move toward column ${approachOpen.column}, row ${approachOpen.row}. Confirm to commit the step.`,
      };
    }
    const approachClosed = nextStepTowardClosedDoor(tokenAnchor, map);
    if (approachClosed !== null) {
      return {
        proposedCommandType: 'table.move',
        path: [approachClosed],
        summary: `Ready to move toward column ${approachClosed.column}, row ${approachClosed.row}. Confirm to commit the step.`,
      };
    }
  }

  if (closedDoors.length > 0) {
    return {
      proposedCommandType: 'table.sync',
      summary:
        'There is a door on this scene, but you are not next to it yet. Move adjacent, then declare opening it again.',
    };
  }

  if (openDoors.length > 0) {
    const adjacentOpen = openDoors.find((edge) => isAdjacentToDoor(tokenAnchor, edge));
    if (
      adjacentOpen !== undefined &&
      /(swing|ajar|hinge|free|test|push|pull|check|inspect)/.test(text)
    ) {
      return {
        proposedCommandType: 'table.sync',
        edgeId: adjacentOpen.edgeId,
        summary:
          'The wooden door beside you is already open and swings freely on its hinges. No roll is required — declare what you do next through the doorway.',
      };
    }
    if (/(swing|ajar|hinge|free|test).*(door|gate)|door.*(swing|ajar|hinge|free|test)/.test(text)) {
      const door = adjacentOpen ?? openDoors[0]!;
      return {
        proposedCommandType: 'table.sync',
        edgeId: door.edgeId,
        summary: adjacentOpen
          ? 'The wooden door beside you is already open and swings freely on its hinges. No roll is required — declare what you do next through the doorway.'
          : `An open wooden door is on this scene (${sceneTitle}). Move adjacent to test it, or declare your next action through the doorway.`,
      };
    }
    if (/(enter|room beyond|beyond|through)/.test(text)) {
      return {
        proposedCommandType: 'table.sync',
        summary: `You are already through the doorway in ${sceneTitle}. Declare what you do next from your current position.`,
      };
    }
    return {
      proposedCommandType: 'table.sync',
      summary: `The doorway in ${sceneTitle} is already open. Move on the map or declare your next action.`,
    };
  }

  return {
    proposedCommandType: 'table.sync',
    summary: `${sceneTitle} already has walls and structural edges on the table. Declare your next action.`,
  };
}

/** Blank-table door placement when no geometry exists yet. */
export function resolveBlankTableDoorBuild(
  map: MapBundleProjection,
  tokenAnchor: MapSquareCoordinate,
  text: string,
): SceneDoorIntentResolution | null {
  if (!map.mapBundleId.startsWith('blank:') || map.edges.length > 0) {
    return null;
  }
  const blankBuild = proposeDoorSceneAhead({ tokenAnchor });
  return {
    proposedCommandType: 'table.build_scene',
    edgeId: blankBuild.doorEdgeId,
    summary: mentionsMovementIntent(text)
      ? 'Ready to raise a wall and wooden door ahead on this blank table, then you can walk to it and enter. Confirm to build the scene first.'
      : 'Ready to raise a wall and wooden door ahead of you on this blank table. Confirm to build the scene and open the door.',
  };
}
