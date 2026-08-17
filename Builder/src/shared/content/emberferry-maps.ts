/**
 * Emberferry Crossing tactical scenes — chapter-linked map geometry.
 *
 * Phase 5 ships authored procedural scenes (dock → caves → bell tower), not
 * painted tile art. Terrain stays within `floor` | `difficult` | `blocked` so
 * the Phase 2 path validator remains the movement authority.
 */

import {
  edgeId,
  type MapCellRecord,
  type MapEdgeRecord,
  type MapSquareCoordinate,
} from '../map-contract.js';
import type { StarterMapFeatureSeed } from './emberferry-crossing.js';

export const EMBERFERRY_COLUMNS = 12;
export const EMBERFERRY_ROWS = 8;

export interface EmberferrySceneDefinition {
  readonly sceneId: string;
  readonly chapterId: string;
  readonly title: string;
  readonly sceneBanner: string;
  readonly notableFeatures: readonly StarterMapFeatureSeed[];
  readonly spawnAnchors: readonly MapSquareCoordinate[];
  readonly cells: readonly MapCellRecord[];
  readonly edges: readonly MapEdgeRecord[];
}

function cell(
  column: number,
  row: number,
  terrain: MapCellRecord['terrain'],
): MapCellRecord {
  return { column, row, terrain, elevationFeet: 0, known: true };
}

function fillGrid(
  classifier: (column: number, row: number) => MapCellRecord['terrain'],
): MapCellRecord[] {
  const cells: MapCellRecord[] = [];
  for (let row = 0; row < EMBERFERRY_ROWS; row += 1) {
    for (let column = 0; column < EMBERFERRY_COLUMNS; column += 1) {
      cells.push(cell(column, row, classifier(column, row)));
    }
  }
  return cells;
}

/** Session 1 — Mist Dock: river water, timber dock, ferry house, gangway pier. */
export function buildMistDockScene(): EmberferrySceneDefinition {
  const cells = fillGrid((column, row) => {
    // Outer frame stays solid so the river doesn't spill off-map.
    if (row === 0 || column === 0 || column === EMBERFERRY_COLUMNS - 1) {
      return 'blocked';
    }
    // North warehouse / ferry office mass.
    if (row === 1 && (column <= 2 || column >= 8)) {
      return 'blocked';
    }
    // Deep river along the south and southeast.
    if (row >= 6) {
      return 'blocked';
    }
    if (row === 5 && (column <= 2 || column >= 9)) {
      return 'blocked';
    }
    // Mist-slick boards (difficult) along the waterline and gangway approach.
    if (row === 5 && column >= 3 && column <= 8) {
      return 'difficult';
    }
    if (row === 4 && (column === 8 || column === 9)) {
      return 'difficult';
    }
    // Open dock planks.
    return 'floor';
  });

  const edges: MapEdgeRecord[] = [
    {
      edgeId: edgeId(2, 1, 'south'),
      column: 2,
      row: 1,
      orientation: 'south',
      kind: 'door',
      doorState: 'closed',
    },
    {
      edgeId: edgeId(5, 2, 'east'),
      column: 5,
      row: 2,
      orientation: 'east',
      kind: 'wall',
      doorState: null,
    },
    {
      edgeId: edgeId(5, 3, 'east'),
      column: 5,
      row: 3,
      orientation: 'east',
      kind: 'wall',
      doorState: null,
    },
  ];

  return {
    sceneId: 'emberferry-mist-dock',
    chapterId: 'emberferry-ch1-dockside',
    title: 'Emberferry Mist Dock',
    sceneBanner:
      'Ember-mist rolls off the river as the last barges of the day wait at the Emberferry dock.',
    notableFeatures: [
      { column: 3, row: 2, label: "Harbor Warden's post" },
      { column: 6, row: 3, label: "Ferry winch — Old Bram's station" },
      { column: 8, row: 5, label: 'Mist-shrouded gangway' },
    ],
    spawnAnchors: [
      { column: 2, row: 3 },
      { column: 3, row: 4 },
      { column: 4, row: 3 },
      { column: 7, row: 2 },
    ],
    cells,
    edges,
  };
}

