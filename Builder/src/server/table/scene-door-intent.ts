/**
 * Door and movement intent against the committed map projection (PQA-146/147).
 */

import type { MapBundleProjection, MapEdgeRecord, MapSquareCoordinate } from '../../shared/map-contract.js';
import {
  doorAuthorityFromStored,
  formatDoorAuthorityLabel,
  textRequestsLockPicking,
} from '../../shared/play-authority-contract.js';
import { declarationNegatesDoorOpen } from '../../shared/resolved-action-receipt.js';

import { isOnOpenDoorPassage, nextStepThroughOpenDoor } from './move-planner.js';
import { proposeDoorSceneAhead } from './scene-builder.js';

export interface SceneDoorIntentResolution {
  readonly proposedCommandType:
    | 'table.move'
    | 'table.sync'
    | 'table.open_door'
    | 'table.close_door'
    | 'table.build_scene';
  readonly summary: string;
  readonly path?: readonly MapSquareCoordinate[];
  readonly edgeId?: string;
}

function mentionsMovementIntent(text: string): boolean {
  return /(move|walk|go|step|approach|enter)/.test(text);
}

/** Adjectival "open door/doorway" is state, not an open-door verb. */
function stripOpenDoorNounPhrases(text: string): string {
  return text.replace(/\bopen(?:ed)?\s+(?:wooden\s+)?(?:door|doorway|gate)s?\b/gi, 'doorway');
}

function wantsOpenDoorAction(text: string): boolean {
  if (declarationNegatesDoorOpen(text)) {
    return false;
  }
  const withoutOpenNoun = stripOpenDoorNounPhrases(text);
  return /\b(?:opens?|opening|push(?:es|ing)?\s+open|swing(?:s|ing)?\s+open)\b/i.test(
    withoutOpenNoun,
  );
}

function wantsCloseDoorAction(text: string): boolean {
  return (
    /\b(?:closes?|closing|shut(?:s|ting)?)\b/i.test(text) &&
    /\b(?:door|doorway|gate|entry(?:way)?)\b/i.test(text)
  );
}

