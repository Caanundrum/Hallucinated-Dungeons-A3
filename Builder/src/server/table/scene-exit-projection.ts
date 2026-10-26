/**
 * Contract-to-map exit projection (system-wide).
 *
 * Every scene-contract exit must appear as a visible tactical primitive with a
 * usable label. Composition may declare exits without placing them; projection
 * materializes markers + door edges inside spawn vision so fog cannot hide them.
 */

import { edgeId, type DoorState, type MapEdgeRecord, type MapSquareCoordinate } from '../../shared/map-contract.js';
import type { ComposedScene, ComposedSceneFeature } from './scene-composition.js';
import type { StoredSceneExit, StoredSceneFeature, StoredSceneInstance } from './map-runtime.js';

export type ExitOrientation = 'north' | 'south' | 'east' | 'west';

export function isPerimeterCoordinate(
  column: number,
  row: number,
  columns: number,
  rows: number,
): boolean {
  return column === 0 || column === columns - 1 || row === 0 || row === rows - 1;
}

export function inferExitPlacement(
  exit: { readonly label: string },
  spawn: MapSquareCoordinate,
  columns: number,
  rows: number,
  index: number,
): { readonly column: number; readonly row: number; readonly orientation: ExitOrientation } {
  const label = exit.label.toLowerCase();
  const midCol = Math.max(1, Math.min(columns - 2, spawn.column || Math.floor(columns / 2)));
  const midRow = Math.max(1, Math.min(rows - 2, spawn.row || Math.floor(rows / 2)));

  if (/\b(north|parapet|ladder|stair)\b/.test(label) && !/\b(south|back\s+down|back\s+to)\b/.test(label)) {
    return { column: midCol, row: 0, orientation: 'north' };
  }
  if (/\b(south|back\s+down)\b/.test(label)) {
    return { column: midCol, row: rows - 1, orientation: 'south' };
  }
  if (/\b(west|river|near bank|inland|behind|daylight|retreat|way back|return|back to)\b/.test(label)) {
    const row = Math.max(1, Math.min(rows - 2, midRow + (index % 2)));
    return { column: 0, row, orientation: 'west' };
  }
  if (/\b(east|onward|forward|shore|deeper|far bank|doorway east|path onward|trail|passage|archway)\b/.test(label)) {
    return { column: columns - 1, row: midRow, orientation: 'east' };
  }
  // Stagger unmarked exits along the 4 perimeter edges so all exits stay perimeter-locked.
  const perimeterBearings: Array<{ column: number; row: number; orientation: ExitOrientation }> = [
    { column: columns - 1, row: midRow, orientation: 'east' },
    { column: midCol, row: 0, orientation: 'north' },
    { column: 0, row: midRow, orientation: 'west' },
    { column: midCol, row: rows - 1, orientation: 'south' },
  ];
  return perimeterBearings[index % perimeterBearings.length]!;
}

export function extractSceneCardinalExits(options: {
  readonly exits: readonly { readonly label: string }[];
  readonly spawn: MapSquareCoordinate;
  readonly columns: number;
  readonly rows: number;
}): { readonly cardinal: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'; readonly label: string }[] {
  return options.exits.map((exit, index) => {
    const place = inferExitPlacement(exit, options.spawn, options.columns, options.rows, index);
    const cardinal =
      place.orientation === 'north'
        ? 'NORTH'
        : place.orientation === 'south'
          ? 'SOUTH'
          : place.orientation === 'west'
            ? 'WEST'
            : 'EAST';
    return {
      cardinal,
      label: exit.label.replace(/\s*—\s*(?:open|closed|locked|unlocked).*$/i, '').trim(),
    };
  });
}

function isExitFeature(feature: { readonly objectId: string; readonly objectKind?: string; readonly referenceKind?: string }): boolean {
  return (
    feature.objectKind === 'exit' ||
    feature.referenceKind === 'exit' ||
    feature.objectId.includes(':exit')
  );
}

