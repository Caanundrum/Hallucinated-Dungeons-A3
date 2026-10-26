/**
 * Director scene loop command helpers (Batch 2 + Batch 3 coherence).
 */

import type { Firestore } from 'firebase-admin/firestore';

import type {
  CampaignBlueprint,
  CampaignRoomBlueprint,
} from '../../shared/campaign-contract.js';
import { npcNamesMatch } from '../../shared/campaign-facts.js';
import { resolveSceneArtUrl } from '../../shared/map-contract.js';
import {
  declarationIsDoorOpenOrPassage,
  declarationMentionsLabelWord,
  declarationNegatesDoorOpen,
} from '../../shared/resolved-action-receipt.js';
import { splitPrimaryTargetFromLocative } from '../../shared/utterance-understanding.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import {
  composeDirectorScene,
  deduplicateSceneFeatureLabels,
  directorNarrationBeat,
  directorOwnedCompositionHint,
  featureLabelWithState,
  matchLandmarkDestination,
  matchPresentedExit,
  nextObjectState,
  newSceneId,
  type ComposedScene,
  type SceneComposeKind,
} from './scene-composition.js';
import {
  HEAVY_FIXTURE_LABEL,
  labelLooksPortableContainer,
  labelLooksPortableSceneProp,
} from '../../shared/container-contents.js';
import {
  applyComposedSceneToRuntime,
  removeSceneObject,
  updateSceneObjectState,
} from './scene-runtime.js';
import {
  activeSceneInstance,
  mergeExplored,
  type StoredMapRuntime,
  type StoredSceneFeature,
  type StoredSceneInstance,
  type StoredTokenPosition,
} from './map-runtime.js';
import { attachExitsToStoredScene } from './scene-exit-projection.js';

