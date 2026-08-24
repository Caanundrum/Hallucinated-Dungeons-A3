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

async function requireOwnSeat(
  firestore: Firestore,
  campaignId: string,
  accountId: string,
): Promise<void> {
  const snapshot = await firestore
    .collection(COLLECTIONS.campaignSeats)
    .where('campaignId', '==', campaignId)
    .where('ownerAccountId', '==', accountId)
    .limit(1)
    .get();
  if (snapshot.empty) {
    throw new CampaignMemoryError(
      'BAD_REQUEST',
      'Seat a character at this table before closing a chapter.',
    );
  }
}

function asNonNegativeInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  if (value !== null && typeof value === 'object') {
    const record = value as { integerValue?: unknown; toNumber?: () => number };
    if (typeof record.toNumber === 'function') {
      return asNonNegativeInt(record.toNumber());
    }
    if (record.integerValue !== undefined) {
      return asNonNegativeInt(record.integerValue);
    }
  }
  return 0;
}

function toMillis(value: unknown): number | null {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

async function readTableStateVersion(firestore: Firestore, campaignId: string): Promise<number> {
  const tableSnapshot = await firestore
    .collection(COLLECTIONS.campaignTableProjections)
    .doc(campaignId)
    .get();

  let checkpoint = 0;
  if (tableSnapshot.exists) {
    const data = tableSnapshot.data() as {
      stateVersion?: unknown;
      lastEventSequence?: unknown;
    };
    checkpoint = Math.max(
      asNonNegativeInt(data.stateVersion),
      asNonNegativeInt(data.lastEventSequence),
    );
  }

  // Isolate optional queries so a missing index / empty collection cannot zero out
  // a known projection version (PQA-087).
  try {
    const seatSnapshot = await firestore
      .collection(COLLECTIONS.campaignSeats)
      .where('campaignId', '==', campaignId)
      .limit(12)
      .get();
    for (const doc of seatSnapshot.docs) {
      const seat = doc.data() as { lastAcknowledgedEventSequence?: unknown };
      checkpoint = Math.max(checkpoint, asNonNegativeInt(seat.lastAcknowledgedEventSequence));
    }
  } catch {
    // Seat ack sequences are optional signal only.
  }

  try {
    const eventSnapshot = await firestore
      .collection(COLLECTIONS.campaignEvents)
      .where('campaignId', '==', campaignId)
      .limit(200)
      .get();
    for (const doc of eventSnapshot.docs) {
      const event = doc.data() as {
        eventSequence?: unknown;
        resultStateVersion?: unknown;
        priorStateVersion?: unknown;
      };
      checkpoint = Math.max(
        checkpoint,
        asNonNegativeInt(event.eventSequence),
        asNonNegativeInt(event.resultStateVersion),
        asNonNegativeInt(event.priorStateVersion),
      );
    }
  } catch {
    // Event history is optional signal only.
  }

  try {
    const commandSnapshot = await firestore
      .collection(COLLECTIONS.campaignCommands)
      .where('campaignId', '==', campaignId)
      .limit(200)
      .get();
    for (const doc of commandSnapshot.docs) {
      const command = doc.data() as { expectedStateVersion?: unknown };
      // A committed command at expected N implies the table reached at least N+1.
      checkpoint = Math.max(checkpoint, asNonNegativeInt(command.expectedStateVersion) + 1);
    }
  } catch {
    // Command history is optional signal only.
  }

  try {
    const encounterSnapshot = await firestore
      .collection(COLLECTIONS.campaignEncounters)
      .doc(campaignId)
      .get();
    if (encounterSnapshot.exists) {
      const encounter = encounterSnapshot.data() as { stateVersion?: unknown };
      checkpoint = Math.max(checkpoint, asNonNegativeInt(encounter.stateVersion));
    }
  } catch {
    // Encounter version is optional signal only.
  }

  // Seating, table commands, and settings bump campaigns.updatedAt. If the campaign
  // document moved after creation, treat that as at least checkpoint 1 so suspend
  // toasts never claim "checkpoint 0" after real campaign activity (PQA-087).
  if (checkpoint === 0) {
    try {
      const campaignSnapshot = await firestore.collection(COLLECTIONS.campaigns).doc(campaignId).get();
      if (campaignSnapshot.exists) {
        const campaign = campaignSnapshot.data() as {
          createdAt?: unknown;
          updatedAt?: unknown;
        };
        const createdMs = toMillis(campaign.createdAt);
        const updatedMs = toMillis(campaign.updatedAt);
        if (createdMs !== null && updatedMs !== null && updatedMs > createdMs + 500) {
          checkpoint = 1;
        }
      }
    } catch {
      // Campaign timestamps are optional signal only.
    }
  }

  return checkpoint;
}

/** Resolves the starter pack for a stored campaign's pack id, or null for a blank table. */
export function resolveStarterPack(adventureTemplateId: string | null): StarterCampaignPack | null {
  return adventureTemplateId === STARTER_CAMPAIGN_PACK_ID ? EMBERFERRY_CROSSING_PACK : null;
}

/** Resolves the starter pack for a campaign-creation template choice, or null for 'blank'. */
export function resolveStarterPackForTemplate(
  _template: AdventureTemplate,
): StarterCampaignPack | null {
  return null;
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

/** True when every chapter already has a recorded summary (adventure finished). */
function adventureChaptersComplete(memory: StoredCampaignMemory): boolean {
  return (
    memory.chapters.length > 0 &&
    memory.chapters.every((chapter) => chapter.recordedSummary !== null)
  );
}

/**
 * When all chapters are closed, complete open quests and clear open threads so
 * the finale state matches player expectation (PQA-030).
 */
function reconcileFinaleState(memory: StoredCampaignMemory, now: Date): StoredCampaignMemory {
  if (!adventureChaptersComplete(memory)) {
    return memory;
  }
  const questsNeedClose = memory.quests.some((quest) => quest.status === 'open');
  const threadsOpen = memory.openThreads.length > 0;
  if (!questsNeedClose && !threadsOpen) {
    return memory;
  }
  return {
    ...memory,
    quests: memory.quests.map((quest) =>
      quest.status === 'open' ? { ...quest, status: 'completed' as const } : quest,
    ),
    openThreads: [],
    updatedAt: now,
  };
}

/** Campaign memory projection for a verified member. Foreign campaigns resolve as not found. */
export async function loadCampaignMemory(
  firestore: Firestore,
  campaignId: string,
  accountId: string,
): Promise<CampaignMemoryProjection> {
  await requireMembership(firestore, campaignId, accountId);
  const [stored, session] = await Promise.all([
    loadStoredMemory(firestore, campaignId),
    loadStoredSession(firestore, campaignId),
  ]);
  const reconciled = reconcileFinaleState(stored, new Date());
  if (reconciled !== stored) {
    await firestore.collection(COLLECTIONS.campaignMemory).doc(campaignId).set(reconciled);
  }
  return projectMemory(reconciled, session);
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
  let updated: StoredCampaignMemory = {
    ...memory,
    chapters,
    currentChapterId: nextChapter?.chapterId ?? memory.currentChapterId,
    updatedAt: now,
  };
  updated = reconcileFinaleState(updated, now);
  updated = {
    ...updated,
    campaignTime: nextCampaignTime(updated.campaignTime),
  };
  await firestore.collection(COLLECTIONS.campaignMemory).doc(campaignId).set(updated);
  // Traveling to the next Emberferry scene reseats tokens on that scene's
  // spawn anchors — prior dock coordinates are not meaningful in the caves.
  if (nextChapter !== null) {
    const projectionRef = firestore
      .collection(COLLECTIONS.campaignTableProjections)
      .doc(campaignId);
    const priorSnap = await projectionRef.get();
    const prior = priorSnap.exists ? (priorSnap.data() as Record<string, unknown>) : {};
    await projectionRef.set({
      ...prior,
      ...emptyMapRuntime(campaignId),
      // Preserve command/event continuity across chapter travel (PQA-087).
      stateVersion: typeof prior.stateVersion === 'number' ? prior.stateVersion : 0,
      lastEventSequence:
        typeof prior.lastEventSequence === 'number' ? prior.lastEventSequence : 0,
      lastEventId: typeof prior.lastEventId === 'string' ? prior.lastEventId : null,
      updatedAt: now,
    });
    // End any carried encounter so combat does not persist across chapters (PQA-081–083).
    await firestore.collection(COLLECTIONS.campaignEncounters).doc(campaignId).delete();
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
  await requireOwnSeat(firestore, campaignId, accountId);
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
  const tableStateVersion = await readTableStateVersion(firestore, campaignId);
  if (tableStateVersion <= 0) {
    throw new CampaignMemoryError(
      'BAD_REQUEST',
      'Play at the table before closing this chapter. Open the table, seat tokens, and take at least one action first.',
    );
  }
  const encounterSnap = await firestore
    .collection(COLLECTIONS.campaignEncounters)
    .doc(campaignId)
    .get();
  if (encounterSnap.exists) {
    const encounter = encounterSnap.data() as { status?: string };
    if (encounter.status === 'active' || encounter.status === 'setup') {
      throw new CampaignMemoryError(
        'BAD_REQUEST',
        'End the current encounter before closing this chapter and traveling.',
      );
    }
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
 * Suspends the current session. Campaign time does not advance on suspend —
 * day changes come from rest or chapter travel, not pausing the table (PQA-166).
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

  const encounterSnap = await firestore
    .collection(COLLECTIONS.campaignEncounters)
    .doc(campaignId)
    .get();
  if (encounterSnap.exists) {
    const encounter = encounterSnap.data() as { status?: string };
    if (encounter.status === 'active' || encounter.status === 'setup') {
      throw new CampaignMemoryError(
        'BAD_REQUEST',
        'End the current encounter before suspending the session.',
      );
    }
  }

  const tableStateVersion = await readTableStateVersion(firestore, campaignId);
  // Campaign-page toast may mention a real checkpoint; Story so far never does (PQA-087).
  // Never publish "checkpoint 0" anywhere — it reads as a false diagnostic.
  const tableStateVersionNote =
    tableStateVersion > 0
      ? `Table checkpoint ${tableStateVersion} at suspend.`
      : 'Table state preserved at suspend.';

  const now = new Date();
  const note =
    typeof options.note === 'string' && options.note.trim().length > 0
      ? options.note.trim().slice(0, 280)
      : null;
  const updatedMemory: StoredCampaignMemory = { ...memory, updatedAt: now };
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

  // Keep checkpoint diagnostics off Story so far — only the human suspend note belongs there.
  await appendChronicleEntry({
    firestore,
    campaignId,
    kind: 'session_suspended',
    body:
      note === null
        ? 'The session was suspended.'
        : `The session was suspended: ${note}`,
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
  const closedChapters = memory.chapters.filter(
    (chapter) => typeof chapter.recordedSummary === 'string' && chapter.recordedSummary.length > 0,
  );
  const currentChapter =
    memory.chapters.find((chapter) => chapter.chapterId === memory.currentChapterId) ?? null;
  const currentStillOpen =
    currentChapter !== null &&
    !(typeof currentChapter.recordedSummary === 'string' && currentChapter.recordedSummary.length > 0);

  let headline: string;
  if (closedChapters.length === 0) {
    headline =
      currentChapter === null
        ? 'No chapters have been played yet.'
        : `The party has not yet finished "${currentChapter.title}".`;
  } else if (currentStillOpen && currentChapter !== null) {
    headline = `Since you were last here, the party finished ${closedChapters.length} chapter${closedChapters.length === 1 ? '' : 's'}, most recently "${closedChapters[closedChapters.length - 1]!.title}". Now playing: "${currentChapter.title}".`;
  } else {
    headline = `Since you were last here, the party finished ${closedChapters.length} chapter${closedChapters.length === 1 ? '' : 's'}, most recently "${closedChapters[closedChapters.length - 1]!.title}".`;
  }

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

/** Throws when the session is suspended and play must not continue (PQA-085). */
export async function assertSessionAllowsPlay(
  firestore: Firestore,
  campaignId: string,
): Promise<void> {
  const session = await loadStoredSession(firestore, campaignId);
  if (session.state === 'suspended') {
    throw new CampaignMemoryError(
      'BAD_REQUEST',
      'This campaign session is suspended. Resume it from the campaign page before playing.',
    );
  }
}
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
