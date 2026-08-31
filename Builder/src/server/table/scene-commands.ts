/**
 * Director scene loop command helpers (Batch 2 + Batch 3 coherence).
 */

import type { Firestore } from 'firebase-admin/firestore';

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
  applyComposedSceneToRuntime,
  updateSceneObjectState,
} from './scene-runtime.js';
import {
  activeSceneInstance,
  type StoredMapRuntime,
  type StoredTokenPosition,
} from './map-runtime.js';

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
  return {
    runtime,
    composed,
    chronicle: directorNarrationBeat('establish', { scene: composed }),
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
  readonly nextState: string;
} {
  const active = activeSceneInstance(options.runtime);
  if (active === null) {
    throw new Error('NO_ACTIVE_SCENE');
  }
  const feature = active.features.find((entry) => entry.objectId === options.objectId);
  if (feature === undefined || !feature.interactable) {
    throw new Error('OBJECT_NOT_INTERACTABLE');
  }
  const next = nextObjectState(feature, options.declaration);
  if (next === null || next === feature.state) {
    throw new Error('OBJECT_STATE_UNCHANGED');
  }
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
      objectLabel: feature.label.replace(/\s*\([^)]+\)\s*$/, '').trim(),
      objectState: next,
    }),
    label: labeled,
    nextState: next,
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

export function travelSceneRuntime(options: {
  readonly runtime: StoredMapRuntime;
  readonly campaignId: string;
  readonly accountId: string;
  readonly destinationHint: string;
  readonly returnToPrevious: boolean;
  readonly seatTokens: readonly StoredTokenPosition[];
}): { readonly runtime: StoredMapRuntime; readonly composed: ComposedScene | null; readonly chronicle: string } {
  const active = activeSceneInstance(options.runtime);
  if (active === null) {
    throw new Error('NO_ACTIVE_SCENE');
  }
  const inferred = inferTravelKind(
    options.runtime,
    options.destinationHint,
    options.returnToPrevious,
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
      seatTokens: options.seatTokens,
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
    seatTokens: options.seatTokens,
  });
  return {
    runtime,
    composed,
    chronicle: directorNarrationBeat('travel', {
      scene: composed,
      priorTitle: active.title,
    }),
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
      if (label.split(/\s+/).some((word) => word.length > 3 && text.includes(word))) {
        score += 3;
      }
      if (kind === 'light' && /\b(lamp|lantern|light|torch|cresset|hearth|sconce)\b/.test(text)) {
        score += 4;
      }
      if (
        kind === 'cover' &&
        /\b(rubble|bench|crate|debris|log|cart|wood|masonry|parapet|span|plinth)\b/.test(text)
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
