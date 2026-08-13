/**
 * Campaign creation, membership, invitations, and seats.
 *
 * Blueprint ownership: Sections 1.5.4 / 1.5.21 (locked Director configuration),
 * 7.6 (invitations and bounded preview), 7.7 / 7.7.2 (ownership and seats),
 * and Phase 1 build scope. Campaign ownership grants no character ownership.
 *
 * Every sensitive operation resolves ownership and membership from the verified
 * authentication context. The client never supplies an owner.
 */

import { randomUUID } from 'node:crypto';

import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import {
  CAMPAIGN_NAME_MAX_LENGTH,
  CAMPAIGN_SUMMARY_MAX_LENGTH,
  DIRECTOR_IDENTITY_LABELS,
  DIRECTOR_PERSONALITY_LABELS,
  INVITATION_RATE_LIMIT_MAX,
  INVITATION_RATE_LIMIT_WINDOW_MS,
  INVITATION_TTL_MS,
  type CampaignDetailProjection,
  type CampaignListProjection,
  type CampaignMemberRole,
  type CampaignProjection,
  type DirectorIdentity,
  type DirectorPersonality,
  type InvitationCreatedProjection,
  type InvitationPreview,
  type MembershipProjection,
  type SeatProjection,
  isDirectorIdentity,
  isDirectorPersonality,
} from '../../shared/campaign-contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import { CharacterNotFoundError, readCharacter, readVault } from '../characters/characters.js';
import {
  DIRECTOR_CONFIGURATION_NOTICE,
  resolveDirectorConfiguration,
} from './director-catalog.js';

const CONTENT_PROFILE_SUMMARY = 'Alpha development campaign. Invitation-only Local Arena table.';
const SESSION_STATE_OPEN = 'Open for membership';
const INVITE_CODE_LENGTH = 12;
/** Seat lifetime for Phase 1 continuity proofs (aligned with development session TTL). */
const SEAT_TTL_MS = 4 * 60 * 60 * 1000;

interface StoredCampaign {
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly ownerDisplayLabel: string;
  readonly name: string;
  readonly summary: string;
  readonly directorIdentity: DirectorIdentity;
  readonly directorPersonality: DirectorPersonality;
  readonly directorAvatarKey: string;
  readonly directorLockedAt: Timestamp | Date;
  readonly createdAt: Timestamp | Date;
  readonly updatedAt: Timestamp | Date;
}

interface StoredMembership {
  readonly membershipId: string;
  readonly campaignId: string;
  readonly accountId: string;
  readonly displayLabel: string;
  readonly role: CampaignMemberRole;
  readonly joinedAt: Timestamp | Date;
}

interface StoredInvitation {
  readonly inviteCode: string;
  readonly campaignId: string;
  readonly createdByAccountId: string;
  readonly createdAt: Timestamp | Date;
  readonly expiresAt: Timestamp | Date;
  readonly status: 'open' | 'revoked';
}

interface StoredSeat {
  readonly seatId: string;
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly characterId: string;
  readonly characterName: string;
  readonly role: 'player';
  readonly deviceSessionId: string;
  readonly createdAt: Timestamp | Date;
  readonly renewedAt: Timestamp | Date;
  readonly expiresAt: Timestamp | Date;
  readonly lastAcknowledgedEventSequence: number;
}

export class CampaignNotFoundError extends Error {
  constructor() {
    super('No such campaign for this account');
    this.name = 'CampaignNotFoundError';
  }
}

export class DirectorConfigLockedError extends Error {
  constructor() {
    super('Director identity and personality are locked after campaign creation');
    this.name = 'DirectorConfigLockedError';
  }
}

export class InvitationUnavailableError extends Error {
  constructor() {
    super('This invitation is not available');
    this.name = 'InvitationUnavailableError';
  }
}

export class InvitationRateLimitedError extends Error {
  constructor() {
    super('Too many invitation links were created recently');
    this.name = 'InvitationRateLimitedError';
  }
}

