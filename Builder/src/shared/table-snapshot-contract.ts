/**
 * Bundled tabletop projection for one poll tick.
 *
 * Replaces eight parallel GETs (`memory`, `timing-authority`, `party-chat`,
 * `map`, `rules-state`, `table-state`, `chronicle`, `presentation-cues`) with a
 * single `/table-snapshot` response so free-exploration clients stay responsive.
 */

import type { CampaignMemoryProjection } from './campaign-memory-contract.js';
import type { ChronicleFeedProjection, PartyChatFeedProjection } from './communication-contract.js';
import type { TableStateProjection } from './command-contract.js';
import type { MapBundleProjection } from './map-contract.js';
import type { PresentationCuePlanProjection } from './presentation-cue-contract.js';
import type { CharacterProgressionProjection, EncounterProjection } from './rules-combat-contract.js';
import type { TimingAuthorityProjection } from './timing-authority-contract.js';

export interface TableRulesStateSlice {
  readonly encounter: EncounterProjection | null;
  readonly progression: CharacterProgressionProjection;
}

export interface TableSnapshotProjection {
  readonly campaignId: string;
  readonly table: TableStateProjection;
  readonly map: MapBundleProjection;
  readonly timingAuthority: { readonly authority: TimingAuthorityProjection | null };
  readonly partyChat: PartyChatFeedProjection;
  readonly chronicle: ChronicleFeedProjection;
  readonly memory: CampaignMemoryProjection | null;
  /** Null when the caller is not seated (or rules projection is unavailable). */
  readonly rules: TableRulesStateSlice | null;
  readonly presentationCues: PresentationCuePlanProjection;
}