function nearbyDoor(
  edges: readonly MapEdgeRecord[],
  column: number,
  row: number,
): boolean {
  return edges.some(
    (edge) =>
      edge.kind === 'door' &&
      Math.abs(edge.column - column) <= 1 &&
      Math.abs(edge.row - row) <= 1,
  );
}

/**
 * Materialize every contract exit onto perimeter features + door edges.
 * Idempotent: existing exit features are normalized to the perimeter boundary.
 */
export function materializeContractExits<
  TFeature extends {
    readonly objectId: string;
    readonly column: number;
    readonly row: number;
    readonly label: string;
    readonly referenceKind: string;
    readonly objectKind: string;
    readonly state: string;
    readonly interactable: boolean;
    readonly lockState?: 'unlocked' | 'locked';
    readonly keyItemId?: string | null;
    readonly lockpickDC?: number | null;
    readonly breakDC?: number | null;
  },
  TExit extends {
    readonly exitId: string;
    readonly label: string;
    readonly destinationHint: string;
    readonly returnToSceneId?: string | null;
    readonly lockState?: 'unlocked' | 'locked';
    readonly keyItemId?: string | null;
    readonly lockpickDC?: number | null;
    readonly breakDC?: number | null;
  },
>(options: {
  readonly spawn: MapSquareCoordinate;
  readonly columns: number;
  readonly rows: number;
  readonly features: readonly TFeature[];
  readonly exits: readonly TExit[];
  readonly edges: readonly MapEdgeRecord[];
  readonly doorStates: Record<string, DoorState>;
  readonly suppressSyntheticDoors?: boolean;
  readonly snapToAnyExistingDoor?: boolean;
}): {
  readonly features: TFeature[];
  readonly edges: MapEdgeRecord[];
  readonly doorStates: Record<string, DoorState>;
} {
  // Normalize any existing exit features so they are strictly on the outer perimeter.
  const features = options.features.map((feature, idx) => {
    if (!isExitFeature(feature)) {
      return feature;
    }
    if (isPerimeterCoordinate(feature.column, feature.row, options.columns, options.rows)) {
      return feature;
    }
    const snapped = inferExitPlacement(
      { label: feature.label },
      options.spawn,
      options.columns,
      options.rows,
      idx,
    );
    return {
      ...feature,
      column: snapped.column,
      row: snapped.row,
    };
  }) as TFeature[];
  const edges = [...options.edges];
  const doorStates = { ...options.doorStates };
  const knownExitIds = new Set(
    features.filter((feature) => isExitFeature(feature)).map((feature) => feature.objectId),
  );

  options.exits.forEach((exit, index) => {
    let place = inferExitPlacement(exit, options.spawn, options.columns, options.rows, index);
    // Keep multiple exits on distinct perimeter squares.
    let guard = 0;
    while (
      guard < 8 &&
      features.some(
        (feature) =>
          isExitFeature(feature) &&
          feature.column === place.column &&
          feature.row === place.row,
      )
    ) {
      const delta = guard % 2 === 0 ? Math.ceil((guard + 1) / 2) : -Math.ceil((guard + 1) / 2);
      if (place.orientation === 'east' || place.orientation === 'west') {
        place = {
          column: place.orientation === 'east' ? options.columns - 1 : 0,
          row: Math.max(1, Math.min(options.rows - 2, place.row + delta)),
          orientation: place.orientation,
        };
      } else {
        place = {
          column: Math.max(1, Math.min(options.columns - 2, place.column + delta)),
          row: place.orientation === 'south' ? options.rows - 1 : 0,
          orientation: place.orientation,
        };
      }
      guard += 1;
    }
    const existingOriented =
      edges.find((edge) => edge.kind === 'door' && edge.orientation === place.orientation) ??
      (options.snapToAnyExistingDoor && index === 0
        ? edges.find((edge) => edge.kind === 'door')
        : undefined);
    // Only snap row/column alignment to an existing door if we still keep the exit feature on the perimeter.
    if (existingOriented !== undefined) {
      if (place.orientation === 'east' || place.orientation === 'west') {
        place = {
          column: place.orientation === 'east' ? options.columns - 1 : 0,
          row: Math.max(1, Math.min(options.rows - 2, existingOriented.row)),
          orientation: place.orientation,
        };
      } else {
        place = {
          column: Math.max(1, Math.min(options.columns - 2, existingOriented.column)),
          row: place.orientation === 'south' ? options.rows - 1 : 0,
          orientation: place.orientation,
        };
      }
    }
    const explicitExitLocked = exit.lockState === 'locked';
    const doorState: DoorState = explicitExitLocked
      ? 'locked'
      : options.suppressSyntheticDoors && existingOriented === undefined
        ? 'open'
        : existingOriented !== undefined
          ? (doorStates[existingOriented.edgeId] ?? existingOriented.doorState ?? 'closed')
          : 'closed';
    const labeledExit = /\b—\s*(open|closed|locked|unlocked)\b/i.test(exit.label)
      ? exit.label
      : `${exit.label.replace(/\s*\((?:open|closed|locked|unlocked)\)\s*/gi, '').trim()} — ${doorState}`;
    if (!knownExitIds.has(exit.exitId)) {
      const alreadyLabeled = features.some(
        (feature) =>
          isExitFeature(feature) &&
          feature.label.toLowerCase().startsWith(exit.label.toLowerCase().slice(0, 12)),
      );
      if (!alreadyLabeled) {
        features.push({
          objectId: exit.exitId,
          column: place.column,
          row: place.row,
          label: labeledExit,
          referenceKind: 'exit',
          objectKind: 'exit',
          state: explicitExitLocked ? 'locked' : 'present',
          interactable: false,
          ...(exit.lockState !== undefined ? { lockState: exit.lockState } : {}),
          ...(exit.keyItemId !== undefined ? { keyItemId: exit.keyItemId } : {}),
          ...(exit.lockpickDC !== undefined ? { lockpickDC: exit.lockpickDC } : {}),
          ...(exit.breakDC !== undefined ? { breakDC: exit.breakDC } : {}),
        } as TFeature);
        knownExitIds.add(exit.exitId);
      }
    }
    // Only add a door when none exists on this bearing and none is already nearby.
    const exitLooksLikeDoor = /\b(?:door|doorway|gate|gateway|hatch|trapdoor|portcullis)\b/i.test(
      exit.label,
    );
    const alreadyHasAnyDoor = edges.some((edge) => edge.kind === 'door');
    if (
      !options.suppressSyntheticDoors &&
      existingOriented === undefined &&
      !nearbyDoor(edges, place.column, place.row) &&
      (!alreadyHasAnyDoor || exitLooksLikeDoor || explicitExitLocked)
    ) {
      const id = edgeId(place.column, place.row, place.orientation);
      if (!edges.some((edge) => edge.edgeId === id)) {
        edges.push({
          edgeId: id,
          column: place.column,
          row: place.row,
          orientation: place.orientation,
          kind: 'door',
          doorState: explicitExitLocked ? 'locked' : 'closed',
          ...(exit.keyItemId !== undefined && exit.keyItemId !== null ? { keyItemId: exit.keyItemId } : {}),
          ...(exit.lockpickDC !== undefined && exit.lockpickDC !== null ? { lockpickDC: exit.lockpickDC } : {}),
          ...(exit.breakDC !== undefined && exit.breakDC !== null ? { breakDC: exit.breakDC } : {}),
        });
      }
      doorStates[id] = doorStates[id] ?? (explicitExitLocked ? 'locked' : 'closed');
    }
  });

  return { features, edges, doorStates };
}

