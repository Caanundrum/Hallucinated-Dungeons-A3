import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  atmosphereFromEnvironment,
  lightWashFromLighting,
  objectVisualFamily,
  resolveSceneVisuals,
  terrainFillCss,
  threatFromPurpose,
} from '../../dist/shared/scene-visual-system.js';

describe('Director scene visual system', () => {
  it('maps environments to atmosphere families without fixture titles', () => {
    assert.equal(atmosphereFromEnvironment('wood_interior'), 'enclosed_warm');
    assert.equal(atmosphereFromEnvironment('stone_interior'), 'enclosed_cool');
    assert.equal(atmosphereFromEnvironment('marsh_trail'), 'wet_fog');
    assert.equal(atmosphereFromEnvironment('watchtower'), 'elevated_exposed');
    assert.equal(atmosphereFromEnvironment('hill_clearing'), 'open_clearing');
    assert.notEqual(atmosphereFromEnvironment('wood_interior'), atmosphereFromEnvironment('marsh_trail'));
  });

  it('darkens wash when torchlit scene has no lit lights', () => {
    assert.equal(lightWashFromLighting('torchlit', true), 'wash_torchlit');
    assert.equal(lightWashFromLighting('torchlit', false), 'wash_darkened');
  });

  it('frames encounter purpose as threat', () => {
    assert.equal(threatFromPurpose('encounter'), 'threat_encounter');
    assert.equal(threatFromPurpose('exploration'), 'threat_none');
  });

  it('resolves reusable object family state variants', () => {
    const lit = objectVisualFamily({
      column: 1,
      row: 1,
      label: 'Hearth lamp (lit)',
      objectKind: 'light',
      referenceKind: 'lighting',
      objectState: 'lit',
    });
    const unlit = objectVisualFamily({
      column: 1,
      row: 1,
      label: 'Hearth lamp (unlit)',
      objectKind: 'light',
      referenceKind: 'lighting',
      objectState: 'unlit',
    });
    const intact = objectVisualFamily({
      column: 2,
      row: 2,
      label: 'Bench (intact)',
      objectKind: 'cover',
      referenceKind: 'cover',
      objectState: 'intact',
    });
    const broken = objectVisualFamily({
      column: 2,
      row: 2,
      label: 'Bench (broken)',
      objectKind: 'cover',
      referenceKind: 'cover',
      objectState: 'broken',
    });
    assert.equal(lit.stateVariant, 'state_lit');
    assert.equal(unlit.stateVariant, 'state_unlit');
    assert.equal(intact.stateVariant, 'state_intact');
    assert.equal(broken.stateVariant, 'state_broken');
    assert.equal(objectVisualFamily({
      column: 3,
      row: 3,
      label: 'Cloaked stranger',
      objectKind: 'npc',
      referenceKind: 'npc',
      objectState: 'present',
    }).family, 'family_npc');
  });

  it('makes wet, wooded canopy, and enclosed timber terrain fills differ', () => {
    const warmFloor = terrainFillCss('floor', true, 'timber');
    const canopyFloor = terrainFillCss('floor', true, 'canopy');
    const wetFloor = terrainFillCss('floor', true, 'damp');
    const wetDifficult = terrainFillCss('difficult', true, 'damp');
    assert.notEqual(warmFloor, wetFloor);
    assert.notEqual(warmFloor, canopyFloor);
    assert.notEqual(wetFloor, wetDifficult);
  });

  it('maps forest_path to canopy bias, not timber interiors', () => {
    const wooded = resolveSceneVisuals({
      campaignId: 'c',
      mapBundleId: 'director:wood:c',
      mapVersion: 1,
      title: 'Thicket',
      coordinateSpace: {
        coordinateSpaceId: 's',
        schemaVersion: 'phase2-map-v1',
        columns: 10,
        rows: 8,
        feetPerSquare: 5,
        pixelsPerSquare: 48,
      },
      cells: [],
      edges: [],
      tokens: [],
      artProvenance: 'procedural_local_placeholder',
      sceneBanner: 'banner',
      notableFeatures: [],
      sceneEnvironment: 'forest_path',
      sceneLighting: 'overcast',
      scenePurpose: 'encounter',
      sceneMood: 'threat',
      viewerSeatId: null,
      exploredSquareIds: [],
      visibleSquareIds: [],
    });
    assert.equal(wooded.atmosphere, 'wooded_path');
    assert.equal(wooded.terrainBias, 'canopy');
    assert.equal(wooded.threat, 'threat_encounter');
  });

  it('builds presentation from map contract fields only', () => {
    const visuals = resolveSceneVisuals({
      campaignId: 'c',
      mapBundleId: 'director:x:c',
      mapVersion: 1,
      title: 'Any title',
      coordinateSpace: {
        coordinateSpaceId: 's',
        schemaVersion: 'phase2-map-v1',
        columns: 10,
        rows: 8,
        feetPerSquare: 5,
        pixelsPerSquare: 48,
      },
      cells: [],
      edges: [],
      tokens: [],
      artProvenance: 'procedural_local_placeholder',
      sceneBanner: 'banner',
      notableFeatures: [
        {
          column: 1,
          row: 1,
          label: 'Lamp (unlit)',
          objectKind: 'light',
          referenceKind: 'lighting',
          objectState: 'unlit',
        },
      ],
      sceneEnvironment: 'wood_interior',
      sceneLighting: 'torchlit',
      scenePurpose: 'exploration',
      sceneMood: 'smoke',
      viewerSeatId: null,
      exploredSquareIds: [],
      visibleSquareIds: [],
    });
    assert.equal(visuals.atmosphere, 'enclosed_warm');
    assert.equal(visuals.lightWash, 'wash_darkened');
    assert.equal(visuals.threat, 'threat_none');
    assert.match(visuals.semanticSummary, /enclosed warm/i);
  });
});
