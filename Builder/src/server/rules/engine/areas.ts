import type {
  AreaCell,
  AreaTarget,
  GridPoint3d,
} from '../../../shared/rules-combat-contract.js';

export const GRID_FEET = 5;

function cell(column: number, row: number, elevationFeet: number): AreaCell {
  return {
    id: `${column},${row},${elevationFeet}`,
    column,
    row,
    elevationFeet,
  };
}

function validateArea(area: AreaTarget): void {
  for (const value of [
    area.origin.column,
    area.origin.row,
    area.origin.elevationFeet,
    area.sizeFeet,
    area.heightFeet,
  ]) {
    if (!Number.isInteger(value)) {
      throw new Error('Area coordinates and dimensions must be whole numbers.');
    }
  }
  if (
    area.sizeFeet < GRID_FEET ||
    area.sizeFeet > 120 ||
    area.heightFeet < GRID_FEET ||
    area.heightFeet > 120 ||
    area.sizeFeet % GRID_FEET !== 0 ||
    area.heightFeet % GRID_FEET !== 0
  ) {
    throw new Error('Area dimensions must be 5-foot increments from 5 to 120 feet.');
  }
  if ((area.shape === 'cone' || area.shape === 'line') && area.direction === undefined) {
    throw new Error(`${area.shape} areas require a cardinal direction.`);
  }
}

function directionVector(
  direction: NonNullable<AreaTarget['direction']>,
): { dc: number; dr: number } {
  switch (direction) {
    case 'north':
      return { dc: 0, dr: -1 };
    case 'east':
      return { dc: 1, dr: 0 };
    case 'south':
      return { dc: 0, dr: 1 };
    case 'west':
      return { dc: -1, dr: 0 };
  }
}

/**
 * Converts a 3D area into occupied 5-foot cells. Origin is the center of a
 * sphere and the nearest cell/corner for the other shapes.
 */
export function areaFootprint(area: AreaTarget): readonly AreaCell[] {
  validateArea(area);
  const levels = area.heightFeet / GRID_FEET;
  const cells = new Map<string, AreaCell>();
  const add = (column: number, row: number, level: number): void => {
    const next = cell(
      column,
      row,
      area.origin.elevationFeet + level * GRID_FEET,
    );
    cells.set(next.id, next);
  };

  if (area.shape === 'cube') {
    const side = area.sizeFeet / GRID_FEET;
    for (let level = 0; level < levels; level += 1) {
      for (let dc = 0; dc < side; dc += 1) {
        for (let dr = 0; dr < side; dr += 1) {
          add(area.origin.column + dc, area.origin.row + dr, level);
        }
      }
    }
  } else if (area.shape === 'sphere') {
    const radius = area.sizeFeet;
    const horizontalRadius = Math.ceil(radius / GRID_FEET);
    for (let level = 0; level < levels; level += 1) {
      for (let dc = -horizontalRadius; dc <= horizontalRadius; dc += 1) {
        for (let dr = -horizontalRadius; dr <= horizontalRadius; dr += 1) {
          const distance = Math.sqrt(
            (dc * GRID_FEET) ** 2 +
              (dr * GRID_FEET) ** 2 +
              (level * GRID_FEET) ** 2,
          );
          if (distance <= radius) {
            add(area.origin.column + dc, area.origin.row + dr, level);
          }
        }
      }
    }
  } else {
    const vector = directionVector(area.direction!);
    const perpendicular = { dc: -vector.dr, dr: vector.dc };
    const length = area.sizeFeet / GRID_FEET;
    const fixedLineWidth = Math.max(1, (area.widthFeet ?? GRID_FEET) / GRID_FEET);
    for (let level = 0; level < levels; level += 1) {
      for (let forward = 0; forward < length; forward += 1) {
        const halfWidth =
          area.shape === 'cone'
            ? forward
            : Math.max(0, Math.floor((fixedLineWidth - 1) / 2));
        for (let lateral = -halfWidth; lateral <= halfWidth; lateral += 1) {
          add(
            area.origin.column + vector.dc * forward + perpendicular.dc * lateral,
            area.origin.row + vector.dr * forward + perpendicular.dr * lateral,
            level,
          );
        }
      }
    }
  }

  return [...cells.values()].sort(
    (left, right) =>
      left.elevationFeet - right.elevationFeet ||
      left.row - right.row ||
      left.column - right.column,
  );
}

export function areaContains(
  footprint: readonly AreaCell[],
  point: GridPoint3d,
): boolean {
  const id = `${point.column},${point.row},${point.elevationFeet}`;
  return footprint.some((entry) => entry.id === id);
}