function carveExitPerimeterCells<TCell extends { readonly column: number; readonly row: number; readonly terrain: string }>(
  cells: readonly TCell[],
  features: readonly { readonly column: number; readonly row: number; readonly objectId: string; readonly objectKind?: string; readonly referenceKind?: string }[],
  columns: number,
  rows: number,
): TCell[] {
  const exitCoords = new Set<string>();
  for (const feature of features) {
    if (!isExitFeature(feature)) continue;
    exitCoords.add(`${feature.column},${feature.row}`);
    // Also ensure the inward orthogonal neighbor is walkable floor.
    if (feature.column === 0) exitCoords.add(`1,${feature.row}`);
    if (feature.column === columns - 1) exitCoords.add(`${columns - 2},${feature.row}`);
    if (feature.row === 0) exitCoords.add(`${feature.column},1`);
    if (feature.row === rows - 1) exitCoords.add(`${feature.column},${rows - 2}`);
  }
  if (exitCoords.size === 0) {
    return [...cells];
  }
  return cells.map((cell) =>
    exitCoords.has(`${cell.column},${cell.row}`) && cell.terrain === 'blocked'
      ? ({ ...cell, terrain: 'floor' } as TCell)
      : cell,
  );
}

/** Apply exit materialization to a composed scene before runtime storage. */
export function attachExitsToComposedScene(scene: ComposedScene): ComposedScene {
  const materialized = materializeContractExits({
    spawn: scene.spawn,
    columns: scene.columns,
    rows: scene.rows,
    features: scene.features,
    exits: scene.exits,
    edges: scene.edges,
    doorStates: scene.doorStates,
  });
  return {
    ...scene,
    cells: carveExitPerimeterCells(scene.cells, materialized.features, scene.columns, scene.rows),
    features: materialized.features as ComposedSceneFeature[],
    edges: materialized.edges,
    doorStates: materialized.doorStates,
  };
}

