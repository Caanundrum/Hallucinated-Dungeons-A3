/**
 * Per-account presentation settings.
 *
 * Blueprint ownership: Section 1.5.21 — local preferences only. Speech/AI
 * presentation fields are reserved defaults; Phase 1 exposes reducedMotion
 * because the shell already honors it.
 */

import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import {
  RESERVED_PLAYER_PRESENTATION_DEFAULTS,
  type PlayerPresentationSettingsProjection,
} from '../../shared/settings-contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';

interface StoredAccountSettings {
  readonly accountId: string;
  readonly reducedMotion: boolean;
  readonly reserved: typeof RESERVED_PLAYER_PRESENTATION_DEFAULTS;
  readonly createdAt: Timestamp | Date;
  readonly updatedAt: Timestamp | Date;
}

function toIso(value: Timestamp | Date): string {
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

function project(stored: StoredAccountSettings): PlayerPresentationSettingsProjection {
  return {
    accountId: stored.accountId,
    reducedMotion: stored.reducedMotion,
    reserved: RESERVED_PLAYER_PRESENTATION_DEFAULTS,
    updatedAt: toIso(stored.updatedAt),
  };
}

async function ensure(firestore: Firestore, accountId: string): Promise<StoredAccountSettings> {
  const ref = firestore.collection(COLLECTIONS.accountSettings).doc(accountId);
  const snapshot = await ref.get();
  if (snapshot.exists) {
    return snapshot.data() as StoredAccountSettings;
  }
  const now = new Date();
  const created: StoredAccountSettings = {
    accountId,
    reducedMotion: false,
    reserved: RESERVED_PLAYER_PRESENTATION_DEFAULTS,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(created);
  return created;
}

export async function readPlayerSettings(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
}): Promise<PlayerPresentationSettingsProjection> {
  return project(await ensure(options.firestore, options.accountId));
}

export async function updatePlayerSettings(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly reducedMotion: unknown;
}): Promise<PlayerPresentationSettingsProjection> {
  const current = await ensure(options.firestore, options.accountId);
  if (typeof options.reducedMotion !== 'boolean') {
    throw new Error('reducedMotion must be a boolean');
  }
  const updated: StoredAccountSettings = {
    ...current,
    reducedMotion: options.reducedMotion,
    reserved: RESERVED_PLAYER_PRESENTATION_DEFAULTS,
    updatedAt: new Date(),
  };
  await options.firestore.collection(COLLECTIONS.accountSettings).doc(options.accountId).set(updated);
  return project(updated);
}
