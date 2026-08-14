/**
 * Vanilla PixiJS tactical stage for Phase 2b.
 *
 * Blueprint ownership: Sections 1.10.9 and 9.11.1 — Vanilla Pixi only (no
 * `@pixi/react`), layers from the Render Layer Registry, projections from the
 * server. This module draws the current map bundle; it does not invent cells.
 */

import { Application, Container, Graphics, Text } from 'pixi.js';

import {
  WEBGL_LAYER_Z_INDEX,
  WEBGL_RENDER_LAYERS,
  type MapBundleProjection,
  type WebGlRenderLayer,
} from '../../shared/map-contract.js';

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

/**
 * Mounts a Pixi application into `host` and returns a handle that accepts
 * server map projections. Call destroy on page unmount.
 */
export async function mountTableStage(host: HTMLElement): Promise<TableStageHandle> {
  host.replaceChildren();
  host.setAttribute('data-testid', 'table-stage-host');

  const application = new Application();
  await application.init({
    background: '#0c0a08',
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    resizeTo: host,
  });
  application.canvas.setAttribute('data-testid', 'table-stage-canvas');
  application.canvas.setAttribute('aria-label', 'Tactical map stage');
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

  function paint(map: MapBundleProjection): void {
    currentMap = map;
    const { columns, rows, pixelsPerSquare } = map.coordinateSpace;
    const width = columns * pixelsPerSquare;
    const height = rows * pixelsPerSquare;

    for (const name of WEBGL_RENDER_LAYERS) {
      layers[name].removeChildren();
    }

    const background = new Graphics();
    background.rect(0, 0, width, height).fill(0x0c0a08);
    layers.world_background.addChild(background);

    const terrain = new Graphics();
    for (const cell of map.cells) {
      const x = cell.column * pixelsPerSquare;
      const y = cell.row * pixelsPerSquare;
      terrain.rect(x, y, pixelsPerSquare, pixelsPerSquare).fill(terrainColor(cell.terrain));
    }
    layers.terrain_art.addChild(terrain);

    const grid = new Graphics();
    grid.setStrokeStyle({ width: 1, color: 0xc4a574, alpha: 0.35 });
    for (let column = 0; column <= columns; column += 1) {
      const x = column * pixelsPerSquare;
      grid.moveTo(x, 0).lineTo(x, height);
    }
    for (let row = 0; row <= rows; row += 1) {
      const y = row * pixelsPerSquare;
      grid.moveTo(0, y).lineTo(width, y);
    }
    grid.stroke();
    layers.grid_reference.addChild(grid);

    const structural = new Graphics();
    for (const edge of map.edges) {
      const x = edge.column * pixelsPerSquare;
      const y = edge.row * pixelsPerSquare;
      const isDoor = edge.kind === 'door';
      structural.setStrokeStyle({
        width: isDoor ? 4 : 5,
        color: isDoor ? 0xb86b2b : 0x8a7a62,
        alpha: 0.95,
      });
      if (edge.orientation === 'east') {
        structural.moveTo(x + pixelsPerSquare, y).lineTo(x + pixelsPerSquare, y + pixelsPerSquare);
      } else if (edge.orientation === 'west') {
        structural.moveTo(x, y).lineTo(x, y + pixelsPerSquare);
      } else if (edge.orientation === 'south') {
        structural.moveTo(x, y + pixelsPerSquare).lineTo(x + pixelsPerSquare, y + pixelsPerSquare);
      } else {
        structural.moveTo(x, y).lineTo(x + pixelsPerSquare, y);
      }
      structural.stroke();
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

    // Keep the map centered in the host without inventing world coordinates.
    const viewWidth = application.screen.width;
    const viewHeight = application.screen.height;
    root.x = Math.max(12, (viewWidth - width) / 2);
    root.y = Math.max(12, (viewHeight - height) / 2);
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