/** Apply exit materialization to a stored scene instance at projection time. */
export function attachExitsToStoredScene(scene: StoredSceneInstance): StoredSceneInstance {
  const isOutdoorScene =
    scene.layoutArchetype === 'outdoor_clearing' ||
    scene.templateId.startsWith('exterior_') ||
    scene.templateId === 'starter_trail_crossroads' ||
    scene.environment === 'forest_path' ||
    scene.environment === 'marsh_trail' ||
    scene.environment === 'village_street';
  const hasExplicitDoorExit = scene.exits.some((exit) =>
    /\b(?:door|doorway|gate|gateway|hatch|trapdoor|portcullis)\b/i.test(exit.label),
  );
  const isNonDividedArchetype =
    scene.layoutArchetype !== undefined && scene.layoutArchetype !== 'divided_rooms';
  const suppressSyntheticDoors =
    (isOutdoorScene && !hasExplicitDoorExit) || (isNonDividedArchetype && !hasExplicitDoorExit);
  const cleanedEdges =
    isOutdoorScene && !hasExplicitDoorExit ? [] : scene.edges;
  const cleanedDoorStates = isOutdoorScene && !hasExplicitDoorExit ? {} : scene.doorStates;
  const materialized = materializeContractExits({
    spawn: scene.spawn,
    columns: scene.columns,
    rows: scene.rows,
    features: scene.features,
    exits: scene.exits as readonly StoredSceneExit[],
    edges: cleanedEdges,
    doorStates: cleanedDoorStates,
    suppressSyntheticDoors,
    snapToAnyExistingDoor: true,
  });
  return {
    ...scene,
    cells: carveExitPerimeterCells(scene.cells, materialized.features, scene.columns, scene.rows),
    features: materialized.features as StoredSceneFeature[],
    edges: materialized.edges,
    doorStates: materialized.doorStates,
  };
}

export function exitSquaresForExploration(
  exits: readonly { readonly label: string }[],
  spawn: MapSquareCoordinate,
  columns: number,
  rows: number,
): { column: number; row: number }[] {
  return exits.map((exit, index) => {
    const place = inferExitPlacement(exit, spawn, columns, rows, index);
    return { column: place.column, row: place.row };
  });
}
