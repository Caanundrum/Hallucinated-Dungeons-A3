/**
 * Character drafts, commitment, and the account-owned Character Vault.
 *
 * Blueprint ownership: Sections 6.4 (save a draft after every confirmed step;
 * permit the player to leave and resume without creating duplicate
 * characters), 7.7 (account-bound character ownership), and 19.12 (the
 * character aggregate preserves both chosen source facts and derived state).
 *
 * Ownership rule, enforced here and nowhere else: every read and write is
 * filtered on `ownerAccountId` server-side. A caller can only ever reach
 * records their authenticated account owns, and the client never supplies an
 * owner.
 */

import { randomUUID } from 'node:crypto';

import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import {
  MAX_ABILITY_ROLL_ATTEMPTS,
  type CharacterChoices,
  type CharacterProjection,
  type CharacterVaultProjection,
  type DraftProjection,
} from '../../shared/character-contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import { findQuickStartTemplate } from '../rules/srd-manifest.js';
import {
  RULES_VERSION,
  coerceStoredChoices,
  completedSteps,
  deriveSheet,
  describeChoices,
  emptyChoices,
  rollAbilityScorePool,
  sanitizeChoices,
  validateChoices,
} from '../rules/character-rules.js';
import {
  type StoredProgression,
} from '../rules/engine/encounter-runtime.js';
import { recomputeSheetForLevel } from '../rules/engine/xp-progression.js';

/** A draft that has not been touched for this long is still resumable; drafts do not expire in Phase 1. */
interface StoredDraft {
  readonly draftId: string;
  readonly ownerAccountId: string;
  readonly rulesVersion: string;
  readonly choices: CharacterChoices;
  readonly createdAt: Timestamp | Date;
  readonly updatedAt: Timestamp | Date;
}

interface StoredCharacter {
  readonly characterId: string;
  readonly ownerAccountId: string;
  readonly rulesVersion: string;
  readonly choices: CharacterChoices;
  readonly createdAt: Timestamp | Date;
  readonly revisions: readonly { readonly at: string; readonly reason: string }[];
}

export class CharacterNotFoundError extends Error {
  constructor() {
    super('No such character or draft for this account');
    this.name = 'CharacterNotFoundError';
  }
}

export class CharacterIncompleteError extends Error {
  constructor() {
    super('The draft still has unresolved required choices');
    this.name = 'CharacterIncompleteError';
  }
}

export class AbilityRollsExhaustedError extends Error {
  constructor() {
    super(`You have already used all ${MAX_ABILITY_ROLL_ATTEMPTS} Ability Score rolls.`);
    this.name = 'AbilityRollsExhaustedError';
  }
}

/**
 * Backfills fields added after a draft was first written so older documents
 * still project cleanly under the current contract.
 */
function normalizeChoices(choices: CharacterChoices): CharacterChoices {
  return sanitizeChoices(coerceStoredChoices(choices));
}

function toIso(value: Timestamp | Date): string {
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

function projectDraft(stored: StoredDraft): DraftProjection {
  const choices = normalizeChoices(stored.choices);
  const problems = validateChoices(choices);
  return {
    draftId: stored.draftId,
    rulesVersion: stored.rulesVersion,
    updatedAt: toIso(stored.updatedAt),
    choices,
    sheet: deriveSheet(choices),
    unresolved: problems,
    completedSteps: completedSteps(choices),
    canCreate: problems.length === 0,
  };
}

function projectCharacter(
  stored: StoredCharacter,
  progression: StoredProgression | null = null,
): CharacterProjection {
  const choices = normalizeChoices(stored.choices);
  const baseSheet = deriveSheet(choices);
  if (baseSheet === null) {
    // A committed character always has Class, Background, and Species, since
    // commitment requires a clean validation. Reaching here means the stored
    // record is impossible under the current rules version (Section 6.5's
    // quarantine case) and must not be presented as a playable sheet.
    throw new Error(`Stored character ${stored.characterId} cannot be derived under ${RULES_VERSION}`);
  }
  const labels = describeChoices(choices);
  const level = progression?.level ?? baseSheet.level;
  const experiencePoints = progression?.experiencePoints ?? baseSheet.experiencePoints;
  const classId = progression?.classId ?? choices.classId;
  const sheet =
    progression !== null && classId !== null
      ? recomputeSheetForLevel(baseSheet, classId, level, experiencePoints)
      : baseSheet;
  return {
    characterId: stored.characterId,
    rulesVersion: stored.rulesVersion,
    createdAt: toIso(stored.createdAt),
    identity: choices.identity,
    classLabel: labels.classLabel,
    speciesLabel: labels.speciesLabel,
    backgroundLabel: labels.backgroundLabel,
    level: sheet.level,
    choices,
    sheet,
  };
}

/**
 * Returns the account's open draft, creating one only if none exists.
 *
 * This is what makes "leave and resume without creating duplicate characters"
 * true: the wizard always resumes the single open draft rather than starting
 * a new one on every visit.
 */
export async function openOrResumeDraft(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
}): Promise<DraftProjection> {
  const { firestore, accountId } = options;

  const existing = await firestore
    .collection(COLLECTIONS.characterDrafts)
    .where('ownerAccountId', '==', accountId)
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get();

  if (!existing.empty) {
    return projectDraft(existing.docs[0]!.data() as StoredDraft);
  }

  const now = new Date();
  const draft: StoredDraft = {
    draftId: randomUUID(),
    ownerAccountId: accountId,
    rulesVersion: RULES_VERSION,
    choices: emptyChoices(),
    createdAt: now,
    updatedAt: now,
  };
  await firestore.collection(COLLECTIONS.characterDrafts).doc(draft.draftId).set(draft);
  return projectDraft(draft);
}