export class AlreadyMemberError extends Error {
  constructor() {
    super('This account is already a member of the campaign');
    this.name = 'AlreadyMemberError';
  }
}

export class NotAMemberError extends Error {
  constructor() {
    super('This account is not a member of the campaign');
    this.name = 'NotAMemberError';
  }
}

export class AlreadySeatedError extends Error {
  constructor() {
    super('This account already has a seat in the campaign');
    this.name = 'AlreadySeatedError';
  }
}

export class CampaignValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignValidationError';
  }
}

function toIso(value: Timestamp | Date): string {
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

function newInviteCode(): string {
  return randomUUID().replace(/-/g, '').slice(0, INVITE_CODE_LENGTH);
}

function validateName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new CampaignValidationError('Campaign name is required.');
  }
  const name = raw.trim();
  if (name.length === 0) {
    throw new CampaignValidationError('Campaign name is required.');
  }
  if (name.length > CAMPAIGN_NAME_MAX_LENGTH) {
    throw new CampaignValidationError(
      `Campaign name must be at most ${CAMPAIGN_NAME_MAX_LENGTH} characters.`,
    );
  }
  return name;
}

function validateSummary(raw: unknown): string {
  if (raw === undefined || raw === null) {
    return '';
  }
  if (typeof raw !== 'string') {
    throw new CampaignValidationError('Campaign summary must be text.');
  }
  const summary = raw.trim();
  if (summary.length > CAMPAIGN_SUMMARY_MAX_LENGTH) {
    throw new CampaignValidationError(
      `Campaign summary must be at most ${CAMPAIGN_SUMMARY_MAX_LENGTH} characters.`,
    );
  }
  return summary;
}

function projectDirector(stored: StoredCampaign) {
  return {
    identity: stored.directorIdentity,
    identityLabel: DIRECTOR_IDENTITY_LABELS[stored.directorIdentity],
    personality: stored.directorPersonality,
    personalityLabel: DIRECTOR_PERSONALITY_LABELS[stored.directorPersonality],
    avatarKey: stored.directorAvatarKey,
    lockedAt: toIso(stored.directorLockedAt),
  };
}

function projectMembership(stored: StoredMembership): MembershipProjection {
  return {
    membershipId: stored.membershipId,
    campaignId: stored.campaignId,
    accountId: stored.accountId,
    displayLabel: stored.displayLabel,
    role: stored.role,
    joinedAt: toIso(stored.joinedAt),
  };
}

function projectSeat(stored: StoredSeat): SeatProjection {
  return {
    seatId: stored.seatId,
    campaignId: stored.campaignId,
    ownerAccountId: stored.ownerAccountId,
    characterId: stored.characterId,
    characterName: stored.characterName,
    role: stored.role,
    deviceSessionId: stored.deviceSessionId,
    createdAt: toIso(stored.createdAt),
    renewedAt: toIso(stored.renewedAt),
    expiresAt: toIso(stored.expiresAt),
    lastAcknowledgedEventSequence: stored.lastAcknowledgedEventSequence,
  };
}

async function loadCampaign(
  firestore: Firestore,
  campaignId: string,
): Promise<StoredCampaign> {
  const snapshot = await firestore.collection(COLLECTIONS.campaigns).doc(campaignId).get();
  if (!snapshot.exists) {
    throw new CampaignNotFoundError();
  }
  return snapshot.data() as StoredCampaign;
}

async function loadMembership(
  firestore: Firestore,
  campaignId: string,
  accountId: string,
): Promise<StoredMembership | null> {
  const snapshot = await firestore
    .collection(COLLECTIONS.campaignMemberships)
    .where('campaignId', '==', campaignId)
    .where('accountId', '==', accountId)
    .limit(1)
    .get();
  if (snapshot.empty) {
    return null;
  }
  return snapshot.docs[0]!.data() as StoredMembership;
}

