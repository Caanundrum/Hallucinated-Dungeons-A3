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
  type CrossCampaignHistoryEntry,
  type DraftProjection,
} from '../../shared/character-contract.js';
import {
  type GeneratePortraitResponse,
  PORTRAIT_DWARF_FIGHTER,
  PORTRAIT_ELF_ROGUE,
  archetypePortraitUrl,
  isTrustedAvatarUrl,
  validateAppearancePrompt,
} from '../../shared/portrait-contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import {
  buildPortraitAssetBankKey,
  checkAndRecordAccountImageQuota,
  loadAccountPortraitHistory,
  loadCampaignAsset,
  loadFromAssetBank,
  saveAccountPortraitHistory,
  saveToAssetBank,
  storeCampaignAssetRecord,
} from '../assets/campaign-assets.js';
import { resolvePortraitChoices, type PortraitEnvironment } from './portrait.js';
import { findQuickStartTemplate } from '../rules/srd-manifest.js';
import {
  RULES_VERSION,
  buildDraftOptions,
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
  applyProgressionTrackers,
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
  readonly avatarUrl?: string | null;
  readonly avatarOptions?: readonly string[];
  readonly portraitForged?: boolean;
  readonly appearancePrompt?: string | null;
}

interface StoredCharacter {
  readonly characterId: string;
  readonly ownerAccountId: string;
  readonly rulesVersion: string;
  readonly choices: CharacterChoices;
  readonly createdAt: Timestamp | Date;
  readonly revisions: readonly { readonly at: string; readonly reason: string }[];
  readonly crossCampaignHistory?: readonly CrossCampaignHistoryEntry[];
  readonly avatarUrl?: string | null;
  readonly avatarOptions?: readonly string[];
  readonly appearancePrompt?: string | null;
  readonly milestonePortraitCredits?: number;
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
    avatarUrl: stored.avatarUrl ?? null,
    ...(stored.avatarOptions !== undefined ? { avatarOptions: stored.avatarOptions } : {}),
    ...(stored.portraitForged !== undefined ? { portraitForged: stored.portraitForged } : {}),
    appearancePrompt: stored.appearancePrompt ?? null,
  };
}

function projectCharacter(
  stored: StoredCharacter,
  progression: StoredProgression | null = null,
  status: { readonly seatedInCombat?: boolean; readonly canChangePreparedSpells?: boolean } = {},
): CharacterProjection {
  const choices = normalizeChoices(stored.choices);
  const overrideUnequipped =
    progression?.equipmentOverrides !== undefined
      ? progression.equipmentOverrides
          .filter((item) => item.equipped === false)
          .map((item) => item.name)
      : undefined;
  const choicesForSheet =
    overrideUnequipped !== undefined
      ? { ...choices, unequippedItemNames: overrideUnequipped }
       : choices;
  const baseSheet = deriveSheet(choicesForSheet);
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
  const withTrackers = applyProgressionTrackers(sheet, progression);
  const editOptions = buildDraftOptions(choices);
  const prepStyle = editOptions.classDetail?.spellcasting?.preparationStyle ?? null;
  const hasRestOrLevelUpEligibility =
    prepStyle === 'prepared'
      ? !(status.seatedInCombat === true)
      : prepStyle === 'known'
        ? (stored.milestonePortraitCredits ?? 0) > 0 ||
          (stored.revisions ?? []).some((r) => /level/i.test(r.reason))
        : false;
  return {
    characterId: stored.characterId,
    rulesVersion: stored.rulesVersion,
    createdAt: toIso(stored.createdAt),
    identity: choices.identity,
    classLabel: labels.classLabel,
    speciesLabel: labels.speciesLabel,
    backgroundLabel: labels.backgroundLabel,
    level: withTrackers.level,
    choices,
    sheet: withTrackers,
    editOptions,
    revisions: stored.revisions.map((revision) => ({
      at: revision.at,
      reason: revision.reason,
    })),
    crossCampaignHistory: (stored.crossCampaignHistory ?? []).map((entry) => ({
      at: entry.at,
      ...(entry.campaignId !== undefined ? { campaignId: entry.campaignId } : {}),
      ...(entry.campaignName !== undefined ? { campaignName: entry.campaignName } : {}),
      summary: entry.summary,
    })),
    avatarUrl: stored.avatarUrl ?? null,
    ...(stored.avatarOptions !== undefined ? { avatarOptions: stored.avatarOptions } : {}),
    appearancePrompt: stored.appearancePrompt ?? null,
    milestonePortraitCredits: stored.milestonePortraitCredits ?? 0,
    seatedInCombat: status.seatedInCombat === true,
    canChangePreparedSpells: status.canChangePreparedSpells ?? hasRestOrLevelUpEligibility,
  };
}