async function loadOwnedDraft(
  firestore: Firestore,
  accountId: string,
  draftId: string,
): Promise<StoredDraft> {
  const snapshot = await firestore.collection(COLLECTIONS.characterDrafts).doc(draftId).get();
  if (!snapshot.exists) {
    throw new CharacterNotFoundError();
  }
  const stored = snapshot.data() as StoredDraft;
  // Ownership is checked against the authenticated account, never against a
  // value the caller supplied.
  if (stored.ownerAccountId !== accountId) {
    throw new CharacterNotFoundError();
  }
  return stored;
}

/** Saves the draft after a confirmed step. Validation is recomputed on read. */
export async function updateDraft(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly draftId: string;
  readonly choices: CharacterChoices;
}): Promise<DraftProjection> {
  const { firestore, accountId, draftId, choices } = options;
  const stored = await loadOwnedDraft(firestore, accountId, draftId);
  const previous = normalizeChoices(stored.choices);

  // Roll state is server-authored. A PUT cannot forge a pool, rewind attempts,
  // or restore a previous roll by shipping those fields from the client.
  const merged: CharacterChoices = {
    ...choices,
    rolledScorePool: previous.rolledScorePool,
    abilityRollAttempts: previous.abilityRollAttempts,
  };

  const updated: StoredDraft = {
    ...stored,
    choices: merged,
    rulesVersion: RULES_VERSION,
    updatedAt: new Date(),
  };
  await firestore.collection(COLLECTIONS.characterDrafts).doc(draftId).set(updated);
  return projectDraft(updated);
}

/**
 * Rolls a fresh Ability Score pool for the draft (4d6 drop lowest × 6).
 *
 * Each roll replaces the previous pool and clears assigned base scores. The
 * player may roll at most `MAX_ABILITY_ROLL_ATTEMPTS` times; earlier pools
 * cannot be restored.
 */
export async function rollDraftAbilities(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly draftId: string;
}): Promise<DraftProjection> {
  const { firestore, accountId, draftId } = options;
  const stored = await loadOwnedDraft(firestore, accountId, draftId);
  const previous = normalizeChoices(stored.choices);

  if (previous.abilityRollAttempts >= MAX_ABILITY_ROLL_ATTEMPTS) {
    throw new AbilityRollsExhaustedError();
  }

  const choices: CharacterChoices = {
    ...previous,
    abilityMethod: 'rolled',
    rolledScorePool: rollAbilityScorePool(),
    abilityRollAttempts: previous.abilityRollAttempts + 1,
    baseAbilityScores: {},
  };

  const updated: StoredDraft = {
    ...stored,
    choices,
    rulesVersion: RULES_VERSION,
    updatedAt: new Date(),
  };
  await firestore.collection(COLLECTIONS.characterDrafts).doc(draftId).set(updated);
  return projectDraft(updated);
}

/**
 * Applies a quick-start template to the draft, filling every mechanical
 * decision and deliberately leaving identity for the final step.
 */
