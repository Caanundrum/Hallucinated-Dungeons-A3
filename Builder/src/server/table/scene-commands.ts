/**
 * Director scene loop command helpers (Batch 2 + Batch 3 coherence).
 */

import type { Firestore } from 'firebase-admin/firestore';

import type {
  CampaignBlueprint,
  CampaignRoomBlueprint,
} from '../../shared/campaign-contract.js';
import { resolveSceneArtUrl } from '../../shared/map-contract.js';
import {
  declarationIsDoorOpenOrPassage,
  declarationMentionsLabelWord,
  declarationNegatesDoorOpen,
} from '../../shared/resolved-action-receipt.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import {
  composeDirectorScene,
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

export function buildStoredSceneFromRoomBlueprint(
  room: CampaignRoomBlueprint,
  campaignId: string,
  options?: {
    readonly accountIds?: readonly string[];
    readonly seatTokens?: readonly StoredTokenPosition[];
    readonly visited?: boolean;
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
  const composePremise = isPassageRoom
    ? 'crypt catacomb subterranean stone passage'
    : room.summary;
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
  const exits =
    room.exits.length > 0
      ? room.exits.map((exit, idx) => ({
          exitId: `${room.sceneId}-exit-${idx + 1}`,
          label: exit.edgeLabel,
          destinationHint: exit.edgeLabel,
          targetSceneId: exit.targetSceneId,
          ...(exit.lockState !== undefined ? { lockState: exit.lockState } : {}),
          ...(exit.keyItemId !== undefined ? { keyItemId: exit.keyItemId } : {}),
          ...(exit.lockpickDC !== undefined ? { lockpickDC: exit.lockpickDC } : {}),
          ...(exit.breakDC !== undefined ? { breakDC: exit.breakDC } : {}),
        }))
      : composed.exits;
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
      requiredKeys.add(keyItemId);
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
      if (feature.objectKind === 'container') {
        const defaultContents =
          feature.contents && feature.contents.length > 0
            ? [...feature.contents]
            : ['Silver Signet Ring', 'Healing Draught'];
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
  const structuredProps = room.structuredProps ?? [];
  structuredProps.forEach((prop, index) => {
    const cleanLabel = prop.label.trim();
    if (cleanLabel.length === 0) return;
    const alreadyExists = baseFeatures.some(
      (f) => f.label.toLowerCase().includes(cleanLabel.toLowerCase()),
    );
    if (alreadyExists) {
      for (let i = 0; i < baseFeatures.length; i += 1) {
        const f = baseFeatures[i]!;
        if (f.label.toLowerCase().includes(cleanLabel.toLowerCase())) {
          if (prop.lockState === 'locked' && prop.keyItemId) {
            requiredKeys.add(prop.keyItemId);
          }
          baseFeatures[i] = {
            ...f,
            objectKind: prop.objectKind,
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
    if (isLocked && keyItemId) {
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
    const col = Math.max(
      1,
      Math.min(composed.columns - 2, composed.spawn.column + 1 + (index % 2)),
    );
    const row = Math.max(
      1,
      Math.min(composed.rows - 2, composed.spawn.row + (index % 2 === 0 ? -1 : 1)),
    );
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
      ...(prop.targetEdgeOrObjectId !== undefined
        ? { targetEdgeOrObjectId: prop.targetEdgeOrObjectId }
        : {}),
    };
    baseFeatures.push(feature);
  });

  // Also ensure any plain string props in room.props are represented on baseFeatures.
  room.props.forEach((rawProp, index) => {
    const clean = rawProp.trim();
    if (clean.length === 0) return;
    const alreadyExists = baseFeatures.some((f) =>
      f.label.toLowerCase().includes(clean.toLowerCase()),
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

  return {
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
    features: baseFeatures,
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

export function sanitizePlayerFacingSceneText(text: string): string {
  return text
    .replace(/^Entry threshold for Milestone \d+\s*(?:\([^)]*\))?\.\s*/i, '')
    .replace(/Investigation and side-trek hall beyond the/i, 'A shadowed passage beyond the cellar stairs and connecting doorway')
    .replace(/beyond the wooden door\b/i, 'beyond the cellar stairs and connecting doorway')
    .replace(/\s*Clues and hazards test the party before the Milestone \d+ climax\./i, ' Hidden clues and lurking hazards guard the way forward.')
    .replace(/^Climax chamber for Milestone \d+\.\s*Resolving the threat here elevates the party to Level \d+\./i, 'The inner sanctum, where ancient stonework and flickering braziers frame the heart of the danger.')
    .trim();
}

function instanceToComposed(prior: NonNullable<ReturnType<typeof activeSceneInstance>>): ComposedScene {
  const cleanedBanner = sanitizePlayerFacingSceneText(prior.sceneBanner);
  const cleanedDescription = sanitizePlayerFacingSceneText(prior.description ?? prior.mood);
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
  const next = nextObjectState(feature, options.declaration);
  if (next === null || next === feature.state) {
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
  const lootedItems =
    feature.objectKind === 'container' && next === 'open'
      ? [...(feature.contents ?? [])]
      : [];
  const nextLockState =
    isLocked && (next === 'open' || next === 'broken') ? ('unlocked' as const) : feature.lockState;
  const baseLabel = feature.label.replace(/\s*\([^)]+\)\s*$/, '').trim();
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
    ...(feature.objectKind === 'container' && next === 'open' ? { contents: [] } : {}),
  });
  if (runtime === null) {
    throw new Error('NO_ACTIVE_SCENE');
  }
  // If a lever/switch with targetEdgeOrObjectId is pulled, unlock/open its target edge or container.
  if (
    feature.objectKind === 'lever' &&
    (next === 'pulled' || next === 'active' || next === 'open') &&
    typeof feature.targetEdgeOrObjectId === 'string' &&
    feature.targetEdgeOrObjectId.length > 0
  ) {
    const targetId = feature.targetEdgeOrObjectId;
    const updatedActive = activeSceneInstance(runtime);
    if (updatedActive !== null) {
      const targetEdge = updatedActive.edges.find((edge) => edge.edgeId === targetId);
      if (targetEdge !== undefined) {
        const nextDoors = {
          ...runtime.doorStates,
          [targetId]: 'open' as const,
        };
        runtime = {
          ...runtime,
          doorStates: nextDoors,
          sceneInstances: {
            ...runtime.sceneInstances,
            [updatedActive.sceneId]: {
              ...updatedActive,
              doorStates: { ...updatedActive.doorStates, [targetId]: 'open' },
            },
          },
        };
      } else {
        const targetObj = updatedActive.features.find((f) => f.objectId === targetId);
        if (targetObj !== undefined) {
          const unlockedLabel = featureLabelWithState({
            ...targetObj,
            state: 'unlocked',
            lockState: 'unlocked',
          });
          const afterTarget = updateSceneObjectState({
            runtime,
            objectId: targetId,
            nextState: 'unlocked',
            labelWithState: unlockedLabel,
            lockState: 'unlocked',
          });
          if (afterTarget !== null) {
            runtime = afterTarget;
          }
        }
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
  const lootClause =
    lootedItems.length > 0 ? ` Looted into inventory: ${lootedItems.join(', ')}.` : '';
  return {
    runtime,
    chronicle: `${baseBeat}${keyClause}${lootClause}`,
    label: labeled,
    priorState,
    nextState: next,
    objectId: options.objectId,
    baseLabel,
    lootedItems,
    ...(unlockedWithKey !== undefined ? { unlockedWithKey } : {}),
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
      ? active.features.find((f) => f.objectId === options.objectId)
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
  if (returnToPrevious || /\breturn|go back|head back|retreat\b/i.test(destinationHint)) {
    const backExit = active.exits.find(
      (exit) =>
        typeof exit.targetSceneId === 'string' &&
        (/\b(return|back)\b/i.test(exit.label) || exit.exitId.endsWith('-back')),
    );
    return backExit?.targetSceneId ?? null;
  }
  const graphExits = active.exits.filter(
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
  }
  if (returnToPrevious) {
    const stack = runtime.sceneStack ?? [];
    const lastId = stack[stack.length - 1];
    if (lastId !== undefined && runtime.sceneInstances?.[lastId] !== undefined) {
      return runtime.sceneInstances[lastId]!.title;
    }
  }
  const matchedExit = matchPresentedExit(active.exits, destinationHint);
  if (matchedExit !== null && matchedExit.destinationHint.trim().length > 0) {
    return matchedExit.destinationHint.trim();
  }
  return null;
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

  const headNoun = tokens[tokens.length - 1]!;
  const prefixTokens = tokens.slice(0, -1);
  const exactPhraseMatch =
    baseLower.length >= 3 &&
    new RegExp(`\\b${baseLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(declaration);
  const headNounMatch = declarationMentionsLabelWord(declaration, headNoun);

  let secondaryNounMatches = 0;
  let modifierMatches = 0;
  for (const tok of prefixTokens) {
    if (!declarationMentionsLabelWord(declaration, tok)) {
      continue;
    }
    if (COMMON_MODIFIER_ADJECTIVES.has(tok)) {
      modifierMatches += 1;
    } else {
      secondaryNounMatches += 1;
    }
  }

  // If a multi-word feature ONLY matched a leading modifier adjective (e.g., "sealed" or "iron")
  // and its head noun is NOT in the declaration, check whether the declaration followed that
  // modifier with a different noun ("sealed <other-noun>"). If so, this feature is a modifier
  // collision and must score 0.
  if (!exactPhraseMatch && !headNounMatch && secondaryNounMatches === 0 && modifierMatches > 0) {
    const matchedModifiers = prefixTokens.filter(
      (tok) => COMMON_MODIFIER_ADJECTIVES.has(tok) && declarationMentionsLabelWord(declaration, tok),
    );
    const followedByDifferentNoun = matchedModifiers.some((mod) => {
      const escapedMod = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`\\b${escapedMod}\\s+([a-z][a-z0-9'-]{2,})\\b`, 'i').exec(declaration);
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
  if (
    declarationIsDoorOpenOrPassage(declaration) ||
    declarationNegatesDoorOpen(declaration)
  ) {
    return [];
  }
  const text = declaration.toLowerCase();
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
  // Single portable container/prop + take language, but not when naming furniture crates/chests.
  const namesFurnitureContainer =
    HEAVY_FIXTURE_LABEL.test(declaration) &&
    !labelLooksPortableContainer(declaration) &&
    !labelLooksPortableSceneProp(declaration);
  if (
    portable.length === 1 &&
    !namesFurnitureContainer &&
    /\b(?:take|grab|pocket|stow|carry|lift|pick(?:ing|ed)?\s+up)\b/i.test(declaration)
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
