/**
 * Mutable tactical runtime for a campaign map (token anchors, doors, explored).
 *
 * Stored beside the table projection so movement commits stay server-authored.
 * Batch 2: Director scene instances stack here for establish / travel / return.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type {
  DoorState,
  MapCellRecord,
  MapEdgeRecord,
  MapReferenceMarkerKind,
  MapSquareCoordinate,
} from '../../shared/map-contract.js';
import { squareId } from '../../shared/map-contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import type {
  SceneEnvironment,
  SceneLighting,
  SceneObjectKind,
  SceneObjectState,
  ScenePurpose,
} from './scene-composition.js';

export interface StoredTokenPosition {
  readonly seatId: string;
  readonly column: number;
  readonly row: number;
}

export interface StoredSceneFeature {
  readonly objectId: string;
  readonly column: number;
  readonly row: number;
  readonly label: string;
  readonly referenceKind: MapReferenceMarkerKind;
  readonly objectKind: SceneObjectKind;
  readonly state: SceneObjectState;
  readonly interactable: boolean;
}

export interface StoredSceneExit {
  readonly exitId: string;
  readonly label: string;
  readonly destinationHint: string;
  readonly returnToSceneId?: string | null;
}

export interface StoredSceneInstance {
  readonly sceneId: string;
  readonly templateId: string;
  readonly title: string;
  readonly sceneBanner: string;
  readonly purpose: ScenePurpose;
  readonly environment: SceneEnvironment;
  readonly lighting: SceneLighting;
  readonly mood: string;
  /** Sensory establishment line from the scene contract. */
  readonly description?: string;
  readonly columns: number;
  readonly rows: number;
  readonly cells: readonly MapCellRecord[];
  readonly edges: readonly MapEdgeRecord[];
  readonly features: readonly StoredSceneFeature[];
  readonly doorStates: Record<string, DoorState>;
  readonly spawn: MapSquareCoordinate;
  readonly exits: readonly StoredSceneExit[];
  /** Actor object ids that must remain visible on the tactical map. */
  readonly inhabitantObjectIds?: readonly string[];
  readonly tokenPositions: StoredTokenPosition[];
  readonly exploredByAccount: Record<string, string[]>;
  readonly revision: number;
}

export interface StoredMapRuntime {
  readonly campaignId: string;
  readonly tokenPositions: StoredTokenPosition[];
  /** edgeId → door state overrides for mutable doors */
  readonly doorStates: Record<string, DoorState>;
  /** Player-confirmed improvised walls/doors on blank tables (PQA-145). */
  readonly runtimeEdges?: readonly MapEdgeRecord[];
  /** Optional title override after scene construction. */
  readonly sceneTitle?: string | null;
  /** accountId → explored square ids */
  readonly exploredByAccount: Record<string, string[]>;
  /** Director-authored multi-scene loop (Batch 2). */
  readonly activeSceneId?: string | null;
  readonly sceneInstances?: Record<string, StoredSceneInstance>;
  /** Prior scene ids; last entry is the most recent left-behind scene. */
  readonly sceneStack?: readonly string[];
  readonly adventureStarted?: boolean;
  readonly premiseKey?: string | null;
}

export function emptyMapRuntime(campaignId: string): StoredMapRuntime {
  return {
    campaignId,
    tokenPositions: [],
    doorStates: {},
    runtimeEdges: [],
    sceneTitle: null,
    exploredByAccount: {},
    activeSceneId: null,
    sceneInstances: {},
    sceneStack: [],
    adventureStarted: false,
    premiseKey: null,
  };
}

export async function loadMapRuntime(
  firestore: Firestore,
  campaignId: string,
): Promise<StoredMapRuntime> {
  const snap = await firestore.collection(COLLECTIONS.campaignTableProjections).doc(campaignId).get();
  if (!snap.exists) {
    return emptyMapRuntime(campaignId);
  }
  const data = snap.data() as Partial<StoredMapRuntime> & { campaignId?: string };
  return {
    campaignId,
    tokenPositions: Array.isArray(data.tokenPositions) ? data.tokenPositions : [],
    doorStates: data.doorStates ?? {},
    runtimeEdges: Array.isArray(data.runtimeEdges) ? data.runtimeEdges : [],
    sceneTitle: typeof data.sceneTitle === 'string' ? data.sceneTitle : null,
    exploredByAccount: data.exploredByAccount ?? {},
    activeSceneId: typeof data.activeSceneId === 'string' ? data.activeSceneId : null,
    sceneInstances:
      data.sceneInstances && typeof data.sceneInstances === 'object' ? data.sceneInstances : {},
    sceneStack: Array.isArray(data.sceneStack) ? data.sceneStack : [],
    adventureStarted: data.adventureStarted === true,
    premiseKey: typeof data.premiseKey === 'string' ? data.premiseKey : null,
  };
}

export function mergeExplored(
  existing: readonly string[] | undefined,
  squares: readonly MapSquareCoordinate[],
): string[] {
  const set = new Set(existing ?? []);
  for (const square of squares) {
    set.add(squareId(square.column, square.row));
  }
  return [...set].sort();
}

export function upsertTokenPosition(
  positions: readonly StoredTokenPosition[],
  seatId: string,
  anchor: MapSquareCoordinate,
): StoredTokenPosition[] {
  const next = positions.filter((entry) => entry.seatId !== seatId);
  next.push({ seatId, column: anchor.column, row: anchor.row });
  return next;
}

export function activeSceneInstance(
  runtime: StoredMapRuntime,
): StoredSceneInstance | null {
  const id = runtime.activeSceneId;
  if (id === null || id === undefined || id.length === 0) {
    return null;
  }
  return runtime.sceneInstances?.[id] ?? null;
}
