/**
 * Phase 2 map coordinate, edge, footprint, and Render Layer Registry contracts.
 *
 * Blueprint ownership: Sections 9.11.1–9.11.4, 6.12, and Phase 2 build scope
 * (map schemas → PixiJS scene graph). Coordinates are integer data; the client
 * never invents authoritative squares from pointer pixels alone.
 */

/** Schema version for the map coordinate space contract. */
export const MAP_COORDINATE_SCHEMA_VERSION = 'phase2-map-v1' as const;

/** World scale: one square is five feet on each edge. */
export const FEET_PER_SQUARE = 5 as const;

export const CREATURE_SIZES = [
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
] as const;
export type CreatureSize = (typeof CREATURE_SIZES)[number];

/** Tiny occupancy slots inside a single five-foot square. */
export const TINY_OCCUPANCY_SLOTS = ['nw', 'ne', 'sw', 'se'] as const;
export type TinyOccupancySlot = (typeof TINY_OCCUPANCY_SLOTS)[number];

/**
 * Default footprint dimensions in squares (width × height) by size category.
 * Tiny still occupies one containing square plus a slot.
 */
export const DEFAULT_FOOTPRINT_SQUARES: Record<
  CreatureSize,
  { readonly width: number; readonly height: number }
> = {
  tiny: { width: 1, height: 1 },
  small: { width: 1, height: 1 },
  medium: { width: 1, height: 1 },
  large: { width: 2, height: 2 },
  huge: { width: 3, height: 3 },
  gargantuan: { width: 4, height: 4 },
};

/** Cardinal edge orientation on the grid. */
export const EDGE_ORIENTATIONS = ['north', 'east', 'south', 'west'] as const;
export type EdgeOrientation = (typeof EDGE_ORIENTATIONS)[number];