async function requireMembership(
  firestore: Firestore,
  campaignId: string,
  accountId: string,
): Promise<StoredMembership> {
  const membership = await loadMembership(firestore, campaignId, accountId);
  if (membership === null) {
    // Foreign campaigns look identical to missing ones to the caller.
    throw new CampaignNotFoundError();
  }
  return membership;
}

async function countMembers(firestore: Firestore, campaignId: string): Promise<number> {
  const snapshot = await firestore
    .collection(COLLECTIONS.campaignMemberships)
    .where('campaignId', '==', campaignId)
    .get();
  return snapshot.size;
}

async function countSeats(firestore: Firestore, campaignId: string): Promise<number> {
  const snapshot = await firestore
    .collection(COLLECTIONS.campaignSeats)
    .where('campaignId', '==', campaignId)
    .get();
  return snapshot.size;
}

async function listMemberships(
  firestore: Firestore,
  campaignId: string,
): Promise<StoredMembership[]> {
  const snapshot = await firestore
    .collection(COLLECTIONS.campaignMemberships)
    .where('campaignId', '==', campaignId)
    .get();
  return snapshot.docs.map((doc) => doc.data() as StoredMembership);
}

async function listSeats(firestore: Firestore, campaignId: string): Promise<StoredSeat[]> {
  const snapshot = await firestore
    .collection(COLLECTIONS.campaignSeats)
    .where('campaignId', '==', campaignId)
    .get();
  return snapshot.docs.map((doc) => doc.data() as StoredSeat);
}

function projectCampaign(
  stored: StoredCampaign,
  membership: StoredMembership,
  memberCount: number,
  seatCount: number,
): CampaignProjection {
  return {
    campaignId: stored.campaignId,
    name: stored.name,
    summary: stored.summary,
    ownerAccountId: stored.ownerAccountId,
    ownerDisplayLabel: stored.ownerDisplayLabel,
    membershipRole: membership.role,
    director: projectDirector(stored),
    memberCount,
    seatCount,
    createdAt: toIso(stored.createdAt),
    updatedAt: toIso(stored.updatedAt),
    isCampaignOwner: membership.role === 'owner',
  };
}

function invitationCreatedProjection(stored: StoredInvitation): InvitationCreatedProjection {
  return {
    inviteCode: stored.inviteCode,
    invitePath: `/invite/${stored.inviteCode}`,
    campaignId: stored.campaignId,
    createdAt: toIso(stored.createdAt),
    expiresAt: toIso(stored.expiresAt),
  };
}

function invitationIsOpen(invitation: StoredInvitation, now: Date): boolean {
  if (invitation.status !== 'open') {
    return false;
  }
  if (invitation.expiresAt === undefined || invitation.expiresAt === null) {
    return false;
  }
  const expiresAt =
    invitation.expiresAt instanceof Date
      ? invitation.expiresAt
      : invitation.expiresAt.toDate();
  return expiresAt.getTime() > now.getTime();
}

async function findOpenInvitation(
  firestore: Firestore,
  campaignId: string,
  now: Date = new Date(),
): Promise<StoredInvitation | null> {
  const snapshot = await firestore
    .collection(COLLECTIONS.campaignInvitations)
    .where('campaignId', '==', campaignId)
    .where('status', '==', 'open')
    .limit(5)
    .get();
  for (const doc of snapshot.docs) {
    const invitation = doc.data() as StoredInvitation;
    if (invitationIsOpen(invitation, now)) {
      return invitation;
    }
  }
  return null;
}