export function buildStoredSceneFromRoomBlueprint(
  room: CampaignRoomBlueprint,
  campaignId: string,
  options?: {
    readonly accountIds?: readonly string[];
    readonly seatTokens?: readonly StoredTokenPosition[];
    readonly visited?: boolean;
    readonly blueprint?: CampaignBlueprint | null;
  },
): StoredSceneInstance {
  const isSanctumRoom =
    room.templateId === 'starter_crypt_sanctum' ||
    room.isMilestoneClimax === true ||
    room.roomIndex >= 3;
  const isPassageRoom = !isSanctumRoom && room.roomIndex === 2;
  const kind: SceneComposeKind =
    isSanctumRoom || room.templateId.startsWith('landmark_')
      ? 'landmark'
      : room.templateId === 'starter_trail_crossroads' || room.templateId.startsWith('exterior_')
        ? 'exterior'
        : 'interior';
  const composePremise =
    room.summary.trim().length > 0
      ? room.summary
      : isPassageRoom && kind === 'interior'
        ? 'crypt catacomb subterranean stone passage'
        : room.title;
  const composed = composeDirectorScene({
    kind,
    sceneId: room.sceneId,
    premise: composePremise,
    destinationHint: room.title,
    seedKey: `${campaignId}:${room.sceneId}:${room.title}`,
    ...(room.columns !== undefined ? { columns: room.columns } : {}),
    ...(room.rows !== undefined ? { rows: room.rows } : {}),
    ...(room.layoutArchetype !== undefined ? { layoutArchetype: room.layoutArchetype } : {}),
  });
  const squares: { column: number; row: number }[] = [];
  for (let row = composed.spawn.row - 2; row <= composed.spawn.row + 2; row += 1) {
    for (let column = composed.spawn.column - 2; column <= composed.spawn.column + 2; column += 1) {
      if (column >= 0 && row >= 0 && column < composed.columns && row < composed.rows) {
        squares.push({ column, row });
      }
    }
  }
  const exploredByAccount: Record<string, string[]> = {};
  for (const accountId of options?.accountIds ?? []) {
    exploredByAccount[accountId] = mergeExplored([], squares);
  }
  const tokenPositions = (options?.seatTokens ?? []).map((token) => ({
    ...token,
    column: composed.spawn.column,
    row: composed.spawn.row,
  }));
  const exits: Array<{
    exitId: string;
    label: string;
    destinationHint: string;
    targetSceneId?: string;
    lockState?: 'unlocked' | 'locked';
    keyItemId?: string | null;
    lockpickDC?: number | null;
    breakDC?: number | null;
  }> =
    room.exits.length > 0
      ? room.exits.map((exit, idx) => {
          const targetRoom = findRoomInBlueprint(options?.blueprint, exit.targetSceneId);
          return {
            exitId: `${room.sceneId}-exit-${idx + 1}`,
            label: exit.edgeLabel,
            destinationHint: targetRoom !== null ? targetRoom.title : exit.edgeLabel,
            targetSceneId: exit.targetSceneId,
            ...(exit.lockState !== undefined ? { lockState: exit.lockState } : {}),
            ...(exit.keyItemId !== undefined ? { keyItemId: exit.keyItemId } : {}),
            ...(exit.lockpickDC !== undefined ? { lockpickDC: exit.lockpickDC } : {}),
            ...(exit.breakDC !== undefined ? { breakDC: exit.breakDC } : {}),
          };
        })
      : composed.exits.map((exit) => ({ ...exit }));
  const hasExplicitDoorExit = exits.some((exit) =>
    /\b(?:door|doorway|gate|gateway|hatch|trapdoor|portcullis)\b/i.test(exit.label),
  );
  const isNonDividedArchetype =
    room.layoutArchetype !== undefined && room.layoutArchetype !== 'divided_rooms';
  const suppressOutdoorDoors =
    ((kind === 'exterior' || room.layoutArchetype === 'outdoor_clearing') && !hasExplicitDoorExit) ||
    (isNonDividedArchetype && !hasExplicitDoorExit);
  const primaryDoorEdge = composed.edges.find((edge) => edge.kind === 'door');
  const rawRoomEdges = suppressOutdoorDoors
    ? []
    : room.exits.length === 1 && primaryDoorEdge !== undefined
      ? composed.edges.filter((edge) => edge.kind !== 'door' || edge.edgeId === primaryDoorEdge.edgeId)
      : composed.edges;

  const firstBlueprintExit = room.exits[0];
  const explicitExitLocked =
    firstBlueprintExit?.lockState === 'locked' ||
    /\b(?:locked|sealed|barred)\b/i.test(firstBlueprintExit?.edgeLabel ?? '');
  const requiredKeys = new Set<string>();

  const roomEdges = rawRoomEdges.map((edge) => {
    if (edge.kind !== 'door') {
      return edge;
    }
    const baseState = explicitExitLocked
      ? 'locked'
      : (composed.doorStates[edge.edgeId] ?? edge.doorState ?? 'closed');
    if (baseState === 'locked') {
      const keyItemId = firstBlueprintExit?.keyItemId ?? 'Brass Key';
      const lockpickDC = firstBlueprintExit?.lockpickDC ?? 13;
      const breakDC = firstBlueprintExit?.breakDC ?? 15;
      if (!/\b(?:lever|mechanism|switch)\b/i.test(keyItemId)) {
        requiredKeys.add(keyItemId);
      }
      return {
        ...edge,
        doorState: 'locked' as const,
        keyItemId,
        lockpickDC,
        breakDC,
      };
    }
    return {
      ...edge,
      doorState: baseState,
    };
  });

  const roomDoorStates: Record<string, (typeof composed.doorStates)[string]> = {};
  for (const edge of roomEdges) {
    if (edge.kind === 'door') {
      roomDoorStates[edge.edgeId] = edge.doorState ?? 'closed';
    }
  }
  if (
    roomEdges.some((edge) => edge.kind === 'door') &&
    exits[0] !== undefined &&
    exits[0].lockState === 'locked' &&
    !/\b(?:lever|mechanism|switch)\b/i.test(exits[0].keyItemId ?? '')
  ) {
    exits[0] = {
      ...exits[0],
      lockState: 'unlocked',
    };
  }

  const composedContainers = composed.features.filter((f) => f.objectKind === 'container');
  const structuredProps = room.structuredProps ?? [];
  const primaryStructuredContainer = structuredProps.find(
    (p) => p.objectKind === 'container' && Array.isArray(p.contents) && p.contents.length > 0,
  );
  let containerDefaultIndex = 0;
  const fallbackContainerPools: ReadonlyArray<readonly string[]> = [
    primaryStructuredContainer?.contents
      ? [...primaryStructuredContainer.contents]
      : ['Silver Signet Ring', 'Healing Draught'],
    ['Weathered Map Fragment', 'Healing Draught'],
    ['Tarnished Compass', 'Healing Draught'],
  ];

  const baseFeatures: StoredSceneFeature[] = composed.features
    .filter(
      (feature) =>
        (room.exits.length === 0 ||
          (feature.objectKind !== 'exit' && feature.referenceKind !== 'exit')) &&
        (room.npcs.length > 0 ||
          (feature.objectKind !== 'npc' && feature.referenceKind !== 'npc')),
    )
    .map((feature) => {
      if (
        room.npcs.length > 0 &&
        (feature.objectKind === 'npc' || feature.referenceKind === 'npc')
      ) {
        const primaryNpc = room.npcs[0]!;
        const state = feature.state?.trim() || 'present';
        return {
          ...feature,
          label: `${primaryNpc.name} — ${state}`,
          ...(primaryNpc.heldItems !== undefined ? { heldItems: [...primaryNpc.heldItems] } : {}),
        };
      }
      if (
        feature.objectId.endsWith(':poi') &&
        feature.objectKind === 'container' &&
        primaryStructuredContainer !== undefined &&
        !/\b(?:satchel|pack|bag|pouch|chest|crate|box|barrel|coffer|trunk|urn|casket|lockbox|reliquary)\b/i.test(
          feature.label,
        )
      ) {
        return {
          ...feature,
          objectKind: 'prop',
          label: featureLabelWithState({ ...feature, objectKind: 'prop' }),
        };
      }
      if (feature.objectKind === 'container') {
        const isPrimaryChest =
          composedContainers.length === 1 || feature.objectId.endsWith(':east-chest');
        const poolIndex = isPrimaryChest
          ? 0
          : Math.min(fallbackContainerPools.length - 1, ++containerDefaultIndex);
        const defaultContents =
          feature.contents && feature.contents.length > 0
            ? [...feature.contents]
            : [...fallbackContainerPools[poolIndex]!];
        return {
          ...feature,
          label: featureLabelWithState(feature),
          contents: defaultContents,
        };
      }
      return {
        ...feature,
        label: featureLabelWithState(feature),
      };
    });

  if (
    room.npcs.length > 0 &&
    !baseFeatures.some((f) => f.objectKind === 'npc' || f.referenceKind === 'npc')
  ) {
    const primaryNpc = room.npcs[0]!;
    const npcCol = Math.max(1, composed.spawn.column - 1);
    const npcRow =
      composed.spawn.row <= composed.rows - 3
        ? composed.spawn.row + 1
        : Math.max(1, composed.spawn.row - 1);
    baseFeatures.push({
      objectId: `${room.sceneId}:npc-premise`,
      column: npcCol,
      row: npcRow,
      label: `${primaryNpc.name} — present`,
      referenceKind: 'npc',
      objectKind: 'npc',
      state: 'present',
      interactable: true,
      ...(primaryNpc.heldItems !== undefined ? { heldItems: [...primaryNpc.heldItems] } : {}),
    });
  }

  // Materialize structuredProps and string props from the room blueprint onto the grid.
  structuredProps.forEach((prop, index) => {
    const cleanLabel = prop.label.trim();
    if (cleanLabel.length === 0) return;
    const alreadyExists = baseFeatures.some(
      (f) =>
        (prop.propId !== undefined && f.objectId === prop.propId) ||
        f.label.toLowerCase().includes(cleanLabel.toLowerCase()),
    );
    if (alreadyExists) {
      for (let i = 0; i < baseFeatures.length; i += 1) {
        const f = baseFeatures[i]!;
        if (
          (prop.propId !== undefined && f.objectId === prop.propId) ||
          f.label.toLowerCase().includes(cleanLabel.toLowerCase())
        ) {
          if (prop.lockState === 'locked' && prop.keyItemId) {
            requiredKeys.add(prop.keyItemId);
          }
          const isLocked = prop.lockState === 'locked';
          const nextState =
            (prop.objectState as StoredSceneFeature['state'] | undefined) ??
            (prop.objectKind === 'container'
              ? isLocked
                ? 'locked'
                : 'closed'
              : f.state);
          const relocateToSpawnSide =
            room.roomIndex === 1 &&
            prop.objectKind === 'container' &&
            f.column > Math.floor(composed.columns / 2);
          const nextCol = relocateToSpawnSide
            ? Math.max(1, Math.min(composed.columns - 2, composed.spawn.column + 1 + (index % 2)))
            : f.column;
          const nextRow = relocateToSpawnSide
            ? Math.max(
                1,
                Math.min(composed.rows - 2, composed.spawn.row + (index % 2 === 0 ? -1 : 1)),
              )
            : f.row;
          baseFeatures[i] = {
            ...f,
            column: nextCol,
            row: nextRow,
            objectKind: prop.objectKind,
            state: nextState,
            label: featureLabelWithState({
              ...f,
              column: nextCol,
              row: nextRow,
              label: cleanLabel,
              objectKind: prop.objectKind,
              state: nextState,
              ...(prop.lockState !== undefined ? { lockState: prop.lockState } : {}),
            }),
            ...(prop.lockState !== undefined ? { lockState: prop.lockState } : {}),
            ...(prop.keyItemId !== undefined ? { keyItemId: prop.keyItemId } : {}),
            ...(prop.lockpickDC !== undefined ? { lockpickDC: prop.lockpickDC } : {}),
            ...(prop.breakDC !== undefined ? { breakDC: prop.breakDC } : {}),
            ...(prop.inspectDC !== undefined ? { inspectDC: prop.inspectDC } : {}),
            ...(prop.contents !== undefined ? { contents: [...prop.contents] } : {}),
            ...(prop.targetEdgeOrObjectId !== undefined
              ? { targetEdgeOrObjectId: prop.targetEdgeOrObjectId }
              : {}),
          };
        }
      }
      return;
    }
    const isLocked = prop.lockState === 'locked';
    const keyItemId = isLocked ? (prop.keyItemId ?? 'Brass Key') : (prop.keyItemId ?? null);
    if (isLocked && keyItemId && !/\b(?:lever|mechanism|switch)\b/i.test(keyItemId)) {
      requiredKeys.add(keyItemId);
    }
    const state =
      (prop.objectState as StoredSceneFeature['state'] | undefined) ??
      (prop.objectKind === 'container'
        ? isLocked
          ? 'locked'
          : 'closed'
        : prop.objectKind === 'lever'
          ? 'closed'
          : prop.objectKind === 'trap'
            ? 'active'
            : prop.objectKind === 'light'
              ? 'lit'
              : 'intact');
    const referenceKind =
      prop.objectKind === 'light'
        ? 'lighting'
        : prop.objectKind === 'cover'
          ? 'cover'
          : prop.objectKind === 'hazard' || prop.objectKind === 'trap'
            ? 'hazard'
            : 'prop';
    const isLever = prop.objectKind === 'lever';
    const doorOrWallEdge =
      roomEdges.find((e) => e.kind === 'door') ?? roomEdges.find((e) => e.kind === 'wall');
    const col = isLever
      ? doorOrWallEdge !== undefined
        ? Math.max(1, Math.min(composed.columns - 2, doorOrWallEdge.column))
        : Math.max(2, Math.min(composed.columns - 2, composed.spawn.column + 2 + index))
      : Math.max(
          1,
          Math.min(composed.columns - 2, composed.spawn.column + 1 + (index % 2)),
        );
    const row = isLever
      ? doorOrWallEdge !== undefined
        ? Math.max(
            1,
            Math.min(composed.rows - 2, doorOrWallEdge.row <= 1 ? 2 : doorOrWallEdge.row - 1),
          )
        : 1
      : Math.max(
          1,
          Math.min(composed.rows - 2, composed.spawn.row + (index % 2 === 0 ? -1 : 1)),
        );
    const defaultLeverTarget = isLever
      ? (exits.find((e, idx) => idx > 0 && !e.exitId.endsWith('-back') && !/\b(?:back|return)\b/i.test(e.label))
          ?.exitId ??
        exits[0]?.exitId ??
        roomEdges.find((e) => e.kind === 'door')?.edgeId)
      : undefined;
    const resolvedTargetId = prop.targetEdgeOrObjectId ?? defaultLeverTarget;
    if (isLever && resolvedTargetId !== undefined) {
      const targetExitIdx = exits.findIndex((e) => e.exitId === resolvedTargetId);
      if (targetExitIdx >= 0) {
        const targetExit = exits[targetExitIdx]!;
        exits[targetExitIdx] = {
          ...targetExit,
          lockState: 'locked',
          keyItemId: targetExit.keyItemId ?? 'Wall Lever Mechanism',
        };
      }
    }
    const feature: StoredSceneFeature = {
      objectId: prop.propId ?? `${room.sceneId}:prop-${index + 1}`,
      column: col,
      row,
      label: featureLabelWithState({
        objectId: prop.propId ?? `${room.sceneId}:prop-${index + 1}`,
        column: col,
        row,
        label: cleanLabel,
        referenceKind,
        objectKind: prop.objectKind,
        state,
        interactable: true,
        ...(prop.lockState !== undefined ? { lockState: prop.lockState } : {}),
      }),
      referenceKind,
      objectKind: prop.objectKind,
      state,
      interactable: true,
      ...(prop.lockState !== undefined ? { lockState: prop.lockState } : {}),
      ...(keyItemId !== null ? { keyItemId } : {}),
      ...(isLocked ? { lockpickDC: prop.lockpickDC ?? 13, breakDC: prop.breakDC ?? 15 } : {}),
      ...(prop.inspectDC !== undefined ? { inspectDC: prop.inspectDC } : {}),
      ...(prop.contents !== undefined
        ? { contents: [...prop.contents] }
        : prop.objectKind === 'container'
          ? { contents: ['Silver Signet Ring', 'Healing Draught'] }
          : {}),
      ...(resolvedTargetId !== undefined
        ? { targetEdgeOrObjectId: resolvedTargetId }
        : {}),
    };
    baseFeatures.push(feature);
  });

  // Also ensure any plain string props in room.props are represented on baseFeatures.
  room.props.forEach((rawProp, index) => {
    const clean = rawProp.trim();
    if (clean.length === 0) return;
    const alreadyExists = baseFeatures.some(
      (f) =>
        f.label.toLowerCase().includes(clean.toLowerCase()) ||
        (f.contents ?? []).some((c) => c.toLowerCase().includes(clean.toLowerCase())),
    );
    if (alreadyExists) return;
    const lower = clean.toLowerCase();
    const objectKind: StoredSceneFeature['objectKind'] =
      /\b(?:chest|crate|box|barrel|satchel|pack|bag|coffer|urn|pouch|trunk|cabinet|casket|lockbox|reliquary)\b/.test(
        lower,
      )
        ? 'container'
        : /\b(?:lever|switch|winch|crank|valve|mechanism)\b/.test(lower)
          ? 'lever'
          : /\b(?:trap|tripwire|snare|pressure\s+plate)\b/.test(lower)
            ? 'trap'
            : /\b(?:key|scroll|potion|amulet|ring|gem|coin|letter|shard|relic)\b/.test(lower)
              ? 'item'
              : /\b(?:lantern|torch|sconce|brazier|lamp|candle)\b/.test(lower)
                ? 'light'
                : 'prop';
    const startsClosed =
      objectKind === 'container' ||
      objectKind === 'lever' ||
      /\b(?:sealed|closed|locked|shuttered|latched|clasped|bound)\b/.test(lower);
    const state: StoredSceneFeature['state'] = startsClosed
      ? 'closed'
      : objectKind === 'trap'
        ? 'active'
        : objectKind === 'light'
          ? 'lit'
          : 'intact';
    const referenceKind =
      objectKind === 'light'
        ? 'lighting'
        : objectKind === 'trap'
          ? 'hazard'
          : 'prop';
    const col = Math.max(
      1,
      Math.min(composed.columns - 2, composed.spawn.column + 1 + ((index + 1) % 2)),
    );
    const row = Math.max(
      1,
      Math.min(composed.rows - 2, composed.spawn.row + (index % 2 === 0 ? 1 : -1)),
    );
    baseFeatures.push({
      objectId: `${room.sceneId}:blueprint-prop-${index + 1}`,
      column: col,
      row,
      label: featureLabelWithState({
        objectId: `${room.sceneId}:blueprint-prop-${index + 1}`,
        column: col,
        row,
        label: clean,
        referenceKind,
        objectKind,
        state,
        interactable: true,
      }),
      referenceKind,
      objectKind,
      state,
      interactable: true,
      ...(objectKind === 'container'
        ? { contents: ['Silver Signet Ring', 'Healing Draught'] }
        : {}),
    });
  });

  // Enforce the Three-Way Lock Rule: every required keyItemId for a locked door/container
  // must exist in an NPC's heldItems, an unlocked container's contents, or a floor item.
  for (const keyItem of requiredKeys) {
    const keyLower = keyItem.toLowerCase();
    const existsInScene = baseFeatures.some(
      (f) =>
        (f.heldItems ?? []).some((item) => item.toLowerCase() === keyLower) ||
        (f.lockState !== 'locked' &&
          f.state !== 'locked' &&
          (f.contents ?? []).some((item) => item.toLowerCase() === keyLower)) ||
        (f.objectKind === 'item' && f.label.toLowerCase().includes(keyLower)),
    );
    if (!existsInScene) {
      const npcIdx = baseFeatures.findIndex(
        (f) => f.objectKind === 'npc' || f.referenceKind === 'npc',
      );
      if (npcIdx >= 0) {
        const npc = baseFeatures[npcIdx]!;
        baseFeatures[npcIdx] = {
          ...npc,
          heldItems: [...(npc.heldItems ?? []), keyItem],
        };
      } else {
        baseFeatures.push({
          objectId: `${room.sceneId}:key-${requiredKeys.size}`,
          column: Math.max(1, composed.spawn.column + 1),
          row: composed.spawn.row,
          label: keyItem,
          referenceKind: 'prop',
          objectKind: 'item',
          state: 'intact',
          interactable: true,
        });
      }
    }
  }

  const attached = attachExitsToStoredScene({
    sceneId: room.sceneId,
    templateId: room.templateId,
    title: room.title,
    sceneBanner: room.summary,
    purpose: composed.purpose,
    environment: composed.environment,
    lighting: composed.lighting,
    mood: composed.mood,
    description: room.summary,
    columns: composed.columns,
    rows: composed.rows,
    ...(composed.layoutArchetype !== undefined
      ? { layoutArchetype: composed.layoutArchetype }
      : {}),
    cells: composed.cells,
    edges: roomEdges,
    features: deduplicateSceneFeatureLabels(baseFeatures, composed.columns),
    doorStates: roomDoorStates,
    spawn: composed.spawn,
    exits,
    inhabitantObjectIds: room.npcs.length > 0 ? [...composed.inhabitantObjectIds] : [],
    tokenPositions,
    exploredByAccount,
    revision: 1,
    sceneArtUrl:
      room.sceneArtUrl ??
      resolveSceneArtUrl(
        room.roomIndex >= 2 && room.templateId === 'starter_stone_chamber'
          ? 'interior_stone_crypt'
          : room.templateId,
      ),
    xpAwardOnDiscovery: room.xpAwardOnDiscovery,
    isMilestoneClimax: room.isMilestoneClimax,
    milestoneIndex: room.milestoneIndex,
    visited: options?.visited === true,
  });

  // Ensure every lever/mechanism feature sits on a walkable ('floor') cell within 1-2 squares of its target locked exit or door.
  const updatedCells = [...attached.cells];
  const updatedFeatures = attached.features.map((feat) => {
    if (feat.objectKind !== 'lever') {
      return feat;
    }
    const targetExitFeature =
      attached.features.find(
        (f) => f.objectKind === 'exit' && f.objectId === feat.targetEdgeOrObjectId,
      ) ??
      attached.features.find((f) => f.objectKind === 'exit' && f.lockState === 'locked');
    const targetDoorEdge =
      attached.edges.find(
        (e) => e.kind === 'door' && e.edgeId === feat.targetEdgeOrObjectId,
      ) ?? attached.edges.find((e) => e.kind === 'door');
    const anchor = targetExitFeature
      ? { column: targetExitFeature.column, row: targetExitFeature.row }
      : targetDoorEdge
        ? { column: targetDoorEdge.column, row: targetDoorEdge.row }
        : null;
    if (anchor === null) {
      return feat;
    }
    const candidates: Array<{ column: number; row: number; dist: number }> = [];
    for (let r = 1; r <= attached.rows - 2; r += 1) {
      for (let c = 1; c <= attached.columns - 2; c += 1) {
        const dist = Math.abs(c - anchor.column) + Math.abs(r - anchor.row);
        if (dist >= 1 && dist <= 2) {
          if (c === attached.spawn.column && r === attached.spawn.row) continue;
          const occupied = attached.features.some(
            (other) =>
              other.objectId !== feat.objectId &&
              other.column === c &&
              other.row === r,
          );
          if (!occupied) {
            candidates.push({ column: c, row: r, dist });
          }
        }
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);
    const chosen = candidates[0] ?? {
      column: Math.max(1, Math.min(attached.columns - 2, anchor.column)),
      row: Math.max(1, Math.min(attached.rows - 2, anchor.row)),
      dist: 1,
    };
    const cellIdx = updatedCells.findIndex(
      (cell) => cell.column === chosen.column && cell.row === chosen.row,
    );
    if (cellIdx >= 0 && updatedCells[cellIdx]!.terrain === 'blocked') {
      updatedCells[cellIdx] = {
        ...updatedCells[cellIdx]!,
        terrain: 'floor',
      };
    }
    return {
      ...feat,
      column: chosen.column,
      row: chosen.row,
    };
  });

  return {
    ...attached,
    cells: updatedCells,
    features: updatedFeatures,
  };
}

export function buildMapRuntimeFromBlueprint(options: {
  readonly campaignId: string;
  readonly blueprint: CampaignBlueprint;
  readonly accountIds?: readonly string[];
  readonly seatTokens?: readonly StoredTokenPosition[];
  readonly activateFirstScene?: boolean;
  /** Optional Rolling Headlights filter: when supplied, only pre-compiles these sceneIds. */
  readonly onlySceneIds?: readonly string[];
}): StoredMapRuntime {
  const allowedIds =
    options.onlySceneIds !== undefined && options.onlySceneIds.length > 0
      ? new Set(options.onlySceneIds)
      : null;
  const sceneInstances: Record<string, StoredSceneInstance> = {};
  for (const milestone of options.blueprint.milestones ?? []) {
    for (const room of milestone.rooms) {
      if (allowedIds !== null && !allowedIds.has(room.sceneId)) {
        continue;
      }
      const isFirst = room.sceneId === 'scene-m1-r1';
      sceneInstances[room.sceneId] = buildStoredSceneFromRoomBlueprint(room, options.campaignId, {
        ...(options.accountIds !== undefined ? { accountIds: options.accountIds } : {}),
        ...(options.seatTokens !== undefined ? { seatTokens: options.seatTokens } : {}),
        visited: isFirst && options.activateFirstScene === true,
        blueprint: options.blueprint,
      });
    }
  }
  const firstScene = sceneInstances['scene-m1-r1'];
  if (options.activateFirstScene && firstScene !== undefined) {
    return {
      campaignId: options.campaignId,
      tokenPositions: firstScene.tokenPositions,
      doorStates: { ...firstScene.doorStates },
      runtimeEdges: firstScene.edges,
      sceneTitle: firstScene.title,
      exploredByAccount: { ...firstScene.exploredByAccount },
      activeSceneId: firstScene.sceneId,
      sceneInstances,
      sceneStack: [],
      adventureStarted: true,
      premiseKey: options.blueprint.premiseDigest,
    };
  }
  return {
    campaignId: options.campaignId,
    tokenPositions: [],
    doorStates: {},
    runtimeEdges: [],
    sceneTitle: null,
    exploredByAccount: {},
    activeSceneId: null,
    sceneInstances,
    sceneStack: [],
    adventureStarted: false,
    premiseKey: options.blueprint.premiseDigest,
  };
}

export async function loadCampaignPremise(
  firestore: Firestore,
  campaignId: string,
): Promise<string> {
  const snap = await firestore.collection(COLLECTIONS.campaigns).doc(campaignId).get();
  if (!snap.exists) {
    return 'an unfolding adventure';
  }
  const data = snap.data() as { summary?: string; premise?: string };
  const premise = typeof data.premise === 'string' ? data.premise.trim() : '';
  if (premise.length > 0) {
    return premise;
  }
  const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
  return summary.length > 0 ? summary : 'an unfolding adventure';
}

export function sanitizePlayerFacingSceneText(text: string, isOutdoor = false): string {
  const base = text.replace(/^Entry threshold for Milestone \d+\s*(?:\([^)]*\))?\.\s*/i, '');
  const withThreshold = isOutdoor
    ? base
        .replace(/Investigation and side-trek hall beyond the/i, 'Along the weathered trail beyond the')
        .replace(/beyond the wooden door\b/i, 'beyond the outer threshold')
    : base
        .replace(/Investigation and side-trek hall beyond the/i, 'A shadowed passage beyond the cellar stairs and connecting doorway')
        .replace(/beyond the wooden door\b/i, 'beyond the cellar stairs and connecting doorway');
  return withThreshold
    .replace(/\s*Clues and hazards test the party before the Milestone \d+ climax\./i, ' Hidden clues and lurking hazards guard the way forward.')
    .replace(/^Climax chamber for Milestone \d+\.\s*Resolving the threat here elevates the party to Level \d+\./i, 'The inner sanctum, where ancient stonework and flickering braziers frame the heart of the danger.')
    .trim();
}

