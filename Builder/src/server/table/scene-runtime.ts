/**
 * Apply composed Director scenes into StoredMapRuntime (Batch 2).
 */

import type { ComposedScene } from './scene-composition.js';
import { featureLabelWithState } from './scene-composition.js';
import type {
  StoredMapRuntime,
  StoredSceneInstance,
  StoredTokenPosition,
} from './map-runtime.js';
import { mergeExplored, upsertTokenPosition } from './map-runtime.js';
import { squareId } from '../../shared/map-contract.js';

function toInstance(
  composed: ComposedScene,
  options: {
    readonly tokenPositions: readonly StoredTokenPosition[];
    readonly exploredByAccount: Record<string, string[]>;
    readonly revision: number;
  },
): StoredSceneInstance {
  return {
    sceneId: composed.sceneId,
    templateId: composed.templateId,
    title: composed.title,
    sceneBanner: composed.sceneBanner,
    purpose: composed.purpose,
    environment: composed.environment,
    lighting: composed.lighting,
    mood: composed.mood,
    description: composed.description,
    columns: composed.columns,
    rows: composed.rows,
    cells: composed.cells,
    edges: composed.edges,
    features: composed.features.map((feature) => ({
      ...feature,
      label: featureLabelWithState(feature),
    })),
    doorStates: { ...composed.doorStates },
    spawn: composed.spawn,
    exits: composed.exits,
    inhabitantObjectIds: [...composed.inhabitantObjectIds],
    tokenPositions: options.tokenPositions.map((token) => ({
      ...token,
      column: composed.spawn.column,
      row: composed.spawn.row,
    })),
    exploredByAccount: options.exploredByAccount,
    revision: options.revision,
  };
}

function seedExploredAroundSpawn(
  accountIds: readonly string[],
  spawn: { column: number; row: number },
  radius = 2,
  extraSquares: readonly { column: number; row: number }[] = [],
): Record<string, string[]> {
  const squares: { column: number; row: number }[] = [...extraSquares];
  for (let row = spawn.row - radius; row <= spawn.row + radius; row += 1) {
    for (let column = spawn.column - radius; column <= spawn.column + radius; column += 1) {
      if (column >= 0 && row >= 0) {
        squares.push({ column, row });
      }
    }
  }
  const explored: Record<string, string[]> = {};
  for (const accountId of accountIds) {
    explored[accountId] = mergeExplored([], squares);
  }
  return explored;
}

/** Establish or replace the active scene; push prior scene onto the stack when traveling. */
export function applyComposedSceneToRuntime(options: {
  readonly runtime: StoredMapRuntime;
  readonly composed: ComposedScene;
  readonly mode: 'establish' | 'travel' | 'restore';
  readonly accountIds?: readonly string[];
  readonly seatTokens?: readonly StoredTokenPosition[];
}): StoredMapRuntime {
  const { runtime, composed, mode } = options;
  const instances = { ...(runtime.sceneInstances ?? {}) };
  const stack = [...(runtime.sceneStack ?? [])];
  const priorId = runtime.activeSceneId ?? null;

  if (mode === 'travel' && priorId !== null && instances[priorId] !== undefined) {
    // Snapshot current global token/door/explored onto the prior instance before leaving.
    instances[priorId] = {
      ...instances[priorId]!,
      tokenPositions: runtime.tokenPositions,
      doorStates: { ...instances[priorId]!.doorStates, ...runtime.doorStates },
      exploredByAccount: { ...runtime.exploredByAccount },
    };
    stack.push(priorId);
  }

  if (mode === 'restore') {
    const existing = instances[composed.sceneId];
    if (existing !== undefined) {
      const restoredTokens =
        options.seatTokens && options.seatTokens.length > 0
          ? options.seatTokens.map((token) => ({
              seatId: token.seatId,
              column: existing.spawn.column,
              row: existing.spawn.row,
            }))
          : existing.tokenPositions;
      return {
        ...runtime,
        activeSceneId: existing.sceneId,
        sceneInstances: instances,
        sceneStack: stack.filter((id) => id !== existing.sceneId),
        sceneTitle: existing.title,
        tokenPositions: restoredTokens,
        doorStates: { ...existing.doorStates },
        runtimeEdges: existing.edges,
        exploredByAccount: existing.exploredByAccount,
        adventureStarted: true,
      };
    }
  }

  const accountIds = options.accountIds ?? Object.keys(runtime.exploredByAccount);
  const contractSquares = composed.features
    .filter(
      (feature) =>
        feature.objectKind === 'creature' ||
        feature.objectKind === 'npc' ||
        feature.objectKind === 'exit' ||
        composed.inhabitantObjectIds.includes(feature.objectId),
    )
    .map((feature) => ({ column: feature.column, row: feature.row }));
  const explored =
    mode === 'establish' || mode === 'travel'
      ? seedExploredAroundSpawn(accountIds, composed.spawn, 2, contractSquares)
      : runtime.exploredByAccount;

  const seatTokens =
    options.seatTokens && options.seatTokens.length > 0
      ? options.seatTokens
      : runtime.tokenPositions;

  const instance = toInstance(composed, {
    tokenPositions: seatTokens,
    exploredByAccount: explored,
    revision: (instances[composed.sceneId]?.revision ?? 0) + 1,
  });
  instances[composed.sceneId] = instance;

  return {
    ...runtime,
    activeSceneId: composed.sceneId,
    sceneInstances: instances,
    sceneStack: mode === 'travel' ? stack : runtime.sceneStack ?? [],
    sceneTitle: composed.title,
    tokenPositions: instance.tokenPositions,
    doorStates: { ...instance.doorStates },
    runtimeEdges: instance.edges,
    exploredByAccount: instance.exploredByAccount,
    adventureStarted: true,
  };
}