/** Creates a campaign with an explicit, immediately locked Director configuration. */
export async function createCampaign(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly displayLabel: string;
  readonly name: unknown;
  readonly summary?: unknown;
  readonly directorIdentity: unknown;
  readonly directorPersonality: unknown;
}): Promise<CampaignProjection> {
  const { firestore, accountId, displayLabel } = options;
  const name = validateName(options.name);
  const summary = validateSummary(options.summary);

  if (!isDirectorIdentity(options.directorIdentity)) {
    throw new CampaignValidationError('Choose Veyra or Garrick as the Game Director identity.');
  }
  if (!isDirectorPersonality(options.directorPersonality)) {
    throw new CampaignValidationError('Choose one approved Game Director personality.');
  }

  const now = new Date();
  const director = resolveDirectorConfiguration({
    identity: options.directorIdentity,
    personality: options.directorPersonality,
    lockedAt: now,
  });

  const campaignId = randomUUID();
  const campaign: StoredCampaign = {
    campaignId,
    ownerAccountId: accountId,
    ownerDisplayLabel: displayLabel,
    name,
    summary,
    directorIdentity: director.identity,
    directorPersonality: director.personality,
    directorAvatarKey: director.avatarKey,
    directorLockedAt: director.lockedAt,
    createdAt: now,
    updatedAt: now,
  };

  const membership: StoredMembership = {
    membershipId: randomUUID(),
    campaignId,
    accountId,
    displayLabel,
    role: 'owner',
    joinedAt: now,
  };

  const batch = firestore.batch();
  batch.set(firestore.collection(COLLECTIONS.campaigns).doc(campaignId), campaign);
  batch.set(
    firestore.collection(COLLECTIONS.campaignMemberships).doc(membership.membershipId),
    membership,
  );
  await batch.commit();

  return projectCampaign(campaign, membership, 1, 0);
}

/** Lists campaigns this account owns or has joined. */
export async function listCampaigns(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
}): Promise<CampaignListProjection> {
  const { firestore, accountId } = options;
  const membershipSnapshot = await firestore
    .collection(COLLECTIONS.campaignMemberships)
    .where('accountId', '==', accountId)
    .get();

  const campaigns: CampaignProjection[] = [];
  for (const doc of membershipSnapshot.docs) {
    const membership = doc.data() as StoredMembership;
    try {
      const campaign = await loadCampaign(firestore, membership.campaignId);
      const [memberCount, seatCount] = await Promise.all([
        countMembers(firestore, membership.campaignId),
        countSeats(firestore, membership.campaignId),
      ]);
      campaigns.push(projectCampaign(campaign, membership, memberCount, seatCount));
    } catch (error) {
      if (error instanceof CampaignNotFoundError) {
        continue;
      }
      throw error;
    }
  }

  campaigns.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { accountId, campaigns };
}

/** Campaign detail for a member. Foreign campaigns resolve as not found. */
export async function readCampaignDetail(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<CampaignDetailProjection> {
  const { firestore, accountId, campaignId } = options;
  const membership = await requireMembership(firestore, campaignId, accountId);
  const campaign = await loadCampaign(firestore, campaignId);
  const [members, seats, openInvitation, vault, memberCount] = await Promise.all([
    listMemberships(firestore, campaignId),
    listSeats(firestore, campaignId),
    membership.role === 'owner' ? findOpenInvitation(firestore, campaignId) : Promise.resolve(null),
    readVault({ firestore, accountId }),
    countMembers(firestore, campaignId),
  ]);

  const seatProjections = seats.map(projectSeat);
  const ownSeat = seatProjections.find((seat) => seat.ownerAccountId === accountId) ?? null;

  return {
    campaign: projectCampaign(campaign, membership, memberCount, seats.length),
    members: members
      .map(projectMembership)
      .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt)),
    seats: seatProjections,
    openInvitation: openInvitation === null ? null : invitationCreatedProjection(openInvitation),
    ownSeat,
    ownCharacters: vault.characters.map((character) => ({
      characterId: character.characterId,
      name: character.name,
      summary: `Level ${character.level} ${character.speciesLabel} ${character.classLabel}`,
    })),
  };
}

/**
 * Ordinary users cannot change Director identity or personality after create.
 * Name/summary updates are allowed for the campaign owner only.
 */
