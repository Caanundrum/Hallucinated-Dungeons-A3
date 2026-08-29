/**
 * Vanilla PixiJS tactical stage for Phase 2b, with an SVG projection mirror.
 *
 * Blueprint ownership: Sections 1.10.9 and 9.11.1 — Vanilla Pixi only (no
 * `@pixi/react`), layers from the Render Layer Registry, projections from the
 * server. The SVG mirror paints the same projection for environments where
 * WebGL/Canvas2D GPU paths stay blank or CSP blocks Pixi's shader compiler;
 * Pixi still owns the named scene graph when it can initialize.
 *
 * Phase 5: Emberferry scenes tint terrain by provenance (dock wood / river /
 * mist), animate token moves, and highlight the selected move square.
 */

import { Application, Container, Graphics, Text } from 'pixi.js';

import {
  WEBGL_LAYER_Z_INDEX,
  WEBGL_RENDER_LAYERS,
  type MapBundleProjection,
  type MapEdgeRecord,
  type MapSquareCoordinate,
  type WebGlRenderLayer,
} from '../../shared/map-contract.js';
import {
  doorStrokeColor,
  layoutMapLabels,
  type MapLabelAnchor,
} from '../../shared/map-label-layout.js';
import { escapeHtml } from '../dom-utils.js';
import {
  doorAuthorityFromStored,
  formatDoorAuthorityLabel,
} from '../../shared/play-authority-contract.js';

function edgeAccessibleLabel(edge: MapEdgeRecord): string {
  const facing =
    edge.orientation === 'north'
      ? 'north'
      : edge.orientation === 'south'
        ? 'south'
        : edge.orientation === 'east'
          ? 'east'
          : 'west';
  if (edge.kind === 'door') {
    return `${formatDoorAuthorityLabel(doorAuthorityFromStored(edge.doorState))} facing ${facing}`;
  }
  return `Wall facing ${facing}`;
}

function edgeHitBox(
  edge: MapEdgeRecord,
  pixelsPerSquare: number,
): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  const pad = 12;
  const x = edge.column * pixelsPerSquare;
  const y = edge.row * pixelsPerSquare;
  if (edge.orientation === 'east') {
    return { x: x + pixelsPerSquare - pad / 2, y, w: pad, h: pixelsPerSquare };
  }
  if (edge.orientation === 'west') {
    return { x: x - pad / 2, y, w: pad, h: pixelsPerSquare };
  }
  if (edge.orientation === 'south') {
    return { x, y: y + pixelsPerSquare - pad / 2, w: pixelsPerSquare, h: pad };
  }
  return { x, y: y - pad / 2, w: pixelsPerSquare, h: pad };
}

export interface TableStageHandle {
  readonly destroy: () => void;
  readonly renderMap: (map: MapBundleProjection) => void;
  readonly setSquareClickHandler: (
    handler: ((square: { column: number; row: number }) => void) | null,
  ) => void;
  readonly setEdgeClickHandler: (handler: ((edgeId: string) => void) | null) => void;
  readonly setMoveTarget: (square: MapSquareCoordinate | null) => void;
  readonly setSelectedEdge: (edgeId: string | null) => void;
}

function layerContainer(name: WebGlRenderLayer): Container {
  const container = new Container();
  container.label = name;
  container.zIndex = WEBGL_LAYER_Z_INDEX[name];
  container.eventMode = name === 'canvas_affordances' ? 'static' : 'none';
  return container;
}