function instanceToComposed(prior: NonNullable<ReturnType<typeof activeSceneInstance>>): ComposedScene {
  const isOutdoor =
    prior.templateId.startsWith('exterior_') ||
    prior.templateId.startsWith('landmark_') ||
    !prior.environment.endsWith('_interior');
  const cleanedBanner = sanitizePlayerFacingSceneText(prior.sceneBanner, isOutdoor);
  const cleanedDescription = sanitizePlayerFacingSceneText(prior.description ?? prior.mood, isOutdoor);
  return {
    sceneId: prior.sceneId,
    templateId: prior.templateId,
    title: prior.title,
    sceneBanner: cleanedBanner.length > 0 ? cleanedBanner : prior.sceneBanner,
    purpose: prior.purpose,
    environment: prior.environment,
    lighting: prior.lighting,
    mood: prior.mood,
    description: cleanedDescription.length > 0 ? cleanedDescription : (prior.description ?? prior.mood),
    columns: prior.columns,
    rows: prior.rows,
    cells: prior.cells,
    edges: prior.edges,
    features: prior.features,
    spawn: prior.spawn,
    exits: prior.exits,
    doorStates: prior.doorStates,
    inhabitantObjectIds: prior.inhabitantObjectIds ?? [],
  };
}

export function beginAdventureRuntime(options: {
  readonly runtime: StoredMapRuntime;
  readonly premise: string;
  readonly campaignId: string;
  readonly accountId: string;
  readonly seatTokens: readonly StoredTokenPosition[];
}): { readonly runtime: StoredMapRuntime; readonly composed: ComposedScene; readonly chronicle: string } {
  if (options.runtime.adventureStarted && activeSceneInstance(options.runtime) !== null) {
    throw new Error('ADVENTURE_ALREADY_STARTED');
  }
  const preForgedFirst = options.runtime.sceneInstances?.['scene-m1-r1'];
  if (preForgedFirst !== undefined) {
    const composed = instanceToComposed(preForgedFirst);
    const squares: { column: number; row: number }[] = [];
    for (let row = preForgedFirst.spawn.row - 2; row <= preForgedFirst.spawn.row + 2; row += 1) {
      for (let col = preForgedFirst.spawn.column - 2; col <= preForgedFirst.spawn.column + 2; col += 1) {
        if (col >= 0 && row >= 0) {
          squares.push({ column: col, row });
        }
      }
    }
    const exploredByAccount = {
      ...preForgedFirst.exploredByAccount,
      [options.accountId]: mergeExplored(preForgedFirst.exploredByAccount[options.accountId], squares),
    };
    const tokenPositions = options.seatTokens.map((token) => ({
      ...token,
      column: preForgedFirst.spawn.column,
      row: preForgedFirst.spawn.row,
    }));
    const updatedFirst: StoredSceneInstance = {
      ...preForgedFirst,
      tokenPositions,
      exploredByAccount,
      visited: true,
    };
    const runtime: StoredMapRuntime = {
      ...options.runtime,
      premiseKey: options.premise,
      activeSceneId: updatedFirst.sceneId,
      sceneInstances: {
        ...(options.runtime.sceneInstances ?? {}),
        [updatedFirst.sceneId]: updatedFirst,
      },
      sceneTitle: updatedFirst.title,
      tokenPositions,
      doorStates: { ...updatedFirst.doorStates },
      runtimeEdges: updatedFirst.edges,
      exploredByAccount,
      adventureStarted: true,
    };
    return {
      runtime,
      composed,
      chronicle: directorNarrationBeat('establish', { scene: composed }),
    };
  }
  const priorTitle = options.runtime.sceneTitle?.trim() || null;
  const hadPriorScene =
    priorTitle !== null &&
    priorTitle.length > 0 &&
    !/^awaiting first scene$/i.test(priorTitle) &&
    !/^blank table$/i.test(priorTitle);
  const sceneId = newSceneId('interior');
  const composed = composeDirectorScene({
    kind: 'interior',
    sceneId,
    premise: options.premise,
    seedKey: `${options.campaignId}:${options.premise}`,
  });
  const runtime = applyComposedSceneToRuntime({
    runtime: {
      ...options.runtime,
      premiseKey: options.premise,
    },
    composed,
    mode: 'establish',
    accountIds: [options.accountId],
    seatTokens: options.seatTokens,
  });
  const establish = directorNarrationBeat('establish', { scene: composed });
  const chronicle = hadPriorScene
    ? `The table records a scene reset — prior play in ${priorTitle} is left behind as archived history. ${establish}`
    : establish;
  return {
    runtime,
    composed,
    chronicle,
  };
}

