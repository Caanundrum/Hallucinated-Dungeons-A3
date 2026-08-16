/**
 * "Emberferry Crossing" — the original Phase 5 starter campaign pack.
 *
 * Blueprint ownership: Section 25 Phase 5 build scope item 2 ("Original
 * curated starter campaign (~3–5 sessions) as product content and versioned
 * validation fixture — known start state, maps, entities, objectives,
 * branches, checkpoints").
 *
 * SERVER-ONLY CONSUMPTION. This module carries `secret`-audience NPC
 * knowledge that must never reach a player's browser. It lives under
 * `src/shared/` only so future non-client tooling (validation fixtures,
 * Independent QA scripts) can import the same versioned pack; no
 * `src/client/` module may import it. `src/server/campaigns/campaign-memory.ts`
 * is the only place that turns this pack into stored campaign memory, and it
 * always applies the audience filter in
 * `src/shared/campaign-memory-contract.ts` before any of it reaches an API
 * response.
 */

import type {
  CampaignTimeProjection,
  NpcAudienceLevel,
  QuestStatus,
} from '../campaign-memory-contract.js';

export const STARTER_CAMPAIGN_PACK_ID = 'emberferry-crossing-v1';

export interface StarterChapterSeed {
  readonly chapterId: string;
  readonly sequence: number;
  readonly title: string;
  readonly sessionLabel: string;
  readonly planSummary: string;
}

export interface StarterNpcSeed {
  readonly npcId: string;
  readonly name: string;
  readonly role: string;
  readonly motive: string;
  readonly knowledge: string;
  readonly audience: NpcAudienceLevel;
}

export interface StarterQuestSeed {
  readonly questId: string;
  readonly title: string;
  readonly status: QuestStatus;
  readonly summary: string;
  readonly audience: NpcAudienceLevel;
}

export interface StarterFactionSeed {
  readonly factionId: string;
  readonly name: string;
  readonly stance: string;
  readonly summary: string;
  readonly audience: NpcAudienceLevel;
}

export interface StarterSocialLinkSeed {
  readonly linkId: string;
  readonly npcId: string;
  readonly description: string;
  readonly audience: NpcAudienceLevel;
}

export interface StarterOpenThreadSeed {
  readonly threadId: string;
  readonly summary: string;
  readonly raisedInChapterId: string;
  readonly audience: NpcAudienceLevel;
}

export interface StarterMapFeatureSeed {
  readonly column: number;
  readonly row: number;
  readonly label: string;
}

export interface StarterCampaignPack {
  readonly packId: string;
  readonly packVersion: string;
  readonly adventureTitle: string;
  readonly tagline: string;
  readonly startingMapTitle: string;
  readonly artProvenance: string;
  readonly startingSceneBanner: string;
  readonly startingMapFeatures: readonly StarterMapFeatureSeed[];
  readonly chapters: readonly StarterChapterSeed[];
  readonly npcs: readonly StarterNpcSeed[];
  readonly quests: readonly StarterQuestSeed[];
  readonly factions: readonly StarterFactionSeed[];
  readonly socialLinks: readonly StarterSocialLinkSeed[];
  readonly openThreads: readonly StarterOpenThreadSeed[];
  readonly startingCampaignTime: CampaignTimeProjection;
  /** Independent QA checkpoints this fixture must satisfy on a fresh campaign. */
  readonly acceptanceCheckpoints: readonly string[];
}

const CHAPTER_1_ID = 'emberferry-ch1-dockside';
const CHAPTER_2_ID = 'emberferry-ch2-mist-caves';
const CHAPTER_3_ID = 'emberferry-ch3-bell-tower';