function prefersReducedMotion(): boolean {
  return (
    document.documentElement.classList.contains('hd-reduced-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function isEmberferryScene(map: MapBundleProjection): boolean {
  return map.artProvenance === 'original_phase5_starter_v1';
}

function terrainColor(terrain: string, known = true, emberferry = false): number {
  if (!known) {
    return 0x1c2430; // fog — distinct from empty void (TQA-057)
  }
  if (emberferry) {
    switch (terrain) {
      case 'blocked':
        return 0x0f2a3a; // river / rock in shadow
      case 'difficult':
        return 0x3d5a4a; // ember-mist boards / flooded stone
      default:
        return 0x6b4e2e; // timber dock / dry stone
    }
  }
  switch (terrain) {
    case 'blocked':
      return 0x1a1410;
    case 'difficult':
      return 0x3a3328;
    default:
      return 0x2a241c;
  }
}

function terrainCss(terrain: string, known: boolean, emberferry = false): string {
  if (!known) {
    return '#1c2430';
  }
  if (emberferry) {
    switch (terrain) {
      case 'blocked':
        return '#0f2a3a';
      case 'difficult':
        return '#3d5a4a';
      default:
        return '#6b4e2e';
    }
  }
  switch (terrain) {
    case 'blocked':
      return '#1a1410';
    case 'difficult':
      return '#3a3328';
    default:
      return '#2a241c';
  }
}

function tokenPixelBox(
  map: MapBundleProjection,
  token: MapBundleProjection['tokens'][number],
): { x: number; y: number; w: number; h: number } {
  const pad = 6;
  const { pixelsPerSquare } = map.coordinateSpace;
  return {
    x: token.footprint.anchor.column * pixelsPerSquare + pad,
    y: token.footprint.anchor.row * pixelsPerSquare + pad,
    w: token.footprint.width * pixelsPerSquare - pad * 2,
    h: token.footprint.height * pixelsPerSquare - pad * 2,
  };
}

function tokenLabelFontSize(
  pixelsPerSquare: number,
  hostWidth: number,
  mapPixelWidth: number,
): number {
  const displayScale = hostWidth > 0 && mapPixelWidth > 0 ? hostWidth / mapPixelWidth : 1;
  const minCssPx = 11;
  const minSvgUnits = minCssPx / Math.max(displayScale, 0.35);
  return Math.max(minSvgUnits, Math.round(pixelsPerSquare * 0.34));
}

function mapTerrainSummary(map: MapBundleProjection): string {
  const { columns, rows } = map.coordinateSpace;
  let floor = 0;
  let difficult = 0;
  let blocked = 0;
  let unexplored = 0;
  for (const cell of map.cells) {
    if (!cell.known) {
      unexplored += 1;
    } else if (cell.terrain === 'blocked') {
      blocked += 1;
    } else if (cell.terrain === 'difficult') {
      difficult += 1;
    } else {
      floor += 1;
    }
  }
  const scene = map.title.trim().length > 0 ? map.title : 'Scene';
  const exits = map.edges.filter((edge) => edge.kind === 'door').length;
  const party =
    map.tokens.length > 0
      ? map.tokens
          .map(
            (token) =>
              `${token.label} at ${token.footprint.anchor.column},${token.footprint.anchor.row}`,
          )
          .join('; ')
      : 'no party token';
  return `${scene} · ${columns}×${rows} · ${party} · ${exits} door${exits === 1 ? '' : 's'} · ${floor} floor, ${difficult} difficult, ${blocked} blocked, ${unexplored} fog`;
}

function paintSemanticSvg(
  host: HTMLElement,
  map: MapBundleProjection,
  moveTarget: MapSquareCoordinate | null,
  selectedEdgeId: string | null,
  priorTokenBoxes: Map<string, { x: number; y: number }>,
  zoomScale: number,
): Map<string, { x: number; y: number }> {
  const lowEffects =
    document.documentElement.classList.contains('hd-low-effects') ||
    document.documentElement.classList.contains('hd-reduced-motion');
  const emberferry = isEmberferryScene(map);
  const { columns, rows, pixelsPerSquare } = map.coordinateSpace;
  const width = columns * pixelsPerSquare;
  const height = rows * pixelsPerSquare;
  const reduceMotion = prefersReducedMotion() || lowEffects;
  const nextBoxes = new Map<string, { x: number; y: number }>();
  const labelSize = tokenLabelFontSize(pixelsPerSquare, host.clientWidth, width);

  const cells = map.cells
    .map((cell) => {
      const fogClass = cell.known
        ? ''
        : lowEffects
          ? ' map-square-fog map-square-fog-flat'
          : ' map-square-fog';
      const selected =
        moveTarget !== null &&
        moveTarget.column === cell.column &&
        moveTarget.row === cell.row
          ? ' map-square-selected'
          : '';
      return `<rect aria-hidden="true" data-square="${cell.column},${cell.row}" data-known="${cell.known}" data-terrain="${escapeHtml(cell.terrain)}" data-low-effects="${lowEffects}" x="${cell.column * pixelsPerSquare}" y="${cell.row * pixelsPerSquare}" width="${pixelsPerSquare}" height="${pixelsPerSquare}" fill="${terrainCss(cell.terrain, cell.known, emberferry)}" class="map-square${fogClass}${selected}" />`;
    })
    .join('');
  const gridLines: string[] = [];
  for (let column = 0; column <= columns; column += 1) {
    const x = column * pixelsPerSquare;
    gridLines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#c4a574" stroke-opacity="0.45" />`,
    );
  }
  for (let row = 0; row <= rows; row += 1) {
    const y = row * pixelsPerSquare;
    gridLines.push(
      `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#c4a574" stroke-opacity="0.45" />`,
    );
  }
  const edges = map.edges
    .map((edge) => {
      const x = edge.column * pixelsPerSquare;
      const y = edge.row * pixelsPerSquare;
      const color =
        edge.kind === 'door' ? doorStrokeColor(edge.doorState) : '#8a7a62';
      const widthStroke = edge.kind === 'door' ? 5 : 5;
      let x1 = x;
      let y1 = y;
      let x2 = x;
      let y2 = y;
      if (edge.orientation === 'east') {
        x1 = x + pixelsPerSquare;
        x2 = x + pixelsPerSquare;
        y2 = y + pixelsPerSquare;
      } else if (edge.orientation === 'west') {
        y2 = y + pixelsPerSquare;
      } else if (edge.orientation === 'south') {
        y1 = y + pixelsPerSquare;
        x2 = x + pixelsPerSquare;
        y2 = y + pixelsPerSquare;
      } else {
        x2 = x + pixelsPerSquare;
      }
      const hit = edgeHitBox(edge, pixelsPerSquare);
      const label = edgeAccessibleLabel(edge);
      const selected = selectedEdgeId === edge.edgeId ? ' map-edge-selected' : '';
      const dash =
        edge.kind === 'door' && edge.doorState === 'locked'
          ? ' stroke-dasharray="6 4"'
          : edge.kind === 'door' && edge.doorState === 'unlocked'
            ? ' stroke-dasharray="2 3"'
            : '';
      return `<g role="button" tabindex="0" aria-label="${escapeHtml(label)}" data-edge="${escapeHtml(edge.edgeId)}" class="map-edge-hit-target${selected}" aria-pressed="${selectedEdgeId === edge.edgeId ? 'true' : 'false'}">
        <rect x="${hit.x}" y="${hit.y}" width="${hit.w}" height="${hit.h}" fill="transparent" stroke="none" />
        <line aria-hidden="true" data-edge="${escapeHtml(edge.edgeId)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${widthStroke}"${dash} pointer-events="none" />
      </g>`;
    })
    .join('');

  const labelAnchors: MapLabelAnchor[] = [
    ...map.tokens.map((token) => {
      const box = tokenPixelBox(map, token);
      return {
        id: `token:${token.tokenId}`,
        kind: 'token' as const,
        x: box.x + box.w / 2,
        y: box.y + box.h / 2,
        obstacle: { x: box.x, y: box.y, w: box.w, h: box.h },
        fullLabel: token.label,
        referenceKind: null,
      };
    }),
    ...map.notableFeatures.map((feature, index) => {
      const cx = feature.column * pixelsPerSquare + pixelsPerSquare / 2;
      const cy = feature.row * pixelsPerSquare + pixelsPerSquare / 2;
      return {
        id: `marker:${feature.column}:${feature.row}:${index}`,
        kind: 'marker' as const,
        x: cx,
        y: cy,
        obstacle: { x: cx - 7, y: cy - 7, w: 14, h: 14 },
        fullLabel: feature.label,
        referenceKind: feature.referenceKind ?? 'prop',
      };
    }),
  ];
  const labelPlacements = layoutMapLabels(labelAnchors, {
    mapWidth: width,
    mapHeight: height,
    pixelsPerSquare,
    zoomScale,
  });

  const tokens = map.tokens
    .map((token) => {
      const box = tokenPixelBox(map, token);
      nextBoxes.set(token.tokenId, { x: box.x, y: box.y });
      const prior = priorTokenBoxes.get(token.tokenId);
      const animate =
        !reduceMotion &&
        prior !== undefined &&
        (prior.x !== box.x || prior.y !== box.y);
      const transform = animate
        ? `translate(${prior.x - box.x}px, ${prior.y - box.y}px)`
        : 'translate(0px, 0px)';
      const initial = token.label.trim().charAt(0).toUpperCase() || '?';
      return `<g role="img" tabindex="0" aria-label="${escapeHtml(token.label)} token on the map" data-token="${escapeHtml(token.tokenId)}" data-anchor-column="${token.footprint.anchor.column}" data-anchor-row="${token.footprint.anchor.row}" class="${animate ? 'token-moving' : ''}" style="transform:${transform}">
        <circle cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" r="${Math.min(box.w, box.h) / 2}" fill="#c9a227" stroke="#f8e7b0" stroke-width="2.5" />
        <circle cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" r="${Math.min(box.w, box.h) / 2 - 3}" fill="#5a3d12" stroke="none" />
        <text x="${box.x + box.w / 2}" y="${box.y + box.h / 2 + labelSize * 0.35}" text-anchor="middle" fill="#f8e7b0" font-size="${Math.max(10, labelSize * 0.85)}" font-family="ui-sans-serif, system-ui, sans-serif" font-weight="700">${escapeHtml(initial)}</text>
      </g>`;
    })
    .join('');

  const hazardFeatures = map.notableFeatures.filter(
    (feature) => feature.referenceKind === 'hazard',
  );
  const groundFeatures = map.notableFeatures.filter(
    (feature) => feature.referenceKind !== 'hazard',
  );
  const paintFeatureDot = (feature: (typeof map.notableFeatures)[number]): string => {
    const x = feature.column * pixelsPerSquare + pixelsPerSquare / 2;
    const y = feature.row * pixelsPerSquare + pixelsPerSquare / 2;
    const fill = feature.referenceKind === 'hazard' ? '#c47a4a' : '#f2d38a';
    return `<g data-notable-feature="${escapeHtml(feature.label)}" data-reference-kind="${escapeHtml(feature.referenceKind ?? 'prop')}">
      <circle cx="${x}" cy="${y}" r="6" fill="${fill}" stroke="#1a1208" stroke-width="1.5" />
    </g>`;
  };
  const hazardLayer = hazardFeatures.map(paintFeatureDot).join('');
  const groundLayer = groundFeatures.map(paintFeatureDot).join('');
  const labelLayer = labelPlacements
    .map((placement) => {
      const leader =
        placement.leader === null
          ? ''
          : `<line class="map-label-leader" x1="${placement.leader.x1}" y1="${placement.leader.y1}" x2="${placement.leader.x2}" y2="${placement.leader.y2}" stroke="#c4a574" stroke-opacity="0.55" stroke-width="1" />`;
      return `<g class="map-label-chip" data-label-id="${escapeHtml(placement.id)}" data-label-kind="${placement.kind}" data-testid="map-label-chip">
        ${leader}
        <rect x="${placement.x}" y="${placement.y}" width="${placement.width}" height="${placement.height}" rx="4" class="map-label-plate" fill="#16110c" fill-opacity="0.92" stroke="#c4a574" stroke-opacity="0.7" />
        <text x="${placement.x + 7}" y="${placement.y + placement.height / 2 + placement.fontSize * 0.35}" fill="#f8e7b0" font-size="${placement.fontSize}" font-family="ui-sans-serif, system-ui, sans-serif" font-weight="600">${escapeHtml(placement.displayText)}</text>
        <title>${escapeHtml(placement.fullLabel)}</title>
      </g>`;
    })
    .join('');

  let wrap = host.querySelector<HTMLElement>('[data-testid="table-stage-semantic"]');
  if (wrap === null) {
    wrap = document.createElement('div');
    wrap.setAttribute('data-testid', 'table-stage-semantic');
    wrap.setAttribute('aria-label', 'Tactical map projection');
    wrap.className = 'table-stage-semantic';
    host.appendChild(wrap);
  }
  const sceneTitle = map.title.trim().length > 0 ? map.title : 'Shared scene';
  wrap.innerHTML = `
    <div class="table-stage-toolbar" data-testid="map-stage-toolbar">
      <button type="button" data-map-zoom="out" aria-label="Zoom out">−</button>
      <button type="button" data-map-zoom="in" aria-label="Zoom in">+</button>
      <button type="button" data-map-zoom="fit" aria-label="Fit map to viewport">Fit</button>
      <button type="button" data-map-zoom="center" aria-label="Center on party">Center</button>
      <button type="button" data-map-zoom="preset" data-zoom-preset="0.75" aria-label="Zoom 75%">75%</button>
      <button type="button" data-map-zoom="preset" data-zoom-preset="1" aria-label="Zoom 100%">100%</button>
      <button type="button" data-map-zoom="preset" data-zoom-preset="1.5" aria-label="Zoom 150%">150%</button>
      <span class="record-meta" data-testid="map-zoom-indicator" aria-live="polite">Zoom ${Math.round(zoomScale * 100)}%</span>
    </div>
    <details class="map-stage-help" data-testid="map-zoom-help">
      <summary>Map controls</summary>
      <p class="record-meta">Fit scales the scene to fill this frame. Drag to pan when zoomed. Center focuses the party token. Labels route around tokens to avoid collisions.</p>
    </details>
    <p class="map-scene-title" data-testid="map-scene-title">${escapeHtml(sceneTitle)}</p>
    <p class="map-terrain-summary" role="region" aria-label="Map summary" data-testid="map-terrain-summary">
      ${escapeHtml(mapTerrainSummary(map))}
    </p>
    <div class="table-stage-svg-viewport" data-testid="table-stage-svg-viewport" data-pan-enabled="true">
      <div class="table-stage-svg-scaler" data-testid="table-stage-svg-scaler" style="width:${width * zoomScale}px;height:${height * zoomScale}px;">
        <svg viewBox="0 0 ${width} ${height}" width="${width * zoomScale}" height="${height * zoomScale}" role="grid" aria-label="${escapeHtml(map.title)}" data-testid="table-stage-svg" data-scene-title="${escapeHtml(map.title)}">
          <defs>
            <pattern id="map-fog-hatch" width="8" height="8" patternUnits="userSpaceOnUse">
              <rect width="8" height="8" fill="#1c2430" />
              <path d="M0 8 L8 0" stroke="#3a4a5c" stroke-width="1" stroke-opacity="0.7" />
            </pattern>
          </defs>
          <rect width="${width}" height="${height}" fill="${emberferry ? '#071820' : '#0c0a08'}" />
          <g data-layer="terrain_art">${cells}</g>
          <g data-layer="fog_hatch">${map.cells
            .filter((cell) => !cell.known)
            .map(
              (cell) =>
                `<rect aria-hidden="true" x="${cell.column * pixelsPerSquare}" y="${cell.row * pixelsPerSquare}" width="${pixelsPerSquare}" height="${pixelsPerSquare}" fill="url(#map-fog-hatch)" class="map-square-fog-hatch" />`,
            )
            .join('')}</g>
          <g data-layer="grid_reference">${gridLines.join('')}</g>
          <g data-layer="structural_underlays">${edges}</g>
          <g data-layer="hazards_zones" data-testid="table-stage-hazard-markers">${hazardLayer}</g>
          <g data-layer="ground_markers" data-testid="table-stage-ground-markers">${groundLayer}</g>
          <g data-layer="tokens_entities">${tokens}</g>
          <g data-layer="label_chips" data-testid="table-stage-label-chips">${labelLayer}</g>
          <g data-layer="overhead_environment" data-testid="table-stage-notable-features"></g>
        </svg>
      </div>
    </div>
    <details class="map-fog-legend" data-testid="map-fog-legend" aria-label="Map legend">
      <summary>Map legend</summary>
      <div class="map-legend-groups">
        <div class="map-legend-group" data-testid="map-legend-terrain">
          <span class="map-legend-heading">Terrain</span>
          <span><span class="swatch" style="background:#2a241c"></span> Floor</span>
          <span><span class="swatch" style="background:#3a3328"></span> Difficult</span>
          <span><span class="swatch" style="background:#1a1410"></span> Blocked</span>
          <span><span class="swatch map-legend-fog" style="background:#1c2430"></span> Fog (unexplored)</span>
        </div>
        <div class="map-legend-group" data-testid="map-legend-structure">
          <span class="map-legend-heading">Structure</span>
          <span><span class="swatch" style="background:#b86b2b"></span> Door closed</span>
          <span><span class="swatch" style="background:#3d8f6a"></span> Door unlocked</span>
          <span><span class="swatch" style="background:#a33b2b"></span> Door locked</span>
          <span><span class="swatch" style="background:#d4a017"></span> Door open</span>
          <span><span class="swatch" style="background:#8a7a62"></span> Wall</span>
        </div>
        <div class="map-legend-group" data-testid="map-legend-entities">
          <span class="map-legend-heading">Entities &amp; references</span>
          <span><span class="swatch" style="background:#c9a227;border-radius:50%"></span> Party token</span>
          <span><span class="swatch" style="background:#f2d38a;border-radius:50%"></span> Reference (lighting/cover/prop)</span>
          <span><span class="swatch" style="background:#c47a4a;border-radius:50%"></span> Hazard reference</span>
        </div>
      </div>
    </details>
    <details class="map-stage-help" data-testid="map-hazard-layer-note">
      <summary>Alpha map scope</summary>
      <p class="record-meta">
        Walls and doors are structural. Lighting, hazards, cover, and props may appear as named reference markers only — they do not change movement, combat, or detection.
        Traps and locks are not map layers; resolve them through play declarations.
        Fog marks unexplored squares — not empty void.
      </p>
    </details>`;

  if (!reduceMotion) {
    requestAnimationFrame(() => {
      wrap?.querySelectorAll<SVGGElement>('g.token-moving').forEach((node) => {
        node.style.transition = 'transform 280ms ease-out';
        node.style.transform = 'translate(0px, 0px)';
      });
    });
  }

  return nextBoxes;
}

/**
 * Mounts a Pixi application into `host` when the environment allows it, and
 * always keeps the SVG projection mirror for CSP / software-desktop fallbacks.
 */
export async function mountTableStage(host: HTMLElement): Promise<TableStageHandle> {
  host.replaceChildren();
  host.setAttribute('data-table-stage-host', 'true');
  if (!host.getAttribute('data-testid')) {
    host.setAttribute('data-testid', 'table-stage-host');
  }

  let currentMap: MapBundleProjection | null = null;
  let moveTarget: MapSquareCoordinate | null = null;
  let selectedEdgeId: string | null = null;
  let squareClickHandler: ((square: { column: number; row: number }) => void) | null = null;
  let edgeClickHandler: ((edgeId: string) => void) | null = null;
  let application: Application | null = null;
  let root: Container | null = null;
  let layers: Record<WebGlRenderLayer, Container> | null = null;
  let priorTokenBoxes = new Map<string, { x: number; y: number }>();
  /** Absolute display scale: map pixel → CSS pixel (Fit sets this to fill the frame). */
  let zoomScale = 1;
  let hasFittedOnce = false;

  function mapPixelSize(): { width: number; height: number } | null {
    if (currentMap === null) {
      return null;
    }
    return {
      width: currentMap.coordinateSpace.columns * currentMap.coordinateSpace.pixelsPerSquare,
      height: currentMap.coordinateSpace.rows * currentMap.coordinateSpace.pixelsPerSquare,
    };
  }

  function applyZoom(next: number): void {
    const size = mapPixelSize();
    zoomScale = Math.max(0.35, Math.min(3.2, next));
    const scaler = host.querySelector<HTMLElement>('[data-testid="table-stage-svg-scaler"]');
    const svg = host.querySelector<SVGSVGElement>('[data-testid="table-stage-svg"]');
    if (size !== null && scaler !== null && svg !== null) {
      const displayW = size.width * zoomScale;
      const displayH = size.height * zoomScale;
      scaler.style.width = `${displayW}px`;
      scaler.style.height = `${displayH}px`;
      svg.setAttribute('width', `${displayW}`);
      svg.setAttribute('height', `${displayH}`);
    }
    const indicator = host.querySelector<HTMLElement>('[data-testid="map-zoom-indicator"]');
    if (indicator !== null) {
      indicator.textContent = `Zoom ${Math.round(zoomScale * 100)}%`;
    }
  }

  function fitMapToViewport(): void {
    const viewport = host.querySelector<HTMLElement>('[data-testid="table-stage-svg-viewport"]');
    const size = mapPixelSize();
    if (viewport === null || size === null) {
      applyZoom(1);
      return;
    }
    const pad = 12;
    const vw = Math.max(48, viewport.clientWidth - pad);
    const vh = Math.max(48, viewport.clientHeight - pad);
    const fit = Math.min(vw / size.width, vh / size.height);
    applyZoom(fit);
    viewport.scrollTo({
      left: Math.max(0, (size.width * fit - viewport.clientWidth) / 2),
      top: Math.max(0, (size.height * fit - viewport.clientHeight) / 2),
      behavior: 'smooth',
    });
  }

  function centerOnParty(): void {
    const viewport = host.querySelector<HTMLElement>('[data-testid="table-stage-svg-viewport"]');
    if (viewport === null || currentMap === null) {
      return;
    }
    const token =
      currentMap.viewerSeatId === null
        ? currentMap.tokens[0]
        : (currentMap.tokens.find((entry) => entry.seatId === currentMap!.viewerSeatId) ??
          currentMap.tokens[0]);
    if (token === undefined) {
      viewport.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      return;
    }
    const { pixelsPerSquare } = currentMap.coordinateSpace;
    const cx = (token.footprint.anchor.column + 0.5) * pixelsPerSquare * zoomScale;
    const cy = (token.footprint.anchor.row + 0.5) * pixelsPerSquare * zoomScale;
    viewport.scrollTo({
      left: Math.max(0, cx - viewport.clientWidth / 2),
      top: Math.max(0, cy - viewport.clientHeight / 2),
      behavior: 'smooth',
    });
  }

  function bindPan(): void {
    const viewport = host.querySelector<HTMLElement>('[data-testid="table-stage-svg-viewport"]');
    if (viewport === null || viewport.dataset.panBound === '1') {
      return;
    }
    viewport.dataset.panBound = '1';
    let dragging = false;
    let originX = 0;
    let originY = 0;
    let scrollLeft = 0;
    let scrollTop = 0;
    viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, a, [data-edge], summary') !== null) {
        return;
      }
      dragging = true;
      originX = event.clientX;
      originY = event.clientY;
      scrollLeft = viewport.scrollLeft;
      scrollTop = viewport.scrollTop;
      viewport.classList.add('is-panning');
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!dragging) {
        return;
      }
      viewport.scrollLeft = scrollLeft - (event.clientX - originX);
      viewport.scrollTop = scrollTop - (event.clientY - originY);
    });
    const endPan = (event: PointerEvent) => {
      if (!dragging) {
        return;
      }
      dragging = false;
      viewport.classList.remove('is-panning');
      try {
        viewport.releasePointerCapture(event.pointerId);
      } catch {
        // Capture may already be released.
      }
    };
    viewport.addEventListener('pointerup', endPan);
    viewport.addEventListener('pointercancel', endPan);
  }

  function bindToolbar(): void {
    host.querySelectorAll<HTMLButtonElement>('[data-map-zoom]').forEach((button) => {
      button.onclick = () => {
        const mode = button.getAttribute('data-map-zoom');
        if (mode === 'in') {
          applyZoom(zoomScale * 1.15);
        } else if (mode === 'out') {
          applyZoom(zoomScale / 1.15);
        } else if (mode === 'fit') {
          fitMapToViewport();
        } else if (mode === 'center') {
          centerOnParty();
        } else if (mode === 'preset') {
          const preset = Number(button.getAttribute('data-zoom-preset') ?? '1');
          const size = mapPixelSize();
          const viewport = host.querySelector<HTMLElement>('[data-testid="table-stage-svg-viewport"]');
          if (size !== null && viewport !== null) {
            const pad = 12;
            const fit = Math.min(
              Math.max(48, viewport.clientWidth - pad) / size.width,
              Math.max(48, viewport.clientHeight - pad) / size.height,
            );
            applyZoom(fit * preset);
          } else {
            applyZoom(preset);
          }
        }
      };
    });
  }

  function bindSquareClicks(): void {
    host.querySelectorAll<SVGRectElement>('rect[data-square]').forEach((rect) => {
      rect.style.cursor = 'pointer';
      rect.onclick = () => {
        if (squareClickHandler === null) return;
        const raw = rect.getAttribute('data-square');
        if (raw === null) return;
        const [columnText, rowText] = raw.split(',');
        const column = Number(columnText);
        const row = Number(rowText);
        if (!Number.isInteger(column) || !Number.isInteger(row)) return;
        squareClickHandler({ column, row });
      };
    });
  }

  function bindEdgeClicks(): void {
    host.querySelectorAll<SVGGElement>('g[data-edge]').forEach((group) => {
      group.style.cursor = 'pointer';
      const activate = (): void => {
        if (edgeClickHandler === null) return;
        const edgeId = group.getAttribute('data-edge');
        if (edgeId === null) return;
        edgeClickHandler(edgeId);
      };
      group.onclick = activate;
      group.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      };
    });
  }

  function paintPixi(map: MapBundleProjection): void {
    if (application === null || root === null || layers === null) {
      return;
    }
    const emberferry = isEmberferryScene(map);
    const { columns, rows, pixelsPerSquare } = map.coordinateSpace;
    const width = columns * pixelsPerSquare;
    const height = rows * pixelsPerSquare;

    for (const name of WEBGL_RENDER_LAYERS) {
      layers[name].removeChildren();
    }

    const background = new Graphics();
    background.rect(0, 0, width, height).fill({
      color: emberferry ? 0x071820 : 0x0c0a08,
      alpha: 0.01,
    });
    layers.world_background.addChild(background);

    const terrain = new Graphics();
    for (const cell of map.cells) {
      const x = cell.column * pixelsPerSquare;
      const y = cell.row * pixelsPerSquare;
      terrain
        .rect(x, y, pixelsPerSquare, pixelsPerSquare)
        .fill(terrainColor(cell.terrain, cell.known, emberferry));
    }
    layers.terrain_art.addChild(terrain);

    const grid = new Graphics();
    for (let column = 0; column <= columns; column += 1) {
      const x = column * pixelsPerSquare;
      grid.moveTo(x, 0).lineTo(x, height);
    }
    for (let row = 0; row <= rows; row += 1) {
      const y = row * pixelsPerSquare;
      grid.moveTo(0, y).lineTo(width, y);
    }
    grid.stroke({ width: 1, color: 0xc4a574, alpha: 0.35 });
    layers.grid_reference.addChild(grid);

    const structural = new Graphics();
    for (const edge of map.edges) {
      const x = edge.column * pixelsPerSquare;
      const y = edge.row * pixelsPerSquare;
      const isDoor = edge.kind === 'door';
      if (edge.orientation === 'east') {
        structural.moveTo(x + pixelsPerSquare, y).lineTo(x + pixelsPerSquare, y + pixelsPerSquare);
      } else if (edge.orientation === 'west') {
        structural.moveTo(x, y).lineTo(x, y + pixelsPerSquare);
      } else if (edge.orientation === 'south') {
        structural.moveTo(x, y + pixelsPerSquare).lineTo(x + pixelsPerSquare, y + pixelsPerSquare);
      } else {
        structural.moveTo(x, y).lineTo(x + pixelsPerSquare, y);
      }
      structural.stroke({
        width: isDoor ? 4 : 5,
        color: isDoor ? 0xb86b2b : 0x8a7a62,
        alpha: 0.95,
      });
    }
    layers.structural_underlays.addChild(structural);

    if (moveTarget !== null) {
      const preview = new Graphics();
      preview
        .rect(
          moveTarget.column * pixelsPerSquare + 2,
          moveTarget.row * pixelsPerSquare + 2,
          pixelsPerSquare - 4,
          pixelsPerSquare - 4,
        )
        .stroke({ width: 3, color: 0xf0c043, alpha: 0.95 });
      layers.action_previews.addChild(preview);
    }

    for (const token of map.tokens) {
      const box = tokenPixelBox(map, token);
      const tokenGfx = new Graphics();
      tokenGfx.roundRect(box.x, box.y, box.w, box.h, 8).fill({
        color: 0xf0c043,
        alpha: 0.95,
      });
      tokenGfx.stroke({ width: 2, color: 0x1a1208, alpha: 1 });
      layers.tokens_entities.addChild(tokenGfx);

      const label = new Text({
        text: token.label,
        style: {
          fill: 0x1a1208,
          fontSize: tokenLabelFontSize(
            map.coordinateSpace.pixelsPerSquare,
            host.clientWidth,
            map.coordinateSpace.columns * map.coordinateSpace.pixelsPerSquare,
          ),
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontWeight: '700',
        },
      });
      label.x = box.x + 6;
      label.y = box.y + box.h / 2 - 7;
      layers.token_information.addChild(label);
    }

    for (const feature of map.notableFeatures) {
      const x = feature.column * pixelsPerSquare + pixelsPerSquare / 2;
      const y = feature.row * pixelsPerSquare + pixelsPerSquare / 2;
      const isHazard = feature.referenceKind === 'hazard';
      const marker = new Graphics();
      marker.circle(x, y, 6).fill({ color: isHazard ? 0xc47a4a : 0xf2d38a, alpha: 0.95 });
      const layer = isHazard ? layers.hazards_zones : layers.ground_markers;
      layer.addChild(marker);
      const featureLabel = new Text({
        text: feature.label,
        style: {
          fill: 0xf8e7b0,
          fontSize: 11,
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontStyle: 'italic',
        },
      });
      featureLabel.x = x + 8;
      featureLabel.y = y - 6;
      layer.addChild(featureLabel);
    }

    const viewWidth = application.screen.width;
    const viewHeight = application.screen.height;
    root.x = Math.max(12, (viewWidth - width) / 2);
    root.y = Math.max(12, (viewHeight - height) / 2);
  }

  function paint(map: MapBundleProjection): void {
    currentMap = map;
    priorTokenBoxes = paintSemanticSvg(host, map, moveTarget, selectedEdgeId, priorTokenBoxes, zoomScale);
    paintPixi(map);
    bindSquareClicks();
    bindEdgeClicks();
    bindToolbar();
    bindPan();
    if (!hasFittedOnce) {
      hasFittedOnce = true;
      requestAnimationFrame(() => fitMapToViewport());
    } else {
      applyZoom(zoomScale);
    }
  }

  try {
    const nextApplication = new Application();
    await nextApplication.init({
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      resizeTo: host,
      preference: ['canvas', 'webgl'],
      failIfMajorPerformanceCaveat: false,
    });
    application = nextApplication;
    const rendererName = String(
      (application.renderer as { name?: string }).name ?? application.renderer.type ?? 'unknown',
    );
    application.canvas.setAttribute('data-testid', 'table-stage-canvas');
    application.canvas.setAttribute('aria-label', 'Tactical map Pixi stage');
    application.canvas.setAttribute('data-renderer', rendererName.toLowerCase());
    application.canvas.classList.add('table-stage-canvas');
    host.appendChild(application.canvas);

    root = new Container();
    root.sortableChildren = true;
    application.stage.addChild(root);

    layers = {} as Record<WebGlRenderLayer, Container>;
    for (const name of WEBGL_RENDER_LAYERS) {
      const container = layerContainer(name);
      layers[name] = container;
      root.addChild(container);
    }
  } catch (failure) {
    // Frozen Local Certification serves a strict CSP without unsafe-eval. Pixi
    // may refuse to start; the SVG semantic mirror remains the playable stage.
    host.setAttribute(
      'data-pixi-fallback',
      failure instanceof Error ? failure.message.slice(0, 160) : 'pixi-unavailable',
    );
    application = null;
    root = null;
    layers = null;
  }

  const onResize = (): void => {
    if (currentMap !== null) {
      paint(currentMap);
    }
  };
  window.addEventListener('resize', onResize);

  return {
    renderMap(map: MapBundleProjection) {
      paint(map);
    },
    setSquareClickHandler(handler) {
      squareClickHandler = handler;
      bindSquareClicks();
    },
    setEdgeClickHandler(handler) {
      edgeClickHandler = handler;
      bindEdgeClicks();
    },
    setMoveTarget(square) {
      moveTarget = square;
      if (currentMap !== null) {
        paint(currentMap);
      }
    },
    setSelectedEdge(edgeId) {
      selectedEdgeId = edgeId;
      if (currentMap !== null) {
        paint(currentMap);
      }
    },
    destroy() {
      window.removeEventListener('resize', onResize);
      if (application !== null) {
        application.destroy(true);
      }
      host.replaceChildren();
    },
  };
}