export function actorHoldsMatchingKey(
  actorEquipment: readonly string[] | undefined,
  keyItemId: string | null | undefined,
): string | null {
  if (actorEquipment === undefined || actorEquipment.length === 0) {
    return null;
  }
  if (typeof keyItemId === 'string' && keyItemId.trim().length > 0) {
    const targetLower = keyItemId.trim().toLowerCase();
    const exactOrSub = actorEquipment.find((item) => {
      const lower = item.trim().toLowerCase();
      return lower === targetLower || lower.includes(targetLower) || targetLower.includes(lower);
    });
    if (exactOrSub !== undefined) {
      return exactOrSub;
    }
  }
  return null;
}

export function interactObjectRuntime(options: {
  readonly runtime: StoredMapRuntime;
  readonly objectId: string;
  readonly declaration: string;
  readonly actorEquipment?: readonly string[];
}): {
  readonly runtime: StoredMapRuntime;
  readonly chronicle: string;
  readonly label: string;
  readonly priorState: string;
  readonly nextState: string;
  readonly objectId: string;
  readonly baseLabel: string;
  readonly lootedItems: readonly string[];
  readonly unlockedWithKey?: string;
} {
  const active = activeSceneInstance(options.runtime);
  if (active === null) {
    throw new Error('NO_ACTIVE_SCENE');
  }
  const feature = active.features.find((entry) => entry.objectId === options.objectId);
  if (feature === undefined || !feature.interactable) {
    throw new Error('OBJECT_NOT_INTERACTABLE');
  }
  const priorState = feature.state;
  const isExplicitLootCommand =
    /\b(?:loot|empty|take\s+all|grab\s+all|collect\s+all|claim\s+all|take\s+(?:the\s+)?contents)\b/i.test(
      options.declaration,
    );
  const isInspectContainerCommand =
    feature.objectKind === 'container' &&
    /\b(?:inspect|examine|search|check|peek|look\s+in(?:side)?)\b/i.test(options.declaration);
  let next = nextObjectState(feature, options.declaration);
  if (
    feature.objectKind === 'container' &&
    feature.state === 'open' &&
    (isExplicitLootCommand || isInspectContainerCommand)
  ) {
    next = 'open';
  } else if (next === null || next === feature.state) {
    throw new Error('OBJECT_STATE_UNCHANGED');
  }
  const isLocked = feature.lockState === 'locked' || feature.state === 'locked';
  let unlockedWithKey: string | undefined;
  if (isLocked && next === 'open') {
    const matchingKey = actorHoldsMatchingKey(options.actorEquipment, feature.keyItemId);
    if (matchingKey === null) {
      throw new Error('OBJECT_LOCKED');
    }
    unlockedWithKey = matchingKey;
  }
  // Two-step container looting (Packet 3 / Guardrail 2):
  // Step 1 ("open / unlock / inspect / search <container>") transitions the container to 'open'
  // and reveals its contents in the Chronicle without auto-transferring them to inventory.
  // Explicit "loot / take all" transfers the contents immediately.
  const lootedItems =
    feature.objectKind === 'container' && next === 'open' && isExplicitLootCommand
      ? [...(feature.contents ?? [])]
      : [];
  const nextLockState =
    isLocked && (next === 'open' || next === 'broken') ? ('unlocked' as const) : feature.lockState;
  const baseLabel = stripFeatureStateSuffix(feature.label);
  const labeled = featureLabelWithState({
    ...feature,
    state: next,
    ...(nextLockState !== undefined ? { lockState: nextLockState } : {}),
  });
  let runtime = updateSceneObjectState({
    runtime: options.runtime,
    objectId: options.objectId,
    nextState: next,
    labelWithState: labeled,
    ...(nextLockState !== undefined ? { lockState: nextLockState } : {}),
    ...(feature.objectKind === 'container' && next === 'open'
      ? {
          contents: isExplicitLootCommand ? [] : [...(feature.contents ?? [])],
        }
      : {}),
  });
  if (runtime === null) {
    throw new Error('NO_ACTIVE_SCENE');
  }
  // If a lever/switch with targetEdgeOrObjectId is pulled, unlock/open its target edge, exit, or container.
  let leverUnlockedClause = '';
  if (
    feature.objectKind === 'lever' &&
    (next === 'pulled' || next === 'active' || next === 'open')
  ) {
    const targetId = feature.targetEdgeOrObjectId ?? '';
    const updatedActive = activeSceneInstance(runtime);
    if (updatedActive !== null) {
      const nextDoors = { ...runtime.doorStates };
      const instanceDoors = { ...updatedActive.doorStates };
      let unlockedAnyMechanism = false;

      const updatedEdges = updatedActive.edges.map((edge) => {
        if (
          edge.kind === 'door' &&
          (edge.edgeId === targetId ||
            edge.keyItemId === 'Wall Lever Mechanism' ||
            /\b(?:lever|mechanism|switch|winch)\b/i.test(edge.keyItemId ?? ''))
        ) {
          nextDoors[edge.edgeId] = 'open';
          instanceDoors[edge.edgeId] = 'open';
          unlockedAnyMechanism = true;
          return {
            ...edge,
            doorState: 'open' as const,
          };
        }
        return edge;
      });

      const updatedExits = updatedActive.exits.map((exit) => {
        if (
          exit.exitId === targetId ||
          exit.keyItemId === 'Wall Lever Mechanism' ||
          /\b(?:lever|mechanism|switch|winch)\b/i.test(exit.keyItemId ?? '')
        ) {
          unlockedAnyMechanism = true;
          return {
            ...exit,
            lockState: 'unlocked' as const,
          };
        }
        return exit;
      });

      const updatedFeatures = updatedActive.features.map((f) => {
        const matchesLeverTarget =
          f.objectId === targetId ||
          (f.objectKind === 'exit' &&
            (f.keyItemId === 'Wall Lever Mechanism' ||
              /\b(?:lever|mechanism|switch|winch)\b/i.test(f.keyItemId ?? '') ||
              updatedExits.some((e) => e.exitId === f.objectId && e.lockState === 'unlocked')));
        if (!matchesLeverTarget) {
          return f;
        }
        unlockedAnyMechanism = true;
        if (f.objectKind === 'exit') {
          const cleanExitBase = f.label
            .replace(/\s*—\s*(?:open|closed|locked|unlocked).*$/i, '')
            .replace(/\s*\([^)]+\)\s*$/, '')
            .trim();
          // Also open any door edge on the same square as this exit.
          for (const edge of updatedEdges) {
            if (
              edge.kind === 'door' &&
              Math.abs(edge.column - f.column) <= 1 &&
              Math.abs(edge.row - f.row) <= 1
            ) {
              nextDoors[edge.edgeId] = 'open';
              instanceDoors[edge.edgeId] = 'open';
            }
          }
          return {
            ...f,
            state: 'open' as const,
            lockState: 'unlocked' as const,
            label: `${cleanExitBase} — open`,
          };
        }
        const unlockedState = f.objectKind === 'container' ? ('closed' as const) : ('unlocked' as const);
        return {
          ...f,
          state: unlockedState,
          lockState: 'unlocked' as const,
          label: featureLabelWithState({
            ...f,
            state: unlockedState,
            lockState: 'unlocked',
          }),
        };
      });

      if (unlockedAnyMechanism) {
        const isOutdoorActive =
          updatedActive.templateId.startsWith('exterior_') ||
          updatedActive.templateId.startsWith('landmark_') ||
          !updatedActive.environment.endsWith('_interior');
        leverUnlockedClause = isOutdoorActive
          ? ' Counterweights grind and unseal the locked passage ahead!'
          : ' Counterweights grind inside the wall and unseal the locked passage!';
        const updatedInstance: StoredSceneInstance = {
          ...updatedActive,
          edges: updatedEdges,
          exits: updatedExits,
          features: updatedFeatures,
          doorStates: instanceDoors,
        };
        runtime = {
          ...runtime,
          doorStates: nextDoors,
          runtimeEdges: updatedEdges,
          sceneInstances: {
            ...runtime.sceneInstances,
            [updatedActive.sceneId]: updatedInstance,
          },
        };
      }
    }
  }
  const scene = instanceToComposed(activeSceneInstance(runtime)!);
  const baseBeat = directorNarrationBeat('interact', {
    scene,
    objectLabel: baseLabel,
    objectState: next,
  });
  const keyClause = unlockedWithKey ? ` Unlocked using ${unlockedWithKey}.` : '';
  const revealedContentsClause =
    feature.objectKind === 'container' && next === 'open' && !isExplicitLootCommand
      ? feature.contents && feature.contents.length > 0
        ? ` Inside you see: ${feature.contents.join(', ')}.`
        : ' It is empty.'
      : '';
  const lootClause =
    lootedItems.length > 0 ? ` Looted into inventory: ${lootedItems.join(', ')}.` : '';
  return {
    runtime,
    chronicle: `${baseBeat}${keyClause}${leverUnlockedClause}${revealedContentsClause}${lootClause}`,
    label: labeled,
    priorState,
    nextState: next,
    objectId: options.objectId,
    baseLabel,
    lootedItems,
    ...(unlockedWithKey !== undefined ? { unlockedWithKey } : {}),
  };
}

