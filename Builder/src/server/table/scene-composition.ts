/**
 * Deterministic Director scene composition from reusable primitives.
 *
 * Templates produce authoritative cells/edges/features. Premise keywords and
 * destination hints select templates — never a single Quiet-chamber hardcode,
 * and never a fixed Interior A → Road B → Encounter C script.
 */

import {
  edgeId,
  type DoorState,
  type MapCellRecord,
  type MapEdgeRecord,
  type MapReferenceMarkerKind,
  type MapSquareCoordinate,
} from '../../shared/map-contract.js';

export const SCENE_PURPOSES = [
  'exploration',
  'travel',
  'encounter',
  'social',
  'hazard',
  'rest',
] as const;
export type ScenePurpose = (typeof SCENE_PURPOSES)[number];

export const SCENE_ENVIRONMENTS = [
  'stone_interior',
  'wood_interior',
  'forest_path',
  'village_street',
  'marsh_trail',
  'hill_clearing',
] as const;
export type SceneEnvironment = (typeof SCENE_ENVIRONMENTS)[number];

export const SCENE_LIGHTING = ['torchlit', 'dim', 'daylight', 'overcast', 'dusk'] as const;
export type SceneLighting = (typeof SCENE_LIGHTING)[number];

export const SCENE_OBJECT_KINDS = [
  'light',
  'cover',
  'container',
  'hazard',
  'prop',
  'creature',
  'npc',
] as const;
export type SceneObjectKind = (typeof SCENE_OBJECT_KINDS)[number];

/** Player-visible object states for reusable primitives. */
export const SCENE_OBJECT_STATES = [
  'lit',
  'unlit',
  'intact',
  'broken',
  'open',
  'closed',
  'active',
  'disarmed',
  'present',
] as const;
export type SceneObjectState = (typeof SCENE_OBJECT_STATES)[number];

export interface ComposedSceneFeature {
  readonly objectId: string;
  readonly column: number;
  readonly row: number;
  readonly label: string;
  readonly referenceKind: MapReferenceMarkerKind;
  readonly objectKind: SceneObjectKind;
  readonly state: SceneObjectState;
  readonly interactable: boolean;
}

export interface ComposedSceneExit {
  readonly exitId: string;
  readonly label: string;
  readonly destinationHint: string;
  /** Prefer restoring this scene id when returning. */
  readonly returnToSceneId?: string | null;
}

export interface ComposedScene {
  readonly sceneId: string;
  readonly templateId: string;
  readonly title: string;
  readonly sceneBanner: string;
  readonly purpose: ScenePurpose;
  readonly environment: SceneEnvironment;
  readonly lighting: SceneLighting;
  readonly mood: string;
  readonly columns: number;
  readonly rows: number;
  readonly cells: readonly MapCellRecord[];
  readonly edges: readonly MapEdgeRecord[];
  readonly features: readonly ComposedSceneFeature[];
  readonly spawn: MapSquareCoordinate;
  readonly exits: readonly ComposedSceneExit[];
  readonly doorStates: Record<string, DoorState>;
}

function perimeterCells(columns: number, rows: number, floor: string = 'floor'): MapCellRecord[] {
  const cells: MapCellRecord[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const border = row === 0 || column === 0 || row === rows - 1 || column === columns - 1;
      cells.push({
        column,
        row,
        terrain: border ? 'blocked' : floor === 'difficult' ? 'difficult' : 'floor',
        elevationFeet: 0,
        known: true,
      });
    }
  }
  return cells;
}

function setTerrain(
  cells: MapCellRecord[],
  column: number,
  row: number,
  terrain: 'floor' | 'difficult' | 'blocked',
): void {
  const index = cells.findIndex((cell) => cell.column === column && cell.row === row);
  if (index >= 0) {
    cells[index] = { ...cells[index]!, terrain, elevationFeet: 0, known: true };
  }
}

