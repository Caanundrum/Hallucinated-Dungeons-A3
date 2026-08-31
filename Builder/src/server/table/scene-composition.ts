/**
 * Deterministic Director scene composition from a structured scene contract.
 *
 * Batch 3: every established actor in fiction is a tactical feature; open-ended
 * destinations compose landmark layouts; surfaces render from one contract.
 */

import {
  edgeId,
  type DoorState,
  type MapCellRecord,
  type MapEdgeRecord,
  type MapReferenceMarkerKind,
  type MapSquareCoordinate,
} from '../../shared/map-contract.js';
import { attachExitsToComposedScene } from './scene-exit-projection.js';

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
  'watchtower',
  'docks',
  'cavern',
  'bridge',
  'ruins',
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
  'exit',
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

/**
 * Structured scene contract — banner, map, objects, exits, inhabitants, and
 * narration all derive from these fields (Batch 3 coherence).
 */
export interface ComposedScene {
  readonly sceneId: string;
  readonly templateId: string;
  readonly title: string;
  readonly sceneBanner: string;
  readonly purpose: ScenePurpose;
  readonly environment: SceneEnvironment;
  readonly lighting: SceneLighting;
  readonly mood: string;
  /** Sensory establishment line shared with Director narration. */
  readonly description: string;
  readonly columns: number;
  readonly rows: number;
  readonly cells: readonly MapCellRecord[];
  readonly edges: readonly MapEdgeRecord[];
  readonly features: readonly ComposedSceneFeature[];
  readonly spawn: MapSquareCoordinate;
  readonly exits: readonly ComposedSceneExit[];
  readonly doorStates: Record<string, DoorState>;
  /** Actor ids that must appear both in fiction and on the tactical map. */
  readonly inhabitantObjectIds: readonly string[];
}