export function lootContainerRuntime(options: {
  readonly runtime: StoredMapRuntime;
  readonly objectId?: string;
  readonly itemHint?: string;
  readonly declaration?: string;
}): {
  readonly runtime: StoredMapRuntime;
  readonly lootedItems: readonly string[];
  readonly containerLabel: string;
  readonly objectId: string;
  readonly chronicle: string;
} {
  const active = activeSceneInstance(options.runtime);
  if (active === null) {
    throw new Error('NO_ACTIVE_SCENE');
  }
  const unlockedContainersWithContents = active.features.filter(
    (f) =>
      f.objectKind === 'container' &&
      f.lockState !== 'locked' &&
      f.state !== 'locked' &&
      Array.isArray(f.contents) &&
      f.contents.length > 0,
  );
  if (unlockedContainersWithContents.length === 0) {
    throw new Error('NO_LOOTABLE_CONTAINER');
  }
  const searchPhrase = `${options.itemHint ?? ''} ${options.declaration ?? ''}`.trim().toLowerCase();
  const isTakeAllOrLoot =
    /\b(?:loot|empty|take\s+all|grab\s+all|collect\s+all|claim\s+all|contents|everything)\b/i.test(
      searchPhrase,
    );

  const itemMatchesSearch = (item: string): boolean => {
    if (searchPhrase.length === 0) return false;
    const itemLower = item.trim().toLowerCase();
    if (searchPhrase.includes(itemLower)) return true;
    const itemTokens = itemLower
      .split(/\W+/)
      .filter((t) => t.length >= 3 && !COMMON_MODIFIER_ADJECTIVES.has(t));
    return itemTokens.some((tok) => declarationMentionsLabelWord(searchPhrase, tok));
  };

  const openContainers = unlockedContainersWithContents.filter((f) => f.state === 'open');
  const explicitById =
    options.objectId !== undefined
      ? unlockedContainersWithContents.find((f) => f.objectId === options.objectId)
      : undefined;
  // If an unopened container was passed by objectId without the player naming that container,
  // and an ALREADY-OPEN container holds the requested item, bind to the open container!
  const openContainerWithMatchingItem = openContainers.find((f) =>
    (f.contents ?? []).some(itemMatchesSearch),
  );
  const effectiveExplicit =
    explicitById !== undefined &&
    explicitById.state !== 'open' &&
    openContainerWithMatchingItem !== undefined &&
    scoreFeatureLabelMatch(searchPhrase, explicitById.label).score === 0
      ? openContainerWithMatchingItem
      : explicitById;

  const targetContainer =
    effectiveExplicit ??
    openContainerWithMatchingItem ??
    openContainers.find((f) => scoreFeatureLabelMatch(searchPhrase, f.label).score > 0) ??
    unlockedContainersWithContents.find((f) => (f.contents ?? []).some(itemMatchesSearch)) ??
    unlockedContainersWithContents.find(
      (f) => scoreFeatureLabelMatch(searchPhrase, f.label).score > 0,
    ) ??
    openContainers[0] ??
    unlockedContainersWithContents[0]!;

  const currentContents = [...(targetContainer.contents ?? [])];
  const matchedSpecificItems = isTakeAllOrLoot
    ? []
    : currentContents.filter(itemMatchesSearch);
  const lootedItems =
    matchedSpecificItems.length > 0 ? matchedSpecificItems : currentContents;
  const remainingContents = currentContents.filter((item) => !lootedItems.includes(item));
  const baseLabel = stripFeatureStateSuffix(targetContainer.label);
  const nextLabel = featureLabelWithState({
    ...targetContainer,
    state: 'open',
    lockState: 'unlocked',
  });
  const updated = updateSceneObjectState({
    runtime: options.runtime,
    objectId: targetContainer.objectId,
    nextState: 'open',
    labelWithState: nextLabel,
    lockState: 'unlocked',
    contents: remainingContents,
  });
  if (updated === null) {
    throw new Error('NO_ACTIVE_SCENE');
  }
  return {
    runtime: updated,
    lootedItems,
    containerLabel: baseLabel,
    objectId: targetContainer.objectId,
    chronicle: `Took ${lootedItems.join(', ')} from ${baseLabel}.`,
  };
}

export function transferNpcItemRuntime(options: {
  readonly runtime: StoredMapRuntime;
  readonly objectId?: string;
  readonly itemHint?: string;
}): {
  readonly runtime: StoredMapRuntime;
  readonly itemLabel: string;
  readonly npcName: string;
  readonly objectId: string;
} {
  const active = activeSceneInstance(options.runtime);
  if (active === null) {
    throw new Error('NO_ACTIVE_SCENE');
  }
  const npcsWithItems = active.features.filter(
    (feature) =>
      (feature.objectKind === 'npc' || feature.referenceKind === 'npc') &&
      Array.isArray(feature.heldItems) &&
      feature.heldItems.length > 0,
  );
  const targetNpc =
    (options.objectId !== undefined
      ? active.features.find(
          (f) =>
            f.objectId === options.objectId ||
            ((f.objectKind === 'npc' || f.referenceKind === 'npc') &&
              npcNamesMatch(f.label, options.objectId ?? '')),
        )
      : undefined) ?? npcsWithItems[0];
  if (
    targetNpc === undefined ||
    !Array.isArray(targetNpc.heldItems) ||
    targetNpc.heldItems.length === 0
  ) {
    throw new Error('NPC_HAS_NO_HELD_ITEMS');
  }
  const hintLower = (options.itemHint ?? '').trim().toLowerCase();
  const matchedItem =
    (hintLower.length > 0
      ? targetNpc.heldItems.find(
          (item) =>
            item.toLowerCase().includes(hintLower) || hintLower.includes(item.toLowerCase()),
        )
      : undefined) ?? targetNpc.heldItems[0]!;
  const remainingItems = targetNpc.heldItems.filter((item) => item !== matchedItem);
  const updated = updateSceneObjectState({
    runtime: options.runtime,
    objectId: targetNpc.objectId,
    nextState: targetNpc.state,
    labelWithState: targetNpc.label,
    heldItems: remainingItems,
  });
  if (updated === null) {
    throw new Error('NO_ACTIVE_SCENE');
  }
  const npcName = targetNpc.label.replace(/\s*\([^)]+\)\s*$/, '').trim();
  return {
    runtime: updated,
    itemLabel: matchedItem,
    npcName,
    objectId: targetNpc.objectId,
  };
}

function inferTravelKind(
  runtime: StoredMapRuntime,
  destinationHint: string,
  returnToPrevious: boolean,
): { kind: SceneComposeKind; returnToSceneId: string | null } {
  if (returnToPrevious || /\breturn|go back|head back|retreat\b/i.test(destinationHint)) {
    const stack = runtime.sceneStack ?? [];
    const prior = stack.length > 0 ? stack[stack.length - 1]! : runtime.activeSceneId;
    return { kind: 'return_hint', returnToSceneId: prior ?? null };
  }
  const active = activeSceneInstance(runtime);

  // Landmark travel only when engaging a Director-presented exit — not freeform naming.
  if (active !== null) {
    const landmarkExits = active.exits.filter((exit) =>
      matchLandmarkDestination(exit.destinationHint),
    );
    if (
      landmarkExits.length > 0 &&
      matchPresentedExit(landmarkExits, destinationHint) !== null
    ) {
      return { kind: 'landmark', returnToSceneId: active.sceneId };
    }
  }

  if (active?.purpose === 'travel') {
    // Forward progress from a trail is a Director encounter; player does not pick which.
    return { kind: 'encounter', returnToSceneId: active.sceneId };
  }
  if (active?.purpose === 'exploration' || active?.purpose === 'social' || active?.purpose === 'rest') {
    return { kind: 'exterior', returnToSceneId: active.sceneId };
  }
  if (active?.purpose === 'encounter' || active?.purpose === 'hazard') {
    if (/\bleave|travel|head|go to|climb|enter|onward|forward\b/i.test(destinationHint)) {
      return { kind: 'landmark', returnToSceneId: active.sceneId };
    }
    return { kind: 'return_hint', returnToSceneId: (runtime.sceneStack ?? []).at(-1) ?? null };
  }
  return { kind: 'exterior', returnToSceneId: active?.sceneId ?? null };
}

