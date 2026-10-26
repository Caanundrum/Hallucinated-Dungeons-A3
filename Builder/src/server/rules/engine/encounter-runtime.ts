import type { Firestore } from 'firebase-admin/firestore';

import type {
  CharacterChoices,
  DerivedCharacterSheet,
} from '../../../shared/character-contract.js';
import type {
  CharacterProgressionProjection,
  EncounterProjection,
} from '../../../shared/rules-combat-contract.js';
import { describeEquipmentItemMechanics } from '../../../shared/container-contents.js';
import { COLLECTIONS } from '../../persistence/firestore.js';
import { deriveSheet } from '../character-rules.js';
import { findClass } from '../srd-manifest.js';
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
  /** ISO timestamp of the last Arcane Recovery use (once per day). */
  readonly arcaneRecoveryUsedAt?: string | null;
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

/** Merge a taken scene prop into equipmentOverrides without wiping the base sheet. */
export function appendEquipmentOverride(options: {
  readonly baseEquipment: readonly {
    readonly name: string;
    readonly quantity: number;
    readonly equipped?: boolean;
  }[];
  readonly equipmentOverrides?: readonly {
    readonly name: string;
    readonly quantity: number;
    readonly equipped?: boolean;
  }[];
  readonly itemName: string;
  readonly quantity?: number;
}): readonly {
  readonly name: string;
  readonly quantity: number;
  readonly equipped?: boolean;
}[] {
  const qty = Math.max(1, options.quantity ?? 1);
  const current =
    options.equipmentOverrides !== undefined && options.equipmentOverrides.length > 0
      ? options.equipmentOverrides.map((item) => ({
          name: item.name,
          quantity: Math.max(0, item.quantity),
          ...(item.equipped === undefined ? {} : { equipped: item.equipped }),
        }))
      : options.baseEquipment.map((item) => ({
          name: item.name,
          quantity: Math.max(0, item.quantity),
          ...(item.equipped === undefined ? {} : { equipped: item.equipped }),
        }));
  const needle = options.itemName.trim().toLowerCase();
  const index = current.findIndex((item) => item.name.trim().toLowerCase() === needle);
  if (index >= 0) {
    const existing = current[index]!;
    return current.map((item, i) =>
      i === index ? { ...item, quantity: existing.quantity + qty } : item,
    );
  }
  return [...current, { name: options.itemName.trim(), quantity: qty }];
}

export function applyProgressionTrackers(
  sheet: DerivedCharacterSheet,
  progression: StoredProgression | null,
): DerivedCharacterSheet {
  if (progression === null) {
    return sheet;
  }
  const rawEquipment =
    progression.equipmentOverrides !== undefined && progression.equipmentOverrides.length > 0
      ? progression.equipmentOverrides.map((item) => {
          const baseMatch = sheet.equipment.find(
            (entry) => entry.name.trim().toLowerCase() === item.name.trim().toLowerCase(),
          );
          const fallbackMeta =
            baseMatch?.statsSummary !== undefined
              ? null
              : describeEquipmentItemMechanics(item.name);
          return {
            ...(baseMatch ?? {}),
            ...(fallbackMeta !== null
              ? {
                  itemKind: baseMatch?.itemKind ?? fallbackMeta.itemKind,
                  statsSummary: fallbackMeta.statsSummary,
                }
              : {}),
            name: item.name,
            quantity: Math.max(0, item.quantity),
            ...(item.equipped === undefined ? {} : { equipped: item.equipped }),
          };
        })
      : sheet.equipment;

  const targetLevel = Math.max(
    1,
    Math.min(20, typeof progression.level === 'number' ? progression.level : sheet.level),
  );
  const targetXp =
    typeof progression.experiencePoints === 'number'
      ? progression.experiencePoints
      : sheet.experiencePoints;
  const synchronizedSheet =
    typeof progression.classId === 'string' && findClass(progression.classId) !== null
      ? recomputeSheetForLevel(
          { ...sheet, equipment: rawEquipment },
          progression.classId,
          targetLevel,
          targetXp,
        )
      : { ...sheet, equipment: rawEquipment };

  const maxHp = synchronizedSheet.hitPoints.value;
  const hitPointsCurrent =
    typeof progression.hitPointsCurrent === 'number'
      ? Math.max(0, Math.min(maxHp, progression.hitPointsCurrent))
      : synchronizedSheet.hitPointsCurrent;
  const temporaryHitPoints =
    typeof progression.temporaryHitPoints === 'number'
      ? Math.max(0, progression.temporaryHitPoints)
      : (synchronizedSheet.temporaryHitPoints ?? 0);
  const classResources = (synchronizedSheet.classResources ?? []).map((resource) => {
    const remaining = progression.resourceRemaining?.[resource.id];
    if (typeof remaining !== 'number') {
      return resource;
    }
    return {
      ...resource,
      remaining: Math.max(0, Math.min(resource.maximum, remaining)),
    };
  });
  const spellcasting =
    synchronizedSheet.spellcasting === null
      ? null
      : {
          ...synchronizedSheet.spellcasting,
          level1SlotsRemaining:
            typeof progression.level1SlotsRemaining === 'number'
              ? Math.max(
                  0,
                  Math.min(
                    synchronizedSheet.spellcasting.level1SlotCount,
                    progression.level1SlotsRemaining,
                  ),
                )
              : synchronizedSheet.spellcasting.level1SlotsRemaining,
        };
  return {
    ...synchronizedSheet,
    hitPointsCurrent,
    temporaryHitPoints,
    classResources,
    spellcasting,
  };
}

export function projectProgression(
  source: StoredCharacterRulesSource,
  stored: StoredProgression,
): CharacterProgressionProjection {
  const baseSheet = baseSheetFor(source);
  const level = Math.max(1, Math.min(20, stored.level));
  const sheet = applyProgressionTrackers(
    recomputeSheetForLevel(baseSheet, stored.classId, level, stored.experiencePoints),
    stored,
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
