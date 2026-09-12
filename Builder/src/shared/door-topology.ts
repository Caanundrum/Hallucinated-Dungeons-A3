/**
 * Near / far / crossing topology for doors and thresholds.
 * Keeps Play narration and reject copy aligned with map position truth.
 */

export type DoorSideRelation = 'near' | 'threshold' | 'far' | 'away';

export interface DoorEdgeLike {
  readonly column: number;
  readonly row: number;
  readonly orientation: 'north' | 'south' | 'east' | 'west';
  readonly doorState?: string | null;
}

export interface ActorAnchor {
  readonly column: number;
  readonly row: number;
}

/** Far-side square beyond an edge doorway (passage cell). */
export function doorPassageSquare(edge: DoorEdgeLike): ActorAnchor {
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

/** Near-side square the door edge belongs to. */
export function doorApproachSquare(edge: DoorEdgeLike): ActorAnchor {
  return { column: edge.column, row: edge.row };
}

function manhattan(a: ActorAnchor, b: ActorAnchor): number {
  return Math.abs(a.column - b.column) + Math.abs(a.row - b.row);
}

/**
 * Relation of an actor to a door edge: far = already on the passage side,
 * near = approach side / adjacent, threshold = on the door cell, away = farther.
 */
export function relationToDoor(anchor: ActorAnchor, edge: DoorEdgeLike): DoorSideRelation {
  const passage = doorPassageSquare(edge);
  const approach = doorApproachSquare(edge);
  if (anchor.column === passage.column && anchor.row === passage.row) {
    return 'far';
  }
  if (anchor.column === approach.column && anchor.row === approach.row) {
    return manhattan(anchor, passage) === 0 ? 'threshold' : 'near';
  }
  const distPassage = manhattan(anchor, passage);
  const distApproach = manhattan(anchor, approach);
  if (distApproach === 0 || distPassage === 0) {
    return 'threshold';
  }
  if (distApproach <= 1) {
    return 'near';
  }
  if (distPassage <= 1 && distPassage < distApproach) {
    // Adjacent to passage but not standing on it — still treated as near the leaf.
    return 'near';
  }
  return 'away';
}

export function describeDoorPosition(options: {
  readonly relation: DoorSideRelation;
  readonly doorLabel: string;
  readonly leaf: string;
  readonly sceneTitle: string;
}): string {
  const label = options.doorLabel.trim() || 'the doorway';
  const scene = options.sceneTitle.trim() || 'this chamber';
  if (options.relation === 'far') {
    return `You are already through the doorway (${label}) in ${scene}.`;
  }
  if (options.relation === 'near') {
    return `You stand near ${label} in ${scene}.`;
  }
  if (options.relation === 'threshold') {
    return `You are at the threshold of ${label} in ${scene}.`;
  }
  return `You are away from ${label} in ${scene}.`;
}

export type CrossingTopologyResult =
  | { readonly kind: 'already_through'; readonly summary: string }
  | { readonly kind: 'still_closed'; readonly summary: string }
  | { readonly kind: 'too_far'; readonly summary: string }
  | { readonly kind: 'proceed' };

/**
 * Crossing intent evaluated against topology.
 * Reverse-cross while already on the far side is allowed to proceed (step back).
 * Forward "enter / beyond" while already through is refused.
 */
export function resolveCrossingAgainstTopology(options: {
  readonly relation: DoorSideRelation;
  readonly leaf: string;
  readonly wantsCross: boolean;
  readonly wantsReverse: boolean;
}): CrossingTopologyResult {
  if (options.relation === 'far') {
    if (options.wantsReverse) {
      return { kind: 'proceed' };
    }
    if (options.wantsCross) {
      return {
        kind: 'already_through',
        summary:
          'You are already through the doorway. Look around or choose another exit from your current position.',
      };
    }
    return { kind: 'proceed' };
  }
  if (options.leaf !== 'open' && options.wantsCross && !options.wantsReverse) {
    return {
      kind: 'still_closed',
      summary: 'The doorway is still closed. Open it before you try to cross.',
    };
  }
  if (options.relation === 'away' && options.wantsCross) {
    return {
      kind: 'too_far',
      summary: 'You are too far from the doorway. Move closer before you cross.',
    };
  }
  return { kind: 'proceed' };
}