function resolveGraphTargetExit(
  active: StoredSceneInstance,
  destinationHint: string,
  returnToPrevious: boolean,
): string | null {
  if (returnToPrevious || /\b(?:return|go\s+back|head\s+back|retreat|back\s+to)\b/i.test(destinationHint)) {
    const backExit = active.exits.find(
      (exit) =>
        typeof exit.targetSceneId === 'string' &&
        (/\b(?:return|back)\b/i.test(exit.label) || exit.exitId.endsWith('-back')),
    );
    return backExit?.targetSceneId ?? null;
  }
  const forwardGraphExits = active.exits.filter(
    (exit) =>
      typeof exit.targetSceneId === 'string' &&
      exit.targetSceneId.length > 0 &&
      !exit.exitId.endsWith('-back') &&
      !/\b(?:return|back\s+to|way\s+back)\b/i.test(exit.label),
  );
  const graphExits =
    forwardGraphExits.length > 0
      ? forwardGraphExits
      : active.exits.filter(
          (exit) =>
            typeof exit.targetSceneId === 'string' &&
            exit.targetSceneId.length > 0 &&
            !exit.exitId.endsWith('-back'),
        );
  if (graphExits.length === 0) {
    return null;
  }
  const matched = matchPresentedExit(graphExits, destinationHint);
  if (matched !== null) {
    const matchedStored = graphExits.find(
      (exit) =>
        exit.label === matched.label && exit.destinationHint === matched.destinationHint,
    );
    if (matchedStored?.targetSceneId) {
      return matchedStored.targetSceneId;
    }
  }
  const lower = destinationHint.toLowerCase();
  for (const exit of graphExits) {
    if (
      exit.targetSceneId &&
      (lower.includes(exit.targetSceneId.toLowerCase()) ||
        lower.includes(exit.label.toLowerCase()) ||
        lower.includes(exit.destinationHint.toLowerCase()))
    ) {
      return exit.targetSceneId;
    }
  }
  // Check compass bearing match against exit features or labels.
  const compassMatch = /\b(north|northern|south|southern|east|eastern|west|western)\b/i.exec(lower);
  if (compassMatch) {
    const dir = compassMatch[1]!.toLowerCase();
    for (const exit of graphExits) {
      if (new RegExp(`\\b${dir.slice(0, 4)}`, 'i').test(exit.label)) {
        return exit.targetSceneId ?? null;
      }
      const exitFeat = active.features.find(
        (f) => f.objectId === exit.exitId && f.objectKind === 'exit',
      );
      if (exitFeat) {
        const isEast = dir.startsWith('east') && exitFeat.column >= active.columns - 2;
        const isWest = dir.startsWith('west') && exitFeat.column <= 1;
        const isNorth = dir.startsWith('north') && exitFeat.row <= 1;
        const isSouth = dir.startsWith('south') && exitFeat.row >= active.rows - 2;
        if (isEast || isWest || isNorth || isSouth) {
          return exit.targetSceneId ?? null;
        }
      }
    }
  }
  return graphExits[0]?.targetSceneId ?? null;
}

function findRoomInBlueprint(
  blueprint: CampaignBlueprint | null | undefined,
  sceneId: string,
) {
  if (!blueprint?.milestones) return null;
  for (const milestone of blueprint.milestones) {
    for (const room of milestone.rooms) {
      if (room.sceneId === sceneId) {
        return room;
      }
    }
  }
  return null;
}

export function resolveTravelDestinationTitle(
  runtime: StoredMapRuntime,
  destinationHint: string,
  returnToPrevious = false,
  blueprint?: CampaignBlueprint | null,
): string | null {
  const active = activeSceneInstance(runtime);
  if (active === null) {
    return null;
  }
  const graphTargetId = resolveGraphTargetExit(active, destinationHint, returnToPrevious);
  if (graphTargetId !== null) {
    if (runtime.sceneInstances?.[graphTargetId] !== undefined) {
      return runtime.sceneInstances[graphTargetId]!.title;
    }
    const blueprintRoom = findRoomInBlueprint(blueprint, graphTargetId);
    if (blueprintRoom !== null) {
      return blueprintRoom.title;
    }
    const matchedGraphExit = active.exits.find((e) => e.targetSceneId === graphTargetId);
    if (
      matchedGraphExit !== undefined &&
      matchedGraphExit.destinationHint.trim().length > 0 &&
      matchedGraphExit.destinationHint.trim().toLowerCase() !== active.title.trim().toLowerCase()
    ) {
      if (
        matchedGraphExit.destinationHint.trim().toLowerCase() ===
          matchedGraphExit.label.trim().toLowerCase() &&
        /-r3$/.test(graphTargetId) &&
        active.title.includes(' — ')
      ) {
        const basePlace = active.title.split(' — ')[0]!.trim();
        return `${basePlace} — Sanctum`;
      }
      return matchedGraphExit.destinationHint.trim();
    }
  }
  if (returnToPrevious) {
    const stack = runtime.sceneStack ?? [];
    const lastId = stack[stack.length - 1];
    if (lastId !== undefined && runtime.sceneInstances?.[lastId] !== undefined) {
      return runtime.sceneInstances[lastId]!.title;
    }
  }
  const matchedExit = matchPresentedExit(active.exits, destinationHint);
  if (
    matchedExit !== null &&
    matchedExit.destinationHint.trim().length > 0 &&
    matchedExit.destinationHint.trim().toLowerCase() !== active.title.trim().toLowerCase()
  ) {
    return matchedExit.destinationHint.trim();
  }
  return null;
}

export function checkExitLockedForTravel(
  active: StoredSceneInstance,
  destinationHint: string,
  returnToPrevious = false,
): {
  readonly locked: boolean;
  readonly byLever: boolean;
  readonly exitLabel: string;
  readonly leverLabel: string | null;
} {
  if (returnToPrevious || /\breturn|go back|head back|retreat\b/i.test(destinationHint)) {
    return { locked: false, byLever: false, exitLabel: '', leverLabel: null };
  }
  const forwardExits = active.exits.filter(
    (exit) =>
      !exit.exitId.endsWith('-back') &&
      !/\b(?:return|back\s+to|way\s+back)\b/i.test(exit.label),
  );
  const candidates = forwardExits.length > 0 ? forwardExits : active.exits;
  const matched = matchPresentedExit(candidates, destinationHint);
  const lower = destinationHint.toLowerCase();
  const targetExit =
    (matched !== null
      ? candidates.find(
          (e) => e.label === matched.label && e.destinationHint === matched.destinationHint,
        )
      : undefined) ??
    candidates.find(
      (e) =>
        lower.includes(e.label.toLowerCase()) ||
        lower.includes(e.destinationHint.toLowerCase()),
    ) ??
    candidates[0];

  if (targetExit === undefined) {
    return { locked: false, byLever: false, exitLabel: '', leverLabel: null };
  }

  const exitFeature = active.features.find(
    (f) => f.objectId === targetExit.exitId && f.objectKind === 'exit',
  );
  const linkedLever = active.features.find(
    (f) =>
      f.objectKind === 'lever' &&
      (f.targetEdgeOrObjectId === targetExit.exitId ||
        targetExit.keyItemId === 'Wall Lever Mechanism' ||
        /\b(?:lever|mechanism|switch|winch)\b/i.test(targetExit.keyItemId ?? '')),
  );
  const leverUnpulled =
    linkedLever !== undefined &&
    linkedLever.state !== 'pulled' &&
    linkedLever.state !== 'active' &&
    linkedLever.state !== 'open';
  const isExitLocked =
    targetExit.lockState === 'locked' ||
    exitFeature?.lockState === 'locked' ||
    exitFeature?.state === 'locked' ||
    leverUnpulled;

  if (!isExitLocked) {
    return { locked: false, byLever: false, exitLabel: '', leverLabel: null };
  }
  const byLever =
    linkedLever !== undefined ||
    targetExit.keyItemId === 'Wall Lever Mechanism' ||
    /\b(?:lever|mechanism|switch|winch)\b/i.test(targetExit.keyItemId ?? '');
  return {
    locked: true,
    byLever,
    exitLabel: stripFeatureStateSuffix(targetExit.label),
    leverLabel: linkedLever ? stripFeatureStateSuffix(linkedLever.label) : null,
  };
}