/**
 * Appends a persistent cross-campaign history milestone to a character record so
 * their history across campaigns is preserved even when they leave or switch tables.
 */
export async function appendCrossCampaignCharacterHistory(options: {
  readonly firestore: Firestore;
  readonly characterId: string;
  readonly campaignId?: string | null;
  readonly campaignName?: string | null;
  readonly summary: string;
}): Promise<void> {
  const { firestore, characterId, campaignId, campaignName, summary } = options;
  const trimmed = summary.trim();
  if (trimmed.length === 0) {
    return;
  }
  const ref = firestore.collection(COLLECTIONS.characters).doc(characterId);
  const snap = await ref.get();
  if (!snap.exists) {
    return;
  }
  const stored = snap.data() as StoredCharacter;
  const entry: CrossCampaignHistoryEntry = {
    at: new Date().toISOString(),
    ...(campaignId !== undefined ? { campaignId } : {}),
    ...(campaignName !== undefined ? { campaignName } : {}),
    summary: trimmed,
  };
  const nextHistory = [...(stored.crossCampaignHistory ?? []), entry].slice(-40);
  await ref.set({ ...stored, crossCampaignHistory: nextHistory });
}

async function loadCrossCampaignCharacterHistory(
  firestore: Firestore,
  characterId: string,
  stored: StoredCharacter,
): Promise<string> {
  const parts: string[] = [];
  const concept = stored.choices.identity?.concept?.trim() ?? '';
  if (concept.length > 0) {
    parts.push(concept);
  }
  for (const entry of (stored.crossCampaignHistory ?? []).slice(-8)) {
    const prefix =
      typeof entry.campaignName === 'string' && entry.campaignName.trim().length > 0
        ? `[${entry.campaignName.trim()}] `
        : '';
    parts.push(`${prefix}${entry.summary}`);
  }
  try {
    const seatSnap = await firestore
      .collection(COLLECTIONS.campaignSeats)
      .where('characterId', '==', characterId)
      .get();
    for (const doc of seatSnap.docs) {
      const seatData = doc.data() as { campaignId?: string };
      if (typeof seatData.campaignId !== 'string' || seatData.campaignId.length === 0) {
        continue;
      }
      const [campaignSnap, memorySnap] = await Promise.all([
        firestore.collection(COLLECTIONS.campaigns).doc(seatData.campaignId).get(),
        firestore.collection(COLLECTIONS.campaignMemory).doc(seatData.campaignId).get(),
      ]);
      const campaignName =
        campaignSnap.exists && typeof (campaignSnap.data() as { name?: unknown })?.name === 'string'
          ? ((campaignSnap.data() as { name: string }).name ?? '').trim()
          : '';
      const chapters =
        memorySnap.exists &&
        Array.isArray((memorySnap.data() as { chapters?: unknown })?.chapters)
          ? ((memorySnap.data() as { chapters: readonly { summary?: string }[] }).chapters ?? [])
          : [];
      const chapterSummaries = chapters
        .map((ch) => (typeof ch.summary === 'string' ? ch.summary.trim() : ''))
        .filter((s) => s.length > 0)
        .slice(-2);
      if (chapterSummaries.length > 0) {
        parts.push(
          campaignName.length > 0
            ? `[${campaignName}] ${chapterSummaries.join('; ')}`
            : chapterSummaries.join('; '),
        );
      } else if (campaignName.length > 0) {
        parts.push(`Active in campaign: ${campaignName}`);
      }
    }
  } catch {
    // Non-fatal if seat/memory lookup fails.
  }
  const revisionNotes = (stored.revisions ?? [])
    .map((rev) => rev.reason)
    .filter((reason) => !/^Portrait updated/i.test(reason))
    .slice(-5);
  parts.push(...revisionNotes);
  return Array.from(new Set(parts.filter((part) => part.trim().length > 0))).join(' | ');
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
    expertiseSkillIds: template.expertiseSkillIds ?? [],
    weaponMasteryWeaponNames: template.weaponMasteryWeaponNames ?? [],
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
    avatarUrl: stored.avatarUrl ?? null,
    ...(stored.avatarUrl ? { avatarOptions: [stored.avatarUrl] } : {}),
    appearancePrompt: stored.appearancePrompt ?? null,
    milestonePortraitCredits: 0,
  };

  await firestore.runTransaction(async (transaction) => {
    transaction.set(firestore.collection(COLLECTIONS.characters).doc(character.characterId), character);
    transaction.delete(firestore.collection(COLLECTIONS.characterDrafts).doc(draftId));
  });

  return projectCharacter(character);
}