function wantsDoorPassage(text: string): boolean {
  // Negated open + passage language is not a crossing intent against a closed door.
  if (declarationNegatesDoorOpen(text)) {
    return false;
  }
  return (
    /\b(?:steps?\s+through|enter(?:s|ing)?|through|beyond|continue)\b/i.test(text) ||
    /\b(?:go|walk|move|step)s?\s+(?:west|east|north|south|back)\b/i.test(text)
  );
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

function isBlockedSquare(map: MapBundleProjection, square: MapSquareCoordinate): boolean {
  const cell = map.cells.find(
    (entry) => entry.column === square.column && entry.row === square.row,
  );
  return cell?.terrain === 'blocked';
}

/** Near-side and far-side squares that count as beside a door edge. */
function adjacentSquaresForDoor(edge: MapEdgeRecord): MapSquareCoordinate[] {
  if (edge.orientation === 'east') {
    return [
      { column: edge.column, row: edge.row },
      { column: edge.column + 1, row: edge.row },
    ];
  }
  if (edge.orientation === 'west') {
    return [
      { column: edge.column, row: edge.row },
      { column: edge.column - 1, row: edge.row },
    ];
  }
  if (edge.orientation === 'south') {
    return [
      { column: edge.column, row: edge.row },
      { column: edge.column, row: edge.row + 1 },
    ];
  }
  return [
    { column: edge.column, row: edge.row },
    { column: edge.column, row: edge.row - 1 },
  ];
}

function nearestClosedDoor(
  anchor: MapSquareCoordinate,
  map: MapBundleProjection,
): MapEdgeRecord | null {
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
  return nearest;
}

function nextStepTowardSquare(
  anchor: MapSquareCoordinate,
  target: MapSquareCoordinate,
  map: MapBundleProjection,
): MapSquareCoordinate | null {
  if (anchor.column === target.column && anchor.row === target.row) {
    return null;
  }
  const columnDelta = target.column - anchor.column;
  const rowDelta = target.row - anchor.row;
  const candidates: MapSquareCoordinate[] = [];
  if (columnDelta !== 0) {
    candidates.push({ column: anchor.column + Math.sign(columnDelta), row: anchor.row });
  }
  if (rowDelta !== 0) {
    candidates.push({ column: anchor.column, row: anchor.row + Math.sign(rowDelta) });
  }
  for (const candidate of candidates) {
    if (!isBlockedSquare(map, candidate)) {
      return candidate;
    }
  }
  return null;
}

function nextStepTowardClosedDoor(
  anchor: MapSquareCoordinate,
  map: MapBundleProjection,
): MapSquareCoordinate | null {
  const nearest = nearestClosedDoor(anchor, map);
  if (nearest === null || isAdjacentToDoor(anchor, nearest)) {
    return null;
  }
  const targets = adjacentSquaresForDoor(nearest).filter((square) => !isBlockedSquare(map, square));
  if (targets.length === 0) {
    return null;
  }
  targets.sort(
    (left, right) =>
      Math.abs(left.column - anchor.column) +
      Math.abs(left.row - anchor.row) -
      (Math.abs(right.column - anchor.column) + Math.abs(right.row - anchor.row)),
  );
  return nextStepTowardSquare(anchor, targets[0]!, map);
}

/**
 * Full walk path that lands beside the nearest closed door in one confirm
 * (beside / next to / adjacent declarations). Caps at movement budget squares.
 */
function pathBesideClosedDoor(
  anchor: MapSquareCoordinate,
  map: MapBundleProjection,
  maxSteps = 6,
): MapSquareCoordinate[] | null {
  const nearest = nearestClosedDoor(anchor, map);
  if (nearest === null || isAdjacentToDoor(anchor, nearest)) {
    return null;
  }
  const targets = adjacentSquaresForDoor(nearest).filter((square) => !isBlockedSquare(map, square));
  if (targets.length === 0) {
    return null;
  }
  targets.sort(
    (left, right) =>
      Math.abs(left.column - anchor.column) +
      Math.abs(left.row - anchor.row) -
      (Math.abs(right.column - anchor.column) + Math.abs(right.row - anchor.row)),
  );
  const destination = targets[0]!;
  const path: MapSquareCoordinate[] = [];
  let cursor = anchor;
  for (let step = 0; step < maxSteps; step += 1) {
    if (isAdjacentToDoor(cursor, nearest)) {
      break;
    }
    const next = nextStepTowardSquare(cursor, destination, map);
    if (next === null) {
      break;
    }
    path.push(next);
    cursor = next;
  }
  return path.length > 0 ? path : null;
}

function wantsBesideDoorIntent(text: string): boolean {
  return (
    /\b(?:beside|next\s+to|adjacent\s+to|up\s+to)\b/i.test(text) &&
    /\b(?:door|doorway|gate|entry(?:way)?)\b/i.test(text)
  );
}

function doorBesideSummary(edge: MapEdgeRecord): string {
  return `${formatDoorAuthorityLabel(doorAuthorityFromStored(edge.doorState))} beside you`;
}

function doorApproachLabel(edge: MapEdgeRecord): string {
  return formatDoorAuthorityLabel(doorAuthorityFromStored(edge.doorState)).replace(/^Wooden doorway/i, 'doorway');
}

function approachThenOpenCopy(sceneTitle: string, edge: MapEdgeRecord, wantsOpen: boolean): string {
  const label = doorApproachLabel(edge);
  if (wantsOpen) {
    return `Ready to step toward the ${label} in ${sceneTitle}. Confirm moves you closer only — when you are beside it, declare open / step through again to finish the passage.`;
  }
  return `Ready to step toward the ${label} in ${sceneTitle}. Confirm to commit the step.`;
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
  const adjacentOpen = openDoors.find((edge) => isAdjacentToDoor(tokenAnchor, edge));
  const wantsUnlock = textRequestsLockPicking(text);
  const wantsClose = !wantsUnlock && wantsCloseDoorAction(text);
  const wantsOpen = !wantsUnlock && !wantsClose && (wantsOpenDoorAction(text) || wantsDoorPassage(text));
  const wantsCross = !wantsClose && wantsDoorPassage(text);
  const wantsInspect =
    (/\b(?:inspect|check|examine|look\s*at|study|swing|ajar|hinge|free|test|listen|locked)\b/.test(
      text,
    ) ||
      /\b(?:whether|if)\s+(?:the\s+)?(?:door|doorway|gate|lock)/.test(text) ||
      declarationNegatesDoorOpen(text)) &&
    !/\b(?:investigat|search\s+for|trap|disarm)\b/.test(text) &&
    !wantsOpen &&
    !wantsClose &&
    !wantsUnlock;

  // Unlock attempts are skill-check drafts — do not open the door here.
  if (wantsUnlock) {
    return null;
  }

  // Already beside the requested doorway: answer clearly, do not fall back to generic intent.
  if (wantsBesideDoorIntent(text)) {
    if (adjacentOpen !== undefined) {
      return {
        proposedCommandType: 'table.sync',
        edgeId: adjacentOpen.edgeId,
        summary: `You are already beside the ${doorApproachLabel(adjacentOpen)} in ${sceneTitle}. Declare open, close, inspect, or step through from here.`,
      };
    }
    if (adjacentClosed !== undefined) {
      return {
        proposedCommandType: 'table.sync',
        edgeId: adjacentClosed.edgeId,
        summary: `You are already beside the ${doorApproachLabel(adjacentClosed)} in ${sceneTitle}. Declare open, inspect, or a lock attempt from here.`,
      };
    }
  }

  // Close an adjacent open leaf — door authority owns this, never interact_object.
  if (wantsClose) {
    if (adjacentOpen !== undefined) {
      return {
        proposedCommandType: 'table.close_door',
        edgeId: adjacentOpen.edgeId,
        summary: `Ready to close the ${doorApproachLabel(adjacentOpen)} beside you. Confirm to shut the leaf on the map (lock stays unlocked).`,
      };
    }
    if (adjacentClosed !== undefined) {
      return {
        proposedCommandType: 'table.sync',
        edgeId: adjacentClosed.edgeId,
        summary: `The ${doorApproachLabel(adjacentClosed)} beside you is already closed. Declare open or inspect if you need a different action.`,
      };
    }
    const nearestOpen = openDoors[0] ?? null;
    if (nearestOpen !== null) {
      return {
        proposedCommandType: 'table.sync',
        edgeId: nearestOpen.edgeId,
        summary: `There is an open doorway in ${sceneTitle}, but you are not next to it yet. Move adjacent, then declare closing it again.`,
      };
    }
    return {
      proposedCommandType: 'table.sync',
      summary: `No open doorway is beside you in ${sceneTitle} to close.`,
    };
  }

  // PQA-155: plain inspect/check/listen reads current door state; open is a separate confirm.
  if (adjacentClosed !== undefined && wantsInspect) {
    const authority = doorAuthorityFromStored(adjacentClosed.doorState);
    const lockNote =
      authority.lock === 'locked'
        ? ' It is locked — declare a lock attempt to try the mechanism.'
        : authority.lock === 'unlocked'
          ? ' The lock is unlocked; the leaf is still closed — declare opening when ready.'
          : ' It looks solid and ordinary from a casual look — no trap signs without a careful search.';
    const listenNote = /\blisten\b/.test(text)
      ? ' You hear only the quiet of the chamber beyond the wood — nothing that forces a roll.'
      : '';
    return {
      proposedCommandType: 'table.sync',
      edgeId: adjacentClosed.edgeId,
      summary: `${doorBesideSummary(adjacentClosed)}.${lockNote}${listenNote} No open or move is prepared — declare opening only when you intend to open it.`,
    };
  }

  if (adjacentClosed !== undefined) {
    if (adjacentClosed.doorState === 'locked') {
      return {
        proposedCommandType: 'table.sync',
        edgeId: adjacentClosed.edgeId,
        summary:
          'The wooden door beside you is locked. Declare a lock attempt before opening it, or inspect it carefully first.',
      };
    }
    const authority = doorAuthorityFromStored(adjacentClosed.doorState);
    const unlockedNote =
      authority.lock === 'unlocked' ? ' It is unlocked — no tools or roll required.' : '';
    return {
      proposedCommandType: 'table.open_door',
      edgeId: adjacentClosed.edgeId,
      summary: wantsCross
        ? `Ready to open the door beside you and step through.${unlockedNote} Confirm to open it and cross the doorway.`
        : wantsOpenDoorAction(text)
          ? `Ready to open the door beside you.${unlockedNote} Confirm to open it on the map.`
          : `Ready to open the door beside you.${unlockedNote} Confirm to commit it on the map.`,
    };
  }

  // Standing beyond an open doorway: "enter the room beyond" is already done;
  // "through / west / back" is a confirmable reverse cross.
  if (isOnOpenDoorPassage(tokenAnchor, map)) {
    const wantsReverseCross =
      /\bthrough\b/i.test(text) ||
      /\b(?:go|walk|move|step)s?\s+(?:west|east|north|south|back)\b/i.test(text) ||
      /\b(?:back|return)\b/i.test(text);
    if (!wantsReverseCross && /(enter|room beyond|beyond)/.test(text)) {
      return {
        proposedCommandType: 'table.sync',
        summary: `You are already through the doorway in ${sceneTitle}. Declare what you do next from your current position.`,
      };
    }
  }

  // Standing on either side of an open doorway: through/enter/west is a confirmable cross.
  if (wantsCross || (adjacentOpen !== undefined && wantsOpen)) {
    const throughStep = nextStepThroughOpenDoor(tokenAnchor, map);
    if (throughStep !== null) {
      const reversing = isOnOpenDoorPassage(tokenAnchor, map);
      return {
        proposedCommandType: 'table.move',
        path: [throughStep],
        ...(adjacentOpen !== undefined ? { edgeId: adjacentOpen.edgeId } : {}),
        summary: reversing
          ? `Ready to step back through the open doorway in ${sceneTitle}. Confirm to commit the step.`
          : `Ready to step through the open doorway in ${sceneTitle}. Confirm to commit the step.`,
      };
    }
  }

  if (adjacentOpen !== undefined && wantsInspect) {
    return {
      proposedCommandType: 'table.sync',
      edgeId: adjacentOpen.edgeId,
      summary:
        'The wooden door beside you is already open and swings freely on its hinges. No roll is required — declare what you do next through the doorway.',
    };
  }

  if (mentionsMovementIntent(text) || wantsOpen || wantsBesideDoorIntent(text)) {
    const approachOpen = nextStepThroughOpenDoor(tokenAnchor, map);
    if (approachOpen !== null && !isOnOpenDoorPassage(tokenAnchor, map)) {
      return {
        proposedCommandType: 'table.move',
        path: [approachOpen],
        summary: wantsOpen
          ? `Ready to step toward the open doorway in ${sceneTitle}. Confirm moves you closer only — when you are beside it, declare step through / enter again to continue.`
          : `Ready to step toward the open doorway in ${sceneTitle}. Confirm to commit the step.`,
      };
    }
    const nearestClosed = nearestClosedDoor(tokenAnchor, map);
    if (wantsBesideDoorIntent(text) && nearestClosed !== null) {
      const besidePath = pathBesideClosedDoor(tokenAnchor, map);
      if (besidePath !== null) {
        const steps = besidePath.length;
        const feet = steps * map.coordinateSpace.feetPerSquare;
        return {
          proposedCommandType: 'table.move',
          path: besidePath,
          edgeId: nearestClosed.edgeId,
          summary: `Ready to move beside the ${doorApproachLabel(nearestClosed)} in ${sceneTitle} (${steps} square${steps === 1 ? '' : 's'}, ${feet} ft). Confirm to arrive adjacent — then declare open / inspect.`,
        };
      }
    }
    const approachClosed = nextStepTowardClosedDoor(tokenAnchor, map);
    if (approachClosed !== null && nearestClosed !== null) {
      return {
        proposedCommandType: 'table.move',
        path: [approachClosed],
        summary: approachThenOpenCopy(sceneTitle, nearestClosed, wantsOpen),
      };
    }
  }

  if (closedDoors.length > 0) {
    const door = closedDoors[0]!;
    if (wantsInspect) {
      return {
        proposedCommandType: 'table.sync',
        edgeId: door.edgeId,
        summary: `A closed wooden door stands in ${sceneTitle}. Move adjacent to inspect it up close, then open it or declare a careful trap or lock check.`,
      };
    }
    return {
      proposedCommandType: 'table.sync',
      edgeId: door.edgeId,
      summary: wantsOpen
        ? `There is a ${doorApproachLabel(door)} on this scene, but you are not next to it yet. Move adjacent, then declare open / step through again to finish.`
        : 'There is a closed door on this scene, but you are not next to it yet. Move adjacent, then declare opening it again.',
    };
  }

  if (openDoors.length > 0) {
    if (/(swing|ajar|hinge|free|test).*(door|gate)|door.*(swing|ajar|hinge|free|test)|inspect|check|examine/.test(text)) {
      const door = adjacentOpen ?? openDoors[0]!;
      return {
        proposedCommandType: 'table.sync',
        edgeId: door.edgeId,
        summary: adjacentOpen
          ? 'The wooden door beside you is already open and swings freely on its hinges. No roll is required — declare what you do next through the doorway.'
          : `An open wooden door is on this scene (${sceneTitle}). Move adjacent to test it, or declare your next action through the doorway.`,
      };
    }
    if (wantsCross) {
      const throughStep = nextStepThroughOpenDoor(tokenAnchor, map);
      if (throughStep !== null) {
        return {
          proposedCommandType: 'table.move',
          path: [throughStep],
          summary: `Ready to step through the open doorway in ${sceneTitle}. Confirm to commit the step.`,
        };
      }
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