export const EDGE_KINDS = ['open', 'wall', 'door'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const DOOR_STATES = ['open', 'closed', 'locked'] as const;
export type DoorState = (typeof DOOR_STATES)[number];

export const TERRAIN_KINDS = ['floor', 'difficult', 'blocked'] as const;
export type TerrainKind = (typeof TERRAIN_KINDS)[number];

/**
 * Honest art provenance values a map bundle may report (Section 25 Phase 5
 * build scope item 4 — asset provenance). `procedural_local_placeholder`
 * remains the blank-table default; `original_phase5_starter_v1` names the
 * curated Emberferry Crossing starter presentation. Neither value claims
 * production art the build does not have.
 */
export const MAP_ART_PROVENANCE_VALUES = [
  'procedural_local_placeholder',
  'original_phase5_starter_v1',
] as const;
export type MapArtProvenance = (typeof MAP_ART_PROVENANCE_VALUES)[number];

/**
 * Named WebGL layers in bottom-to-top order (Section 9.11.1).
 * Numerical z values are assigned only here — never in feature components.
 */
export const WEBGL_RENDER_LAYERS = [
  'world_background',
  'terrain_art',
  'grid_reference',
  'structural_underlays',
  'hazards_zones',
  'ground_markers',
  'tokens_entities',
  'token_information',
  'overhead_environment',
  'visibility_fog',
  'action_previews',
  'canvas_affordances',
] as const;
export type WebGlRenderLayer = (typeof WEBGL_RENDER_LAYERS)[number];

/** Controlled z gaps so future named layers can insert without arbitrary escalation. */
export const WEBGL_LAYER_Z_INDEX: Record<WebGlRenderLayer, number> = {
  world_background: 100,
  terrain_art: 200,
  grid_reference: 300,
  structural_underlays: 400,
  hazards_zones: 500,
  ground_markers: 600,
  tokens_entities: 700,
  token_information: 800,
  overhead_environment: 900,
  visibility_fog: 1000,
  action_previews: 1100,
  canvas_affordances: 1200,
};

export interface MapSquareCoordinate {
  readonly column: number;
  readonly row: number;
}

export interface MapFootprint {
  readonly size: CreatureSize;
  readonly anchor: MapSquareCoordinate;
  readonly width: number;
  readonly height: number;
  readonly tinySlot: TinyOccupancySlot | null;
  readonly elevationFeet: number;
}

export interface MapEdgeRecord {
  readonly edgeId: string;
  /** Square owning the edge's primary face (the cell the orientation points from). */
  readonly column: number;
  readonly row: number;
  readonly orientation: EdgeOrientation;
  readonly kind: EdgeKind;
  readonly doorState: DoorState | null;
}

export interface MapCellRecord {
  readonly column: number;
  readonly row: number;
  readonly terrain: TerrainKind;
  readonly elevationFeet: number;
  /** False when the viewer has neither explored nor currently seen this square. */
  readonly known: boolean;
}

export interface MapTokenProjection {
  readonly tokenId: string;
  readonly seatId: string;
  readonly label: string;
  readonly footprint: MapFootprint;
}

/** A named point of interest on the map, independent of fog-of-war cells. */
export interface MapNotableFeatureRecord {
  readonly column: number;
  readonly row: number;
  readonly label: string;
}

export interface MapCoordinateSpace {
  readonly coordinateSpaceId: string;
  readonly schemaVersion: typeof MAP_COORDINATE_SCHEMA_VERSION;
  readonly columns: number;
  readonly rows: number;
  readonly feetPerSquare: typeof FEET_PER_SQUARE;
  /** Presentation-only: CSS pixels per square at zoom 1. */
  readonly pixelsPerSquare: number;
}

export interface MapBundleProjection {
  readonly campaignId: string;
  readonly mapBundleId: string;
  readonly mapVersion: number;
  readonly title: string;
  readonly coordinateSpace: MapCoordinateSpace;
  readonly cells: readonly MapCellRecord[];
  readonly edges: readonly MapEdgeRecord[];
  readonly tokens: readonly MapTokenProjection[];
  /** Honest art provenance — procedural placeholder or a named starter pack presentation. */
  readonly artProvenance: MapArtProvenance;
  /** Short scene-setting line shown above the stage, independent of fog-of-war. */
  readonly sceneBanner: string;
  /** Named points of interest for richer cell labels than bare terrain. */
  readonly notableFeatures: readonly MapNotableFeatureRecord[];
  readonly viewerSeatId: string | null;
  readonly exploredSquareIds: readonly string[];
  readonly visibleSquareIds: readonly string[];
}

export function isMapArtProvenance(value: unknown): value is MapArtProvenance {
  return typeof value === 'string' && (MAP_ART_PROVENANCE_VALUES as readonly string[]).includes(value);
}

export function isCreatureSize(value: unknown): value is CreatureSize {
  return typeof value === 'string' && (CREATURE_SIZES as readonly string[]).includes(value);
}

export function isTinyOccupancySlot(value: unknown): value is TinyOccupancySlot {
  return typeof value === 'string' && (TINY_OCCUPANCY_SLOTS as readonly string[]).includes(value);
}

export function isEdgeOrientation(value: unknown): value is EdgeOrientation {
  return typeof value === 'string' && (EDGE_ORIENTATIONS as readonly string[]).includes(value);
}

export function isWebGlRenderLayer(value: unknown): value is WebGlRenderLayer {
  return typeof value === 'string' && (WEBGL_RENDER_LAYERS as readonly string[]).includes(value);
}

/** Deterministic square id from integer column/row. */
export function squareId(column: number, row: number): string {
  return `c${column}r${row}`;
}

/** Deterministic edge id shared by both neighboring faces of a boundary. */
export function edgeId(column: number, row: number, orientation: EdgeOrientation): string {
  return `e:${column}:${row}:${orientation}`;
}

/**
 * Expands a footprint into every occupied square. Fails closed on illegal sizes.
 */
export function footprintSquares(footprint: MapFootprint): MapSquareCoordinate[] {
  const squares: MapSquareCoordinate[] = [];
  for (let rowOffset = 0; rowOffset < footprint.height; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < footprint.width; columnOffset += 1) {
      squares.push({
        column: footprint.anchor.column + columnOffset,
        row: footprint.anchor.row + rowOffset,
      });
    }
  }
  return squares;
}

/** True when every footprint square lies inside the coordinate space. */
export function footprintFitsCoordinateSpace(
  footprint: MapFootprint,
  space: Pick<MapCoordinateSpace, 'columns' | 'rows'>,
): boolean {
  if (footprint.width < 1 || footprint.height < 1) {
    return false;
  }
  if (footprint.size === 'tiny' && footprint.tinySlot === null) {
    return false;
  }
  if (footprint.size !== 'tiny' && footprint.tinySlot !== null) {
    return false;
  }
  for (const square of footprintSquares(footprint)) {
    if (
      square.column < 0 ||
      square.row < 0 ||
      square.column >= space.columns ||
      square.row >= space.rows
    ) {
      return false;
    }
  }
  return true;
}

export function defaultFootprintForSize(
  size: CreatureSize,
  anchor: MapSquareCoordinate,
  options: { readonly tinySlot?: TinyOccupancySlot; readonly elevationFeet?: number } = {},
): MapFootprint {
  const dimensions = DEFAULT_FOOTPRINT_SQUARES[size];
  return {
    size,
    anchor,
    width: dimensions.width,
    height: dimensions.height,
    tinySlot: size === 'tiny' ? (options.tinySlot ?? 'nw') : null,
    elevationFeet: options.elevationFeet ?? 0,
  };
}