async function isCharacterSeatedInActiveCombat(
  firestore: Firestore,
  characterId: string,
): Promise<boolean> {
  try {
    const seatsSnap = await firestore
      .collection(COLLECTIONS.campaignSeats)
      .where('characterId', '==', characterId)
      .get();
    for (const doc of seatsSnap.docs) {
      const seat = doc.data() as { campaignId?: string };
      if (typeof seat.campaignId !== 'string' || seat.campaignId.length === 0) {
        continue;
      }
      const encSnap = await firestore
        .collection(COLLECTIONS.campaignEncounters)
        .doc(seat.campaignId)
        .get();
      if (encSnap.exists) {
        const enc = encSnap.data() as { status?: string };
        if (enc.status === 'active') {
          return true;
        }
      }
    }
  } catch {
    // Non-fatal in mock/unit environments without query indexes.
  }
  return false;
}

export async function readCharacter(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly characterId: string;
}): Promise<CharacterProjection> {
  const { firestore, accountId, characterId } = options;
  const stored = await loadOwnedCharacter(firestore, accountId, characterId);
  const [progressionSnap, seatedInCombat] = await Promise.all([
    firestore.collection(COLLECTIONS.characterProgressions).doc(characterId).get(),
    isCharacterSeatedInActiveCombat(firestore, characterId),
  ]);
  const progression = progressionSnap.exists
    ? (progressionSnap.data() as StoredProgression)
    : null;
  return projectCharacter(stored, progression, { seatedInCombat });
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

  /** Soft enrichment for PQA-210 / FQA-035 — only the single active seat (most recently renewed). */
  const seatsByCharacterId = new Map<string, { names: string[]; campaignId: string }>();
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
        seatsByCharacterId.set(active.characterId, {
          names: [campaignName],
          campaignId: active.campaignId,
        });
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
          const seatInfo = seatsByCharacterId.get(stored.characterId);
          const baseSheet = deriveSheet(choices);
          const level = progression?.level ?? baseSheet?.level ?? 1;
          const experiencePoints = progression?.experiencePoints ?? baseSheet?.experiencePoints ?? 0;
          const classId = progression?.classId ?? choices.classId;
          const leveled =
            baseSheet !== null && classId !== null
              ? recomputeSheetForLevel(baseSheet, classId, level, experiencePoints)
              : baseSheet;
          const sheet = leveled !== null ? applyProgressionTrackers(leveled, progression) : null;
          const slotLine =
            sheet?.spellcasting !== undefined &&
            sheet.spellcasting !== null &&
            sheet.spellcasting.level1SlotCount > 0
              ? ` · L1 slots ${sheet.spellcasting.level1SlotsRemaining}/${sheet.spellcasting.level1SlotCount}`
              : '';
          const resourceLine =
            sheet?.classResources !== undefined &&
            sheet.classResources.length > 0
              ? ` · ${sheet.classResources
                  .slice(0, 2)
                  .map((resource) => `${resource.label} ${resource.remaining}/${resource.maximum}`)
                  .join(', ')}`
              : '';
          return {
            characterId: stored.characterId,
            name: choices.identity.name,
            classLabel: labels.classLabel,
            speciesLabel: labels.speciesLabel,
            backgroundLabel: labels.backgroundLabel,
            level,
            createdAt: toIso(stored.createdAt),
            seatedCampaignNames: seatInfo?.names ?? [],
            seatedCampaignId: seatInfo?.campaignId ?? null,
            avatarUrl: stored.avatarUrl ?? null,
            appearancePrompt: stored.appearancePrompt ?? null,
            milestonePortraitCredits: stored.milestonePortraitCredits ?? 0,
            ...(sheet !== null
              ? {
                  hitPointsCurrent: sheet.hitPointsCurrent,
                  hitPointsMax: sheet.hitPoints.value,
                  resourceSummary: `HP ${sheet.hitPointsCurrent}/${sheet.hitPoints.value}${slotLine}${resourceLine}`,
                }
              : {}),
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
      const isUntouchedBlank =
        choices.classId === null &&
        choices.backgroundId === null &&
        choices.speciesId === null &&
        Object.keys(choices.baseAbilityScores).length === 0 &&
        choices.identity.name.trim().length === 0 &&
        choices.identity.concept.trim().length === 0;
      if (isUntouchedBlank) {
        return [];
      }
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
  const danglingSeats = await firestore
    .collection(COLLECTIONS.campaignSeats)
    .where('characterId', '==', characterId)
    .get();
  await firestore.runTransaction(async (transaction) => {
    transaction.delete(firestore.collection(COLLECTIONS.characters).doc(characterId));
    transaction.delete(firestore.collection(COLLECTIONS.characterProgressions).doc(characterId));
    for (const seatDoc of danglingSeats.docs) {
      transaction.delete(seatDoc.ref);
    }
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

/** PQA-207/211: update prepared spells, starting kits, and mastery picks. */
export async function updateCharacterLoadout(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly characterId: string;
  readonly spellIds?: readonly string[];
  readonly classEquipmentOptionId?: string | null;
  readonly backgroundEquipmentOptionId?: string | null;
  readonly weaponMasteryWeaponNames?: readonly string[];
  readonly chosenOriginFeatId?: string | null;
}): Promise<CharacterProjection> {
  const { firestore, accountId, characterId } = options;
  const stored = await loadOwnedCharacter(firestore, accountId, characterId);
  const nextChoices = normalizeChoices({
    ...stored.choices,
    ...(options.spellIds !== undefined ? { spellIds: [...options.spellIds] } : {}),
    ...(options.classEquipmentOptionId !== undefined
      ? { classEquipmentOptionId: options.classEquipmentOptionId }
      : {}),
    ...(options.backgroundEquipmentOptionId !== undefined
      ? { backgroundEquipmentOptionId: options.backgroundEquipmentOptionId }
      : {}),
    ...(options.weaponMasteryWeaponNames !== undefined
      ? { weaponMasteryWeaponNames: [...options.weaponMasteryWeaponNames] }
      : {}),
    ...(options.chosenOriginFeatId !== undefined
      ? { chosenOriginFeatId: options.chosenOriginFeatId }
      : {}),
  });
  const problems = validateChoices(nextChoices);
  if (problems.length > 0) {
    throw new CharacterIncompleteError();
  }
  const updated: StoredCharacter = {
    ...stored,
    choices: nextChoices,
    revisions: [
      ...stored.revisions,
      { at: new Date().toISOString(), reason: 'Loadout updated' },
    ],
  };
  await firestore.collection(COLLECTIONS.characters).doc(characterId).set(updated);
  return readCharacter({ firestore, accountId, characterId });
}

/** PQA-213/214/215/216: persist HP, resources, slots, and inventory overrides. */
export async function updateCharacterTrackers(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly characterId: string;
  readonly hitPointsCurrent?: number;
  readonly temporaryHitPoints?: number;
  readonly resourceRemaining?: Readonly<Record<string, number>>;
  readonly level1SlotsRemaining?: number;
  readonly equipmentOverrides?: readonly {
    readonly name: string;
    readonly quantity: number;
    readonly equipped?: boolean;
  }[];
  /** Required player-facing unlock reason for correction-mode audits (FQA-R01). */
  readonly auditReason?: string;
}): Promise<CharacterProjection> {
  const { firestore, accountId, characterId } = options;
  const stored = await loadOwnedCharacter(firestore, accountId, characterId);
  const progressionRef = firestore.collection(COLLECTIONS.characterProgressions).doc(characterId);
  const progressionSnap = await progressionRef.get();
  const classId = stored.choices.classId;
  if (classId === null) {
    throw new CharacterIncompleteError();
  }
  const now = new Date().toISOString();
  const prior = progressionSnap.exists
    ? (progressionSnap.data() as StoredProgression)
    : {
        characterId,
        classId,
        experiencePoints: 0,
        level: 1,
        updatedAt: now,
      };
  const next: StoredProgression = {
    ...prior,
    updatedAt: now,
    ...(options.hitPointsCurrent !== undefined
      ? { hitPointsCurrent: options.hitPointsCurrent }
      : {}),
    ...(options.temporaryHitPoints !== undefined
      ? { temporaryHitPoints: options.temporaryHitPoints }
      : {}),
    ...(options.resourceRemaining !== undefined
      ? {
          resourceRemaining: {
            ...(prior.resourceRemaining ?? {}),
            ...options.resourceRemaining,
          },
        }
      : {}),
    ...(options.level1SlotsRemaining !== undefined
      ? { level1SlotsRemaining: options.level1SlotsRemaining }
      : {}),
    ...(options.equipmentOverrides !== undefined
      ? { equipmentOverrides: options.equipmentOverrides }
      : {}),
  };
  await progressionRef.set(next);
  const reasonParts: string[] = [];
  if (options.auditReason !== undefined && options.auditReason.trim().length > 0) {
    reasonParts.push(options.auditReason.trim());
  }
  if (options.hitPointsCurrent !== undefined) {
    reasonParts.push(`HP set to ${options.hitPointsCurrent}`);
  }
  if (options.temporaryHitPoints !== undefined) {
    reasonParts.push(`temp HP set to ${options.temporaryHitPoints}`);
  }
  if (options.level1SlotsRemaining !== undefined) {
    reasonParts.push(`level-1 slots set to ${options.level1SlotsRemaining}`);
  }
  if (options.resourceRemaining !== undefined) {
    reasonParts.push('class resources corrected');
  }
  if (options.equipmentOverrides !== undefined) {
    reasonParts.push('equipment ledger corrected');
  }
  const audited: StoredCharacter = {
    ...stored,
    revisions: [
      ...stored.revisions,
      {
        at: now,
        reason:
          reasonParts.length > 0
            ? `Correction: ${reasonParts.join('; ')}`
            : 'Correction: character ledger updated',
      },
    ],
  };
  await firestore.collection(COLLECTIONS.characters).doc(characterId).set(audited);
  return projectCharacter(audited, next);
}

/**
 * Level-up / milestone hook: grants one portrait update credit. Pure so the
 * rules transaction can write it alongside the progression document.
 */
export function withMilestonePortraitCredit<T extends { readonly milestonePortraitCredits?: number }>(
  stored: T,
): T & { readonly milestonePortraitCredits: number } {
  return { ...stored, milestonePortraitCredits: (stored.milestonePortraitCredits ?? 0) + 1 };
}

export class PortraitRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortraitRequestError';
  }
}