export function sceneContractSummary(scene: ComposedScene): string {
  const objects = scene.features
    .filter((feature) => feature.objectKind !== 'creature' && feature.objectKind !== 'npc')
    .map((feature) => featureLabelWithState(feature))
    .join('; ');
  const inhabitants = scene.features
    .filter((feature) => feature.objectKind === 'creature' || feature.objectKind === 'npc')
    .map((feature) => feature.label)
    .join('; ');
  const exits = scene.exits.map((exit) => exit.label).join('; ');
  return [
    `Location: ${scene.title}`,
    `Purpose: ${scene.purpose}; environment: ${scene.environment}; lighting: ${scene.lighting}`,
    `Dimensions: ${scene.columns}×${scene.rows}`,
    `Atmosphere: ${scene.mood}`,
    `Description: ${scene.description}`,
    objects.length > 0 ? `Objects: ${objects}` : 'Objects: none',
    inhabitants.length > 0 ? `Inhabitants: ${inhabitants}` : 'Inhabitants: none',
    exits.length > 0 ? `Exits: ${exits}` : 'Exits: none',
  ].join('\n');
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

function northDoorWall(
  doorColumn: number,
  wallRow: number,
  columnStart: number,
  columnEnd: number,
): { edges: MapEdgeRecord[]; doorEdgeId: string } {
  const edges: MapEdgeRecord[] = [];
  let doorEdgeId = '';
  for (let column = columnStart; column <= columnEnd; column += 1) {
    const kind = column === doorColumn ? 'door' : 'wall';
    const id = edgeId(column, wallRow, 'north');
    if (kind === 'door') {
      doorEdgeId = id;
    }
    edges.push({
      edgeId: id,
      column,
      row: wallRow,
      orientation: 'north',
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

/** Place actors inside spawn vision so fiction and fog agree. */
function nearSpawn(
  spawn: MapSquareCoordinate,
  columns: number,
  rows: number,
  offsetColumn: number,
  offsetRow: number,
): MapSquareCoordinate {
  return {
    column: Math.max(1, Math.min(columns - 2, spawn.column + offsetColumn)),
    row: Math.max(1, Math.min(rows - 2, spawn.row + offsetRow)),
  };
}

export type SceneComposeKind =
  | 'interior'
  | 'exterior'
  | 'encounter'
  | 'landmark'
  | 'return_hint';

export function matchLandmarkDestination(hint: string): boolean {
  return /\b(watchtower|tower|dock|docks|pier|harbor|harbour|cavern|cave|grotto|bridge|ridge|ruin|ruins|keep|fort|cliff)\b/i.test(
    hint,
  );
}

function pickInteriorFamily(premise: string, seed: number): {
  templateId: string;
  title: string;
  environment: SceneEnvironment;
  lighting: SceneLighting;
  mood: string;
  description: string;
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
      description: 'A low-ceilinged common room waits with a lit hearth lamp and a closed east door.',
      lightLabel: 'Hearth lamp',
      coverLabel: 'Overturned bench',
      poiLabel: 'Service counter',
      poiKind: 'container',
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
      description: 'Damp stone walls close in around a wall cresset and a sealed niche.',
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
      description: 'Workbenches and crate stacks crowd a torchlit bay with a yard door east.',
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
      description: 'A modest parlor holds a table lantern and a shuttered window.',
      lightLabel: 'Table lantern',
      coverLabel: 'Wood pile',
      poiLabel: 'Window shutter',
      poiKind: 'prop',
      poiRef: 'prop',
      poiState: 'closed',
    };
  }
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
      description: 'A freight bay holds a hanging lantern, rubble, and a sealed crate.',
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
  description: string;
  coverLabel: string;
  poiLabel: string;
} {
  const text = hint.toLowerCase();
  if (/\b(marsh|bog|mire|wetland)\b/.test(text)) {
    return {
      templateId: 'exterior_marsh_trail',
      title: 'Marsh boardwalk',
      environment: 'marsh_trail',
      lighting: 'overcast',
      mood: 'Reeds rasp; the boards sink an inch with each step.',
      description: 'A narrow boardwalk threads the mist toward deeper ground.',
      coverLabel: 'Reed tangle',
      poiLabel: 'Fogged mile post',
    };
  }
  if (/\b(village|street|town|market)\b/.test(text)) {
    return {
      templateId: 'exterior_village_street',
      title: 'Village street',
      environment: 'village_street',
      lighting: 'daylight',
      mood: 'Packed earth, shuttered stalls, and a path onward.',
      description: 'A quiet street opens between shuttered stalls and a lit street lamp.',
      coverLabel: 'Market cart',
      poiLabel: 'Street lamp',
    };
  }
  if (/\b(forest|wood|path|trail)\b/.test(text) || seed % 3 === 2) {
    return {
      templateId: 'exterior_forest_path',
      title: 'Forest path',
      environment: 'forest_path',
      lighting: 'daylight',
      mood: 'Needles underfoot; the trail bends toward thicker growth.',
      description: 'A forest path bends between a fallen log and a trail blaze.',
      coverLabel: 'Fallen log',
      poiLabel: 'Trail blaze',
    };
  }
  if (seed % 3 === 0) {
    return pickExteriorFamily('marsh', seed);
  }
  if (seed % 3 === 1) {
    return pickExteriorFamily('village', seed);
  }
  return pickExteriorFamily('forest', seed);
}

function pickEncounterFamily(hint: string, seed: number): {
  templateId: string;
  title: string;
  environment: SceneEnvironment;
  lighting: SceneLighting;
  mood: string;
  description: string;
  creatureLabel: string;
  creatureKind: 'creature' | 'npc';
  hazardLabel: string;
} {
  const text = hint.toLowerCase();
  const wolf = {
    templateId: 'encounter_wolf_pack',
    title: 'Wolf-haunted thicket',
    environment: 'forest_path' as const,
    lighting: 'dim' as const,
    mood: 'Yellow eyes catch the last light.',
    description: 'A lean wolf holds the trail beside thorn and debris.',
    creatureLabel: 'Lean wolf',
    creatureKind: 'creature' as const,
    hazardLabel: 'Thorny bramble',
  };
  const ambush = {
    templateId: 'encounter_road_ambush',
    title: 'Roadside ambush clearing',
    environment: 'hill_clearing' as const,
    lighting: 'dusk' as const,
    mood: 'Broken brush and a waiting silence.',
    description: 'A wary lookout waits in the brush where the road narrows.',
    creatureLabel: 'Wary bandit lookout',
    creatureKind: 'npc' as const,
    hazardLabel: 'Tripwire brush',
  };
  const stranger = {
    templateId: 'encounter_watchful_stranger',
    title: 'Watchful stranger at the ford',
    environment: 'marsh_trail' as const,
    lighting: 'overcast' as const,
    mood: 'Someone waits where the path narrows.',
    description: 'A cloaked stranger waits at the ford beside slick stones.',
    creatureLabel: 'Cloaked stranger',
    creatureKind: 'npc' as const,
    hazardLabel: 'Slick stones',
  };
  // Keyword hints beat seed rotation so "wolf thicket" cannot become a road ambush.
  if (/\b(wolf|beast|hunt|thicket|forest|wooded|woods)\b/.test(text)) {
    return wolf;
  }
  if (/\b(bandit|ambush|road)\b/.test(text)) {
    return ambush;
  }
  if (/\b(ford|stranger|marsh)\b/.test(text)) {
    return stranger;
  }
  if (seed % 3 === 0) {
    return ambush;
  }
  if (seed % 3 === 1) {
    return wolf;
  }
  return stranger;
}

type LandmarkFamily = {
  templateId: string;
  title: string;
  environment: SceneEnvironment;
  lighting: SceneLighting;
  mood: string;
  description: string;
  columns: number;
  rows: number;
  layout: 'tower' | 'docks' | 'cavern' | 'bridge' | 'ruins';
  coverLabel: string;
  statefulLabel: string;
  statefulKind: SceneObjectKind;
  statefulRef: MapReferenceMarkerKind;
  statefulState: SceneObjectState;
  inhabitantLabel: string | null;
  inhabitantKind: 'creature' | 'npc' | null;
};

function pickLandmarkFamily(hint: string, seed: number): LandmarkFamily {
  const text = hint.toLowerCase();
  if (/\b(watchtower|tower|keep|fort|ridge|cliff)\b/.test(text)) {
    return {
      templateId: 'landmark_ruined_watchtower',
      title: 'Ruined watchtower on the ridge',
      environment: 'watchtower',
      lighting: 'dusk',
      mood: 'Wind scours broken crenellations above the ridge.',
      description:
        'A narrow tower floor opens under open sky, with a parapet stair and a shuttered arrow loop.',
      columns: 8,
      rows: 12,
      layout: 'tower',
      coverLabel: 'Collapsed masonry',
      statefulLabel: 'Arrow-loop shutter',
      statefulKind: 'prop',
      statefulRef: 'prop',
      statefulState: 'closed',
      inhabitantLabel: null,
      inhabitantKind: null,
    };
  }
  if (/\b(dock|docks|pier|harbor|harbour)\b/.test(text)) {
    return {
      templateId: 'landmark_foggy_docks',
      title: 'Foggy riverside docks',
      environment: 'docks',
      lighting: 'overcast',
      mood: 'Ropes creak; water slaps the piles.',
      description: 'A wide pier stretches over dark water with a moored skiff and stacked crates.',
      columns: 16,
      rows: 6,
      layout: 'docks',
      coverLabel: 'Mooring crate',
      statefulLabel: 'Skiff painter',
      statefulKind: 'prop',
      statefulRef: 'prop',
      statefulState: 'closed',
      inhabitantLabel: 'Dock loafer',
      inhabitantKind: 'npc',
    };
  }
  if (/\b(cavern|cave|grotto)\b/.test(text)) {
    return {
      templateId: 'landmark_limestone_cavern',
      title: 'Limestone cavern mouth',
      environment: 'cavern',
      lighting: 'dim',
      mood: 'Drip and echo replace the sky.',
      description: 'Irregular stone closes around a torch stub and a side passage.',
      columns: 13,
      rows: 9,
      layout: 'cavern',
      coverLabel: 'Stalagmite cluster',
      statefulLabel: 'Rope bridge span',
      statefulKind: 'prop',
      statefulRef: 'prop',
      statefulState: 'intact',
      inhabitantLabel: 'Cave cricket swarm',
      inhabitantKind: 'creature',
    };
  }
  if (/\b(bridge)\b/.test(text)) {
    return {
      templateId: 'landmark_stone_bridge',
      title: 'Wind-scoured stone bridge',
      environment: 'bridge',
      lighting: 'daylight',
      mood: 'The span hangs over a cold drop.',
      description: 'A long bridge run has a damaged mid-span and clear approaches at both ends.',
      columns: 14,
      rows: 5,
      layout: 'bridge',
      coverLabel: 'Broken parapet',
      statefulLabel: 'Damaged mid-span',
      statefulKind: 'cover',
      statefulRef: 'cover',
      statefulState: 'intact',
      inhabitantLabel: null,
      inhabitantKind: null,
    };
  }
  if (/\b(ruin|ruins)\b/.test(text) || seed % 2 === 0) {
    return {
      templateId: 'landmark_courtyard_ruins',
      title: 'Broken courtyard ruins',
      environment: 'ruins',
      lighting: 'daylight',
      mood: 'Grass pushes through cracked flagstones.',
      description: 'An open ruin courtyard holds a toppled plinth and a half-buried chest.',
      columns: 12,
      rows: 10,
      layout: 'ruins',
      coverLabel: 'Toppled plinth',
      statefulLabel: 'Half-buried chest',
      statefulKind: 'container',
      statefulRef: 'prop',
      statefulState: 'closed',
      inhabitantLabel: 'Scruffy scavenger',
      inhabitantKind: 'npc',
    };
  }
  return pickLandmarkFamily('watchtower', seed);
}

function composeInterior(options: {
  readonly sceneId: string;
  readonly premise: string;
  readonly seedKey: string;
}): ComposedScene {
  const seed = hashSeed(options.seedKey);
  const family = pickInteriorFamily(options.premise, seed);
  const columns = 10 + (seed % 3);
  const rows = 7 + (seed % 2);
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
  const lightPos = nearSpawn(spawn, columns, rows, -1, -1);
  const coverPos = nearSpawn(spawn, columns, rows, 0, 1);
  const poiPos = nearSpawn(spawn, columns, rows, 1, -1);
  const features: ComposedSceneFeature[] = [
    {
      objectId: lightId,
      column: lightPos.column,
      row: lightPos.row,
      label: family.lightLabel,
      referenceKind: 'lighting',
      objectKind: 'light',
      state: 'lit',
      interactable: true,
    },
    {
      objectId: coverId,
      column: coverPos.column,
      row: coverPos.row,
      label: family.coverLabel,
      referenceKind: 'cover',
      objectKind: 'cover',
      state: 'intact',
      interactable: true,
    },
    {
      objectId: poiId,
      column: poiPos.column,
      row: poiPos.row,
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
    description: family.description,
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
    inhabitantObjectIds: [],
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
  const columns = 12 + (seed % 3);
  const rows = 6 + (seed % 2);
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

  const coverPos = nearSpawn(spawn, columns, rows, 1, -1);
  const poiPos = nearSpawn(spawn, columns, rows, 2, 0);
  const features: ComposedSceneFeature[] = [
    {
      objectId: `${options.sceneId}:cover`,
      column: coverPos.column,
      row: coverPos.row,
      label: family.coverLabel,
      referenceKind: 'cover',
      objectKind: 'cover',
      state: 'intact',
      interactable: true,
    },
    {
      objectId: `${options.sceneId}:light`,
      column: poiPos.column,
      row: poiPos.row,
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
    description: family.description,
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
    inhabitantObjectIds: [],
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
  const creaturePos = nearSpawn(spawn, columns, rows, 2, 0);
  const hazardPos = nearSpawn(spawn, columns, rows, 1, 1);
  const coverPos = nearSpawn(spawn, columns, rows, 0, -1);
  const creatureId = `${options.sceneId}:creature`;
  const features: ComposedSceneFeature[] = [
    {
      objectId: creatureId,
      column: creaturePos.column,
      row: creaturePos.row,
      label: family.creatureLabel,
      referenceKind: family.creatureKind,
      objectKind: family.creatureKind,
      state: 'present',
      interactable: false,
    },
    {
      objectId: `${options.sceneId}:hazard`,
      column: hazardPos.column,
      row: hazardPos.row,
      label: family.hazardLabel,
      referenceKind: 'hazard',
      objectKind: 'hazard',
      state: 'active',
      interactable: true,
    },
    {
      objectId: `${options.sceneId}:cover`,
      column: coverPos.column,
      row: coverPos.row,
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
    description: family.description,
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
    inhabitantObjectIds: [creatureId],
  };
}

function composeLandmark(options: {
  readonly sceneId: string;
  readonly destinationHint: string;
  readonly seedKey: string;
  readonly returnToSceneId: string | null;
}): ComposedScene {
  const seed = hashSeed(options.seedKey);
  const family = pickLandmarkFamily(options.destinationHint, seed);
  const { columns, rows } = family;
  const cells = perimeterCells(columns, rows);
  const spawn = { column: 2, row: Math.floor(rows / 2) };
  const features: ComposedSceneFeature[] = [];
  const exits: ComposedSceneExit[] = [];
  let doorStates: Record<string, DoorState> = {};
  const edges: MapEdgeRecord[] = [];

  if (family.layout === 'tower') {
    // Tall shaft: blocked corners create a narrower climb chamber.
    for (let row = 2; row < rows - 2; row += 1) {
      setTerrain(cells, 1, row, row % 2 === 0 ? 'difficult' : 'floor');
      setTerrain(cells, columns - 2, row, 'blocked');
    }
    const north = northDoorWall(spawn.column, 1, 1, columns - 2);
    edges.push(...north.edges);
    if (north.doorEdgeId) {
      doorStates = { [north.doorEdgeId]: 'open' };
    }
    exits.push(
      {
        exitId: `${options.sceneId}:exit-parapet`,
        label: 'Parapet stair north',
        destinationHint: 'the ridge path below',
      },
      {
        exitId: `${options.sceneId}:exit-return`,
        label: 'Ladder back down',
        destinationHint: 'return to the earlier scene',
        returnToSceneId: options.returnToSceneId,
      },
    );
  } else if (family.layout === 'docks') {
    for (let column = 1; column < columns - 1; column += 1) {
      setTerrain(cells, column, rows - 2, 'difficult');
      if (column % 4 === 0) {
        setTerrain(cells, column, 1, 'blocked');
      }
    }
    exits.push(
      {
        exitId: `${options.sceneId}:exit-river`,
        label: 'River channel west',
        destinationHint: 'upstream along the water',
      },
      {
        exitId: `${options.sceneId}:exit-shore`,
        label: 'Shore path east',
        destinationHint: 'the shore road',
      },
      {
        exitId: `${options.sceneId}:exit-return`,
        label: 'Way back inland',
        destinationHint: 'return to the earlier scene',
        returnToSceneId: options.returnToSceneId,
      },
    );
  } else if (family.layout === 'cavern') {
    for (let row = 2; row < rows - 2; row += 1) {
      for (let column = 3; column < columns - 3; column += 1) {
        if ((column + row + seed) % 5 === 0) {
          setTerrain(cells, column, row, 'blocked');
        } else if ((column + row) % 4 === 0) {
          setTerrain(cells, column, row, 'difficult');
        }
      }
    }
    const side = eastDoorWall(columns - 3, spawn.row, Math.max(1, spawn.row - 1), Math.min(rows - 2, spawn.row + 1));
    edges.push(...side.edges);
    if (side.doorEdgeId) {
      doorStates = { [side.doorEdgeId]: 'open' };
    }
    exits.push(
      {
        exitId: `${options.sceneId}:exit-deeper`,
        label: 'Passage deeper east',
        destinationHint: 'deeper into the cavern',
      },
      {
        exitId: `${options.sceneId}:exit-return`,
        label: 'Daylight behind',
        destinationHint: 'return to the earlier scene',
        returnToSceneId: options.returnToSceneId,
      },
    );
  } else if (family.layout === 'bridge') {
    for (let column = 1; column < columns - 1; column += 1) {
      setTerrain(cells, column, 1, column === Math.floor(columns / 2) ? 'difficult' : 'floor');
      setTerrain(cells, column, rows - 2, 'blocked');
    }
    exits.push(
      {
        exitId: `${options.sceneId}:exit-far`,
        label: 'Far bank east',
        destinationHint: 'the far bank',
      },
      {
        exitId: `${options.sceneId}:exit-near`,
        label: 'Near bank west',
        destinationHint: 'return to the earlier scene',
        returnToSceneId: options.returnToSceneId,
      },
    );
  } else {
    // Ruins courtyard — open center, corner stubs only.
    for (let row = 2; row < rows - 2; row += 1) {
      for (let column = 2; column < columns - 2; column += 1) {
        setTerrain(cells, column, row, 'floor');
      }
    }
    setTerrain(cells, 2, 2, 'blocked');
    setTerrain(cells, columns - 3, 2, 'blocked');
    setTerrain(cells, 2, rows - 3, 'blocked');
    setTerrain(cells, columns - 3, rows - 3, 'blocked');
    exits.push(
      {
        exitId: `${options.sceneId}:exit-arch`,
        label: 'Collapsed arch south',
        destinationHint: 'the overgrown lane',
      },
      {
        exitId: `${options.sceneId}:exit-return`,
        label: 'Breach in the north wall',
        destinationHint: 'return to the earlier scene',
        returnToSceneId: options.returnToSceneId,
      },
    );
  }

  const coverPos = nearSpawn(spawn, columns, rows, 0, 1);
  const statePos = nearSpawn(spawn, columns, rows, 1, -1);
  features.push(
    {
      objectId: `${options.sceneId}:cover`,
      column: coverPos.column,
      row: coverPos.row,
      label: family.coverLabel,
      referenceKind: 'cover',
      objectKind: 'cover',
      state: 'intact',
      interactable: true,
    },
    {
      objectId: `${options.sceneId}:stateful`,
      column: statePos.column,
      row: statePos.row,
      label: family.statefulLabel,
      referenceKind: family.statefulRef,
      objectKind: family.statefulKind,
      state: family.statefulState,
      interactable: true,
    },
  );

  const inhabitantObjectIds: string[] = [];
  if (family.inhabitantLabel !== null && family.inhabitantKind !== null) {
    const actorPos = nearSpawn(spawn, columns, rows, 2, 0);
    const actorId = `${options.sceneId}:inhabitant`;
    features.push({
      objectId: actorId,
      column: actorPos.column,
      row: actorPos.row,
      label: family.inhabitantLabel,
      referenceKind: family.inhabitantKind,
      objectKind: family.inhabitantKind,
      state: 'present',
      interactable: false,
    });
    inhabitantObjectIds.push(actorId);
  }

  return {
    sceneId: options.sceneId,
    templateId: family.templateId,
    title: family.title,
    sceneBanner: `${family.title} — ${family.mood}`,
    purpose: family.inhabitantKind !== null ? 'encounter' : 'exploration',
    environment: family.environment,
    lighting: family.lighting,
    mood: family.mood,
    description: family.description,
    columns,
    rows,
    cells,
    edges,
    features,
    spawn,
    exits,
    doorStates,
    inhabitantObjectIds,
  };
}

/**
 * Compose a Director scene from the structured contract.
 * Kind + premise/hint choose a composition family; seedKey keeps it stable.
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
  let composed: ComposedScene;
  if (options.kind === 'interior') {
    composed = composeInterior({
      sceneId: options.sceneId,
      premise,
      seedKey: options.seedKey,
    });
  } else if (options.kind === 'encounter') {
    composed = composeEncounter({
      sceneId: options.sceneId,
      destinationHint: hint,
      seedKey: `${options.seedKey}:enc`,
      returnToSceneId: options.returnToSceneId ?? null,
    });
  } else if (options.kind === 'landmark') {
    composed = composeLandmark({
      sceneId: options.sceneId,
      destinationHint: hint,
      seedKey: `${options.seedKey}:landmark`,
      returnToSceneId: options.returnToSceneId ?? null,
    });
  } else {
    composed = composeExterior({
      sceneId: options.sceneId,
      destinationHint: hint,
      seedKey: `${options.seedKey}:ext`,
      returnToSceneId: options.returnToSceneId ?? null,
    });
  }
  // System-wide: every contract exit becomes a visible tactical primitive.
  return attachExitsToComposedScene(composed);
}

export function featureLabelWithState(feature: ComposedSceneFeature): string {
  const base = feature.label
    .replace(
      /\s*\((?:lit|unlit|intact|broken|open|closed|active|disarmed|present)\)\s*$/i,
      '',
    )
    .trim();
  if (feature.objectKind === 'creature' || feature.objectKind === 'npc' || feature.objectKind === 'exit') {
    return base;
  }
  if (feature.objectKind === 'light') {
    return `${base} (${feature.state === 'unlit' ? 'unlit' : 'lit'})`;
  }
  if (feature.objectKind === 'cover' || feature.objectKind === 'container') {
    return `${base} (${feature.state})`;
  }
  if (feature.objectKind === 'hazard') {
    return `${base} (${feature.state})`;
  }
  if (feature.objectKind === 'prop' && (feature.state === 'open' || feature.state === 'closed' || feature.state === 'intact' || feature.state === 'broken')) {
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
    if (/\b(open)\b/.test(text) && feature.objectKind === 'container') {
      return feature.state === 'closed' ? 'open' : feature.state === 'open' ? 'closed' : 'open';
    }
    if (/\b(close|shut)\b/.test(text) && feature.objectKind === 'container') return 'closed';
    if (/\b(move|clear|shift|push)\b/.test(text)) return 'broken';
    return feature.state === 'intact' ? 'broken' : feature.state === 'closed' ? 'open' : 'intact';
  }
  if (feature.objectKind === 'hazard') {
    if (/\b(disarm|disable|safe|clear)\b/.test(text)) return 'disarmed';
    return feature.state === 'active' ? 'disarmed' : 'active';
  }
  if (feature.objectKind === 'prop') {
    if (/\b(break|smash|cut|sever|collapse)\b/.test(text)) return 'broken';
    if (/\b(open)\b/.test(text)) return 'open';
    if (/\b(close|shut)\b/.test(text)) return 'closed';
    if (feature.state === 'closed') return 'open';
    if (feature.state === 'open') return 'closed';
    if (feature.state === 'intact') return 'broken';
  }
  return null;
}

export function directorNarrationBeat(
  kind: 'establish' | 'travel' | 'interact' | 'return',
  options: {
    readonly scene: ComposedScene;
    readonly priorTitle?: string | null;
    readonly objectLabel?: string | null;
    readonly objectState?: string | null;
  },
): string {
  const scene = options.scene;
  const inhabitants = scene.features
    .filter((feature) => feature.objectKind === 'creature' || feature.objectKind === 'npc')
    .map((feature) => feature.label);
  const inhabitantLine =
    inhabitants.length > 0
      ? ` ${inhabitants.join(' and ')} ${inhabitants.length === 1 ? 'is' : 'are'} here on the scene.`
      : '';
  if (kind === 'establish') {
    return `${scene.description}${inhabitantLine} ${scene.mood}`;
  }
  if (kind === 'travel') {
    return `The party leaves ${options.priorTitle ?? 'the prior place'} behind and arrives at ${scene.title}. ${scene.description}${inhabitantLine}`;
  }
  if (kind === 'return') {
    const consequence =
      options.objectLabel !== null && options.objectLabel !== undefined
        ? ` ${options.objectLabel} remains as you left it.`
        : ' Prior consequences remain.';
    return `You return to ${scene.title}.${consequence} ${scene.mood}`;
  }
  const label = options.objectLabel ?? 'The object';
  const state = options.objectState ?? 'changed';
  return `At ${scene.title}, ${label} is now ${state}. The scene holds that consequence.`;
}

export function newSceneId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
