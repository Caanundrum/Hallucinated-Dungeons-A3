/**
 * Campaign memory contract — Phase 5.
 *
 * Blueprint ownership: Section 25 Phase 5 build scope item 1 ("Structured
 * campaign memory: chapters, summaries, NPC motives/knowledge, quests,
 * factions, social state, open threads, recaps, campaign-time continuity")
 * and the invariant kernel ("Campaign memory and recaps are audience-
 * classified; secrets never collapse into public summaries").
 *
 * Audience classification is the trust boundary this whole contract exists
 * to protect: `secret` records exist so a Director-authored chapter plan can
 * carry a twist the players have not discovered, without any code path
 * copying that text into a recap. `loadCampaignMemory` and
 * `buildPersonalRecap` both omit `secret` records entirely — they are never
 * partially redacted, because a partially redacted secret is still a leak.
 */

export const NPC_AUDIENCE_LEVELS = ['public', 'private', 'secret'] as const;
export type NpcAudienceLevel = (typeof NPC_AUDIENCE_LEVELS)[number];

export function isNpcAudienceLevel(value: unknown): value is NpcAudienceLevel {
  return typeof value === 'string' && (NPC_AUDIENCE_LEVELS as readonly string[]).includes(value);
}

export const QUEST_STATUSES = ['open', 'completed', 'failed'] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];

export const SESSION_STATES = ['active', 'suspended'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** One entry in the campaign's chapter plan (Section 25 Phase 5 build scope). */
export interface CampaignChapterProjection {
  readonly chapterId: string;
  readonly sequence: number;
  readonly title: string;
  readonly sessionLabel: string;
  /** Director-authored hook for the chapter, safe to show before it is played. */
  readonly planSummary: string;
  /** Server-recorded summary of what actually happened, filled in as the chapter closes. */
  readonly recordedSummary: string | null;
  readonly closedAt: string | null;
}

export interface CampaignNpcRecordProjection {
  readonly npcId: string;
  readonly name: string;
  readonly role: string;
  readonly motive: string;
  readonly knowledge: string;
  readonly audience: NpcAudienceLevel;
}

export interface CampaignQuestProjection {
  readonly questId: string;
  readonly title: string;
  readonly status: QuestStatus;
  readonly summary: string;
  readonly audience: NpcAudienceLevel;
}

export interface CampaignFactionProjection {
  readonly factionId: string;
  readonly name: string;
  readonly stance: string;
  readonly summary: string;
  readonly audience: NpcAudienceLevel;
}

export interface CampaignSocialLinkProjection {
  readonly linkId: string;
  readonly npcId: string;
  readonly description: string;
  readonly audience: NpcAudienceLevel;
}

export interface CampaignOpenThreadProjection {
  readonly threadId: string;
  readonly summary: string;
  readonly raisedInChapterId: string | null;
  readonly audience: NpcAudienceLevel;
}

/** In-fiction campaign time. Advances only through committed session events. */
export interface CampaignTimeProjection {
  readonly inGameDay: number;
  readonly label: string;
}

export interface CampaignSessionStateProjection {
  readonly state: SessionState;
  readonly suspendedAt: string | null;
  readonly resumedAt: string | null;
  readonly suspendedNote: string | null;
  /** Table command state version captured at the moment of suspend, or null before any suspend. */
  readonly suspendedAtStateVersion: number | null;
}

/**
 * Audience-filtered projection returned to a campaign member. `secret`
 * records are never present here — see the module doc comment.
 */
export interface CampaignMemoryProjection {
  readonly campaignId: string;
  readonly adventureTemplateId: string | null;
  readonly adventurePackVersion: string | null;
  readonly chapters: readonly CampaignChapterProjection[];
  readonly currentChapterId: string | null;
  readonly npcs: readonly CampaignNpcRecordProjection[];
  readonly quests: readonly CampaignQuestProjection[];
  readonly factions: readonly CampaignFactionProjection[];
  readonly socialLinks: readonly CampaignSocialLinkProjection[];
  readonly openThreads: readonly CampaignOpenThreadProjection[];
  readonly campaignTime: CampaignTimeProjection;
  readonly session: CampaignSessionStateProjection;
  readonly updatedAt: string;
}

/** Personal, per-account absence/return recap (Section 25 Phase 5 build scope item 5). */
export interface PersonalRecapProjection {
  readonly campaignId: string;
  readonly accountId: string;
  readonly generatedAt: string;
  readonly headline: string;
  readonly chapterTitle: string | null;
  readonly recentChapterSummaries: readonly string[];
  readonly openThreads: readonly string[];
  readonly activeQuests: readonly string[];
  readonly campaignTimeLabel: string;
}

export interface CampaignSessionSuspendResponse {
  readonly memory: CampaignMemoryProjection;
  readonly tableStateVersionNote: string;
}

export interface CampaignSessionResumeResponse {
  readonly memory: CampaignMemoryProjection;
  readonly recap: PersonalRecapProjection;
}