export class PortraitCreditRequiredError extends Error {
  constructor() {
    super('Reach a level-up milestone to earn another portrait update.');
    this.name = 'PortraitCreditRequiredError';
  }
}

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 120 ? value : null;
}

/**
 * Resolves a portrait (Imagen when a key is configured, curated archetype
 * otherwise) and, when a draft or character id is supplied, persists it on the
 * caller's own document. A character update spends one milestone credit.
 */
export async function generateCharacterPortrait(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly body: unknown;
  readonly env?: PortraitEnvironment;
  readonly fetchImpl?: typeof fetch;
}): Promise<GeneratePortraitResponse> {
  const { firestore, accountId } = options;
  const body =
    typeof options.body === 'object' && options.body !== null && !Array.isArray(options.body)
      ? (options.body as Record<string, unknown>)
      : null;
  if (body === null || typeof body.appearancePrompt !== 'string') {
    throw new PortraitRequestError('appearancePrompt is required.');
  }
  const validation = validateAppearancePrompt(body.appearancePrompt);
  if (!validation.ok) {
    throw new PortraitRequestError(validation.message);
  }
  const appearancePrompt = validation.text;
  let ancestryId = optionalId(body.ancestryId);
  let classId = optionalId(body.classId);
  let pronouns = typeof body.pronouns === 'string' && body.pronouns.length <= 120 ? body.pronouns : null;
  const selectedAvatarUrl =
    typeof body.selectedAvatarUrl === 'string' && body.selectedAvatarUrl.length > 0
      ? body.selectedAvatarUrl
      : null;
  const characterId = optionalId(body.characterId);
  const draftId = optionalId(body.draftId);

  const stored = characterId !== null ? await loadOwnedCharacter(firestore, accountId, characterId) : null;
  const draft = draftId !== null ? await loadOwnedDraft(firestore, accountId, draftId) : null;
  const choices = stored?.choices ?? draft?.choices ?? null;
  if (choices !== null) {
    ancestryId = ancestryId ?? choices.speciesId;
    classId = classId ?? choices.classId;
    pronouns = pronouns ?? (choices.identity?.pronouns ?? null);
  }

  // Selecting one of the 3 already-forged portraits confirms that choice as final and discards the other two.
  if (selectedAvatarUrl !== null) {
    if (!isTrustedAvatarUrl(selectedAvatarUrl)) {
      throw new PortraitRequestError('Selected portrait is not valid.');
    }
    if (draft !== null && draftId !== null) {
      const allowed = draft.avatarOptions ?? (draft.avatarUrl ? [draft.avatarUrl] : []);
      if (allowed.length > 0 && !allowed.includes(selectedAvatarUrl)) {
        throw new PortraitRequestError('Choose one of your forged portrait options.');
      }
      const preservedOptions = allowed.length > 0 ? allowed : [selectedAvatarUrl];
      const updatedDraft: StoredDraft = {
        ...draft,
        avatarUrl: selectedAvatarUrl,
        avatarOptions: preservedOptions,
        updatedAt: new Date(),
      };
      await firestore.collection(COLLECTIONS.characterDrafts).doc(draftId).set(updatedDraft);
      return {
        avatarUrl: selectedAvatarUrl,
        avatarOptions: preservedOptions,
        portraitForged: true,
        appearancePrompt: draft.appearancePrompt ?? appearancePrompt,
        source: 'generated',
      };
    }
    if (stored !== null && characterId !== null) {
      const allowed = stored.avatarOptions ?? (stored.avatarUrl ? [stored.avatarUrl] : []);
      if (allowed.length > 0 && !allowed.includes(selectedAvatarUrl)) {
        throw new PortraitRequestError('Choose one of your forged portrait options.');
      }
      const updatedCharacter: StoredCharacter = {
        ...stored,
        avatarUrl: selectedAvatarUrl,
        avatarOptions: [selectedAvatarUrl],
      };
      await firestore.collection(COLLECTIONS.characters).doc(characterId).set(updatedCharacter);
      return {
        avatarUrl: selectedAvatarUrl,
        avatarOptions: [selectedAvatarUrl],
        portraitForged: true,
        appearancePrompt: stored.appearancePrompt ?? appearancePrompt,
        source: 'generated',
        milestonePortraitCredits: stored.milestonePortraitCredits ?? 0,
      };
    }
  }

  // During character creation, once 3 portraits are forged, return those 3 options rather than re-forging endlessly.
  if (
    draft !== null &&
    draft.portraitForged === true &&
    draft.avatarOptions !== undefined &&
    draft.avatarOptions.length > 0
  ) {
    return {
      avatarUrl: draft.avatarUrl ?? draft.avatarOptions[0]!,
      avatarOptions: draft.avatarOptions,
      portraitForged: true,
      appearancePrompt: draft.appearancePrompt ?? appearancePrompt,
      source: 'generated',
    };
  }

  if (stored !== null && (stored.milestonePortraitCredits ?? 0) < 1) {
    throw new PortraitCreditRequiredError();
  }

  // On level-up, pass the character's cross-campaign history and existing core portrait so variations alter the existing look.
  let characterHistory: string | null = null;
  let baseImage: { readonly mimeType: string; readonly base64Data: string } | null = null;
  if (stored !== null && characterId !== null) {
    characterHistory = await loadCrossCampaignCharacterHistory(firestore, characterId, stored);
    if (typeof stored.avatarUrl === 'string') {
      const inlineMatch = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
        stored.avatarUrl,
      );
      if (inlineMatch !== null) {
        baseImage = { mimeType: inlineMatch[1]!, base64Data: inlineMatch[2]! };
      } else {
        const assetMatch = /^\/api\/campaign-assets\/([a-zA-Z0-9_-]{1,120})$/.exec(
          stored.avatarUrl,
        );
        if (assetMatch !== null) {
          const asset = await loadCampaignAsset(firestore, assetMatch[1]!);
          if (asset !== null) {
            baseImage = { mimeType: asset.mimeType, base64Data: asset.base64Data };
          }
        }
      }
    }
  }

  const portraitBankKey = buildPortraitAssetBankKey({
    ancestryId,
    classId,
    pronouns,
  });
  const quota = await checkAndRecordAccountImageQuota({
    firestore,
    accountId,
    kind: 'portrait',
  });

  let resolvedOptions: readonly string[];
  let resolvedAvatarUrl: string;
  let portraitSource: 'generated' | 'archetype';

  if (!quota.allowed) {
    // Silent $0.00 cache fallback on daily cap or 15s cooldown (Guardrail 4 / Packet 5).
    const historyUrls = await loadAccountPortraitHistory({
      firestore,
      accountId,
      ancestryId,
      classId,
      pronouns,
    });
    const bankUrls =
      historyUrls.length >= 3 ? [] : await loadFromAssetBank(firestore, portraitBankKey);
    const primaryCurated = archetypePortraitUrl({
      ancestryId,
      classId,
      name: choices?.identity?.name ?? null,
    });
    const curatedUrls = [
      primaryCurated,
      primaryCurated === PORTRAIT_ELF_ROGUE ? PORTRAIT_DWARF_FIGHTER : PORTRAIT_ELF_ROGUE,
    ];
    const combined = [...new Set([...historyUrls, ...bankUrls, ...curatedUrls])].filter((u) =>
      isTrustedAvatarUrl(u),
    );
    resolvedOptions = combined.slice(0, 3);
    resolvedAvatarUrl = resolvedOptions[0] ?? primaryCurated;
    portraitSource = 'archetype';
  } else {
    const portrait = await resolvePortraitChoices({
      appearancePrompt,
      ancestryId,
      classId,
      pronouns,
      characterName: choices?.identity?.name ?? null,
      characterHistory,
      preserveCorePortrait: stored !== null && Boolean(stored.avatarUrl),
      baseImage,
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    });

    const persistSingleUrl = async (rawUrl: string): Promise<string> => {
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(rawUrl);
      if (match !== null && rawUrl.length > 1000) {
        try {
          return await storeCampaignAssetRecord({
            firestore,
            campaignId: characterId ?? draftId ?? 'character-portrait',
            kind: 'npc_portrait',
            mimeType: match[1]!,
            base64Data: match[2]!,
            prompt: appearancePrompt,
          });
        } catch {
          return rawUrl;
        }
      }
      return rawUrl;
    };

    resolvedOptions = await Promise.all(portrait.avatarOptions.map(persistSingleUrl));
    resolvedAvatarUrl = resolvedOptions[0] ?? portrait.avatarUrl;
    portraitSource = portrait.source;

    if (resolvedOptions.length > 0 && portraitSource === 'generated') {
      await Promise.all([
        saveAccountPortraitHistory({
          firestore,
          accountId,
          avatarOptions: resolvedOptions,
          ancestryId,
          classId,
          pronouns,
        }),
        saveToAssetBank({
          firestore,
          bankKey: portraitBankKey,
          urls: resolvedOptions,
        }),
      ]);
    }
  }

  if (!isTrustedAvatarUrl(resolvedAvatarUrl)) {
    throw new PortraitRequestError('Portrait could not be produced.');
  }

  let milestonePortraitCredits: number | undefined;
  if (stored !== null && characterId !== null) {
    milestonePortraitCredits = Math.max(0, (stored.milestonePortraitCredits ?? 0) - 1);
    const updated: StoredCharacter = {
      ...stored,
      avatarUrl: resolvedAvatarUrl,
      avatarOptions: [...resolvedOptions],
      appearancePrompt,
      milestonePortraitCredits,
      revisions: [
        ...stored.revisions,
        { at: new Date().toISOString(), reason: 'Portrait updated (milestone credit spent)' },
      ],
    };
    await firestore.collection(COLLECTIONS.characters).doc(characterId).set(updated);
  }
  if (draft !== null && draftId !== null) {
    const updatedDraft: StoredDraft = {
      ...draft,
      avatarUrl: resolvedAvatarUrl,
      avatarOptions: [...resolvedOptions],
      portraitForged: true,
      appearancePrompt,
      updatedAt: new Date(),
    };
    await firestore.collection(COLLECTIONS.characterDrafts).doc(draftId).set(updatedDraft);
  }

  return {
    avatarUrl: resolvedAvatarUrl,
    avatarOptions: [...resolvedOptions],
    portraitForged: true,
    appearancePrompt,
    source: portraitSource,
    ...(milestonePortraitCredits !== undefined ? { milestonePortraitCredits } : {}),
  };
}