export async function applyQuickStart(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly draftId: string;
  readonly templateId: string;
}): Promise<DraftProjection> {
  const { firestore, accountId, draftId, templateId } = options;
  const stored = await loadOwnedDraft(firestore, accountId, draftId);
  const template = findQuickStartTemplate(templateId);
  if (template === null) {
    throw new CharacterNotFoundError();
  }

  const choices: CharacterChoices = {
    ...emptyChoices(),
    classId: template.classId,
    backgroundId: template.backgroundId,
    speciesId: template.speciesId,
    abilityMethod: 'standard-array',
    baseAbilityScores: template.baseAbilityScores,
    backgroundAbilityBonuses: template.backgroundAbilityBonuses,
    classSkillIds: template.classSkillIds,
    speciesChoiceIds: template.speciesChoiceIds,
    classChoiceIds: template.classChoiceIds,
    classEquipmentOptionId: template.classEquipmentOptionId,
    backgroundEquipmentOptionId: template.backgroundEquipmentOptionId,
    cantripIds: template.cantripIds,
    spellbookIds: template.spellbookIds ?? [],
    spellIds: template.spellIds,
    chosenOriginFeatId: template.chosenOriginFeatId ?? null,
    backgroundFeatCantripIds: template.backgroundFeatCantripIds ?? [],
    backgroundFeatSpellIds: template.backgroundFeatSpellIds ?? [],
    originFeatCantripIds: template.originFeatCantripIds ?? [],
    originFeatSpellIds: template.originFeatSpellIds ?? [],
    // Identity is intentionally left empty: the player supplies it at the
    // final review step, exactly as the custom path requires.
    identity: stored.choices.identity,
  };

  const updated: StoredDraft = { ...stored, choices, rulesVersion: RULES_VERSION, updatedAt: new Date() };
  await firestore.collection(COLLECTIONS.characterDrafts).doc(draftId).set(updated);
  return projectDraft(updated);
}

export async function readDraft(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly draftId: string;
}): Promise<DraftProjection> {
  return projectDraft(await loadOwnedDraft(options.firestore, options.accountId, options.draftId));
}

export async function discardDraft(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly draftId: string;
}): Promise<void> {
  const { firestore, accountId, draftId } = options;
  await loadOwnedDraft(firestore, accountId, draftId);
  await firestore.collection(COLLECTIONS.characterDrafts).doc(draftId).delete();
}

/**
 * Commits a complete draft into an account-owned character.
 *
 * The server revalidates from the stored choices rather than trusting that
 * the client only offered Create when the wizard looked finished.
 */
export async function commitDraft(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly draftId: string;
}): Promise<CharacterProjection> {
  const { firestore, accountId, draftId } = options;
  const stored = await loadOwnedDraft(firestore, accountId, draftId);
  const choices = normalizeChoices(stored.choices);

  if (validateChoices(choices).length > 0) {
    throw new CharacterIncompleteError();
  }

  const now = new Date();
  const character: StoredCharacter = {
    characterId: randomUUID(),
    ownerAccountId: accountId,
    rulesVersion: RULES_VERSION,
    choices,
    createdAt: now,
    revisions: [{ at: now.toISOString(), reason: 'Character created' }],
  };

  await firestore.runTransaction(async (transaction) => {
    transaction.set(firestore.collection(COLLECTIONS.characters).doc(character.characterId), character);
    transaction.delete(firestore.collection(COLLECTIONS.characterDrafts).doc(draftId));
  });

  return projectCharacter(character);
}

export async function readCharacter(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly characterId: string;
}): Promise<CharacterProjection> {
  const { firestore, accountId, characterId } = options;
  const stored = await loadOwnedCharacter(firestore, accountId, characterId);
  const progressionSnap = await firestore
    .collection(COLLECTIONS.characterProgressions)
    .doc(characterId)
    .get();
  const progression = progressionSnap.exists
    ? (progressionSnap.data() as StoredProgression)
    : null;
  return projectCharacter(stored, progression);
}

