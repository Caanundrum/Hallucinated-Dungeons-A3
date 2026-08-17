/**
 * Campaign memory, starter-pack seeding, and session suspend/resume — Phase 5.
 *
 * Blueprint ownership: Section 25 Phase 5 build scope items 1 ("structured
 * campaign memory") and 5 ("multi-session resume, absence/return personal
 * recap"), and the invariant kernel ("campaign memory and recaps are
 * audience-classified; secrets never collapse into public summaries").
 *
 * This is the only module that imports the Emberferry Crossing content pack
 * (`../../shared/content/emberferry-crossing.js`) and `map-projection.ts` for
 * its starter map presentation fields only (title/artProvenance/scene
 * banner/notable features) — never its NPC or quest records. No
 * `src/client/` module may import either of those directly or transitively.
 */

import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import type { AdventureTemplate } from '../../shared/campaign-contract.js';
import {
  type CampaignChapterProjection,
  type CampaignFactionProjection,
  type CampaignMemoryProjection,
  type CampaignNpcRecordProjection,
  type CampaignOpenThreadProjection,
  type CampaignQuestProjection,
  type CampaignSessionResumeResponse,
  type CampaignSessionStateProjection,
  type CampaignSessionSuspendResponse,
  type CampaignSocialLinkProjection,
  type CampaignTimeProjection,
  type PersonalRecapProjection,
  type SessionState,
} from '../../shared/campaign-memory-contract.js';
import type { MapArtProvenance } from '../../shared/map-contract.js';
import {
  EMBERFERRY_CROSSING_PACK,
  STARTER_CAMPAIGN_PACK_ID,
  type StarterCampaignPack,
  type StarterMapFeatureSeed,
} from '../../shared/content/emberferry-crossing.js';
import {
  resolveEmberferryScene,
  type EmberferrySceneDefinition,
} from '../../shared/content/emberferry-maps.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import { CampaignNotFoundError } from './errors.js';
import { appendChronicleEntry } from '../communication/chronicle.js';
import { emptyMapRuntime } from '../table/map-runtime.js';

export class CampaignMemoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CampaignMemoryError';
    this.code = code;
  }
}

interface StoredChapter {
  readonly chapterId: string;
  readonly sequence: number;
  readonly title: string;
  readonly sessionLabel: string;
  readonly planSummary: string;
  readonly recordedSummary: string | null;
  readonly closedAt: Timestamp | Date | null;
}

interface StoredCampaignMemory {
  readonly campaignId: string;
  readonly adventureTemplateId: string | null;
  readonly adventurePackVersion: string | null;
  readonly chapters: readonly StoredChapter[];
  readonly currentChapterId: string | null;
  readonly npcs: readonly CampaignNpcRecordProjection[];
  readonly quests: readonly CampaignQuestProjection[];
  readonly factions: readonly CampaignFactionProjection[];
  readonly socialLinks: readonly CampaignSocialLinkProjection[];
  readonly openThreads: readonly CampaignOpenThreadProjection[];
  readonly campaignTime: CampaignTimeProjection;
  readonly createdAt: Timestamp | Date;
  readonly updatedAt: Timestamp | Date;
}

interface StoredSessionState {
  readonly campaignId: string;
  readonly state: SessionState;
  readonly suspendedAt: Timestamp | Date | null;
  readonly resumedAt: Timestamp | Date | null;
  readonly suspendedNote: string | null;
  readonly suspendedAtStateVersion: number | null;
  readonly updatedAt: Timestamp | Date;
}

interface StoredMembership {
  readonly membershipId: string;
  readonly campaignId: string;
  readonly accountId: string;
}

