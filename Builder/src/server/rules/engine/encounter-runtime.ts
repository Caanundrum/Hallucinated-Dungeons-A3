import type { Firestore } from 'firebase-admin/firestore';

import type {
  CharacterChoices,
  DerivedCharacterSheet,
} from '../../../shared/character-contract.js';
import type {
  CharacterProgressionProjection,
  EncounterProjection,
} from '../../../shared/rules-combat-contract.js';
import { COLLECTIONS } from '../../persistence/firestore.js';
import { deriveSheet } from '../character-rules.js';
import {
  deriveProgression,
  levelForExperience,
  recomputeSheetForLevel,
} from './xp-progression.js';

export interface StoredCharacterRulesSource {
  readonly characterId: string;
  readonly ownerAccountId: string;
  readonly choices: CharacterChoices;
}

export interface StoredProgression {
  readonly characterId: string;
  readonly classId: string;
  readonly experiencePoints: number;
  readonly level: number;
  readonly updatedAt: string;
  /** Encounter that already granted an XP award, if any. */
  readonly lastAwardedEncounterId?: string | null;
  /** Persisted sheet trackers (PQA-213/214/215/216). */
  readonly hitPointsCurrent?: number;
  readonly temporaryHitPoints?: number;
  readonly resourceRemaining?: Readonly<Record<string, number>>;
  readonly level1SlotsRemaining?: number;
  readonly equipmentOverrides?: readonly {
    readonly name: string;
    readonly quantity: number;
    readonly equipped?: boolean;
  }[];
}

export async function loadEncounter(
  firestore: Firestore,
  campaignId: string,
): Promise<EncounterProjection | null> {
  const snapshot = await firestore.collection(COLLECTIONS.campaignEncounters).doc(campaignId).get();
  return snapshot.exists ? (snapshot.data() as EncounterProjection) : null;
}

export async function saveEncounter(
  firestore: Firestore,
  encounter: EncounterProjection,
): Promise<void> {
  await firestore
    .collection(COLLECTIONS.campaignEncounters)
    .doc(encounter.campaignId)
    .set(encounter);
}

export async function loadCharacterRulesSource(
  firestore: Firestore,
  characterId: string,
): Promise<StoredCharacterRulesSource> {
  const snapshot = await firestore.collection(COLLECTIONS.characters).doc(characterId).get();
  if (!snapshot.exists) {
    throw new Error('The seated character no longer exists.');
  }
  return snapshot.data() as StoredCharacterRulesSource;
}

export function initialStoredProgression(
  source: StoredCharacterRulesSource,
  now = new Date(),
): StoredProgression {
  if (source.choices.classId === null) {
    throw new Error('The seated character has no Class.');
  }
  return {
    characterId: source.characterId,
    classId: source.choices.classId,
    experiencePoints: 0,
    level: 1,
    updatedAt: now.toISOString(),
  };
}

export function baseSheetFor(source: StoredCharacterRulesSource): DerivedCharacterSheet {
  const sheet = deriveSheet(source.choices);
  if (sheet === null) {
    throw new Error('The seated character cannot be derived under the current rules.');
  }
  return sheet;
}

export function projectProgression(
  source: StoredCharacterRulesSource,
  stored: StoredProgression,
): CharacterProgressionProjection {
  const baseSheet = baseSheetFor(source);
  const level = Math.max(1, Math.min(20, stored.level));
  const sheet = recomputeSheetForLevel(
    baseSheet,
    stored.classId,
    level,
    stored.experiencePoints,
  );
  return {
    characterId: stored.characterId,
    classId: stored.classId,
    experiencePoints: stored.experiencePoints,
    level,
    levelUpAvailable: levelForExperience(stored.experiencePoints) > level,
    derived: deriveProgression(baseSheet, stored.classId, level),
    sheet,
    updatedAt: stored.updatedAt,
  };
}

export async function loadProgressionProjection(
  firestore: Firestore,
  characterId: string,
): Promise<CharacterProgressionProjection> {
  const [source, progressionSnapshot] = await Promise.all([
    loadCharacterRulesSource(firestore, characterId),
    firestore.collection(COLLECTIONS.characterProgressions).doc(characterId).get(),
  ]);
  const stored = progressionSnapshot.exists
    ? (progressionSnapshot.data() as StoredProgression)
    : initialStoredProgression(source);
  return projectProgression(source, stored);
}