export function travelSceneRuntime(options: {
  readonly runtime: StoredMapRuntime;
  readonly campaignId: string;
  readonly accountId: string;
  readonly destinationHint: string;
  readonly returnToPrevious?: boolean;
  readonly seatTokens?: readonly StoredTokenPosition[];
  readonly partyXp?: number;
  readonly requiredXpThreshold?: number;
  readonly blueprint?: CampaignBlueprint | null;
}): {
  readonly runtime: StoredMapRuntime;
  readonly composed: ComposedScene | null;
  readonly chronicle: string;
  readonly xpAwarded?: number;
  readonly jitCompiledSceneId?: string;
} {
  const active = activeSceneInstance(options.runtime);
  if (active === null) {
    throw new Error('NO_ACTIVE_SCENE');
  }
  const returnToPrevious = options.returnToPrevious === true;
  const lockCheck = checkExitLockedForTravel(active, options.destinationHint, returnToPrevious);
  if (lockCheck.locked) {
    throw new Error(lockCheck.byLever ? 'EXIT_LOCKED_BY_MECHANISM' : 'EXIT_LOCKED');
  }
  const seatTokens = options.seatTokens ?? active.tokenPositions;

  // Check if the current scene has a multi-map graph exit target (pre-forged or JIT from blueprint).
  const graphTargetId = resolveGraphTargetExit(
    active,
    options.destinationHint,
    returnToPrevious,
  );
  let workingSceneInstances = { ...(options.runtime.sceneInstances ?? {}) };
  let jitCompiledSceneId: string | undefined;
  if (
    graphTargetId !== null &&
    workingSceneInstances[graphTargetId] === undefined &&
    options.blueprint !== undefined &&
    options.blueprint !== null
  ) {
    const room = findRoomInBlueprint(options.blueprint, graphTargetId);
    if (room !== null) {
      workingSceneInstances[graphTargetId] = buildStoredSceneFromRoomBlueprint(
        room,
        options.campaignId,
        {
          accountIds: [options.accountId],
          seatTokens,
          visited: false,
        },
      );
      jitCompiledSceneId = graphTargetId;
      // Rolling Headlights: also pre-compile any immediate forward exit rooms from this room.
      for (const exit of room.exits) {
        if (
          exit.targetSceneId &&
          workingSceneInstances[exit.targetSceneId] === undefined
        ) {
          const nextRoom = findRoomInBlueprint(options.blueprint, exit.targetSceneId);
          if (nextRoom !== null) {
            workingSceneInstances[exit.targetSceneId] = buildStoredSceneFromRoomBlueprint(
              nextRoom,
              options.campaignId,
              {
                accountIds: [options.accountId],
                seatTokens,
                visited: false,
              },
            );
          }
        }
      }
    }
  }
  if (graphTargetId !== null && workingSceneInstances[graphTargetId] !== undefined) {
    let targetScene = workingSceneInstances[graphTargetId]!;
    let redirectedNote = '';
    if (
      targetScene.isMilestoneClimax === true &&
      options.partyXp !== undefined &&
      options.requiredXpThreshold !== undefined &&
      options.partyXp < options.requiredXpThreshold
    ) {
      const unvisitedSideRoom = Object.values(workingSceneInstances).find(
        (candidate) =>
          candidate.milestoneIndex === targetScene.milestoneIndex &&
          candidate.isMilestoneClimax !== true &&
          candidate.visited !== true &&
          candidate.sceneId !== active.sceneId,
      );
      if (unvisitedSideRoom !== undefined) {
        targetScene = unvisitedSideRoom;
        redirectedNote =
          ' Heavy wards bar the inner sanctum until the party gathers further strength along the approach.';
      }
    }
    const xpAwarded = targetScene.visited ? 0 : (targetScene.xpAwardOnDiscovery ?? 0);
    const composed = instanceToComposed(targetScene);
    const squares: { column: number; row: number }[] = [];
    for (let row = targetScene.spawn.row - 2; row <= targetScene.spawn.row + 2; row += 1) {
      for (let col = targetScene.spawn.column - 2; col <= targetScene.spawn.column + 2; col += 1) {
        if (col >= 0 && row >= 0) {
          squares.push({ column: col, row });
        }
      }
    }
    const nextExplored = {
      ...targetScene.exploredByAccount,
      [options.accountId]: mergeExplored(
        targetScene.exploredByAccount[options.accountId],
        squares,
      ),
    };
    const nextTokens = seatTokens.map((token) => ({
      ...token,
      column: targetScene.spawn.column,
      row: targetScene.spawn.row,
    }));
    const instances: Record<string, StoredSceneInstance> = {
      ...workingSceneInstances,
      [active.sceneId]: {
        ...active,
        tokenPositions: options.runtime.tokenPositions,
        doorStates: { ...active.doorStates, ...options.runtime.doorStates },
        exploredByAccount: { ...options.runtime.exploredByAccount },
      },
      [targetScene.sceneId]: {
        ...targetScene,
        tokenPositions: nextTokens,
        exploredByAccount: nextExplored,
        visited: true,
      },
    };
    const stack = [...(options.runtime.sceneStack ?? [])];
    if (!returnToPrevious && active.sceneId !== targetScene.sceneId) {
      stack.push(active.sceneId);
    }
    const runtime: StoredMapRuntime = {
      ...options.runtime,
      activeSceneId: targetScene.sceneId,
      sceneInstances: instances,
      sceneStack: returnToPrevious
        ? stack.filter((id) => id !== targetScene.sceneId)
        : stack,
      sceneTitle: targetScene.title,
      tokenPositions: nextTokens,
      doorStates: { ...targetScene.doorStates },
      runtimeEdges: targetScene.edges,
      exploredByAccount: nextExplored,
      adventureStarted: true,
    };
    return {
      runtime,
      composed,
      chronicle: `${directorNarrationBeat('travel', {
        scene: composed,
        priorTitle: active.title,
        objectLabel: options.destinationHint,
      })}${redirectedNote}`,
      xpAwarded,
      ...(jitCompiledSceneId !== undefined ? { jitCompiledSceneId } : {}),
    };
  }

  const inferred = inferTravelKind(
    options.runtime,
    options.destinationHint,
    returnToPrevious,
  );

  if (inferred.kind === 'return_hint') {
    const returnId = inferred.returnToSceneId;
    if (returnId === null || options.runtime.sceneInstances?.[returnId] === undefined) {
      throw new Error('NO_PRIOR_SCENE');
    }
    const prior = options.runtime.sceneInstances![returnId]!;
    const composed = instanceToComposed(prior);
    const runtime = applyComposedSceneToRuntime({
      runtime: options.runtime,
      composed,
      mode: 'restore',
      accountIds: [options.accountId],
      seatTokens,
    });
    const changed = prior.features.find(
      (feature) =>
        feature.interactable &&
        ((feature.objectKind === 'light' && feature.state === 'unlit') ||
          (feature.objectKind === 'cover' && feature.state === 'broken') ||
          (feature.objectKind === 'container' &&
            (feature.state === 'broken' || feature.state === 'open')) ||
          (feature.objectKind === 'prop' &&
            (feature.state === 'open' || feature.state === 'broken')) ||
          (feature.objectKind === 'hazard' && feature.state === 'disarmed')),
    );
    return {
      runtime,
      composed,
      chronicle: directorNarrationBeat('return', {
        scene: composed,
        objectLabel: changed?.label ?? null,
      }),
      xpAwarded: 0,
    };
  }

  const premise = options.runtime.premiseKey ?? 'an unfolding adventure';
  const stackDepth = options.runtime.sceneStack?.length ?? 0;
  // Stable Director seed — do not hash player freeform text into scene identity.
  const seedKey = `${options.campaignId}:${inferred.kind}:${active.sceneId}:${stackDepth}`;
  const directorHint = directorOwnedCompositionHint({
    kind: inferred.kind,
    premise,
    seedKey,
    playerDeclaration: options.destinationHint,
    presentedExits: active.exits,
  });
  const sceneId = newSceneId(
    inferred.kind === 'encounter'
      ? 'encounter'
      : inferred.kind === 'landmark'
        ? 'landmark'
        : 'exterior',
  );
  const composed = composeDirectorScene({
    kind: inferred.kind,
    sceneId,
    premise,
    destinationHint: directorHint,
    seedKey,
    returnToSceneId: inferred.returnToSceneId,
  });
  const runtime = applyComposedSceneToRuntime({
    runtime: options.runtime,
    composed,
    mode: 'travel',
    accountIds: [options.accountId],
    seatTokens,
  });
  return {
    runtime,
    composed,
    chronicle: directorNarrationBeat('travel', {
      scene: composed,
      priorTitle: active.title,
    }),
    xpAwarded: 0,
  };
}

export function isPortableSceneContainer(feature: StoredSceneFeature): boolean {
  if (
    feature.objectKind === 'exit' ||
    feature.referenceKind === 'exit' ||
    feature.objectKind === 'lever' ||
    feature.objectKind === 'trap' ||
    feature.objectKind === 'hazard' ||
    feature.objectKind === 'cover' ||
    feature.objectKind === 'npc' ||
    feature.objectKind === 'creature'
  ) {
    return false;
  }
  if (
    /\b(?:trail|path|road|passage|passageway|corridor|stairs?|staircase|steps|doorway|archway|bridge|crossing|ford|tunnel|exit|way|route|gate|gateway)\b/i.test(
      feature.label,
    )
  ) {
    return false;
  }
  if (feature.objectKind === 'item') {
    return true;
  }
  if (feature.objectKind === 'container') {
    return labelLooksPortableContainer(feature.label);
  }
  if (feature.objectKind === 'prop') {
    return !HEAVY_FIXTURE_LABEL.test(feature.label);
  }
  return false;
}

const COMMON_MODIFIER_ADJECTIVES = new Set([
  'sealed',
  'locked',
  'unlocked',
  'closed',
  'open',
  'opened',
  'broken',
  'intact',
  'lit',
  'unlit',
  'iron',
  'ironbound',
  'wooden',
  'oak',
  'oaken',
  'stone',
  'carved',
  'brass',
  'copper',
  'silver',
  'golden',
  'gold',
  'ancient',
  'old',
  'rusty',
  'rusted',
  'heavy',
  'sturdy',
  'small',
  'large',
  'dark',
  'dim',
  'bright',
  'ornate',
  'dusty',
  'weathered',
  'worn',
  'cracked',
  'folded',
  'bloodstained',
  'tattered',
  'hidden',
  'secret',
  'contested',
  'shuttered',
  'latched',
  'clasped',
  'bound',
]);

export function stripFeatureStateSuffix(label: string): string {
  return label
    .replace(/\s*\([^)]+\)\s*$/, '')
    .replace(/\s*—\s*(?:open|closed|locked|unlocked|intact|broken|lit|unlit|present|active|disarmed|spotted).*$/i, '')
    .replace(/^contested\s+/i, '')
    .trim();
}

export interface FeatureLabelMatchScore {
  readonly score: number;
  readonly exactPhraseMatch: boolean;
  readonly headNounMatch: boolean;
  readonly secondaryNounMatches: number;
  readonly modifierMatches: number;
  readonly baseLabel: string;
  readonly headNoun: string;
}

/**
 * Scores how well a player declaration matches a scene feature label using
 * exact-phrase and head-noun priority over shared leading modifier adjectives.
 */
export function scoreFeatureLabelMatch(
  declaration: string,
  featureLabel: string,
): FeatureLabelMatchScore {
  const baseLabel = stripFeatureStateSuffix(featureLabel);
  const baseLower = baseLabel.toLowerCase();
  const tokens = baseLower
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !/^(?:the|a|an|of|in|on|at|to|for|with|and)$/i.test(w));

  if (tokens.length === 0) {
    return {
      score: 0,
      exactPhraseMatch: false,
      headNounMatch: false,
      secondaryNounMatches: 0,
      modifierMatches: 0,
      baseLabel,
      headNoun: '',
    };
  }

  const { primaryClause, locativeQualifier } = splitPrimaryTargetFromLocative(declaration);
  const effectiveDeclaration = primaryClause.trim().length > 0 ? primaryClause : declaration;

  const headNoun = tokens[tokens.length - 1]!;
  const prefixTokens = tokens.slice(0, -1);
  const exactPhraseMatch =
    baseLower.length >= 3 &&
    new RegExp(`\\b${baseLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(
      effectiveDeclaration,
    );
  const headNounMatch = declarationMentionsLabelWord(effectiveDeclaration, headNoun);

  let secondaryNounMatches = 0;
  let modifierMatches = 0;
  for (const tok of prefixTokens) {
    if (!declarationMentionsLabelWord(effectiveDeclaration, tok)) {
      continue;
    }
    if (COMMON_MODIFIER_ADJECTIVES.has(tok)) {
      modifierMatches += 1;
    } else {
      secondaryNounMatches += 1;
    }
  }

  // If the primary clause didn't match this feature's head or secondary noun, check if it was only mentioned in the locative qualifier.
  if (
    !exactPhraseMatch &&
    !headNounMatch &&
    secondaryNounMatches === 0 &&
    modifierMatches === 0 &&
    locativeQualifier.length > 0 &&
    declarationMentionsLabelWord(locativeQualifier, headNoun)
  ) {
    return {
      score: 3,
      exactPhraseMatch: false,
      headNounMatch: false,
      secondaryNounMatches: 0,
      modifierMatches: 1,
      baseLabel,
      headNoun,
    };
  }

  // If a multi-word feature ONLY matched a leading modifier adjective (e.g., "sealed" or "iron")
  // and its head noun is NOT in the declaration, check whether the declaration followed that
  // modifier with a different noun ("sealed <other-noun>"). If so, this feature is a modifier
  // collision and must score 0.
  if (!exactPhraseMatch && !headNounMatch && secondaryNounMatches === 0 && modifierMatches > 0) {
    const matchedModifiers = prefixTokens.filter(
      (tok) =>
        COMMON_MODIFIER_ADJECTIVES.has(tok) &&
        declarationMentionsLabelWord(effectiveDeclaration, tok),
    );
    const followedByDifferentNoun = matchedModifiers.some((mod) => {
      const escapedMod = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`\\b${escapedMod}\\s+([a-z][a-z0-9'-]{2,})\\b`, 'i').exec(
        effectiveDeclaration,
      );
      if (m === null) {
        return false;
      }
      const followingWord = m[1]!.toLowerCase();
      return !tokens.includes(followingWord);
    });
    if (followedByDifferentNoun) {
      return {
        score: 0,
        exactPhraseMatch: false,
        headNounMatch: false,
        secondaryNounMatches: 0,
        modifierMatches: 0,
        baseLabel,
        headNoun,
      };
    }
  }

  let score = 0;
  if (exactPhraseMatch) {
    score += 100;
  }
  if (headNounMatch) {
    score += 45;
  }
  score += secondaryNounMatches * 15;
  score += modifierMatches * 3;

  return {
    score,
    exactPhraseMatch,
    headNounMatch,
    secondaryNounMatches,
    modifierMatches,
    baseLabel,
    headNoun,
  };
}