function toIso(value: Timestamp | Date): string {
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

function toIsoOrNull(value: Timestamp | Date | null): string | null {
  return value === null ? null : toIso(value);
}

async function requireMembership(
  firestore: Firestore,
  campaignId: string,
  accountId: string,
): Promise<StoredMembership> {
  const snapshot = await firestore
    .collection(COLLECTIONS.campaignMemberships)
    .where('campaignId', '==', campaignId)
    .where('accountId', '==', accountId)
    .limit(1)
    .get();
  if (snapshot.empty) {
    // Foreign campaigns look identical to missing ones to the caller.
    throw new CampaignNotFoundError();
  }
  return snapshot.docs[0]!.data() as StoredMembership;
}

/** Resolves the starter pack for a stored campaign's pack id, or null for a blank table. */
export function resolveStarterPack(adventureTemplateId: string | null): StarterCampaignPack | null {
  return adventureTemplateId === STARTER_CAMPAIGN_PACK_ID ? EMBERFERRY_CROSSING_PACK : null;
}

/** Resolves the starter pack for a campaign-creation template choice, or null for 'blank'. */
export function resolveStarterPackForTemplate(
  template: AdventureTemplate,
): StarterCampaignPack | null {
  return template === 'emberferry_crossing' ? EMBERFERRY_CROSSING_PACK : null;
}

/**
 * Map-presentation + chapter scene for a starter pack, for `map-projection.ts`
 * only. Never returns NPC, quest, faction, or thread records.
 */
export function loadAdventureMapPresentation(
  adventureTemplateId: string | null,
  currentChapterId: string | null = null,
): {
  readonly title: string;
  readonly artProvenance: MapArtProvenance;
  readonly sceneBanner: string;
  readonly notableFeatures: readonly StarterMapFeatureSeed[];
  readonly scene: EmberferrySceneDefinition | null;
} | null {
  const pack = resolveStarterPack(adventureTemplateId);
  if (pack === null) {
    return null;
  }
  const scene = resolveEmberferryScene(currentChapterId ?? pack.chapters[0]?.chapterId ?? null);
  return {
    title: scene.title,
    artProvenance: pack.artProvenance as MapArtProvenance,
    sceneBanner: scene.sceneBanner,
    notableFeatures: scene.notableFeatures,
    scene,
  };
}

function blankMemory(campaignId: string, now: Date): StoredCampaignMemory {
  return {
    campaignId,
    adventureTemplateId: null,
    adventurePackVersion: null,
    chapters: [],
    currentChapterId: null,
    npcs: [],
    quests: [],
    factions: [],
    socialLinks: [],
    openThreads: [],
    campaignTime: { inGameDay: 1, label: 'Day 1' },
    createdAt: now,
    updatedAt: now,
  };
}

function seededMemory(campaignId: string, pack: StarterCampaignPack, now: Date): StoredCampaignMemory {
  return {
    campaignId,
    adventureTemplateId: pack.packId,
    adventurePackVersion: pack.packVersion,
    chapters: pack.chapters.map((chapter) => ({
      chapterId: chapter.chapterId,
      sequence: chapter.sequence,
      title: chapter.title,
      sessionLabel: chapter.sessionLabel,
      planSummary: chapter.planSummary,
      recordedSummary: null,
      closedAt: null,
    })),
    currentChapterId: pack.chapters[0]?.chapterId ?? null,
    npcs: pack.npcs,
    quests: pack.quests,
    factions: pack.factions,
    socialLinks: pack.socialLinks,
    openThreads: pack.openThreads,
    campaignTime: pack.startingCampaignTime,
    createdAt: now,
    updatedAt: now,
  };
}

function blankSession(campaignId: string, now: Date): StoredSessionState {
  return {
    campaignId,
    state: 'active',
    suspendedAt: null,
    resumedAt: null,
    suspendedNote: null,
    suspendedAtStateVersion: null,
    updatedAt: now,
  };
}

/** Creates campaign memory + session-state records if they do not exist yet. */
export async function ensureCampaignMemory(
  firestore: Firestore,
  campaignId: string,
  starterPack?: StarterCampaignPack,
): Promise<StoredCampaignMemory> {
  const memoryRef = firestore.collection(COLLECTIONS.campaignMemory).doc(campaignId);
  const memorySnapshot = await memoryRef.get();
  if (memorySnapshot.exists) {
    return memorySnapshot.data() as StoredCampaignMemory;
  }

  const now = new Date();
  const created =
    starterPack === undefined ? blankMemory(campaignId, now) : seededMemory(campaignId, starterPack, now);
  const batch = firestore.batch();
  batch.set(memoryRef, created);
  const sessionRef = firestore.collection(COLLECTIONS.campaignSessions).doc(campaignId);
  const sessionSnapshot = await sessionRef.get();
  if (!sessionSnapshot.exists) {
    batch.set(sessionRef, blankSession(campaignId, now));
  }
  await batch.commit();
  return created;
}

async function loadStoredMemory(firestore: Firestore, campaignId: string): Promise<StoredCampaignMemory> {
  return ensureCampaignMemory(firestore, campaignId);
}

async function loadStoredSession(firestore: Firestore, campaignId: string): Promise<StoredSessionState> {
  const ref = firestore.collection(COLLECTIONS.campaignSessions).doc(campaignId);
  const snapshot = await ref.get();
  if (snapshot.exists) {
    return snapshot.data() as StoredSessionState;
  }
  const now = new Date();
  const created = blankSession(campaignId, now);
  await ref.set(created);
  return created;
}

function nonSecret<T extends { readonly audience: string }>(record: T): boolean {
  return record.audience !== 'secret';
}

function projectChapter(stored: StoredChapter): CampaignChapterProjection {
  return {
    chapterId: stored.chapterId,
    sequence: stored.sequence,
    title: stored.title,
    sessionLabel: stored.sessionLabel,
    planSummary: stored.planSummary,
    recordedSummary: stored.recordedSummary,
    closedAt: toIsoOrNull(stored.closedAt),
  };
}

function projectSession(stored: StoredSessionState): CampaignSessionStateProjection {
  return {
    state: stored.state,
    suspendedAt: toIsoOrNull(stored.suspendedAt),
    resumedAt: toIsoOrNull(stored.resumedAt),
    suspendedNote: stored.suspendedNote,
    suspendedAtStateVersion: stored.suspendedAtStateVersion,
  };
}

/**
 * Audience-filtered projection. `secret` records are omitted entirely — see
 * the module doc comment above and `campaign-memory-contract.ts`.
 */
function projectMemory(
  memory: StoredCampaignMemory,
  session: StoredSessionState,
): CampaignMemoryProjection {
  return {
    campaignId: memory.campaignId,
    adventureTemplateId: memory.adventureTemplateId,
    adventurePackVersion: memory.adventurePackVersion,
    chapters: memory.chapters.map(projectChapter),
    currentChapterId: memory.currentChapterId,
    npcs: memory.npcs.filter(nonSecret),
    quests: memory.quests.filter(nonSecret),
    factions: memory.factions.filter(nonSecret),
    socialLinks: memory.socialLinks.filter(nonSecret),
    openThreads: memory.openThreads.filter(nonSecret),
    campaignTime: memory.campaignTime,
    session: projectSession(session),
    updatedAt: toIso(memory.updatedAt),
  };
}

/** Campaign memory projection for a verified member. Foreign campaigns resolve as not found. */
export async function loadCampaignMemory(
  firestore: Firestore,
  campaignId: string,
  accountId: string,
): Promise<CampaignMemoryProjection> {
  await requireMembership(firestore, campaignId, accountId);
  const [memory, session] = await Promise.all([
    loadStoredMemory(firestore, campaignId),
    loadStoredSession(firestore, campaignId),
  ]);
  return projectMemory(memory, session);
}

/**
 * Records the server-authored summary of a played chapter and, unless told
 * otherwise, advances `currentChapterId` to the next chapter in sequence.
 */
export async function appendChapterSummary(
  firestore: Firestore,
  campaignId: string,
  options: { readonly chapterId: string; readonly recordedSummary: string; readonly advance?: boolean },
): Promise<CampaignMemoryProjection> {
  const memory = await loadStoredMemory(firestore, campaignId);
  const chapterIndex = memory.chapters.findIndex((chapter) => chapter.chapterId === options.chapterId);
  if (chapterIndex === -1) {
    throw new CampaignMemoryError('BAD_REQUEST', 'No such chapter on this campaign.');
  }
  const now = new Date();
  const closedChapter = memory.chapters[chapterIndex]!;
  const chapters = memory.chapters.map((chapter, index) =>
    index === chapterIndex
      ? { ...chapter, recordedSummary: options.recordedSummary, closedAt: now }
      : chapter,
  );
  const advance = options.advance ?? true;
  const nextChapter = advance
    ? memory.chapters.find((chapter) => chapter.sequence === closedChapter.sequence + 1) ?? null
    : null;
  const updated: StoredCampaignMemory = {
    ...memory,
    chapters,
    currentChapterId: nextChapter?.chapterId ?? memory.currentChapterId,
    updatedAt: now,
  };
  await firestore.collection(COLLECTIONS.campaignMemory).doc(campaignId).set(updated);
  // Traveling to the next Emberferry scene reseats tokens on that scene's
  // spawn anchors — prior dock coordinates are not meaningful in the caves.
  if (nextChapter !== null) {
    await firestore
      .collection(COLLECTIONS.campaignTableProjections)
      .doc(campaignId)
      .set(emptyMapRuntime(campaignId));
  }
  await appendChronicleEntry({
    firestore,
    campaignId,
    kind: 'chapter_closed',
    body: `Chapter "${closedChapter.title}" closed: ${options.recordedSummary}`,
  });
  const session = await loadStoredSession(firestore, campaignId);
  return projectMemory(updated, session);
}

/**
 * Closes the current chapter for a campaign member (owner or seated player) and
 * advances to the next chapter's map scene when one exists.
 */
export async function closeCurrentChapter(
  firestore: Firestore,
  campaignId: string,
  accountId: string,
  options: { readonly recordedSummary?: string } = {},
): Promise<CampaignMemoryProjection> {
  await requireMembership(firestore, campaignId, accountId);
  const memory = await loadStoredMemory(firestore, campaignId);
  if (memory.currentChapterId === null) {
    throw new CampaignMemoryError(
      'BAD_REQUEST',
      'This campaign has no current chapter to close.',
    );
  }
  const current =
    memory.chapters.find((chapter) => chapter.chapterId === memory.currentChapterId) ?? null;
  if (current === null) {
    throw new CampaignMemoryError('BAD_REQUEST', 'No such chapter on this campaign.');
  }
  if (current.recordedSummary !== null) {
    throw new CampaignMemoryError(
      'BAD_REQUEST',
      'This chapter is already closed. Resume play on the next scene from Campaign memory.',
    );
  }
  const recordedSummary =
    options.recordedSummary !== undefined && options.recordedSummary.trim().length > 0
      ? options.recordedSummary.trim().slice(0, 480)
      : `The party finished "${current.title}" and travels onward.`;
  return appendChapterSummary(firestore, campaignId, {
    chapterId: current.chapterId,
    recordedSummary,
    advance: true,
  });
}

function nextCampaignTime(current: CampaignTimeProjection): CampaignTimeProjection {
  const inGameDay = current.inGameDay + 1;
  return { inGameDay, label: `Day ${inGameDay}` };
}

/**
 * Suspends the current session. Campaign time advances by one in-game day —
 * the only way it moves is through this committed session event or a closed
 * chapter, never from AI narration text.
 */
export async function recordSessionSuspend(
  firestore: Firestore,
  campaignId: string,
  accountId: string,
  options: { readonly note?: string } = {},
): Promise<CampaignSessionSuspendResponse> {
  await requireMembership(firestore, campaignId, accountId);
  const [memory, session] = await Promise.all([
    loadStoredMemory(firestore, campaignId),
    loadStoredSession(firestore, campaignId),
  ]);
  if (session.state === 'suspended') {
    throw new CampaignMemoryError(
      'SESSION_ALREADY_SUSPENDED',
      'This campaign session is already suspended. Resume it before suspending again.',
    );
  }

  const tableSnapshot = await firestore
    .collection(COLLECTIONS.campaignTableProjections)
    .doc(campaignId)
    .get();
  const tableStateVersion = tableSnapshot.exists
    ? ((tableSnapshot.data() as { stateVersion?: number }).stateVersion ?? 0)
    : 0;
  const tableStateVersionNote = `Table state version ${tableStateVersion} at suspend.`;

  const now = new Date();
  const note =
    typeof options.note === 'string' && options.note.trim().length > 0
      ? options.note.trim().slice(0, 280)
      : null;
  const nextTime = nextCampaignTime(memory.campaignTime);
  const updatedMemory: StoredCampaignMemory = { ...memory, campaignTime: nextTime, updatedAt: now };
  const updatedSession: StoredSessionState = {
    ...session,
    state: 'suspended',
    suspendedAt: now,
    suspendedNote: note,
    suspendedAtStateVersion: tableStateVersion,
    updatedAt: now,
  };

  const batch = firestore.batch();
  batch.set(firestore.collection(COLLECTIONS.campaignMemory).doc(campaignId), updatedMemory);
  batch.set(firestore.collection(COLLECTIONS.campaignSessions).doc(campaignId), updatedSession);
  await batch.commit();

  await appendChronicleEntry({
    firestore,
    campaignId,
    kind: 'session_suspended',
    body:
      note === null
        ? `The session was suspended. ${tableStateVersionNote}`
        : `The session was suspended: ${note} ${tableStateVersionNote}`,
  });

  return {
    memory: projectMemory(updatedMemory, updatedSession),
    tableStateVersionNote,
  };
}

function buildPersonalRecap(
  memory: StoredCampaignMemory,
  accountId: string,
): PersonalRecapProjection {
  const closedChapters = memory.chapters.filter((chapter) => chapter.recordedSummary !== null);
  const currentChapter =
    memory.chapters.find((chapter) => chapter.chapterId === memory.currentChapterId) ?? null;
  const headline =
    closedChapters.length === 0
      ? currentChapter === null
        ? 'No chapters have been played yet.'
        : `The party has not yet finished "${currentChapter.title}".`
      : `Since you were last here, the party finished ${closedChapters.length} chapter${closedChapters.length === 1 ? '' : 's'}, most recently "${closedChapters[closedChapters.length - 1]!.title}".`;

  return {
    campaignId: memory.campaignId,
    accountId,
    generatedAt: new Date().toISOString(),
    headline,
    chapterTitle: currentChapter?.title ?? null,
    recentChapterSummaries: closedChapters
      .slice(-3)
      .map((chapter) => `${chapter.title}: ${chapter.recordedSummary!}`),
    openThreads: memory.openThreads.filter(nonSecret).map((thread) => thread.summary),
    activeQuests: memory.quests
      .filter(nonSecret)
      .filter((quest) => quest.status === 'open')
      .map((quest) => quest.title),
    campaignTimeLabel: memory.campaignTime.label,
  };
}

/** Personal, per-account recap. Never includes any `secret`-audience record. */
export async function readPersonalRecap(
  firestore: Firestore,
  campaignId: string,
  accountId: string,
): Promise<PersonalRecapProjection> {
  await requireMembership(firestore, campaignId, accountId);
  const memory = await loadStoredMemory(firestore, campaignId);
  return buildPersonalRecap(memory, accountId);
}

/** Resumes a suspended session and returns the personal recap for the returning account. */
export async function resumeSession(
  firestore: Firestore,
  campaignId: string,
  accountId: string,
): Promise<CampaignSessionResumeResponse> {
  await requireMembership(firestore, campaignId, accountId);
  const [memory, session] = await Promise.all([
    loadStoredMemory(firestore, campaignId),
    loadStoredSession(firestore, campaignId),
  ]);
  if (session.state !== 'suspended') {
    throw new CampaignMemoryError(
      'SESSION_NOT_SUSPENDED',
      'This campaign session is not suspended, so there is nothing to resume.',
    );
  }

  const now = new Date();
  const updatedSession: StoredSessionState = { ...session, state: 'active', resumedAt: now, updatedAt: now };
  await firestore.collection(COLLECTIONS.campaignSessions).doc(campaignId).set(updatedSession);

  await appendChronicleEntry({
    firestore,
    campaignId,
    kind: 'session_resumed',
    body: 'The session resumed.',
  });

  return {
    memory: projectMemory(memory, updatedSession),
    recap: buildPersonalRecap(memory, accountId),
  };
}

/** Seeds campaign memory at campaign creation, from the given template id (or blank). */
export async function seedCampaignMemoryForTemplate(
  firestore: Firestore,
  campaignId: string,
  adventureTemplateId: string | null,
): Promise<void> {
  const pack = resolveStarterPack(adventureTemplateId);
  await ensureCampaignMemory(firestore, campaignId, pack ?? undefined);
}
