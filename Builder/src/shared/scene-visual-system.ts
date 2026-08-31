/**
 * Reusable Director scene visual system.
 *
 * Driven only by structured scene presentation fields (environment, lighting,
 * purpose) and object kind/state — never by fixture titles like inn/marsh/
 * watchtower. The table renderer applies these families consistently.
 */

import type { MapBundleProjection, MapNotableFeatureRecord } from './map-contract.js';

/** Atmosphere families derived from sceneEnvironment. */
export const SCENE_ATMOSPHERE_FAMILIES = [
  'enclosed_warm',
  'enclosed_cool',
  'wet_fog',
  'wooded_path',
  'settled_street',
  'elevated_exposed',
  'open_clearing',
  'cavernous',
  'waterfront',
  'ruined_open',
  'neutral',
] as const;
export type SceneAtmosphereFamily = (typeof SCENE_ATMOSPHERE_FAMILIES)[number];

export const SCENE_LIGHT_WASHES = [
  'wash_torchlit',
  'wash_dim',
  'wash_daylight',
  'wash_overcast',
  'wash_dusk',
  'wash_darkened',
] as const;
export type SceneLightWash = (typeof SCENE_LIGHT_WASHES)[number];

export const SCENE_THREAT_FRAMES = ['threat_none', 'threat_hazard', 'threat_encounter'] as const;
export type SceneThreatFrame = (typeof SCENE_THREAT_FRAMES)[number];

export interface SceneVisualPresentation {
  readonly atmosphere: SceneAtmosphereFamily;
  readonly lightWash: SceneLightWash;
  readonly threat: SceneThreatFrame;
  readonly elevationCue: 'flat' | 'raised' | 'span';
  readonly terrainBias: 'dry' | 'damp' | 'stone' | 'timber' | 'canopy' | 'open';
  readonly hasLitLight: boolean;
  readonly semanticSummary: string;
}

export function atmosphereFromEnvironment(environment: string | null | undefined): SceneAtmosphereFamily {
  switch (environment) {
    case 'wood_interior':
      return 'enclosed_warm';
    case 'stone_interior':
      return 'enclosed_cool';
    case 'marsh_trail':
      return 'wet_fog';
    case 'forest_path':
      return 'wooded_path';
    case 'village_street':
      return 'settled_street';
    case 'watchtower':
    case 'bridge':
      return 'elevated_exposed';
    case 'hill_clearing':
      return 'open_clearing';
    case 'cavern':
      return 'cavernous';
    case 'docks':
      return 'waterfront';
    case 'ruins':
      return 'ruined_open';
    default:
      return 'neutral';
  }
}

export function lightWashFromLighting(
  lighting: string | null | undefined,
  hasLitLight: boolean,
): SceneLightWash {
  if (!hasLitLight && (lighting === 'torchlit' || lighting === 'dim')) {
    return 'wash_darkened';
  }
  switch (lighting) {
    case 'torchlit':
      return 'wash_torchlit';
    case 'dim':
      return 'wash_dim';
    case 'daylight':
      return 'wash_daylight';
    case 'overcast':
      return 'wash_overcast';
    case 'dusk':
      return 'wash_dusk';
    default:
      return hasLitLight ? 'wash_torchlit' : 'wash_dim';
  }
}

export function threatFromPurpose(purpose: string | null | undefined): SceneThreatFrame {
  if (purpose === 'encounter' || purpose === 'combat') {
    return 'threat_encounter';
  }
  if (purpose === 'hazard') {
    return 'threat_hazard';
  }
  return 'threat_none';
}

export function elevationCueFromEnvironment(
  environment: string | null | undefined,
): SceneVisualPresentation['elevationCue'] {
  if (environment === 'watchtower') {
    return 'raised';
  }
  if (environment === 'bridge') {
    return 'span';
  }
  return 'flat';
}

export function terrainBiasFromAtmosphere(
  atmosphere: SceneAtmosphereFamily,
): SceneVisualPresentation['terrainBias'] {
  switch (atmosphere) {
    case 'wet_fog':
    case 'waterfront':
      return 'damp';
    case 'enclosed_cool':
    case 'cavernous':
    case 'elevated_exposed':
    case 'ruined_open':
      return 'stone';
    case 'enclosed_warm':
      return 'timber';
    case 'wooded_path':
      return 'canopy';
    case 'open_clearing':
    case 'settled_street':
      return 'open';
    default:
      return 'dry';
  }
}

export function mapHasLitLight(features: readonly MapNotableFeatureRecord[]): boolean {
  return features.some(
    (feature) =>
      (feature.objectKind === 'light' || feature.referenceKind === 'lighting') &&
      feature.objectState !== 'unlit',
  );
}

