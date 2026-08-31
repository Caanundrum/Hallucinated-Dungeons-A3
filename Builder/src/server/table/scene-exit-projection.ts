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

export function inferExitPlacement(
  exit: { readonly label: string },
  spawn: MapSquareCoordinate,
  columns: number,
  rows: number,
  index: number,
): { readonly column: number; readonly row: number; readonly orientation: ExitOrientation } {
  const label = exit.label.toLowerCase();
  const clamp = (column: number, row: number) => ({
    column: Math.max(1, Math.min(columns - 2, column)),
    row: Math.max(1, Math.min(rows - 2, row)),
  });
  if (/\b(north|parapet|ladder|stair)\b/.test(label) && !/\bsouth\b/.test(label)) {
    const pos = clamp(spawn.column, spawn.row - 2);
    return { ...pos, orientation: 'north' };
  }
  if (/\bsouth\b/.test(label)) {
    const pos = clamp(spawn.column, spawn.row + 2);
    return { ...pos, orientation: 'south' };
  }
  if (/\b(west|river|near bank|inland|behind|daylight|retreat|way back|return)\b/.test(label)) {
    const pos = clamp(spawn.column - 1, spawn.row + (index % 2));
    return { ...pos, orientation: 'west' };
  }
  if (/\b(east|onward|forward|shore|deeper|far bank|doorway east|path onward)\b/.test(label)) {
    const pos = clamp(spawn.column + 2, spawn.row);
    return { ...pos, orientation: 'east' };
  }
  // Stagger unmarked exits around spawn so multiple routes stay distinct.
  const offsets: Array<{ column: number; row: number; orientation: ExitOrientation }> = [
    { column: spawn.column + 2, row: spawn.row, orientation: 'east' },
    { column: spawn.column, row: spawn.row - 2, orientation: 'north' },
    { column: spawn.column - 1, row: spawn.row, orientation: 'west' },
    { column: spawn.column, row: spawn.row + 2, orientation: 'south' },
  ];
  const pick = offsets[index % offsets.length]!;
  return { ...clamp(pick.column, pick.row), orientation: pick.orientation };
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
 * Materialize every contract exit onto features + door edges inside spawn vision.
 * Idempotent: existing exit features / nearby doors are preserved.
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
  },
  TExit extends {
    readonly exitId: string;
    readonly label: string;
    readonly destinationHint: string;
    readonly returnToSceneId?: string | null;
  },
>(options: {
  readonly spawn: MapSquareCoordinate;
  readonly columns: number;
  readonly rows: number;
  readonly features: readonly TFeature[];
  readonly exits: readonly TExit[];
  readonly edges: readonly MapEdgeRecord[];
  readonly doorStates: Record<string, DoorState>;
}): {
  readonly features: TFeature[];
  readonly edges: MapEdgeRecord[];
  readonly doorStates: Record<string, DoorState>;
} {
  const features = [...options.features] as TFeature[];
  const edges = [...options.edges];
  const doorStates = { ...options.doorStates };
  const knownExitIds = new Set(
    features.filter((feature) => isExitFeature(feature)).map((feature) => feature.objectId),
  );

  options.exits.forEach((exit, index) => {
    let place = inferExitPlacement(exit, options.spawn, options.columns, options.rows, index);
    // Keep multiple exits on distinct squares inside spawn vision.
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
      place = {
        column: Math.max(1, Math.min(options.columns - 2, place.column + ((guard % 2) * 2 - 1))),
        row: Math.max(1, Math.min(options.rows - 2, place.row + (guard % 3) - 1)),
        orientation: place.orientation,
      };
      guard += 1;
    }
    // Prefer an existing door on this bearing so we do not invent a second unnamed opening.
    const existingOriented = edges.find(
      (edge) => edge.kind === 'door' && edge.orientation === place.orientation,
    );
    const doorState =
      existingOriented !== undefined
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
          state: 'present',
          interactable: false,
        } as TFeature);
        knownExitIds.add(exit.exitId);
      }
    }
    // Only add a door when none exists on this bearing and none is already nearby.
    if (
      existingOriented === undefined &&
      !nearbyDoor(edges, place.column, place.row)
    ) {
      const id = edgeId(place.column, place.row, place.orientation);
      if (!edges.some((edge) => edge.edgeId === id)) {
        edges.push({
          edgeId: id,
          column: place.column,
          row: place.row,
          orientation: place.orientation,
          kind: 'door',
          doorState: 'closed',
        });
      }
      doorStates[id] = doorStates[id] ?? 'closed';
    }
  });

  return { features, edges, doorStates };
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
    features: materialized.features as ComposedSceneFeature[],
    edges: materialized.edges,
    doorStates: materialized.doorStates,
  };
}

/** Apply exit materialization to a stored scene instance at projection time. */
export function attachExitsToStoredScene(scene: StoredSceneInstance): StoredSceneInstance {
  const materialized = materializeContractExits({
    spawn: scene.spawn,
    columns: scene.columns,
    rows: scene.rows,
    features: scene.features,
    exits: scene.exits as readonly StoredSceneExit[],
    edges: scene.edges,
    doorStates: scene.doorStates,
  });
  return {
    ...scene,
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
