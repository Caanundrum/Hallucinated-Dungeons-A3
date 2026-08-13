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
  type CharacterChoices,
  type CharacterProjection,
  type CharacterVaultProjection,
  type DraftProjection,
} from '../../shared/character-contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import { findQuickStartTemplate } from '../rules/srd-manifest.js';
import {
  RULES_VERSION,
  completedSteps,
  deriveSheet,
  describeChoices,
  emptyChoices,
  validateChoices,
} from '../rules/character-rules.js';

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

function toIso(value: Timestamp | Date): string {
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

function projectDraft(stored: StoredDraft): DraftProjection {
  const problems = validateChoices(stored.choices);
  return {
    draftId: stored.draftId,
    rulesVersion: stored.rulesVersion,
    updatedAt: toIso(stored.updatedAt),
    choices: stored.choices,
    sheet: deriveSheet(stored.choices),
    unresolved: problems,
    completedSteps: completedSteps(stored.choices),
    canCreate: problems.length === 0,
  };
}

function projectCharacter(stored: StoredCharacter): CharacterProjection {
  const sheet = deriveSheet(stored.choices);
  if (sheet === null) {
    // A committed character always has Class, Background, and Species, since
    // commitment requires a clean validation. Reaching here means the stored
    // record is impossible under the current rules version (Section 6.5's
    // quarantine case) and must not be presented as a playable sheet.
    throw new Error(`Stored character ${stored.characterId} cannot be derived under ${RULES_VERSION}`);
  }
  const labels = describeChoices(stored.choices);
  return {
    characterId: stored.characterId,
    rulesVersion: stored.rulesVersion,
    createdAt: toIso(stored.createdAt),
    identity: stored.choices.identity,
    classLabel: labels.classLabel,
    speciesLabel: labels.speciesLabel,
    backgroundLabel: labels.backgroundLabel,
    level: sheet.level,
    choices: stored.choices,
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
    spellIds: template.spellIds,
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

  if (validateChoices(stored.choices).length > 0) {
    throw new CharacterIncompleteError();
  }

  const now = new Date();
  const character: StoredCharacter = {
    characterId: randomUUID(),
    ownerAccountId: accountId,
    rulesVersion: RULES_VERSION,
    choices: stored.choices,
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
  const snapshot = await firestore.collection(COLLECTIONS.characters).doc(characterId).get();
  if (!snapshot.exists) {
    throw new CharacterNotFoundError();
  }
  const stored = snapshot.data() as StoredCharacter;
  if (stored.ownerAccountId !== accountId) {
    throw new CharacterNotFoundError();
  }
  return projectCharacter(stored);
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

  const characters = charactersSnapshot.docs.map((doc) => {
    const stored = doc.data() as StoredCharacter;
    const labels = describeChoices(stored.choices);
    return {
      characterId: stored.characterId,
      name: stored.choices.identity.name,
      classLabel: labels.classLabel,
      speciesLabel: labels.speciesLabel,
      backgroundLabel: labels.backgroundLabel,
      level: 1,
      createdAt: toIso(stored.createdAt),
    };
  });

  const drafts = draftsSnapshot.docs.map((doc) => {
    const stored = doc.data() as StoredDraft;
    const problems = validateChoices(stored.choices);
    return {
      draftId: stored.draftId,
      classLabel: describeChoices(stored.choices).classLabel,
      updatedAt: toIso(stored.updatedAt),
      canCreate: problems.length === 0,
      unresolvedCount: problems.length,
    };
  });

  return { accountId, characters, drafts };
}
