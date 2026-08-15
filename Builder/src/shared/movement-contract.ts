/**
 * Phase 2c movement, collision, and visibility contracts.
 *
 * Blueprint ownership: Sections 6.12–6.12.9 and Phase 2 build scope
 * (movement / collision / visibility). The client may preview; only the
 * server path validator authorizes a committed path.
 */

import type { MapSquareCoordinate } from './map-contract.js';

export const GRID_ADJUDICATION_STANDARD_VERSION = 'phase2-gas-v1' as const;

export const MOVEMENT_MODES = ['walk'] as const;
export type MovementMode = (typeof MOVEMENT_MODES)[number];

/** Default walking speed budget for Phase 2c local proof (feet). */
export const DEFAULT_MOVEMENT_BUDGET_FEET = 30 as const;

export const MOVEMENT_REJECTION_CODES = [
  'EMPTY_PATH',
  'PATH_TOO_LONG',
  'NOT_ADJACENT',
  'OUT_OF_BOUNDS',
  'BLOCKED_TERRAIN',
  'BLOCKED_EDGE',
  'DIAGONAL_CORNER_BLOCKED',
  'OCCUPIED',
  'INSUFFICIENT_MOVEMENT',
  'START_MISMATCH',
] as const;
export type MovementRejectionCode = (typeof MOVEMENT_REJECTION_CODES)[number];

export interface PathStepProjection {
  readonly column: number;
  readonly row: number;
  readonly enterCostFeet: number;
  readonly cumulativeCostFeet: number;
}

export interface MovementPreviewRequest {
  readonly path: readonly MapSquareCoordinate[];
  readonly movementMode: MovementMode;
  readonly movementBudgetFeet: number;
}

export interface MovementPreviewProjection {
  readonly legal: boolean;
  readonly rejectionCode: MovementRejectionCode | null;
  readonly rejectionMessage: string | null;
  readonly path: readonly PathStepProjection[];
  readonly totalCostFeet: number;
  readonly remainingBudgetFeet: number;
  readonly gridAdjudicationStandardVersion: typeof GRID_ADJUDICATION_STANDARD_VERSION;
}

export interface VisibilitySquareProjection {
  readonly column: number;
  readonly row: number;
  readonly visible: boolean;
  readonly explored: boolean;
}

/** Vision radius in squares for Phase 2c local proof (not full LOS engine). */
export const DEFAULT_VISION_RADIUS_SQUARES = 4 as const;

export function isMovementMode(value: unknown): value is MovementMode {
  return typeof value === 'string' && (MOVEMENT_MODES as readonly string[]).includes(value);
}

export function isMovementRejectionCode(value: unknown): value is MovementRejectionCode {
  return (
    typeof value === 'string' && (MOVEMENT_REJECTION_CODES as readonly string[]).includes(value)
  );
}

export function chebyshevDistance(
  a: MapSquareCoordinate,
  b: MapSquareCoordinate,
): number {
  return Math.max(Math.abs(a.column - b.column), Math.abs(a.row - b.row));
}

export function areAdjacent(a: MapSquareCoordinate, b: MapSquareCoordinate): boolean {
  const dc = Math.abs(a.column - b.column);
  const dr = Math.abs(a.row - b.row);
  return dc <= 1 && dr <= 1 && !(dc === 0 && dr === 0);
}

export function isDiagonalStep(a: MapSquareCoordinate, b: MapSquareCoordinate): boolean {
  return Math.abs(a.column - b.column) === 1 && Math.abs(a.row - b.row) === 1;
}