export const EMBERFERRY_CROSSING_PACK: StarterCampaignPack = {
  packId: STARTER_CAMPAIGN_PACK_ID,
  packVersion: '1.0.0',
  adventureTitle: 'Emberferry Crossing',
  tagline:
    'A river-trade town wrapped in strange dusk mist, three missing barges, and a bell tower that should not still be ringing.',
  startingMapTitle: 'Emberferry Mist Dock',
  artProvenance: 'original_phase5_starter_v1',
  startingSceneBanner:
    'Ember-mist rolls off the river as the last barges of the day wait at the Emberferry dock.',
  startingMapFeatures: [
    { column: 3, row: 2, label: "Harbor Warden's post" },
    { column: 6, row: 3, label: "Ferry winch — Old Bram's station" },
    { column: 8, row: 5, label: 'Mist-shrouded gangway' },
  ],
  chapters: [
    {
      chapterId: CHAPTER_1_ID,
      sequence: 1,
      title: 'Dockside at Emberferry',
      sessionLabel: 'Session 1: Arrival & the Harbor Warden',
      planSummary:
        'The party arrives at the Emberferry dock as the ember-mist rolls in. Harbor Warden Lysa Quill greets them, worried about three missing barges and a strange hum drifting up from the river caves.',
    },
    {
      chapterId: CHAPTER_2_ID,
      sequence: 2,
      title: 'The Mist-Cut Caves',
      sessionLabel: 'Session 2: Caves & Skirmish',
      planSummary:
        'Following barge wreckage upriver, the party enters the mist-cut caves beneath Emberferry Bluff and fights through a nest of mist-touched creatures guarding a hidden channel.',
    },
    {
      chapterId: CHAPTER_3_ID,
      sequence: 3,
      title: 'The Drowned Bell Tower',
      sessionLabel: 'Session 3: Climax at the Bell Tower',
      planSummary:
        'The source of the ember-mist is the drowned bell tower at the river bend. The party must decide whether to silence the bell or bargain with whatever answers it, and set the course for what comes after.',
    },
  ],
  npcs: [
    {
      npcId: 'lysa-quill',
      name: 'Lysa Quill',
      role: 'Harbor Warden',
      motive: 'Keep the crossing running and every barge crew accounted for.',
      knowledge:
        'Knows the barge schedules, the exact missing-crew count, and that the mist has thickened every night this week.',
      audience: 'public',
    },
    {
      npcId: 'sera-windlow',
      name: 'Sera Windlow',
      role: 'Dockside chandler',
      motive: 'Sell supplies and trade gossip in equal measure.',
      knowledge: "Has heard the drowned bell tower 'sang' the night the first barge went missing.",
      audience: 'public',
    },
    {
      npcId: 'old-bram-halyard',
      name: 'Old Bram Halyard',
      role: 'Ferry mechanic',
      motive: 'Protect his smuggling side-income without getting caught.',
      knowledge:
        'A smuggler crew has been paying him to stay quiet about a hidden channel through the mist-cut caves.',
      audience: 'private',
    },
    {
      npcId: 'the-bellkeeper',
      name: 'The Bellkeeper',
      role: 'Bound spirit of the drowned bell tower',
      motive:
        'Wants release from the bell\u2019s binding by having its true name spoken aloud — and will pull Emberferry deeper into river-mist as it grows stronger if ignored.',
      knowledge: 'Is the true source and controller of the ember-mist rolling off the river.',
      audience: 'secret',
    },
  ],
  quests: [
    {
      questId: 'find-the-missing-barges',
      title: 'Find the Missing Barges',
      status: 'open',
      summary: 'Three barges have not returned to the Emberferry dock in the last week.',
      audience: 'public',
    },
    {
      questId: 'trace-the-ember-mist',
      title: 'Trace the Ember-Mist',
      status: 'open',
      summary:
        'The dusk mist rolling off the river is thicker and stranger than usual; something upriver may be the cause.',
      audience: 'public',
    },
    {
      questId: 'uncover-the-smugglers-channel',
      title: "Uncover the Smugglers' Channel",
      status: 'open',
      summary: 'Rumors persist of a hidden channel through the mist-cut caves used by smugglers.',
      audience: 'private',
    },
  ],
  factions: [
    {
      factionId: 'emberferry-harbor-guild',
      name: 'Emberferry Harbor Guild',
      stance: 'Neutral, helpful toward the party',
      summary:
        'The river-trade cooperative that keeps the crossing solvent. Wants its barges recovered and the mist explained.',
      audience: 'public',
    },
    {
      factionId: 'low-water-smugglers',
      name: 'The Low-Water Smugglers',
      stance: 'Avoidant, hostile if confronted',
      summary:
        'A small smuggling crew running goods through a hidden cave channel; will fight to protect their route.',
      audience: 'private',
    },
  ],
  socialLinks: [
    {
      linkId: 'lysa-trusts-barge-finders',
      npcId: 'lysa-quill',
      description: 'Lysa Quill trusts whoever finds the barges before she trusts anyone with harbor authority.',
      audience: 'public',
    },
    {
      linkId: 'bram-nervous-about-caves',
      npcId: 'old-bram-halyard',
      description: 'Old Bram Halyard grows visibly nervous around anyone who mentions the caves twice.',
      audience: 'private',
    },
  ],
  openThreads: [
    {
      threadId: 'three-crews-unaccounted-for',
      summary: 'Three barge crews are still unaccounted for.',
      raisedInChapterId: CHAPTER_1_ID,
      audience: 'public',
    },
    {
      threadId: 'wordless-hum-from-the-caves',
      summary: 'A wordless hum rises from the river caves at low tide.',
      raisedInChapterId: CHAPTER_1_ID,
      audience: 'public',
    },
  ],
  startingCampaignTime: {
    inGameDay: 1,
    label: 'Day 1 — Arrival at Emberferry',
  },
  acceptanceCheckpoints: [
    'A fresh Emberferry campaign starts on chapter 1 ("Dockside at Emberferry") with Lysa Quill and Sera Windlow visible in every member\u2019s campaign memory.',
    'Old Bram Halyard\u2019s smuggling knowledge stays out of any member\u2019s recap until a chapter summary records it (private, never secret-leaking).',
    'The Bellkeeper\u2019s true nature never appears in any campaign memory projection or personal recap returned to a client.',
    'Campaign time starts at in-game day 1 and only advances through a recorded session suspend or a closed chapter.',
    'The starter map for this template reports title "Emberferry Mist Dock" and artProvenance "original_phase5_starter_v1".',
  ],
};
