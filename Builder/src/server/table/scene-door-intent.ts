/**
 * Door and movement intent against the committed map projection (PQA-146/147).
 */

import type { MapBundleProjection, MapEdgeRecord, MapSquareCoordinate } from '../../shared/map-contract.js';
import {
  doorAuthorityFromStored,
  formatDoorAuthorityLabel,
  textRequestsLockPicking,
} from '../../shared/play-authority-contract.js';

import { isOnOpenDoorPassage, nextStepThroughOpenDoor } from './move-planner.js';
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

/** Adjectival "open door/doorway" is state, not an open-door verb. */
function stripOpenDoorNounPhrases(text: string): string {
  return text.replace(/\bopen(?:ed)?\s+(?:wooden\s+)?(?:door|doorway|gate)s?\b/gi, 'doorway');
}

function wantsOpenDoorAction(text: string): boolean {
  const withoutOpenNoun = stripOpenDoorNounPhrases(text);
  return /\b(?:opens?|opening|push(?:es|ing)?\s+open|swing(?:s|ing)?\s+open)\b/i.test(
    withoutOpenNoun,
  );
}

function wantsDoorPassage(text: string): boolean {
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

function doorBesideSummary(edge: MapEdgeRecord): string {
  return `${formatDoorAuthorityLabel(doorAuthorityFromStored(edge.doorState))} beside you`;
}

function doorApproachLabel(edge: MapEdgeRecord): string {
  return formatDoorAuthorityLabel(doorAuthorityFromStored(edge.doorState)).replace(/^Wooden door/i, 'door');
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
  const wantsOpen = !wantsUnlock && (wantsOpenDoorAction(text) || wantsDoorPassage(text));
  const wantsCross = wantsDoorPassage(text);
  const wantsInspect =
    /(inspect|check|examine|look\s*at|study|swing|ajar|hinge|free|test|push|pull)/.test(text) &&
    !wantsOpen &&
    !wantsUnlock;

  // Unlock attempts are skill-check drafts — do not open the door here.
  if (wantsUnlock) {
    return null;
  }

  // PQA-155: plain inspect/check reads current door state; open is a separate confirm.
  if (adjacentClosed !== undefined && wantsInspect) {
    const authority = doorAuthorityFromStored(adjacentClosed.doorState);
    const lockNote =
      authority.lock === 'locked'
        ? ' It is locked — declare a lock attempt to try the mechanism.'
        : authority.lock === 'unlocked'
          ? ' The lock is already open; you can declare opening the door when ready.'
          : ' It looks solid and ordinary from a casual look — no trap signs without a careful search.';
    return {
      proposedCommandType: 'table.sync',
      edgeId: adjacentClosed.edgeId,
      summary: `${doorBesideSummary(adjacentClosed)}.${lockNote} Confirm to open it, or declare a trap or lock check if you want a roll.`,
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

  if (mentionsMovementIntent(text) || wantsOpen) {
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
    const nearestClosed =
      closedDoors.length === 0
        ? null
        : closedDoors.reduce((best, door) => {
            const distance = Math.abs(tokenAnchor.column - door.column) + Math.abs(tokenAnchor.row - door.row);
            const bestDistance =
              Math.abs(tokenAnchor.column - best.column) + Math.abs(tokenAnchor.row - best.row);
            return distance < bestDistance ? door : best;
          });
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