export function rankInteractablesByDeclaration(
  runtime: StoredMapRuntime,
  declaration: string,
): ReadonlyArray<{
  readonly objectId: string;
  readonly label: string;
  readonly baseLabel: string;
  readonly score: number;
  readonly headNounMatch: boolean;
}> {
  const active = activeSceneInstance(runtime);
  if (active === null) {
    return [];
  }
  const { primaryClause } = splitPrimaryTargetFromLocative(declaration);
  const effectiveDeclaration = primaryClause.trim().length > 0 ? primaryClause : declaration;
  if (
    declarationIsDoorOpenOrPassage(effectiveDeclaration) ||
    declarationNegatesDoorOpen(effectiveDeclaration)
  ) {
    return [];
  }
  const text = effectiveDeclaration.toLowerCase();
  const interactable = active.features.filter(
    (feature) =>
      feature.interactable &&
      feature.objectKind !== 'npc' &&
      feature.objectKind !== 'creature' &&
      feature.objectKind !== 'exit',
  );

  const rawScores = interactable.map((feature) => {
    const labelScore = scoreFeatureLabelMatch(declaration, feature.label);
    return { feature, labelScore };
  });

  const anyHeadOrSecondaryNounMatched = rawScores.some(
    (entry) => entry.labelScore.headNounMatch || entry.labelScore.secondaryNounMatches > 0,
  );

  const wantsOpenState =
    /\b(?:the|an|that|this)\s+(?:open|opened|unlocked|unsealed)\s+[a-z]/i.test(text) ||
    /\b(?:loot|search|inspect|examine|check|empty)\s+(?:the\s+)?(?:open|opened|unlocked)\b/i.test(
      text,
    );
  const wantsClosedOrLockedState =
    /\b(?:the|a|that|this)\s+(?:closed|locked|sealed|shut|unopened)\s+[a-z]/i.test(text) ||
    /\b(?:open|unlock|unseal|inspect|examine|pry|force)\s+(?:the\s+)?(?:closed|locked|sealed|unopened)\b/i.test(
      text,
    );
  const isOpenOrUnlockVerb = /^\s*(?:i\s+|we\s+)?(?:open|unlock|unseal|unlatch|pry|force)\b/i.test(
    text,
  );
  const isLootOrTakeVerb = /^\s*(?:i\s+|we\s+)?(?:loot|empty|take|grab|collect|claim)\b/i.test(
    text,
  );
  const wantsWest = /\b(?:west|western|left)\b/i.test(text);
  const wantsEast = /\b(?:east|eastern|right)\b/i.test(text);
  const midCol = Math.floor(active.columns / 2);

  const ranked = rawScores
    .map(({ feature, labelScore }) => {
      // If another feature in the scene matched its head/secondary noun, discard modifier-only matches.
      if (
        anyHeadOrSecondaryNounMatched &&
        !labelScore.headNounMatch &&
        labelScore.secondaryNounMatches === 0
      ) {
        return {
          objectId: feature.objectId,
          label: feature.label,
          baseLabel: labelScore.baseLabel,
          score: 0,
          headNounMatch: false,
        };
      }

      let score = labelScore.score;
      const kind = feature.objectKind;

      // Category-level bonuses only apply when no other feature matched by head noun,
      // or when this feature itself matched a noun token.
      if (!anyHeadOrSecondaryNounMatched) {
        if (
          kind === 'light' &&
          /\b(extinguish|douse|snuff|put out|relight|ignite|kindle|light the|lamp|lantern|torch|cresset|hearth|sconce)\b/.test(
            text,
          )
        ) {
          score += 8;
        } else if (
          kind === 'lever' &&
          /\b(lever|switch|winch|crank|valve|mechanism)\b/.test(text)
        ) {
          score += 8;
        } else if (
          (kind === 'hazard' || kind === 'trap') &&
          /\b(trap|tripwire|bramble|hazard|disarm)\b/.test(text)
        ) {
          score += 8;
        }
      } else if (labelScore.headNounMatch || labelScore.secondaryNounMatches > 0) {
        if (kind === 'light' && /\b(lamp|lantern|light|torch|cresset|hearth|sconce)\b/.test(text)) {
          score += 4;
        }
        if (
          kind === 'container' &&
          /\b(crate|chest|box|counter|workbench|freight|satchel|coffer|trunk)\b/.test(text)
        ) {
          score += 4;
        }
        if (
          kind === 'lever' &&
          /\b(lever|switch|pull|flip|toggle|winch|crank|valve|mechanism)\b/.test(text)
        ) {
          score += 4;
        }
      }

      if (score > 0) {
        const isClosedOrLocked =
          feature.state === 'closed' ||
          feature.state === 'locked' ||
          feature.lockState === 'locked';
        if (wantsOpenState) {
          if (feature.state === 'open' || feature.state === 'unlocked') {
            score += 50;
          } else if (isClosedOrLocked) {
            score = Math.max(1, score - 40);
          }
        } else if (wantsClosedOrLockedState) {
          if (isClosedOrLocked) {
            score += 50;
          } else if (feature.state === 'open') {
            score = Math.max(1, score - 40);
          }
        } else if (isOpenOrUnlockVerb && kind === 'container') {
          if (isClosedOrLocked) {
            score += 25;
          }
        } else if (isLootOrTakeVerb && kind === 'container') {
          if (feature.state === 'open') {
            score += 35;
          }
        }

        if (wantsWest && !wantsEast && feature.column < midCol) {
          score += 30;
        } else if (wantsEast && !wantsWest && feature.column >= midCol) {
          score += 30;
        }
      }

      return {
        objectId: feature.objectId,
        label: feature.label,
        baseLabel: labelScore.baseLabel,
        score,
        headNounMatch: labelScore.headNounMatch,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked;
}

export function matchTakeContainerByDeclaration(
  runtime: StoredMapRuntime,
  declaration: string,
): string | null {
  const active = activeSceneInstance(runtime);
  if (active === null) {
    return null;
  }
  const portable = active.features.filter(isPortableSceneContainer);
  if (portable.length === 0) {
    return null;
  }
  const scored = portable
    .map((feature) => {
      const match = scoreFeatureLabelMatch(declaration, feature.label);
      return { objectId: feature.objectId, score: match.score, headNounMatch: match.headNounMatch };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const anyHeadMatch = scored.some((s) => s.headNounMatch);
  const filtered = anyHeadMatch ? scored.filter((s) => s.headNounMatch) : scored;
  if (filtered[0] !== undefined) {
    return filtered[0].objectId;
  }
  // Single portable container/prop + pronoun take language ("take it", "pick it up"),
  // never when the player names a different noun (such as a trail, NPC item, or chest item).
  const namesFurnitureContainer =
    HEAVY_FIXTURE_LABEL.test(declaration) &&
    !labelLooksPortableContainer(declaration) &&
    !labelLooksPortableSceneProp(declaration);
  if (
    portable.length === 1 &&
    !namesFurnitureContainer &&
    /\b(?:take|grab|pocket|stow|carry|lift|pick(?:ing|ed)?\s+up)\s+(?:it|that|this)\b/i.test(
      declaration,
    )
  ) {
    return portable[0]!.objectId;
  }
  return null;
}

export function takeScenePropRuntime(options: {
  readonly runtime: StoredMapRuntime;
  readonly objectId: string;
}): {
  readonly runtime: StoredMapRuntime;
  readonly chronicle: string;
  readonly label: string;
  readonly objectId: string;
  readonly equipmentName: string;
} {
  const active = activeSceneInstance(options.runtime);
  if (active === null) {
    throw new Error('NO_ACTIVE_SCENE');
  }
  const feature = active.features.find((entry) => entry.objectId === options.objectId);
  if (feature === undefined) {
    throw new Error('OBJECT_NOT_FOUND');
  }
  if (!isPortableSceneContainer(feature)) {
    throw new Error('OBJECT_NOT_PORTABLE');
  }
  const runtime = removeSceneObject({
    runtime: options.runtime,
    objectId: options.objectId,
  });
  if (runtime === null) {
    throw new Error('OBJECT_NOT_FOUND');
  }
  const rawBase = stripFeatureStateSuffix(feature.label) || feature.label.trim();
  const baseLabel =
    rawBase.length > 0 ? rawBase.charAt(0).toUpperCase() + rawBase.slice(1) : rawBase;
  return {
    runtime,
    chronicle: `${baseLabel} is stowed in inventory and leaves the scene.`,
    label: baseLabel,
    objectId: options.objectId,
    equipmentName: baseLabel,
  };
}

export function matchInteractableByDeclaration(
  runtime: StoredMapRuntime,
  declaration: string,
): string | null {
  const ranked = rankInteractablesByDeclaration(runtime, declaration);
  return ranked[0]?.objectId ?? null;
}
