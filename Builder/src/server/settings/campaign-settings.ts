/**
 * Campaign settings and Session Zero persistence.
 *
 * Blueprint ownership: Sections 1.5.21, 4.4, 13.18, Phase 1 settings slice.
 * Owner writes; members read. Director identity/personality remain locked
 * elsewhere and are never accepted here.
 */

import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import {
  ACCESSIBILITY_NOTES_MAX_LENGTH,
  CAMPAIGN_SETTINGS_CONFIGURATION_NOTICE,
  CONTENT_PROFILE_LABELS,
  CONTENT_PROFILE_SUMMARIES,
  CONTENT_PROFILES,
  ENEMY_HEALTH_PRESENTATION_LABELS,
  EXPECTED_SESSION_LENGTH_MAX_LENGTH,
  EXTERNAL_VOICE_NOTE_MAX_LENGTH,
  GROUP_DECISION_POLICY_LABELS,
  REACTION_WINDOW_SECONDS_DEFAULT,
  REACTION_WINDOW_SECONDS_MAX,
  REACTION_WINDOW_SECONDS_MIN,
  RULES_TRANSPARENCY_LABELS,
  SAFETY_BOUNDARIES_MAX_LENGTH,
  defaultCampaignSettingsFields,
  isCharacterConflictPolicy,
  isContentProfile,
  isContentSourceFlag,
  isDropInOutPolicy,
  isEnemyHealthPresentation,
  isGroupDecisionPolicy,
  isLethalityPreference,
  isRomancePolicy,
  isSessionTone,
  type CampaignSettingsProjection,
  type ContentProfile,
  type ContentSourceFlag,
  type CharacterConflictPolicy,
  type DropInOutPolicy,
  type EnemyHealthPresentation,
  type GroupDecisionPolicy,
  type LethalityPreference,
  type RomancePolicy,
  type SessionTone,
  type SessionZeroProjection,
} from '../../shared/settings-contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import {
  CampaignNotFoundError,
  CampaignValidationError,
} from '../campaigns/errors.js';
import { appendChronicleEntry } from '../communication/chronicle.js';

interface StoredMembership {
  readonly membershipId: string;
  readonly campaignId: string;
  readonly accountId: string;
  readonly displayLabel: string;
  readonly role: 'owner' | 'player';
}

async function requireCampaignMembership(
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
    throw new CampaignNotFoundError();
  }
  return snapshot.docs[0]!.data() as StoredMembership;
}

interface StoredSessionZero {
  readonly completed: boolean;
  readonly completedAt: Timestamp | Date | null;
  readonly tone: SessionTone;
  readonly pvpPolicy: 'consent_required';
  readonly characterConflictPolicy: CharacterConflictPolicy;
  readonly romancePolicy: RomancePolicy;
  readonly lethalityPreference: LethalityPreference;
  readonly directorDiscretionLevel: 'moderate_bounded';
  readonly expectedSessionLength: string;
  readonly dropInOutPolicy: DropInOutPolicy;
  readonly textChatExpectations: string;
  readonly externalVoiceNote: string;
  readonly accessibilityNeeds: string;
  readonly contentSource: ContentSourceFlag;
}

export interface StoredCampaignSettings {
  readonly campaignId: string;
  readonly contentProfile: ContentProfile;
  readonly safetyBoundaries: string;
  readonly groupDecisionPolicy: GroupDecisionPolicy;
  readonly designatedCallerAccountId: string | null;
  readonly reactionWindowSeconds: number;
  readonly rulesTransparency: 'standard';
  readonly enemyHealthPresentation: EnemyHealthPresentation;
  readonly sessionZero: StoredSessionZero;
  readonly createdAt: Timestamp | Date;
  readonly updatedAt: Timestamp | Date;
}

function toIso(value: Timestamp | Date | null): string | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value.toDate().toISOString();
}