function eastDoorWall(
  wallColumn: number,
  doorRow: number,
  rowStart: number,
  rowEnd: number,
): { edges: MapEdgeRecord[]; doorEdgeId: string } {
  const edges: MapEdgeRecord[] = [];
  let doorEdgeId = '';
  for (let row = rowStart; row <= rowEnd; row += 1) {
    const kind = row === doorRow ? 'door' : 'wall';
    const id = edgeId(wallColumn, row, 'east');
    if (kind === 'door') {
      doorEdgeId = id;
    }
    edges.push({
      edgeId: id,
      column: wallColumn,
      row,
      orientation: 'east',
      kind,
      doorState: kind === 'door' ? 'closed' : null,
    });
  }
  return { edges, doorEdgeId };
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export type SceneComposeKind = 'interior' | 'exterior' | 'encounter' | 'return_hint';

function pickInteriorFamily(premise: string, seed: number): {
  templateId: string;
  title: string;
  environment: SceneEnvironment;
  lighting: SceneLighting;
  mood: string;
  lightLabel: string;
  coverLabel: string;
  poiLabel: string;
  poiKind: SceneObjectKind;
  poiRef: MapReferenceMarkerKind;
  poiState: SceneObjectState;
} {
  const text = premise.toLowerCase();
  if (/\b(inn|tavern|pub|alehouse)\b/.test(text)) {
    return {
      templateId: 'interior_inn_common',
      title: 'Warm inn common room',
      environment: 'wood_interior',
      lighting: 'torchlit',
      mood: 'Hearth smoke and low talk under timber beams.',
      lightLabel: 'Hearth lamp',
      coverLabel: 'Overturned bench',
      poiLabel: 'Service counter',
      poiKind: 'prop',
      poiRef: 'prop',
      poiState: 'intact',
    };
  }
  if (/\b(crypt|tomb|catacomb|grave)\b/.test(text)) {
    return {
      templateId: 'interior_stone_crypt',
      title: 'Stone crypt antechamber',
      environment: 'stone_interior',
      lighting: 'dim',
      mood: 'Cold stone and old incense cling to the air.',
      lightLabel: 'Wall cresset',
      coverLabel: 'Fallen masonry',
      poiLabel: 'Sealed niche',
      poiKind: 'prop',
      poiRef: 'prop',
      poiState: 'closed',
    };
  }
  if (/\b(workshop|forge|smith|tinker)\b/.test(text)) {
    return {
      templateId: 'interior_workshop',
      title: 'Cluttered workshop',
      environment: 'wood_interior',
      lighting: 'torchlit',
      mood: 'Oil, shavings, and a stubborn draft from the yard door.',
      lightLabel: 'Work lamp',
      coverLabel: 'Crate stack',
      poiLabel: 'Workbench',
      poiKind: 'container',
      poiRef: 'prop',
      poiState: 'intact',
    };
  }
  if (/\b(cottage|cabin|hut|home)\b/.test(text)) {
    return {
      templateId: 'interior_cottage',
      title: 'Cottage parlor',
      environment: 'wood_interior',
      lighting: 'torchlit',
      mood: 'Herbs dry by a shuttered window.',
      lightLabel: 'Table lantern',
      coverLabel: 'Wood pile',
      poiLabel: 'Window shutter',
      poiKind: 'prop',
      poiRef: 'prop',
      poiState: 'closed',
    };
  }
  // No keyword hit — vary by seed so blank premises still compose differently.
  const families = [
    pickInteriorFamily('inn', seed),
    pickInteriorFamily('crypt', seed),
    pickInteriorFamily('workshop', seed),
    pickInteriorFamily('cottage', seed),
    {
      templateId: 'interior_warehouse',
      title: 'Dim warehouse bay',
      environment: 'stone_interior' as const,
      lighting: 'dim' as const,
      mood: 'Dust hangs in the rafters; a freight door waits east.',
      lightLabel: 'Hanging lantern',
      coverLabel: 'Rubble pile',
      poiLabel: 'Freight crate',
      poiKind: 'container' as const,
      poiRef: 'prop' as const,
      poiState: 'intact' as const,
    },
  ];
  return families[seed % families.length]!;
}

function pickExteriorFamily(hint: string, seed: number): {
  templateId: string;
  title: string;
  environment: SceneEnvironment;
  lighting: SceneLighting;
  mood: string;
  coverLabel: string;
  poiLabel: string;
} {
  const text = hint.toLowerCase();
  if (/\b(marsh|bog|mire|wetland)\b/.test(text) || seed % 3 === 0) {
    return {
      templateId: 'exterior_marsh_trail',
      title: 'Marsh boardwalk',
      environment: 'marsh_trail',
      lighting: 'overcast',
      mood: 'Reeds rasp; the boards sink an inch with each step.',
      coverLabel: 'Reed tangle',
      poiLabel: 'Fogged mile post',
    };
  }
  if (/\b(village|street|town|market)\b/.test(text) || seed % 3 === 1) {
    return {
      templateId: 'exterior_village_street',
      title: 'Village street',
      environment: 'village_street',
      lighting: 'daylight',
      mood: 'Packed earth, shuttered stalls, and a path onward.',
      coverLabel: 'Market cart',
      poiLabel: 'Street lamp',
    };
  }
  return {
    templateId: 'exterior_forest_path',
    title: 'Forest path',
    environment: 'forest_path',
    lighting: 'daylight',
    mood: 'Needles underfoot; the trail bends toward thicker growth.',
    coverLabel: 'Fallen log',
    poiLabel: 'Trail blaze',
  };
}

function pickEncounterFamily(hint: string, seed: number): {
  templateId: string;
  title: string;
  environment: SceneEnvironment;
  lighting: SceneLighting;
  mood: string;
  creatureLabel: string;
  hazardLabel: string;
} {
  const text = hint.toLowerCase();
  if (/\b(bandit|ambush|road)\b/.test(text) || seed % 3 === 0) {
    return {
      templateId: 'encounter_road_ambush',
      title: 'Roadside ambush clearing',
      environment: 'hill_clearing',
      lighting: 'dusk',
      mood: 'Broken brush and a waiting silence.',
      creatureLabel: 'Wary bandit lookout',
      hazardLabel: 'Tripwire brush',
    };
  }
  if (/\b(wolf|beast|hunt)\b/.test(text) || seed % 3 === 1) {
    return {
      templateId: 'encounter_wolf_pack',
      title: 'Wolf-haunted thicket',
      environment: 'forest_path',
      lighting: 'dim',
      mood: 'Yellow eyes catch the last light.',
      creatureLabel: 'Lean wolf',
      hazardLabel: 'Thorny bramble',
    };
  }
  return {
    templateId: 'encounter_watchful_stranger',
    title: 'Watchful stranger at the ford',
    environment: 'marsh_trail',
    lighting: 'overcast',
    mood: 'Someone waits where the path narrows.',
    creatureLabel: 'Cloaked stranger',
    hazardLabel: 'Slick stones',
  };
}

function composeInterior(options: {
  readonly sceneId: string;
  readonly premise: string;
  readonly seedKey: string;
}): ComposedScene {
  const seed = hashSeed(options.seedKey);
  const family = pickInteriorFamily(options.premise, seed);
  const columns = 10 + (seed % 3); // 10–12
  const rows = 7 + (seed % 2); // 7–8
  const cells = perimeterCells(columns, rows);
  const spawn = { column: 2, row: Math.floor(rows / 2) };
  const wallColumn = Math.min(columns - 3, spawn.column + 3);
  const doorRow = spawn.row;
  const { edges, doorEdgeId } = eastDoorWall(
    wallColumn,
    doorRow,
    Math.max(1, doorRow - 1),
    Math.min(rows - 2, doorRow + 1),
  );
  setTerrain(cells, spawn.column + 1, spawn.row + 1, 'difficult');

  const lightId = `${options.sceneId}:light`;
  const coverId = `${options.sceneId}:cover`;
  const poiId = `${options.sceneId}:poi`;
  const features: ComposedSceneFeature[] = [
    {
      objectId: lightId,
      column: 1,
      row: 1,
      label: family.lightLabel,
      referenceKind: 'lighting',
      objectKind: 'light',
      state: 'lit',
      interactable: true,
    },
    {
      objectId: coverId,
      column: 2,
      row: Math.min(rows - 3, spawn.row + 2),
      label: family.coverLabel,
      referenceKind: 'cover',
      objectKind: 'cover',
      state: 'intact',
      interactable: true,
    },
    {
      objectId: poiId,
      column: 3,
      row: Math.max(1, spawn.row - 1),
      label: family.poiLabel,
      referenceKind: family.poiRef,
      objectKind: family.poiKind,
      state: family.poiState,
      interactable: true,
    },
  ];

  return {
    sceneId: options.sceneId,
    templateId: family.templateId,
    title: family.title,
    sceneBanner: `${family.title} — ${family.mood}`,
    purpose: 'exploration',
    environment: family.environment,
    lighting: family.lighting,
    mood: family.mood,
    columns,
    rows,
    cells,
    edges,
    features,
    spawn,
    exits: [
      {
        exitId: `${options.sceneId}:exit-east`,
        label: 'Wooden doorway east',
        destinationHint: inferExteriorHint(options.premise, seed),
      },
    ],
    doorStates: doorEdgeId ? { [doorEdgeId]: 'closed' } : {},
  };
}

function inferExteriorHint(premise: string, seed: number): string {
  const text = premise.toLowerCase();
  if (/\bmarsh|bog\b/.test(text)) return 'the marsh trail';
  if (/\bvillage|town\b/.test(text)) return 'the village street';
  if (/\bforest|wood\b/.test(text)) return 'the forest path';
  return seed % 3 === 0 ? 'the marsh trail' : seed % 3 === 1 ? 'the village street' : 'the forest path';
}

function composeExterior(options: {
  readonly sceneId: string;
  readonly destinationHint: string;
  readonly seedKey: string;
  readonly returnToSceneId: string | null;
}): ComposedScene {
  const seed = hashSeed(options.seedKey);
  const family = pickExteriorFamily(options.destinationHint, seed);
  const columns = 12 + (seed % 3); // 12–14
  const rows = 6 + (seed % 2); // 6–7
  const cells = perimeterCells(columns, rows);
  for (let column = 2; column < columns - 2; column += 1) {
    if (column % 3 === 0) {
      setTerrain(cells, column, Math.floor(rows / 2), 'difficult');
    }
  }
  const spawn = { column: 2, row: Math.floor(rows / 2) };
  const forwardColumn = columns - 3;
  const { edges, doorEdgeId } = eastDoorWall(
    forwardColumn,
    spawn.row,
    Math.max(1, spawn.row - 1),
    Math.min(rows - 2, spawn.row + 1),
  );

  const lightId = `${options.sceneId}:light`;
  const coverId = `${options.sceneId}:cover`;
  const features: ComposedSceneFeature[] = [
    {
      objectId: coverId,
      column: 4,
      row: Math.max(1, spawn.row - 1),
      label: family.coverLabel,
      referenceKind: 'cover',
      objectKind: 'cover',
      state: 'intact',
      interactable: true,
    },
    {
      objectId: lightId,
      column: 5,
      row: spawn.row,
      label: family.poiLabel,
      referenceKind: family.environment === 'village_street' ? 'lighting' : 'prop',
      objectKind: family.environment === 'village_street' ? 'light' : 'prop',
      state: family.environment === 'village_street' ? 'lit' : 'present',
      interactable: family.environment === 'village_street',
    },
  ];

  return {
    sceneId: options.sceneId,
    templateId: family.templateId,
    title: family.title,
    sceneBanner: `${family.title} — ${family.mood}`,
    purpose: 'travel',
    environment: family.environment,
    lighting: family.lighting,
    mood: family.mood,
    columns,
    rows,
    cells,
    edges,
    features,
    spawn,
    exits: [
      {
        exitId: `${options.sceneId}:exit-forward`,
        label: 'Path onward',
        destinationHint: 'the encounter ahead',
      },
      {
        exitId: `${options.sceneId}:exit-return`,
        label: 'Way back',
        destinationHint: 'return to the earlier scene',
        returnToSceneId: options.returnToSceneId,
      },
    ],
    doorStates: doorEdgeId ? { [doorEdgeId]: 'open' } : {},
  };
}

function composeEncounter(options: {
  readonly sceneId: string;
  readonly destinationHint: string;
  readonly seedKey: string;
  readonly returnToSceneId: string | null;
}): ComposedScene {
  const seed = hashSeed(options.seedKey);
  const family = pickEncounterFamily(options.destinationHint, seed);
  const columns = 11 + (seed % 2);
  const rows = 8 + (seed % 2);
  const cells = perimeterCells(columns, rows);
  setTerrain(cells, 5, 3, 'difficult');
  setTerrain(cells, 6, 4, 'difficult');
  const spawn = { column: 2, row: Math.floor(rows / 2) };
  const features: ComposedSceneFeature[] = [
    {
      objectId: `${options.sceneId}:creature`,
      column: columns - 3,
      row: spawn.row,
      label: family.creatureLabel,
      referenceKind: 'hazard',
      objectKind: 'creature',
      state: 'present',
      interactable: false,
    },
    {
      objectId: `${options.sceneId}:hazard`,
      column: 4,
      row: spawn.row + 1,
      label: family.hazardLabel,
      referenceKind: 'hazard',
      objectKind: 'hazard',
      state: 'active',
      interactable: true,
    },
    {
      objectId: `${options.sceneId}:cover`,
      column: 3,
      row: Math.max(1, spawn.row - 1),
      label: 'Scattered debris',
      referenceKind: 'cover',
      objectKind: 'cover',
      state: 'intact',
      interactable: true,
    },
  ];

  return {
    sceneId: options.sceneId,
    templateId: family.templateId,
    title: family.title,
    sceneBanner: `${family.title} — ${family.mood}`,
    purpose: 'encounter',
    environment: family.environment,
    lighting: family.lighting,
    mood: family.mood,
    columns,
    rows,
    cells,
    edges: [],
    features,
    spawn,
    exits: [
      {
        exitId: `${options.sceneId}:exit-return`,
        label: 'Retreat the way you came',
        destinationHint: 'return to the earlier scene',
        returnToSceneId: options.returnToSceneId,
      },
    ],
    doorStates: {},
  };
}

/**
 * Compose a Director scene. Kind + premise/hint choose a template family;
 * seedKey keeps composition stable for a campaign while allowing variety.
 */
export function composeDirectorScene(options: {
  readonly kind: SceneComposeKind;
  readonly sceneId: string;
  readonly premise?: string;
  readonly destinationHint?: string;
  readonly seedKey: string;
  readonly returnToSceneId?: string | null;
}): ComposedScene {
  const premise = options.premise?.trim() || 'an unfolding adventure';
  const hint = options.destinationHint?.trim() || premise;
  if (options.kind === 'interior') {
    return composeInterior({
      sceneId: options.sceneId,
      premise,
      seedKey: options.seedKey,
    });
  }
  if (options.kind === 'encounter') {
    return composeEncounter({
      sceneId: options.sceneId,
      destinationHint: hint,
      seedKey: `${options.seedKey}:enc`,
      returnToSceneId: options.returnToSceneId ?? null,
    });
  }
  return composeExterior({
    sceneId: options.sceneId,
    destinationHint: hint,
    seedKey: `${options.seedKey}:ext`,
    returnToSceneId: options.returnToSceneId ?? null,
  });
}

export function featureLabelWithState(feature: ComposedSceneFeature): string {
  const base = feature.label
    .replace(
      /\s*\((?:lit|unlit|intact|broken|open|closed|active|disarmed|present)\)\s*$/i,
      '',
    )
    .trim();
  if (feature.objectKind === 'light') {
    return `${base} (${feature.state === 'unlit' ? 'unlit' : 'lit'})`;
  }
  if (feature.objectKind === 'cover' || feature.objectKind === 'container') {
    return `${base} (${feature.state})`;
  }
  if (feature.objectKind === 'hazard') {
    return `${base} (${feature.state})`;
  }
  if (feature.objectKind === 'prop' && (feature.state === 'open' || feature.state === 'closed')) {
    return `${base} (${feature.state})`;
  }
  return base;
}

export function nextObjectState(
  feature: ComposedSceneFeature,
  declaration: string,
): SceneObjectState | null {
  const text = declaration.toLowerCase();
  if (feature.objectKind === 'light') {
    if (/\b(extinguish|douse|snuff|put out|darken)\b/.test(text)) return 'unlit';
    if (/\b(light|relight|ignite|kindle)\b/.test(text)) return 'lit';
    return feature.state === 'lit' ? 'unlit' : 'lit';
  }
  if (feature.objectKind === 'cover' || feature.objectKind === 'container') {
    if (/\b(break|smash|kick|shatter|destroy)\b/.test(text)) return 'broken';
    if (/\b(move|clear|shift|push)\b/.test(text)) return 'broken';
    return feature.state === 'intact' ? 'broken' : 'intact';
  }
  if (feature.objectKind === 'hazard') {
    if (/\b(disarm|disable|safe|clear)\b/.test(text)) return 'disarmed';
    return feature.state === 'active' ? 'disarmed' : 'active';
  }
  if (feature.objectKind === 'prop') {
    if (/\b(open)\b/.test(text)) return 'open';
    if (/\b(close|shut)\b/.test(text)) return 'closed';
    if (feature.state === 'closed') return 'open';
    if (feature.state === 'open') return 'closed';
  }
  return null;
}

export function newSceneId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
