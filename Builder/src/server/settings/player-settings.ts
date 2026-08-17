/**
 * Per-account presentation settings.
 *
 * Blueprint ownership: Section 1.5.21. Phase 4 activates player-optional
 * speech prefs (TTS/STT) stored under `reserved`.
 */

import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import {
  RESERVED_PLAYER_PRESENTATION_DEFAULTS,
  isNarrationDensity,
  type PlayerPresentationSettingsProjection,
  type ReservedPlayerPresentationSettings,
} from '../../shared/settings-contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';

interface StoredAccountSettings {
  readonly accountId: string;
  readonly reducedMotion: boolean;
  readonly lowEffects: boolean;
  readonly reserved: ReservedPlayerPresentationSettings;
  readonly createdAt: Timestamp | Date;
  readonly updatedAt: Timestamp | Date;
}

function toIso(value: Timestamp | Date): string {
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

function normalizeReserved(
  raw: Partial<ReservedPlayerPresentationSettings> | undefined,
): ReservedPlayerPresentationSettings {
  return {
    textToSpeechEnabled: raw?.textToSpeechEnabled === true,
    chronicleAutoplay: raw?.chronicleAutoplay === true,
    privateDirectorAutoplay: raw?.privateDirectorAutoplay === true,
    speechToTextEnabled: raw?.speechToTextEnabled === true,
    narrationDensity: raw?.narrationDensity ?? RESERVED_PLAYER_PRESENTATION_DEFAULTS.narrationDensity,
    dicePresentation: raw?.dicePresentation ?? RESERVED_PLAYER_PRESENTATION_DEFAULTS.dicePresentation,
  };
}

function project(stored: StoredAccountSettings): PlayerPresentationSettingsProjection {
  return {
    accountId: stored.accountId,
    reducedMotion: stored.reducedMotion,
    lowEffects: stored.lowEffects,
    reserved: normalizeReserved(stored.reserved),
    updatedAt: toIso(stored.updatedAt),
  };
}

async function ensure(firestore: Firestore, accountId: string): Promise<StoredAccountSettings> {
  const ref = firestore.collection(COLLECTIONS.accountSettings).doc(accountId);
  const snapshot = await ref.get();
  if (snapshot.exists) {
    const raw = snapshot.data() as Partial<StoredAccountSettings> & {
      accountId: string;
      reducedMotion: boolean;
    };
    return {
      accountId: raw.accountId,
      reducedMotion: raw.reducedMotion,
      lowEffects: raw.lowEffects === true,
      reserved: normalizeReserved(raw.reserved),
      createdAt: (raw.createdAt as Timestamp | Date | undefined) ?? new Date(0),
      updatedAt: (raw.updatedAt as Timestamp | Date | undefined) ?? new Date(0),
    };
  }
  const now = new Date();
  const created: StoredAccountSettings = {
    accountId,
    reducedMotion: false,
    lowEffects: false,
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
  readonly lowEffects?: unknown;
  readonly speech?: {
    readonly textToSpeechEnabled?: unknown;
    readonly chronicleAutoplay?: unknown;
    readonly privateDirectorAutoplay?: unknown;
    readonly speechToTextEnabled?: unknown;
  };
  /** Player-controlled narration length (Section 25 Phase 5). */
  readonly narrationDensity?: unknown;
}): Promise<PlayerPresentationSettingsProjection> {
  const current = await ensure(options.firestore, options.accountId);
  if (typeof options.reducedMotion !== 'boolean') {
    throw new Error('reducedMotion must be a boolean');
  }
  if (options.lowEffects !== undefined && typeof options.lowEffects !== 'boolean') {
    throw new Error('lowEffects must be a boolean');
  }
  if (options.narrationDensity !== undefined && !isNarrationDensity(options.narrationDensity)) {
    throw new Error('narrationDensity must be one of concise, balanced, cinematic');
  }
  const speech = options.speech ?? {};
  for (const key of [
    'textToSpeechEnabled',
    'chronicleAutoplay',
    'privateDirectorAutoplay',
    'speechToTextEnabled',
  ] as const) {
    if (speech[key] !== undefined && typeof speech[key] !== 'boolean') {
      throw new Error(`${key} must be a boolean`);
    }
  }
  const reserved: ReservedPlayerPresentationSettings = {
    ...current.reserved,
    textToSpeechEnabled:
      typeof speech.textToSpeechEnabled === 'boolean'
        ? speech.textToSpeechEnabled
        : current.reserved.textToSpeechEnabled,
    chronicleAutoplay:
      typeof speech.chronicleAutoplay === 'boolean'
        ? speech.chronicleAutoplay
        : current.reserved.chronicleAutoplay,
    privateDirectorAutoplay:
      typeof speech.privateDirectorAutoplay === 'boolean'
        ? speech.privateDirectorAutoplay
        : current.reserved.privateDirectorAutoplay,
    speechToTextEnabled:
      typeof speech.speechToTextEnabled === 'boolean'
        ? speech.speechToTextEnabled
        : current.reserved.speechToTextEnabled,
    narrationDensity: isNarrationDensity(options.narrationDensity)
      ? options.narrationDensity
      : current.reserved.narrationDensity,
  };
  const updated: StoredAccountSettings = {
    ...current,
    reducedMotion: options.reducedMotion,
    lowEffects:
      typeof options.lowEffects === 'boolean' ? options.lowEffects : current.lowEffects,
    reserved,
    updatedAt: new Date(),
  };
  await options.firestore.collection(COLLECTIONS.accountSettings).doc(options.accountId).set(updated);
  return project(updated);
}