function clampText(value: unknown, max: number, field: string): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new CampaignValidationError(`${field} must be text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new CampaignValidationError(`${field} is too long.`);
  }
  return trimmed;
}

function projectSessionZero(stored: StoredSessionZero): SessionZeroProjection {
  return {
    completed: stored.completed,
    completedAt: toIso(stored.completedAt),
    tone: stored.tone,
    pvpPolicy: stored.pvpPolicy,
    characterConflictPolicy: stored.characterConflictPolicy,
    romancePolicy: stored.romancePolicy,
    lethalityPreference: stored.lethalityPreference,
    directorDiscretionLevel: stored.directorDiscretionLevel,
    expectedSessionLength: stored.expectedSessionLength,
    dropInOutPolicy: stored.dropInOutPolicy,
    textChatExpectations: stored.textChatExpectations,
    externalVoiceNote: stored.externalVoiceNote,
    accessibilityNeeds: stored.accessibilityNeeds,
    contentSource: stored.contentSource,
  };
}

export function projectCampaignSettings(stored: StoredCampaignSettings): CampaignSettingsProjection {
  return {
    campaignId: stored.campaignId,
    contentProfile: stored.contentProfile,
    contentProfileLabel: CONTENT_PROFILE_LABELS[stored.contentProfile],
    contentProfileSummary: CONTENT_PROFILE_SUMMARIES[stored.contentProfile],
    safetyBoundaries: stored.safetyBoundaries,
    groupDecisionPolicy: stored.groupDecisionPolicy,
    groupDecisionPolicyLabel: GROUP_DECISION_POLICY_LABELS[stored.groupDecisionPolicy],
    designatedCallerAccountId: stored.designatedCallerAccountId,
    reactionWindowSeconds: stored.reactionWindowSeconds,
    rulesTransparency: stored.rulesTransparency,
    rulesTransparencyLabel: RULES_TRANSPARENCY_LABELS[stored.rulesTransparency],
    enemyHealthPresentation: stored.enemyHealthPresentation,
    enemyHealthPresentationLabel: ENEMY_HEALTH_PRESENTATION_LABELS[stored.enemyHealthPresentation],
    sessionZero: projectSessionZero(stored.sessionZero),
    configurationNotice: CAMPAIGN_SETTINGS_CONFIGURATION_NOTICE,
    updatedAt: toIso(stored.updatedAt) ?? new Date(0).toISOString(),
  };
}

export function buildDefaultStoredSettings(campaignId: string, now: Date): StoredCampaignSettings {
  const defaults = defaultCampaignSettingsFields();
  return {
    campaignId,
    contentProfile: defaults.contentProfile,
    safetyBoundaries: defaults.safetyBoundaries,
    groupDecisionPolicy: defaults.groupDecisionPolicy,
    designatedCallerAccountId: null,
    reactionWindowSeconds: defaults.reactionWindowSeconds,
    rulesTransparency: 'standard',
    enemyHealthPresentation: defaults.enemyHealthPresentation,
    sessionZero: {
      completed: false,
      completedAt: null,
      tone: defaults.sessionZero.tone,
      pvpPolicy: 'consent_required',
      characterConflictPolicy: defaults.sessionZero.characterConflictPolicy,
      romancePolicy: defaults.sessionZero.romancePolicy,
      lethalityPreference: defaults.sessionZero.lethalityPreference,
      directorDiscretionLevel: 'moderate_bounded',
      expectedSessionLength: defaults.sessionZero.expectedSessionLength,
      dropInOutPolicy: defaults.sessionZero.dropInOutPolicy,
      textChatExpectations: defaults.sessionZero.textChatExpectations,
      externalVoiceNote: '',
      accessibilityNeeds: '',
      contentSource: defaults.sessionZero.contentSource,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export async function ensureCampaignSettings(
  firestore: Firestore,
  campaignId: string,
): Promise<StoredCampaignSettings> {
  const ref = firestore.collection(COLLECTIONS.campaignSettings).doc(campaignId);
  const snapshot = await ref.get();
  if (snapshot.exists) {
    return snapshot.data() as StoredCampaignSettings;
  }
  const created = buildDefaultStoredSettings(campaignId, new Date());
  await ref.set(created);
  return created;
}

export async function assertSessionZeroRecorded(
  firestore: Firestore,
  campaignId: string,
): Promise<void> {
  const stored = await ensureCampaignSettings(firestore, campaignId);
  if (!stored.sessionZero.completed) {
    throw new CampaignValidationError(
      'Record Session Zero in Campaign settings before seating characters or starting live play.',
    );
  }
}

export async function readCampaignSettings(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<CampaignSettingsProjection> {
  await requireCampaignMembership(options.firestore, options.campaignId, options.accountId);
  const stored = await ensureCampaignSettings(options.firestore, options.campaignId);
  return projectCampaignSettings(stored);
}

export async function updateCampaignSettings(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
  readonly payload: Record<string, unknown>;
}): Promise<CampaignSettingsProjection> {
  const { firestore, accountId, campaignId, payload } = options;
  const membership = await requireCampaignMembership(firestore, campaignId, accountId);
  if (membership.role !== 'owner') {
    throw new CampaignNotFoundError();
  }

  const current = await ensureCampaignSettings(firestore, campaignId);
  const next = { ...current, sessionZero: { ...current.sessionZero } };

  if (payload.contentProfile !== undefined) {
    if (!isContentProfile(payload.contentProfile)) {
      throw new CampaignValidationError(
        `Choose a content profile: ${CONTENT_PROFILES.join(', ')}.`,
      );
    }
    next.contentProfile = payload.contentProfile;
  }

  if (payload.safetyBoundaries !== undefined) {
    next.safetyBoundaries = clampText(
      payload.safetyBoundaries,
      SAFETY_BOUNDARIES_MAX_LENGTH,
      'Safety boundaries',
    );
  }

  if (payload.contentProfile !== undefined || payload.safetyBoundaries !== undefined) {
    if (next.contentProfile === 'custom_restricted' && next.safetyBoundaries.trim().length === 0) {
      throw new CampaignValidationError(
        'Custom Restricted requires at least one line, veil, or safety boundary.',
      );
    }
  }

  if (payload.groupDecisionPolicy !== undefined) {
    if (!isGroupDecisionPolicy(payload.groupDecisionPolicy)) {
      throw new CampaignValidationError('Choose a valid group-decision policy.');
    }
    next.groupDecisionPolicy = payload.groupDecisionPolicy;
  }

  if (payload.designatedCallerAccountId !== undefined) {
    const caller = payload.designatedCallerAccountId;
    if (caller === null || caller === '') {
      next.designatedCallerAccountId = null;
    } else if (typeof caller !== 'string' || caller.length > 64) {
      throw new CampaignValidationError('Designated caller must be a campaign member account.');
    } else {
      const callerMembership = await firestore
        .collection(COLLECTIONS.campaignMemberships)
        .where('campaignId', '==', campaignId)
        .where('accountId', '==', caller)
        .limit(1)
        .get();
      if (callerMembership.empty) {
        throw new CampaignValidationError('Designated caller must be a campaign member.');
      }
      const callerSeat = await firestore
        .collection(COLLECTIONS.campaignSeats)
        .where('campaignId', '==', campaignId)
        .where('ownerAccountId', '==', caller)
        .limit(1)
        .get();
      if (callerSeat.empty) {
        throw new CampaignValidationError('Designated caller must be a seated campaign member.');
      }
      next.designatedCallerAccountId = caller;
    }
  }

  if (payload.reactionWindowSeconds !== undefined) {
    const seconds = payload.reactionWindowSeconds;
    if (
      typeof seconds !== 'number' ||
      !Number.isInteger(seconds) ||
      seconds < REACTION_WINDOW_SECONDS_MIN ||
      seconds > REACTION_WINDOW_SECONDS_MAX
    ) {
      throw new CampaignValidationError(
        `Reaction window must be ${REACTION_WINDOW_SECONDS_MIN}–${REACTION_WINDOW_SECONDS_MAX} seconds.`,
      );
    }
    next.reactionWindowSeconds = seconds;
  }

  if (payload.enemyHealthPresentation !== undefined) {
    if (!isEnemyHealthPresentation(payload.enemyHealthPresentation)) {
      throw new CampaignValidationError('Choose a valid enemy health presentation.');
    }
    next.enemyHealthPresentation = payload.enemyHealthPresentation;
  }

  const sessionPayload = payload.sessionZero;
  if (sessionPayload !== undefined) {
    if (sessionPayload === null || typeof sessionPayload !== 'object') {
      throw new CampaignValidationError('Session Zero payload is invalid.');
    }
    const zero = sessionPayload as Record<string, unknown>;
    if (zero.tone !== undefined) {
      if (!isSessionTone(zero.tone)) {
        throw new CampaignValidationError('Choose a valid Session Zero tone.');
      }
      next.sessionZero.tone = zero.tone;
    }
    if (zero.characterConflictPolicy !== undefined) {
      if (!isCharacterConflictPolicy(zero.characterConflictPolicy)) {
        throw new CampaignValidationError('Choose a valid character conflict policy.');
      }
      next.sessionZero.characterConflictPolicy = zero.characterConflictPolicy;
    }
    if (zero.romancePolicy !== undefined) {
      if (!isRomancePolicy(zero.romancePolicy)) {
        throw new CampaignValidationError('Choose a valid romance policy.');
      }
      next.sessionZero.romancePolicy = zero.romancePolicy;
    }
    if (zero.lethalityPreference !== undefined) {
      if (!isLethalityPreference(zero.lethalityPreference)) {
        throw new CampaignValidationError('Choose a valid lethality preference.');
      }
      next.sessionZero.lethalityPreference = zero.lethalityPreference;
    }
    if (zero.expectedSessionLength !== undefined) {
      next.sessionZero.expectedSessionLength = clampText(
        zero.expectedSessionLength,
        EXPECTED_SESSION_LENGTH_MAX_LENGTH,
        'Expected session length',
      );
      const length = next.sessionZero.expectedSessionLength.trim();
      if (length.length === 0) {
        throw new CampaignValidationError(
          'Expected session length is required. Enter a duration such as “3–5 sessions”.',
        );
      }
      if (/^0(\s|$)|zero\s+session/i.test(length) || length === '0 sessions') {
        throw new CampaignValidationError(
          'Expected session length must describe at least one session (for example, “3–5 sessions”).',
        );
      }
    }
    if (zero.dropInOutPolicy !== undefined) {
      if (!isDropInOutPolicy(zero.dropInOutPolicy)) {
        throw new CampaignValidationError('Choose a valid drop-in/drop-out policy.');
      }
      next.sessionZero.dropInOutPolicy = zero.dropInOutPolicy;
    }
    if (zero.textChatExpectations !== undefined) {
      next.sessionZero.textChatExpectations = clampText(
        zero.textChatExpectations,
        EXTERNAL_VOICE_NOTE_MAX_LENGTH,
        'Text-chat expectations',
      );
    }
    if (zero.externalVoiceNote !== undefined) {
      next.sessionZero.externalVoiceNote = clampText(
        zero.externalVoiceNote,
        EXTERNAL_VOICE_NOTE_MAX_LENGTH,
        'External voice note',
      );
    }
    if (zero.accessibilityNeeds !== undefined) {
      next.sessionZero.accessibilityNeeds = clampText(
        zero.accessibilityNeeds,
        ACCESSIBILITY_NOTES_MAX_LENGTH,
        'Accessibility needs',
      );
    }
    if (zero.contentSource !== undefined) {
      if (!isContentSourceFlag(zero.contentSource)) {
        throw new CampaignValidationError('Choose original or homebrew-allowed content.');
      }
      next.sessionZero.contentSource = zero.contentSource;
    }
    if (zero.complete === true) {
      // Require an explicit non-empty length in THIS request. Do not complete Session
      // Zero by inheriting a previously stored default the player just cleared (PQA-108).
      const providedLength =
        typeof zero.expectedSessionLength === 'string' ? zero.expectedSessionLength.trim() : '';
      if (providedLength.length === 0) {
        throw new CampaignValidationError(
          'Expected session length is required for Session Zero. Enter a duration such as “3–5 sessions”.',
        );
      }
      next.sessionZero.expectedSessionLength = clampText(
        providedLength,
        EXPECTED_SESSION_LENGTH_MAX_LENGTH,
        'Expected session length',
      );
      if (next.sessionZero.textChatExpectations.trim().length === 0) {
        throw new CampaignValidationError('Text-chat expectations are required for Session Zero.');
      }
      if (!next.sessionZero.completed) {
        next.sessionZero.completed = true;
        next.sessionZero.completedAt = new Date();
      } else {
        // Updates refresh the recorded timestamp so players see the change stuck.
        next.sessionZero.completedAt = new Date();
      }
    }
    // Locked defaults — ignore client attempts to weaken them.
    next.sessionZero.pvpPolicy = 'consent_required';
    next.sessionZero.directorDiscretionLevel = 'moderate_bounded';
  }

  if (next.groupDecisionPolicy === 'designated_caller') {
    if (next.designatedCallerAccountId === null) {
      throw new CampaignValidationError(
        'Designated caller policy requires choosing a campaign member.',
      );
    }
  } else {
    next.designatedCallerAccountId = null;
  }

  if (next.reactionWindowSeconds < REACTION_WINDOW_SECONDS_MIN) {
    next.reactionWindowSeconds = REACTION_WINDOW_SECONDS_DEFAULT;
  }

  const wasSessionZeroComplete = current.sessionZero.completed;
  next.updatedAt = new Date();
  const stored: StoredCampaignSettings = {
    ...next,
    sessionZero: { ...next.sessionZero },
  };
  await firestore.collection(COLLECTIONS.campaignSettings).doc(campaignId).set(stored);

  await appendChronicleEntry({
    firestore,
    campaignId,
    kind: 'settings_updated',
    body: 'Campaign settings were updated by the campaign owner.',
  });

  if (!wasSessionZeroComplete && stored.sessionZero.completed) {
    await appendChronicleEntry({
      firestore,
      campaignId,
      kind: 'session_zero_recorded',
      body: 'Session Zero social contract was recorded for this campaign.',
    });
  }

  return projectCampaignSettings(stored);
}

/** Used when creating a campaign so settings exist before first read. */
export async function seedCampaignSettings(
  firestore: Firestore,
  campaignId: string,
  now: Date,
): Promise<void> {
  await firestore
    .collection(COLLECTIONS.campaignSettings)
    .doc(campaignId)
    .set(buildDefaultStoredSettings(campaignId, now));
}

export function contentProfileSummaryFor(profile: ContentProfile): string {
  return CONTENT_PROFILE_SUMMARIES[profile];
}
