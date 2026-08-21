/**
 * NPC Speak-as-Character spotlight — serializes who holds the floor with an NPC.
 */

import type { Firestore } from 'firebase-admin/firestore';

import { ERROR_CODES } from '../../shared/contract.js';
import {
  NPC_SPOTLIGHT_TTL_MS,
  type NpcSpotlightProjection,
  type TableConflictDetail,
} from '../../shared/table-contention-contract.js';
import type { CampaignNpcRecordProjection } from '../../shared/campaign-memory-contract.js';
import { loadCampaignMemory } from '../campaigns/campaign-memory.js';
import { COLLECTIONS } from '../persistence/firestore.js';

export class NpcSpotlightError extends Error {
  readonly code: string;
  readonly conflict?: TableConflictDetail;

  constructor(code: string, message: string, conflict?: TableConflictDetail) {
    super(message);
    this.name = 'NpcSpotlightError';
    this.code = code;
    if (conflict !== undefined) {
      this.conflict = conflict;
    }
  }
}

interface StoredSeat {
  readonly seatId: string;
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly characterId: string;
}

interface StoredProjectionDoc {
  readonly stateVersion?: number;
  readonly lastEventSequence?: number;
  readonly lastEventId?: string | null;
  readonly tokenPositions?: unknown;
  readonly doorStates?: Record<string, string>;
  readonly exploredByAccount?: Record<string, string[]>;
  readonly npcSpotlight?: NpcSpotlightProjection | null;
  readonly campaignId?: string;
  readonly updatedAt?: Date | null;
}

function liveSpotlight(
  spotlight: NpcSpotlightProjection | null | undefined,
  now: Date,
): NpcSpotlightProjection | null {
  if (spotlight === null || spotlight === undefined) {
    return null;
  }
  if (Date.parse(spotlight.expiresAt) <= now.getTime()) {
    return null;
  }
  return spotlight;
}

/** Match an addressed NPC from spoken text against public campaign memory. */
export function matchAddressedNpc(
  body: string,
  npcs: readonly CampaignNpcRecordProjection[],
): CampaignNpcRecordProjection | null {
  const text = body.toLowerCase();
  let best: CampaignNpcRecordProjection | null = null;
  let bestScore = 0;
  for (const npc of npcs) {
    const name = npc.name.trim().toLowerCase();
    if (name.length < 2) {
      continue;
    }
    let score = 0;
    if (text.includes(`@${name}`) || text.includes(`to ${name}`) || text.includes(`hey ${name}`)) {
      score = 3;
    } else if (text.includes(name)) {
      score = 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = npc;
    }
  }
  return bestScore > 0 ? best : null;
}

async function loadOwnSeat(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<StoredSeat | null> {
  const snap = await options.firestore
    .collection(COLLECTIONS.campaignSeats)
    .where('campaignId', '==', options.campaignId)
    .where('ownerAccountId', '==', options.accountId)
    .limit(1)
    .get();
  if (snap.empty) {
    return null;
  }
  return snap.docs[0]!.data() as StoredSeat;
}

/**
 * Claims or refreshes the NPC floor for Speak as Character.
 * Returns the spotlight projection when an NPC was addressed; null if no NPC match.
 */
export async function claimNpcSpotlightForSpeech(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
  readonly displayLabel: string;
  readonly body: string;
}): Promise<NpcSpotlightProjection | null> {
  const memory = await loadCampaignMemory(
    options.firestore,
    options.campaignId,
    options.accountId,
  );
  const npc = matchAddressedNpc(options.body, memory.npcs);
  if (npc === null) {
    return null;
  }
  const seat = await loadOwnSeat(options);
  if (seat === null) {
    throw new NpcSpotlightError(
      ERROR_CODES.NOT_SEATED,
      'Seat a character before speaking as that character to an NPC.',
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + NPC_SPOTLIGHT_TTL_MS);
  const projectionRef = options.firestore
    .collection(COLLECTIONS.campaignTableProjections)
    .doc(options.campaignId);

  let result: NpcSpotlightProjection | null = null;
  await options.firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(projectionRef);
    const current = (snap.exists ? snap.data() : {}) as StoredProjectionDoc;
    const held = liveSpotlight(current.npcSpotlight ?? null, now);
    if (
      held !== null &&
      held.npcId === npc.npcId &&
      held.holderSeatId !== seat.seatId
    ) {
      const conflict: TableConflictDetail = {
        reason: 'npc_spotlight',
        message: `${held.holderDisplayName} currently holds the floor with ${held.npcName}. Wait for the spotlight to clear, then speak.`,
        holderDisplayName: held.holderDisplayName,
        npcId: held.npcId,
        npcName: held.npcName,
        serverStateVersion: current.stateVersion ?? 0,
        ...(held.lastMessagePreview
          ? { competingSummary: held.lastMessagePreview }
          : {}),
      };
      throw new NpcSpotlightError(ERROR_CODES.NPC_SPOTLIGHT_HELD, conflict.message, conflict);
    }
    const next: NpcSpotlightProjection = {
      npcId: npc.npcId,
      npcName: npc.name,
      holderSeatId: seat.seatId,
      holderAccountId: options.accountId,
      holderDisplayName: options.displayLabel,
      claimedAt: (held?.holderSeatId === seat.seatId ? held.claimedAt : now.toISOString()),
      expiresAt: expiresAt.toISOString(),
      lastMessagePreview: options.body.slice(0, 120),
    };
    result = next;
    transaction.set(
      projectionRef,
      {
        campaignId: options.campaignId,
        stateVersion: current.stateVersion ?? 0,
        lastEventSequence: current.lastEventSequence ?? 0,
        lastEventId: current.lastEventId ?? null,
        updatedAt: now,
        tokenPositions: current.tokenPositions ?? [],
        doorStates: current.doorStates ?? {},
        exploredByAccount: current.exploredByAccount ?? {},
        npcSpotlight: next,
      },
      { merge: true },
    );
  });
  return result;
}

export async function yieldNpcSpotlight(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<NpcSpotlightProjection | null> {
  const seat = await loadOwnSeat(options);
  if (seat === null) {
    throw new NpcSpotlightError(
      ERROR_CODES.NOT_SEATED,
      'Seat a character before yielding the NPC floor.',
    );
  }
  const projectionRef = options.firestore
    .collection(COLLECTIONS.campaignTableProjections)
    .doc(options.campaignId);
  let cleared: NpcSpotlightProjection | null = null;
  await options.firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(projectionRef);
    if (!snap.exists) {
      return;
    }
    const current = snap.data() as StoredProjectionDoc;
    const held = liveSpotlight(current.npcSpotlight ?? null, new Date());
    if (held === null || held.holderSeatId !== seat.seatId) {
      return;
    }
    cleared = held;
    transaction.set(
      projectionRef,
      {
        ...current,
        campaignId: options.campaignId,
        npcSpotlight: null,
        updatedAt: new Date(),
      },
      { merge: true },
    );
  });
  return cleared;
}