/** Session 2 — Mist-Cut Caves: tunnel floors, rock walls, mist pools. */
export function buildMistCavesScene(): EmberferrySceneDefinition {
  const cells = fillGrid((column, row) => {
    if (
      row === 0 ||
      column === 0 ||
      row === EMBERFERRY_ROWS - 1 ||
      column === EMBERFERRY_COLUMNS - 1
    ) {
      return 'blocked';
    }
    // Rock pillars / collapsed barge ribs.
    if (
      (column === 4 && row >= 2 && row <= 5) ||
      (column === 8 && row >= 1 && row <= 3) ||
      (row === 4 && column >= 6 && column <= 9)
    ) {
      return 'blocked';
    }
    // Mist pools.
    if ((column + row) % 5 === 0) {
      return 'difficult';
    }
    return 'floor';
  });

  const edges: MapEdgeRecord[] = [
    {
      edgeId: edgeId(3, 3, 'east'),
      column: 3,
      row: 3,
      orientation: 'east',
      kind: 'door',
      doorState: 'closed',
    },
  ];

  return {
    sceneId: 'emberferry-mist-caves',
    chapterId: 'emberferry-ch2-mist-caves',
    title: 'Mist-Cut Caves',
    sceneBanner:
      'Barge ribs and ember-mist choke the river caves beneath Emberferry Bluff. Something hums deeper in.',
    notableFeatures: [
      { column: 2, row: 2, label: 'Wrecked barge rib' },
      { column: 6, row: 5, label: 'Mist pool — faint hum' },
      { column: 9, row: 2, label: 'Hidden channel mouth' },
    ],
    spawnAnchors: [
      { column: 2, row: 5 },
      { column: 3, row: 6 },
      { column: 5, row: 2 },
      { column: 7, row: 6 },
    ],
    cells,
    edges,
  };
}

/** Session 3 — Drowned Bell Tower: flooded nave, dry platforms, sealed doors. */
export function buildBellTowerScene(): EmberferrySceneDefinition {
  const cells = fillGrid((column, row) => {
    if (
      row === 0 ||
      column === 0 ||
      row === EMBERFERRY_ROWS - 1 ||
      column === EMBERFERRY_COLUMNS - 1
    ) {
      return 'blocked';
    }
    // Tower walls / buttresses.
    if (column === 5 || column === 6) {
      if (row === 1 || row === 2 || row === 5 || row === 6) {
        return 'blocked';
      }
    }
    // Flooded nave (difficult — wading, not deep blocked).
    if (row >= 3 && row <= 5 && column >= 2 && column <= 9) {
      return 'difficult';
    }
    return 'floor';
  });

  const edges: MapEdgeRecord[] = [
    {
      edgeId: edgeId(5, 3, 'east'),
      column: 5,
      row: 3,
      orientation: 'east',
      kind: 'door',
      doorState: 'closed',
    },
    {
      edgeId: edgeId(4, 2, 'south'),
      column: 4,
      row: 2,
      orientation: 'south',
      kind: 'wall',
      doorState: null,
    },
  ];

  return {
    sceneId: 'emberferry-bell-tower',
    chapterId: 'emberferry-ch3-bell-tower',
    title: 'Drowned Bell Tower',
    sceneBanner:
      'The drowned bell tower lists in the river bend. The bell should not still be ringing.',
    notableFeatures: [
      { column: 3, row: 2, label: 'Dry stone landing' },
      { column: 7, row: 4, label: 'Half-submerged bell' },
      { column: 9, row: 6, label: 'River-bend overlook' },
    ],
    spawnAnchors: [
      { column: 2, row: 2 },
      { column: 3, row: 6 },
      { column: 8, row: 2 },
      { column: 9, row: 5 },
    ],
    cells,
    edges,
  };
}

const SCENES: readonly EmberferrySceneDefinition[] = [
  buildMistDockScene(),
  buildMistCavesScene(),
  buildBellTowerScene(),
];

export function resolveEmberferryScene(
  chapterId: string | null | undefined,
): EmberferrySceneDefinition {
  if (chapterId === null || chapterId === undefined) {
    return SCENES[0]!;
  }
  return SCENES.find((scene) => scene.chapterId === chapterId) ?? SCENES[0]!;
}

export function listEmberferryScenes(): readonly EmberferrySceneDefinition[] {
  return SCENES;
}