export function resolveSceneVisuals(map: MapBundleProjection): SceneVisualPresentation {
  const environment = map.sceneEnvironment ?? null;
  const lighting = map.sceneLighting ?? null;
  const purpose = map.scenePurpose ?? null;
  const hasLitLight = mapHasLitLight(map.notableFeatures);
  const atmosphere = atmosphereFromEnvironment(environment);
  const lightWash = lightWashFromLighting(lighting, hasLitLight);
  const threat = threatFromPurpose(purpose);
  const elevationCue = elevationCueFromEnvironment(environment);
  const terrainBias = terrainBiasFromAtmosphere(atmosphere);
  const semanticSummary = [
    `Atmosphere ${atmosphere.replace(/_/g, ' ')}`,
    `lighting ${lightWash.replace(/^wash_/, '').replace(/_/g, ' ')}`,
    threat === 'threat_none' ? 'no elevated threat frame' : threat.replace(/_/g, ' '),
    elevationCue === 'flat' ? 'level ground' : `${elevationCue} elevation cue`,
  ].join('; ');
  return {
    atmosphere,
    lightWash,
    threat,
    elevationCue,
    terrainBias,
    hasLitLight,
    semanticSummary,
  };
}

/** Terrain fill colors keyed by bias — never by room title. */
export function terrainFillCss(
  terrain: string,
  known: boolean,
  bias: SceneVisualPresentation['terrainBias'],
): string {
  if (!known) {
    return bias === 'damp' || bias === 'open' ? '#071018' : '#0a1018';
  }
  if (terrain === 'blocked') {
    switch (bias) {
      case 'damp':
        return '#0c1820';
      case 'timber':
        return '#1a120c';
      case 'canopy':
        return '#0e1810';
      case 'stone':
        return '#141218';
      case 'open':
        return '#1a2218';
      default:
        return '#12100e';
    }
  }
  if (terrain === 'difficult') {
    switch (bias) {
      case 'damp':
        return '#243a3c';
      case 'timber':
        return '#3a3024';
      case 'canopy':
        return '#243828';
      case 'stone':
        return '#2e3438';
      case 'open':
        return '#354028';
      default:
        return '#2f3a38';
    }
  }
  switch (bias) {
    case 'damp':
      return '#2a3836';
    case 'timber':
      return '#3a2e22';
    case 'canopy':
      return '#2a3824';
    case 'stone':
      return '#2c2a28';
    case 'open':
      return '#343828';
    default:
      return '#322b22';
  }
}

export function terrainFillPixi(
  terrain: string,
  known: boolean,
  bias: SceneVisualPresentation['terrainBias'],
): number {
  const css = terrainFillCss(terrain, known, bias);
  return Number.parseInt(css.slice(1), 16);
}

export function voidFillCss(bias: SceneVisualPresentation['terrainBias']): string {
  switch (bias) {
    case 'damp':
      return '#061018';
    case 'open':
      return '#0c1410';
    case 'canopy':
      return '#08120c';
    case 'stone':
      return '#0a0a0e';
    case 'timber':
      return '#0c0806';
    default:
      return '#0a0806';
  }
}

export function objectVisualFamily(feature: MapNotableFeatureRecord): {
  readonly family: string;
  readonly stateVariant: string;
} {
  const kind = feature.objectKind ?? feature.referenceKind ?? 'prop';
  const state = feature.objectState ?? 'present';
  if (kind === 'light' || feature.referenceKind === 'lighting') {
    return { family: 'family_light', stateVariant: state === 'unlit' ? 'state_unlit' : 'state_lit' };
  }
  if (kind === 'cover' || feature.referenceKind === 'cover') {
    return {
      family: 'family_cover',
      stateVariant: state === 'broken' ? 'state_broken' : 'state_intact',
    };
  }
  if (kind === 'container') {
    return {
      family: 'family_container',
      stateVariant:
        state === 'broken' ? 'state_broken' : state === 'open' ? 'state_open' : 'state_closed',
    };
  }
  if (kind === 'hazard' || feature.referenceKind === 'hazard') {
    return {
      family: 'family_hazard',
      stateVariant: state === 'disarmed' ? 'state_disarmed' : 'state_active',
    };
  }
  if (kind === 'creature' || feature.referenceKind === 'creature') {
    return { family: 'family_creature', stateVariant: 'state_present' };
  }
  if (kind === 'npc' || feature.referenceKind === 'npc') {
    return { family: 'family_npc', stateVariant: 'state_present' };
  }
  if (kind === 'exit' || feature.referenceKind === 'exit') {
    const label = feature.label.toLowerCase();
    if (/\bstair|ladder|parapet\b/.test(label)) {
      return { family: 'family_exit_vertical', stateVariant: 'state_open' };
    }
    return { family: 'family_exit_passage', stateVariant: 'state_open' };
  }
  if (kind === 'prop') {
    return {
      family: 'family_prop',
      stateVariant:
        state === 'open'
          ? 'state_open'
          : state === 'closed'
            ? 'state_closed'
            : state === 'broken'
              ? 'state_broken'
              : 'state_intact',
    };
  }
  return { family: 'family_prop', stateVariant: `state_${state}` };
}
