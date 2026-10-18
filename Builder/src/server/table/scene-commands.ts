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
import { labelLooksPortableContainer } from '../../shared/container-contents.js';
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
  const kind: SceneComposeKind =
    room.templateId === 'starter_crypt_sanctum'
      ? 'landmark'
      : room.templateId === 'starter_trail_crossroads'
        ? 'exterior'
        : 'interior';
  const composed = composeDirectorScene({
    kind,
    sceneId: room.sceneId,
    premise: `${room.title} — ${room.summary}`,
    destinationHint: room.title,
    seedKey: `${campaignId}:${room.sceneId}:${room.title}`,
  });
  const squares: { column: number; row: number }[] = [];
  for (let row = composed.spawn.row - 2; row <= composed.spawn.row + 2; row += 1) {
    for (let column = composed.spawn.column - 2; column <= composed.spawn.column + 2; column += 1) {
      if (column >= 0 && row >= 0) {
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
        }))
      : composed.exits;
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
    cells: composed.cells,
    edges: composed.edges,
    features: composed.features.map((feature) => ({
      ...feature,
      label: featureLabelWithState(feature),
    })),
    doorStates: { ...composed.doorStates },
    spawn: composed.spawn,
    exits,
    inhabitantObjectIds: [...composed.inhabitantObjectIds],
    tokenPositions,
    exploredByAccount,
    revision: 1,
    sceneArtUrl: room.sceneArtUrl ?? resolveSceneArtUrl(room.templateId),
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
}): StoredMapRuntime {
  const sceneInstances: Record<string, StoredSceneInstance> = {};
  for (const milestone of options.blueprint.milestones ?? []) {
    for (const room of milestone.rooms) {
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
  const data = snap.data() as { summary?: string; name?: string };
  const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
  if (summary.length > 0) {
    return summary;
  }
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  return name.length > 0 ? name : 'an unfolding adventure';
}

function instanceToComposed(prior: NonNullable<ReturnType<typeof activeSceneInstance>>): ComposedScene {
  return {
    sceneId: prior.sceneId,
    templateId: prior.templateId,
    title: prior.title,
    sceneBanner: prior.sceneBanner,
    purpose: prior.purpose,
    environment: prior.environment,
    lighting: prior.lighting,
    mood: prior.mood,
    description: prior.description ?? prior.mood,
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

export function interactObjectRuntime(options: {
  readonly runtime: StoredMapRuntime;
  readonly objectId: string;
  readonly declaration: string;
}): {
  readonly runtime: StoredMapRuntime;
  readonly chronicle: string;
  readonly label: string;
  readonly priorState: string;
  readonly nextState: string;
  readonly objectId: string;
  readonly baseLabel: string;
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
  const baseLabel = feature.label.replace(/\s*\([^)]+\)\s*$/, '').trim();
  const labeled = featureLabelWithState({ ...feature, state: next });
  const runtime = updateSceneObjectState({
    runtime: options.runtime,
    objectId: options.objectId,
    nextState: next,
    labelWithState: labeled,
  });
  if (runtime === null) {
    throw new Error('NO_ACTIVE_SCENE');
  }
  const scene = instanceToComposed(activeSceneInstance(runtime)!);
  return {
    runtime,
    chronicle: directorNarrationBeat('interact', {
      scene,
      objectLabel: baseLabel,
      objectState: next,
    }),
    label: labeled,
    priorState,
    nextState: next,
    objectId: options.objectId,
    baseLabel,
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

export function travelSceneRuntime(options: {
  readonly runtime: StoredMapRuntime;
  readonly campaignId: string;
  readonly accountId: string;
  readonly destinationHint: string;
  readonly returnToPrevious?: boolean;
  readonly seatTokens?: readonly StoredTokenPosition[];
  readonly partyXp?: number;
  readonly requiredXpThreshold?: number;
}): {
  readonly runtime: StoredMapRuntime;
  readonly composed: ComposedScene | null;
  readonly chronicle: string;
  readonly xpAwarded?: number;
} {
  const active = activeSceneInstance(options.runtime);
  if (active === null) {
    throw new Error('NO_ACTIVE_SCENE');
  }
  const returnToPrevious = options.returnToPrevious === true;
  const seatTokens = options.seatTokens ?? active.tokenPositions;

  // Check if the current scene has a pre-forged multi-map graph exit target.
  const graphTargetId = resolveGraphTargetExit(
    active,
    options.destinationHint,
    returnToPrevious,
  );
  if (graphTargetId !== null && options.runtime.sceneInstances?.[graphTargetId] !== undefined) {
    let targetScene = options.runtime.sceneInstances[graphTargetId]!;
    let redirectedNote = '';
    if (
      targetScene.isMilestoneClimax === true &&
      options.partyXp !== undefined &&
      options.requiredXpThreshold !== undefined &&
      options.partyXp < options.requiredXpThreshold
    ) {
      const unvisitedSideRoom = Object.values(options.runtime.sceneInstances).find(
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
      ...(options.runtime.sceneInstances ?? {}),
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
      })}${redirectedNote}`,
      xpAwarded,
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
  return feature.objectKind === 'container' && labelLooksPortableContainer(feature.label);
}

/** Match a portable container prop for inventory take (courier satchel, pack, bag, pouch). */
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
  const text = declaration.toLowerCase();
  const scored = portable
    .map((feature) => {
      const label = feature.label.toLowerCase();
      let score = 0;
      if (
        label
          .split(/\s+/)
          .some((word) => word.length > 2 && declarationMentionsLabelWord(declaration, word))
      ) {
        score += 3;
      }
      if (/\b(?:courier\s+satchel|satchel)\b/.test(text) && /\bsatchel\b/.test(label)) {
        score += 4;
      }
      if (/\b(?:pack|bag|pouch)\b/.test(text) && /\b(?:pack|bag|pouch)\b/.test(label)) {
        score += 3;
      }
      return { objectId: feature.objectId, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored[0] !== undefined) {
    return scored[0].objectId;
  }
  // Single portable container + take language, but not when naming furniture crates/chests.
  const namesFurnitureContainer =
    /\b(?:crate|crates|chest|box|barrel|urn|freight)\b/i.test(declaration) &&
    !labelLooksPortableContainer(declaration);
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
  const baseLabel = feature.label.replace(/\s*[—(].*$/, '').trim() || feature.label.trim();
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
  const active = activeSceneInstance(runtime);
  if (active === null) {
    return null;
  }
  // Doorway open/passage language is door authority — never fuzzy-match props
  // (e.g. "wood" from "Wood pile" inside "wooden doorway").
  if (
    declarationIsDoorOpenOrPassage(declaration) ||
    declarationNegatesDoorOpen(declaration)
  ) {
    return null;
  }
  const text = declaration.toLowerCase();
  const interactable = active.features.filter((feature) => feature.interactable);
  if (
    /\b(extinguish|douse|snuff|put out|relight|ignite|kindle|light the|lamp|lantern|torch|cresset|hearth)\b/.test(
      text,
    )
  ) {
    const light = interactable.find((feature) => feature.objectKind === 'light');
    if (light !== undefined) {
      return light.objectId;
    }
  }
  const scored = interactable
    .map((feature) => {
      const label = feature.label.toLowerCase();
      const kind = feature.objectKind;
      let score = 0;
      // Word-boundary only — "wood" must not hit inside "wooden".
      if (
        label
          .split(/\s+/)
          .some((word) => declarationMentionsLabelWord(declaration, word))
      ) {
        score += 3;
      }
      if (kind === 'light' && /\b(lamp|lantern|light|torch|cresset|hearth|sconce)\b/.test(text)) {
        score += 4;
      }
      if (
        kind === 'cover' &&
        /\b(rubble|bench|crate|debris|log|cart|wood|masonry|parapet|span|plinth)\b/.test(text) &&
        !/\b(?:door|doorway|gate|entry(?:way)?)\b/.test(text)
      ) {
        score += 4;
      }
      if (
        kind === 'container' &&
        /\b(crate|chest|box|counter|workbench|freight)\b/.test(text)
      ) {
        score += 4;
      }
      if (kind === 'hazard' && /\b(trap|tripwire|bramble|hazard|disarm|stones)\b/.test(text)) {
        score += 4;
      }
      if (
        kind === 'prop' &&
        /\b(shutter|window|niche|painter|skiff|rope|bridge|arrow-loop|loop)\b/.test(text)
      ) {
        score += 3;
      }
      if (/\b(extinguish|douse|light|break|smash|move|open|close|disarm)\b/.test(text)) {
        score += 1;
      }
      return { objectId: feature.objectId, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.objectId ?? null;
}
