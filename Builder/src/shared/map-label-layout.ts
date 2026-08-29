/**
 * Map label placement — collision avoidance for tokens and reference markers (TQA-026–031).
 *
 * Places short callout chips beside anchors without overlapping tokens or each other.
 * Display text is decluttered; full labels stay available for accessibility elsewhere.
 */

export interface MapLabelAnchor {
  readonly id: string;
  readonly kind: 'token' | 'marker';
  /** Anchor center in map pixel space. */
  readonly x: number;
  readonly y: number;
  /** Obstacle box that labels must not cover (token footprint / marker disc). */
  readonly obstacle: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Full canonical label (may include kind suffix). */
  readonly fullLabel: string;
  readonly referenceKind?: string | null;
}

export interface MapLabelPlacement {
  readonly id: string;
  readonly kind: 'token' | 'marker';
  readonly displayText: string;
  readonly fullLabel: string;
  readonly referenceKind: string | null;
  /** Top-left of the chip in map pixel space. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  /** Leader line from anchor center to chip edge midpoint (optional). */
  readonly leader: {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  } | null;
}

export interface MapLabelLayoutOptions {
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly pixelsPerSquare: number;
  /** Effective display zoom (1 = fit). Used for declutter thresholds. */
  readonly zoomScale?: number;
}

const OFFSETS: readonly { readonly dx: number; readonly dy: number }[] = [
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: 1 },
];

/** Strip " — hazard reference" style suffixes for on-map chips. */
export function shortenMapLabel(fullLabel: string): string {
  const trimmed = fullLabel.trim();
  const cut = trimmed.replace(/\s+[—–-]\s+(?:hazard|lighting|cover|prop|landmark|exit|objective)\s+reference\s*$/i, '');
  return cut.length > 0 ? cut : trimmed;
}

function estimateChipSize(
  text: string,
  fontSize: number,
): { readonly width: number; readonly height: number } {
  const avgChar = fontSize * 0.56;
  const width = Math.ceil(text.length * avgChar + 14);
  const height = Math.ceil(fontSize + 10);
  return { width, height };
}

function rectsOverlap(
  a: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  b: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  pad = 3,
): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

function clampChip(
  x: number,
  y: number,
  width: number,
  height: number,
  mapWidth: number,
  mapHeight: number,
): { readonly x: number; readonly y: number } {
  return {
    x: Math.max(2, Math.min(mapWidth - width - 2, x)),
    y: Math.max(2, Math.min(mapHeight - height - 2, y)),
  };
}

/**
 * Resolve non-overlapping label chips for tokens and markers.
 * Tokens are placed first (higher priority), then markers.
 */
export function layoutMapLabels(
  anchors: readonly MapLabelAnchor[],
  options: MapLabelLayoutOptions,
): readonly MapLabelPlacement[] {
  const zoom = options.zoomScale ?? 1;
  const fontSize = Math.max(10, Math.min(14, Math.round(options.pixelsPerSquare * 0.28)));
  const gap = Math.max(8, Math.round(options.pixelsPerSquare * 0.22));
  const showLeaders = zoom >= 1.05;

  const obstacles: { x: number; y: number; w: number; h: number }[] = anchors.map((anchor) => ({
    ...anchor.obstacle,
  }));
  const placements: MapLabelPlacement[] = [];

  const ordered = [...anchors].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'token' ? -1 : 1;
    }
    return left.id.localeCompare(right.id);
  });

  for (const anchor of ordered) {
    const displayText = shortenMapLabel(anchor.fullLabel);
    const size = estimateChipSize(displayText, fontSize);
    let placed: MapLabelPlacement | null = null;

    for (const offset of OFFSETS) {
      const rawX =
        offset.dx > 0
          ? anchor.obstacle.x + anchor.obstacle.w + gap
          : offset.dx < 0
            ? anchor.obstacle.x - size.width - gap
            : anchor.x - size.width / 2;
      const rawY =
        offset.dy > 0
          ? anchor.obstacle.y + anchor.obstacle.h + gap
          : offset.dy < 0
            ? anchor.obstacle.y - size.height - gap
            : anchor.y - size.height / 2;
      const clamped = clampChip(
        rawX,
        rawY,
        size.width,
        size.height,
        options.mapWidth,
        options.mapHeight,
      );
      const chip = { x: clamped.x, y: clamped.y, w: size.width, h: size.height };
      const hits = obstacles.some((obstacle) => rectsOverlap(chip, obstacle));
      if (hits) {
        continue;
      }
      const midX = chip.x + chip.w / 2;
      const midY = chip.y + chip.h / 2;
      placed = {
        id: anchor.id,
        kind: anchor.kind,
        displayText,
        fullLabel: anchor.fullLabel,
        referenceKind: anchor.referenceKind ?? null,
        x: chip.x,
        y: chip.y,
        width: size.width,
        height: size.height,
        fontSize,
        leader: showLeaders
          ? {
              x1: anchor.x,
              y1: anchor.y,
              x2: midX,
              y2: midY,
            }
          : null,
      };
      obstacles.push(chip);
      break;
    }

    if (placed === null) {
      // Last resort: stack below the anchor with a slight cascade.
      const cascade = placements.filter((entry) => entry.kind === anchor.kind).length;
      const clamped = clampChip(
        anchor.x - size.width / 2,
        anchor.obstacle.y + anchor.obstacle.h + gap + cascade * (size.height + 2),
        size.width,
        size.height,
        options.mapWidth,
        options.mapHeight,
      );
      placed = {
        id: anchor.id,
        kind: anchor.kind,
        displayText,
        fullLabel: anchor.fullLabel,
        referenceKind: anchor.referenceKind ?? null,
        x: clamped.x,
        y: clamped.y,
        width: size.width,
        height: size.height,
        fontSize,
        leader: null,
      };
      obstacles.push({ x: placed.x, y: placed.y, w: placed.width, h: placed.height });
    }

    placements.push(placed);
  }

  return placements;
}

/** Distinct door stroke colors for leaf/lock state (TQA-033 / A2). */
export function doorStrokeColor(doorState: string | null): string {
  if (doorState === 'open') {
    return '#d4a017';
  }
  if (doorState === 'locked') {
    return '#a33b2b';
  }
  if (doorState === 'unlocked') {
    return '#3d8f6a';
  }
  return '#b86b2b';
}