export async function updateCampaign(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
  readonly name?: unknown;
  readonly summary?: unknown;
  readonly directorIdentity?: unknown;
  readonly directorPersonality?: unknown;
}): Promise<CampaignProjection> {
  const { firestore, accountId, campaignId } = options;

  if (options.directorIdentity !== undefined || options.directorPersonality !== undefined) {
    throw new DirectorConfigLockedError();
  }

  const membership = await requireMembership(firestore, campaignId, accountId);
  if (membership.role !== 'owner') {
    throw new CampaignNotFoundError();
  }

  const stored = await loadCampaign(firestore, campaignId);
  const name = options.name === undefined ? stored.name : validateName(options.name);
  const summary =
    options.summary === undefined ? stored.summary : validateSummary(options.summary);

  const updated: StoredCampaign = {
    ...stored,
    name,
    summary,
    updatedAt: new Date(),
  };
  await firestore.collection(COLLECTIONS.campaigns).doc(campaignId).set(updated);

  const [memberCount, seatCount] = await Promise.all([
    countMembers(firestore, campaignId),
    countSeats(firestore, campaignId),
  ]);
  return projectCampaign(updated, membership, memberCount, seatCount);
}

/** Owner creates (or reuses) an open invitation for the campaign. */
export async function createInvitation(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<InvitationCreatedProjection> {
  const { firestore, accountId, campaignId } = options;
  const membership = await requireMembership(firestore, campaignId, accountId);
  if (membership.role !== 'owner') {
    throw new CampaignNotFoundError();
  }
  await loadCampaign(firestore, campaignId);

  const now = new Date();
  const existing = await findOpenInvitation(firestore, campaignId, now);
  if (existing !== null) {
    return invitationCreatedProjection(existing);
  }

  const recentCutoff = now.getTime() - INVITATION_RATE_LIMIT_WINDOW_MS;
  const recent = await firestore
    .collection(COLLECTIONS.campaignInvitations)
    .where('createdByAccountId', '==', accountId)
    .get();
  const recentCount = recent.docs.filter((doc) => {
    const createdAt = (doc.data() as StoredInvitation).createdAt;
    const createdMs =
      createdAt instanceof Date ? createdAt.getTime() : createdAt.toDate().getTime();
    return createdMs >= recentCutoff;
  }).length;
  if (recentCount >= INVITATION_RATE_LIMIT_MAX) {
    throw new InvitationRateLimitedError();
  }

  const invitation: StoredInvitation = {
    inviteCode: newInviteCode(),
    campaignId,
    createdByAccountId: accountId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    status: 'open',
  };
  await firestore
    .collection(COLLECTIONS.campaignInvitations)
    .doc(invitation.inviteCode)
    .set(invitation);
  return invitationCreatedProjection(invitation);
}

/** Owner revokes the current open invitation (Section 7.6). */
export async function revokeInvitation(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<void> {
  const { firestore, accountId, campaignId } = options;
  const membership = await requireMembership(firestore, campaignId, accountId);
  if (membership.role !== 'owner') {
    throw new CampaignNotFoundError();
  }

  const open = await findOpenInvitation(firestore, campaignId);
  if (open === null) {
    return;
  }
  await firestore.collection(COLLECTIONS.campaignInvitations).doc(open.inviteCode).set({
    ...open,
    status: 'revoked',
  });
}

/**
 * Bounded invitation preview. Available without authentication; reveals only
 * the fields Section 7.6 / 8.8 allow before sign-in.
 */
export async function previewInvitation(options: {
  readonly firestore: Firestore;
  readonly inviteCode: string;
}): Promise<InvitationPreview> {
  const { firestore, inviteCode } = options;
  if (!/^[A-Za-z0-9]{8,32}$/.test(inviteCode)) {
    throw new InvitationUnavailableError();
  }

  const snapshot = await firestore
    .collection(COLLECTIONS.campaignInvitations)
    .doc(inviteCode)
    .get();
  if (!snapshot.exists) {
    throw new InvitationUnavailableError();
  }
  const invitation = snapshot.data() as StoredInvitation;
  if (!invitationIsOpen(invitation, new Date())) {
    throw new InvitationUnavailableError();
  }

  const campaign = await loadCampaign(firestore, invitation.campaignId);
  return {
    inviteCode: invitation.inviteCode,
    campaignName: campaign.name,
    hostDisplayLabel: campaign.ownerDisplayLabel,
    contentProfileSummary: CONTENT_PROFILE_SUMMARY,
    sessionStateLabel: SESSION_STATE_OPEN,
    requiresSignIn: true,
    directorIdentityLabel: DIRECTOR_IDENTITY_LABELS[campaign.directorIdentity],
    directorPersonalityLabel: DIRECTOR_PERSONALITY_LABELS[campaign.directorPersonality],
    configurationNotice: DIRECTOR_CONFIGURATION_NOTICE,
    expiresAt: toIso(invitation.expiresAt),
  };
}

/** Authenticated account accepts an open invitation and becomes a player member. */
export async function acceptInvitation(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly displayLabel: string;
  readonly inviteCode: string;
}): Promise<CampaignProjection> {
  const { firestore, accountId, displayLabel, inviteCode } = options;
  if (!/^[A-Za-z0-9]{8,32}$/.test(inviteCode)) {
    throw new InvitationUnavailableError();
  }

  const snapshot = await firestore
    .collection(COLLECTIONS.campaignInvitations)
    .doc(inviteCode)
    .get();
  if (!snapshot.exists) {
    throw new InvitationUnavailableError();
  }
  const invitation = snapshot.data() as StoredInvitation;
  if (!invitationIsOpen(invitation, new Date())) {
    throw new InvitationUnavailableError();
  }

  const campaign = await loadCampaign(firestore, invitation.campaignId);
  const existing = await loadMembership(firestore, invitation.campaignId, accountId);
  if (existing !== null) {
    throw new AlreadyMemberError();
  }

  const now = new Date();
  const membership: StoredMembership = {
    membershipId: randomUUID(),
    campaignId: invitation.campaignId,
    accountId,
    displayLabel,
    role: 'player',
    joinedAt: now,
  };
  await firestore
    .collection(COLLECTIONS.campaignMemberships)
    .doc(membership.membershipId)
    .set(membership);

  const [memberCount, seatCount] = await Promise.all([
    countMembers(firestore, invitation.campaignId),
    countSeats(firestore, invitation.campaignId),
  ]);
  return projectCampaign(campaign, membership, memberCount, seatCount);
}

/**
 * Creates a seat binding this account's owned character into the campaign.
 * Foreign characters and non-members are refused without leaking ownership.
 */
export async function createSeat(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
  readonly characterId: string;
  readonly deviceSessionId: string;
}): Promise<SeatProjection> {
  const { firestore, accountId, campaignId, characterId, deviceSessionId } = options;
  await requireMembership(firestore, campaignId, accountId);
  await loadCampaign(firestore, campaignId);

  const existingSeats = await firestore
    .collection(COLLECTIONS.campaignSeats)
    .where('campaignId', '==', campaignId)
    .where('ownerAccountId', '==', accountId)
    .limit(1)
    .get();
  if (!existingSeats.empty) {
    throw new AlreadySeatedError();
  }

  let character;
  try {
    character = await readCharacter({ firestore, accountId, characterId });
  } catch (error) {
    if (error instanceof CharacterNotFoundError) {
      // A character owned by someone else is indistinguishable from missing.
      throw new CharacterNotFoundError();
    }
    throw error;
  }

  const now = new Date();
  const seat: StoredSeat = {
    seatId: randomUUID(),
    campaignId,
    ownerAccountId: accountId,
    characterId: character.characterId,
    characterName: character.identity.name,
    role: 'player',
    deviceSessionId,
    createdAt: now,
    renewedAt: now,
    expiresAt: new Date(now.getTime() + SEAT_TTL_MS),
    lastAcknowledgedEventSequence: 0,
  };
  await firestore.collection(COLLECTIONS.campaignSeats).doc(seat.seatId).set(seat);
  return projectSeat(seat);
}
