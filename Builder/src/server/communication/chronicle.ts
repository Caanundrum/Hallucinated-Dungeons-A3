/**
 * Server-authored Chronicle entries for Phase 1.
 *
 * Blueprint ownership: Section 1.5.2.2 — players never post into Chronicle.
 * Entries derive from trusted application events only.
 */

import { randomUUID } from 'node:crypto';

import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import type {
  ChronicleEntryKind,
  ChronicleEntryProjection,
  ChronicleFeedProjection,
} from '../../shared/communication-contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';

interface StoredChronicleEntry {
  readonly entryId: string;
  readonly campaignId: string;
  readonly kind: ChronicleEntryKind;
  readonly body: string;
  readonly createdAt: Timestamp | Date;
  readonly sequence: number;
}

function toIso(value: Timestamp | Date): string {
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

function projectEntry(stored: StoredChronicleEntry): ChronicleEntryProjection {
  return {
    entryId: stored.entryId,
    campaignId: stored.campaignId,
    kind: stored.kind,
    body: stored.body,
    createdAt: toIso(stored.createdAt),
    sequence: stored.sequence,
  };
}

async function nextSequence(firestore: Firestore, campaignId: string): Promise<number> {
  const snapshot = await firestore
    .collection(COLLECTIONS.chronicleEntries)
    .where('campaignId', '==', campaignId)
    .limit(200)
    .get();
  let highest = 0;
  for (const doc of snapshot.docs) {
    const entry = doc.data() as StoredChronicleEntry;
    if (entry.sequence > highest) {
      highest = entry.sequence;
    }
  }
  return highest + 1;
}

export async function appendChronicleEntry(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly kind: ChronicleEntryKind;
  readonly body: string;
}): Promise<ChronicleEntryProjection> {
  const { firestore, campaignId, kind, body } = options;
  const sequence = await nextSequence(firestore, campaignId);
  const entry: StoredChronicleEntry = {
    entryId: randomUUID(),
    campaignId,
    kind,
    body,
    createdAt: new Date(),
    sequence,
  };
  await firestore.collection(COLLECTIONS.chronicleEntries).doc(entry.entryId).set(entry);
  return projectEntry(entry);
}

export async function listChronicleEntries(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
}): Promise<ChronicleFeedProjection> {
  const snapshot = await options.firestore
    .collection(COLLECTIONS.chronicleEntries)
    .where('campaignId', '==', options.campaignId)
    .limit(200)
    .get();
  const entries = snapshot.docs
    .map((doc) => projectEntry(doc.data() as StoredChronicleEntry))
    .sort(
      (left: ChronicleEntryProjection, right: ChronicleEntryProjection) =>
        left.sequence - right.sequence,
    );
  return { campaignId: options.campaignId, entries };
}
