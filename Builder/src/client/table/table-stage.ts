/**
 * Vanilla PixiJS tactical stage for Phase 2b, with an SVG projection mirror.
 *
 * Blueprint ownership: Sections 1.10.9 and 9.11.1 — Vanilla Pixi only (no
 * `@pixi/react`), layers from the Render Layer Registry, projections from the
 * server. The SVG mirror paints the same projection for environments where
 * WebGL/Canvas2D GPU paths stay blank; Pixi still owns the named scene graph.
 */

import { Application, Container, Graphics, Text } from 'pixi.js';

import {
  WEBGL_LAYER_Z_INDEX,
  WEBGL_RENDER_LAYERS,
  type MapBundleProjection,
  type WebGlRenderLayer,
} from '../../shared/map-contract.js';
import { escapeHtml } from '../dom-utils.js';

export interface TableStageHandle {
  readonly destroy: () => void;
  readonly renderMap: (map: MapBundleProjection) => void;
}

function layerContainer(name: WebGlRenderLayer): Container {
  const container = new Container();
  container.label = name;
  container.zIndex = WEBGL_LAYER_Z_INDEX[name];
  container.eventMode = name === 'canvas_affordances' ? 'static' : 'none';
  return container;
}

function terrainColor(terrain: string): number {
  switch (terrain) {
    case 'blocked':
      return 0x1a1410;
    case 'difficult':
      return 0x3a3328;
    default:
      return 0x2a241c;
  }
}

function terrainCss(terrain: string): string {
  switch (terrain) {
    case 'blocked':
      return '#1a1410';
    case 'difficult':
      return '#3a3328';
    default:
      return '#2a241c';
  }
}

function paintSemanticSvg(host: HTMLElement, map: MapBundleProjection): void {
  const { columns, rows, pixelsPerSquare } = map.coordinateSpace;
  const width = columns * pixelsPerSquare;
  const height = rows * pixelsPerSquare;
  const cells = map.cells
    .map(
      (cell) =>
        `<rect data-square="${cell.column},${cell.row}" x="${cell.column * pixelsPerSquare}" y="${cell.row * pixelsPerSquare}" width="${pixelsPerSquare}" height="${pixelsPerSquare}" fill="${terrainCss(cell.terrain)}" />`,
    )
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
      const color = edge.kind === 'door' ? '#b86b2b' : '#8a7a62';
      const widthStroke = edge.kind === 'door' ? 4 : 5;
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
      return `<line data-edge="${escapeHtml(edge.edgeId)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${widthStroke}" />`;
    })
    .join('');
  const tokens = map.tokens
    .map((token) => {
      const pad = 6;
      const x = token.footprint.anchor.column * pixelsPerSquare + pad;
      const y = token.footprint.anchor.row * pixelsPerSquare + pad;
      const w = token.footprint.width * pixelsPerSquare - pad * 2;
      const h = token.footprint.height * pixelsPerSquare - pad * 2;
      return `<g data-token="${escapeHtml(token.tokenId)}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#d4a017" />
        <text x="${x + 6}" y="${y + h / 2 + 4}" fill="#1a1208" font-size="12" font-family="Georgia, serif" font-weight="700">${escapeHtml(token.label)}</text>
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
  wrap.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img" aria-label="${escapeHtml(map.title)}">
    <rect width="${width}" height="${height}" fill="#0c0a08" />
    <g data-layer="terrain_art">${cells}</g>
    <g data-layer="grid_reference">${gridLines.join('')}</g>
    <g data-layer="structural_underlays">${edges}</g>
    <g data-layer="tokens_entities">${tokens}</g>
  </svg>`;
}

/**
 * Mounts a Pixi application into `host` and returns a handle that accepts
 * server map projections. Call destroy on page unmount.
 */
export async function mountTableStage(host: HTMLElement): Promise<TableStageHandle> {
  host.replaceChildren();
  // Keep the page's stage slot test id; mark the host with an additional attribute.
  host.setAttribute('data-table-stage-host', 'true');
  if (!host.getAttribute('data-testid')) {
    host.setAttribute('data-testid', 'table-stage-host');
  }

  const application = new Application();
  // Prefer Canvas2D first so software desktops still initialize a Pixi renderer.
  await application.init({
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    resizeTo: host,
    preference: ['canvas', 'webgl'],
    failIfMajorPerformanceCaveat: false,
  });
  const rendererName = String(
    (application.renderer as { name?: string }).name ?? application.renderer.type ?? 'unknown',
  );
  application.canvas.setAttribute('data-testid', 'table-stage-canvas');
  application.canvas.setAttribute('aria-label', 'Tactical map Pixi stage');
  application.canvas.setAttribute('data-renderer', rendererName.toLowerCase());
  application.canvas.classList.add('table-stage-canvas');
  host.appendChild(application.canvas);

  const root = new Container();
  root.sortableChildren = true;
  application.stage.addChild(root);

  const layers = {} as Record<WebGlRenderLayer, Container>;
  for (const name of WEBGL_RENDER_LAYERS) {
    const container = layerContainer(name);
    layers[name] = container;
    root.addChild(container);
  }

  let currentMap: MapBundleProjection | null = null;

  function paintPixi(map: MapBundleProjection): void {
    const { columns, rows, pixelsPerSquare } = map.coordinateSpace;
    const width = columns * pixelsPerSquare;
    const height = rows * pixelsPerSquare;

    for (const name of WEBGL_RENDER_LAYERS) {
      layers[name].removeChildren();
    }

    const background = new Graphics();
    background.rect(0, 0, width, height).fill({ color: 0x0c0a08, alpha: 0.01 });
    layers.world_background.addChild(background);

    const terrain = new Graphics();
    for (const cell of map.cells) {
      const x = cell.column * pixelsPerSquare;
      const y = cell.row * pixelsPerSquare;
      terrain.rect(x, y, pixelsPerSquare, pixelsPerSquare).fill(terrainColor(cell.terrain));
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

    for (const token of map.tokens) {
      const { footprint } = token;
      const tokenGfx = new Graphics();
      const pad = 6;
      const tokenWidth = footprint.width * pixelsPerSquare - pad * 2;
      const tokenHeight = footprint.height * pixelsPerSquare - pad * 2;
      const tokenX = footprint.anchor.column * pixelsPerSquare + pad;
      const tokenY = footprint.anchor.row * pixelsPerSquare + pad;
      tokenGfx.roundRect(tokenX, tokenY, tokenWidth, tokenHeight, 8).fill({
        color: 0xd4a017,
        alpha: 0.92,
      });
      layers.tokens_entities.addChild(tokenGfx);

      const label = new Text({
        text: token.label,
        style: {
          fill: 0x1a1208,
          fontSize: 12,
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontWeight: '700',
        },
      });
      label.x = tokenX + 6;
      label.y = tokenY + tokenHeight / 2 - 7;
      layers.token_information.addChild(label);
    }

    const viewWidth = application.screen.width;
    const viewHeight = application.screen.height;
    root.x = Math.max(12, (viewWidth - width) / 2);
    root.y = Math.max(12, (viewHeight - height) / 2);
  }

  function paint(map: MapBundleProjection): void {
    currentMap = map;
    paintSemanticSvg(host, map);
    paintPixi(map);
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
    destroy() {
      window.removeEventListener('resize', onResize);
      application.destroy(true);
      host.replaceChildren();
    },
  };
}