/** The account's Character Vault: committed characters plus any open draft. */
export async function readVault(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
}): Promise<CharacterVaultProjection> {
  const { firestore, accountId } = options;

  const [charactersSnapshot, draftsSnapshot] = await Promise.all([
    firestore
      .collection(COLLECTIONS.characters)
      .where('ownerAccountId', '==', accountId)
      .orderBy('createdAt', 'desc')
      .get(),
    firestore
      .collection(COLLECTIONS.characterDrafts)
      .where('ownerAccountId', '==', accountId)
      .orderBy('updatedAt', 'desc')
      .get(),
  ]);

  /** Soft enrichment for PQA-210 — only the single active seat (most recently renewed). */
  const seatsByCharacterId = new Map<string, string[]>();
  try {
    const seatSnapshots = await firestore
      .collection(COLLECTIONS.campaignSeats)
      .where('ownerAccountId', '==', accountId)
      .limit(40)
      .get();
    type SeatRow = {
      readonly characterId: string;
      readonly campaignId: string;
      readonly renewedAtMs: number;
    };
    const rows: SeatRow[] = [];
    for (const seatDoc of seatSnapshots.docs) {
      const seat = seatDoc.data() as {
        characterId?: string;
        campaignId?: string;
        renewedAt?: Date | { toDate: () => Date };
      };
      if (seat.characterId === undefined || seat.campaignId === undefined) {
        continue;
      }
      const renewed =
        seat.renewedAt instanceof Date
          ? seat.renewedAt.getTime()
          : typeof seat.renewedAt?.toDate === 'function'
            ? seat.renewedAt.toDate().getTime()
            : 0;
      rows.push({
        characterId: seat.characterId,
        campaignId: seat.campaignId,
        renewedAtMs: renewed,
      });
    }
    rows.sort((left, right) => right.renewedAtMs - left.renewedAtMs);
    const active = rows[0];
    if (active !== undefined) {
      const campaignSnap = await firestore.collection(COLLECTIONS.campaigns).doc(active.campaignId).get();
      const campaignName = campaignSnap.exists
        ? ((campaignSnap.data() as { name?: string }).name ?? null)
        : null;
      if (campaignName !== null && campaignName.length > 0) {
        seatsByCharacterId.set(active.characterId, [campaignName]);
      }
    }
  } catch {
    // Leave seatsByCharacterId empty; vault characters still load.
  }

  const characters = (
    await Promise.all(
      charactersSnapshot.docs.map(async (doc) => {
        try {
          const stored = doc.data() as StoredCharacter;
          const choices = normalizeChoices(stored.choices);
          const labels = describeChoices(choices);
          const progressionSnap = await firestore
            .collection(COLLECTIONS.characterProgressions)
            .doc(stored.characterId)
            .get();
          const progression = progressionSnap.exists
            ? (progressionSnap.data() as StoredProgression)
            : null;
          return {
            characterId: stored.characterId,
            name: choices.identity.name,
            classLabel: labels.classLabel,
            speciesLabel: labels.speciesLabel,
            backgroundLabel: labels.backgroundLabel,
            level: progression?.level ?? 1,
            createdAt: toIso(stored.createdAt),
            seatedCampaignNames: seatsByCharacterId.get(stored.characterId) ?? [],
          };
        } catch (failure) {
          const detail = failure instanceof Error ? failure.message : String(failure);
          process.stderr.write(
            `[characters] vault character ${doc.id} skipped during projection: ${detail}\n`,
          );
          return null;
        }
      }),
    )
  ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const drafts = draftsSnapshot.docs.flatMap((doc) => {
    try {
      const stored = doc.data() as StoredDraft;
      const choices = normalizeChoices(stored.choices);
      const problems = validateChoices(choices);
      const labels = describeChoices(choices);
      return [
        {
          draftId: stored.draftId,
          classLabel: labels.classLabel,
          speciesLabel: labels.speciesLabel,
          backgroundLabel: labels.backgroundLabel,
          name: choices.identity.name.trim(),
          concept: choices.identity.concept.trim(),
          updatedAt: toIso(stored.updatedAt),
          canCreate: problems.length === 0,
          unresolvedCount: problems.length,
        },
      ];
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : String(failure);
      process.stderr.write(`[characters] vault draft ${doc.id} skipped during projection: ${detail}\n`);
      return [];
    }
  });

  return { accountId, characters, drafts };
}

async function loadOwnedCharacter(
  firestore: Firestore,
  accountId: string,
  characterId: string,
): Promise<StoredCharacter> {
  const snapshot = await firestore.collection(COLLECTIONS.characters).doc(characterId).get();
  if (!snapshot.exists) {
    throw new CharacterNotFoundError();
  }
  const stored = snapshot.data() as StoredCharacter;
  if (stored.ownerAccountId !== accountId) {
    throw new CharacterNotFoundError();
  }
  return stored;
}

export async function deleteCharacter(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly characterId: string;
}): Promise<void> {
  const { firestore, accountId, characterId } = options;
  await loadOwnedCharacter(firestore, accountId, characterId);
  await firestore.runTransaction(async (transaction) => {
    transaction.delete(firestore.collection(COLLECTIONS.characters).doc(characterId));
    transaction.delete(firestore.collection(COLLECTIONS.characterProgressions).doc(characterId));
  });
}

export async function updateCharacterIdentity(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly characterId: string;
  readonly identity: CharacterChoices['identity'];
}): Promise<CharacterProjection> {
  const { firestore, accountId, characterId, identity } = options;
  const stored = await loadOwnedCharacter(firestore, accountId, characterId);
  const choices = normalizeChoices({
    ...stored.choices,
    identity,
  });
  const updated: StoredCharacter = {
    ...stored,
    choices,
    revisions: [
      ...stored.revisions,
      { at: new Date().toISOString(), reason: 'Identity updated' },
    ],
  };
  await firestore.collection(COLLECTIONS.characters).doc(characterId).set(updated);
  const progressionSnap = await firestore
    .collection(COLLECTIONS.characterProgressions)
    .doc(characterId)
    .get();
  const progression = progressionSnap.exists
    ? (progressionSnap.data() as StoredProgression)
    : null;
  return projectCharacter(updated, progression);
}