export function updateSceneObjectState(options: {
  readonly runtime: StoredMapRuntime;
  readonly objectId: string;
  readonly nextState: string;
  readonly labelWithState: string;
}): StoredMapRuntime | null {
  const activeId = options.runtime.activeSceneId;
  if (activeId === null || activeId === undefined) {
    return null;
  }
  const instance = options.runtime.sceneInstances?.[activeId];
  if (instance === undefined) {
    return null;
  }
  const features = instance.features.map((feature) =>
    feature.objectId === options.objectId
      ? {
          ...feature,
          state: options.nextState as typeof feature.state,
          label: options.labelWithState,
        }
      : feature,
  );
  const updated: StoredSceneInstance = {
    ...instance,
    features,
    revision: instance.revision + 1,
  };
  return {
    ...options.runtime,
    sceneInstances: {
      ...options.runtime.sceneInstances,
      [activeId]: updated,
    },
  };
}

export function placeSeatOnActiveSpawn(
  runtime: StoredMapRuntime,
  seatId: string,
): StoredMapRuntime {
  const active = runtime.activeSceneId
    ? runtime.sceneInstances?.[runtime.activeSceneId]
    : null;
  if (active === null || active === undefined) {
    return runtime;
  }
  const tokenPositions = upsertTokenPosition(runtime.tokenPositions, seatId, active.spawn);
  return {
    ...runtime,
    tokenPositions,
    sceneInstances: {
      ...runtime.sceneInstances,
      [active.sceneId]: {
        ...active,
        tokenPositions,
      },
    },
  };
}

export function revealSpawnVision(
  runtime: StoredMapRuntime,
  accountId: string,
): StoredMapRuntime {
  const active = runtime.activeSceneId
    ? runtime.sceneInstances?.[runtime.activeSceneId]
    : null;
  if (active === null || active === undefined) {
    return runtime;
  }
  const squares = [];
  for (let row = active.spawn.row - 2; row <= active.spawn.row + 2; row += 1) {
    for (let column = active.spawn.column - 2; column <= active.spawn.column + 2; column += 1) {
      if (column >= 0 && row >= 0 && column < active.columns && row < active.rows) {
        squares.push({ column, row });
      }
    }
  }
  const exploredByAccount = {
    ...runtime.exploredByAccount,
    [accountId]: mergeExplored(runtime.exploredByAccount[accountId], squares),
  };
  return {
    ...runtime,
    exploredByAccount,
    sceneInstances: {
      ...runtime.sceneInstances,
      [active.sceneId]: {
        ...active,
        exploredByAccount,
      },
    },
  };
}

export function listInteractableObjects(runtime: StoredMapRuntime): StoredSceneInstance['features'] {
  const active = runtime.activeSceneId
    ? runtime.sceneInstances?.[runtime.activeSceneId]
    : null;
  if (active === null || active === undefined) {
    return [];
  }
  return active.features.filter((feature) => feature.interactable);
}

export { squareId };
