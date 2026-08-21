/**
 * Party Chat persistence for Phase 1.
 *
 * Blueprint ownership: Section 1.5.2.3 — Table Talk / Speak as Character never
 * mutate mechanics. Membership is required; foreign campaigns look missing.
 */

import { randomUUID } from 'node:crypto';

import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import {
  PARTY_CHAT_MESSAGE_MAX_LENGTH,
  isPartyChatMode,
  type PartyChatFeedProjection,
  type PartyChatMessageProjection,
  type PartyChatMode,
} from '../../shared/communication-contract.js';
import {
  CampaignNotFoundError,
  CampaignValidationError,
} from '../campaigns/errors.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import {
  claimNpcSpotlightForSpeech,
} from '../table/npc-spotlight.js';

interface StoredMembership {
  readonly membershipId: string;
  readonly campaignId: string;
  readonly accountId: string;
  readonly displayLabel: string;
  readonly role: 'owner' | 'player';
  readonly joinedAt: Timestamp | Date;
}

interface StoredPartyChatMessage {
  readonly messageId: string;
  readonly campaignId: string;
  readonly senderAccountId: string;
  readonly senderDisplayLabel: string;
  readonly mode: PartyChatMode;
  readonly body: string;
  readonly createdAt: Timestamp | Date;
  readonly addressedNpcId?: string;
  readonly addressedNpcName?: string;
}

function toIso(value: Timestamp | Date): string {
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

async function requireMembership(
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

function projectMessage(stored: StoredPartyChatMessage): PartyChatMessageProjection {
  return {
    messageId: stored.messageId,
    campaignId: stored.campaignId,
    senderAccountId: stored.senderAccountId,
    senderDisplayLabel: stored.senderDisplayLabel,
    mode: stored.mode,
    body: stored.body,
    createdAt: toIso(stored.createdAt),
    ...(stored.addressedNpcId !== undefined
      ? { addressedNpcId: stored.addressedNpcId }
      : {}),
    ...(stored.addressedNpcName !== undefined
      ? { addressedNpcName: stored.addressedNpcName }
      : {}),
  };
}

export async function listPartyChat(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
}): Promise<PartyChatFeedProjection> {
  await requireMembership(options.firestore, options.campaignId, options.accountId);
  const snapshot = await options.firestore
    .collection(COLLECTIONS.partyChatMessages)
    .where('campaignId', '==', options.campaignId)
    .limit(200)
    .get();
  const messages = snapshot.docs
    .map((doc) => projectMessage(doc.data() as StoredPartyChatMessage))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return {
    campaignId: options.campaignId,
    messages,
  };
}

export async function postPartyChatMessage(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly campaignId: string;
  readonly mode: unknown;
  readonly body: unknown;
}): Promise<PartyChatMessageProjection> {
  const membership = await requireMembership(
    options.firestore,
    options.campaignId,
    options.accountId,
  );
  if (!isPartyChatMode(options.mode)) {
    throw new CampaignValidationError('Choose Table Talk or Speak as Character.');
  }
  if (typeof options.body !== 'string') {
    throw new CampaignValidationError('Chat message must be text.');
  }
  const body = options.body.trim();
  if (body.length === 0) {
    throw new CampaignValidationError('Chat message cannot be empty.');
  }
  if (body.length > PARTY_CHAT_MESSAGE_MAX_LENGTH) {
    throw new CampaignValidationError('Chat message is too long.');
  }

  let addressedNpcId: string | undefined;
  let addressedNpcName: string | undefined;
  if (options.mode === 'speak_as_character') {
    const spotlight = await claimNpcSpotlightForSpeech({
      firestore: options.firestore,
      accountId: options.accountId,
      campaignId: options.campaignId,
      displayLabel: membership.displayLabel,
      body,
    });
    if (spotlight !== null) {
      addressedNpcId = spotlight.npcId;
      addressedNpcName = spotlight.npcName;
    }
  }

  const message: StoredPartyChatMessage = {
    messageId: randomUUID(),
    campaignId: options.campaignId,
    senderAccountId: options.accountId,
    senderDisplayLabel: membership.displayLabel,
    mode: options.mode,
    body,
    createdAt: new Date(),
    ...(addressedNpcId !== undefined ? { addressedNpcId } : {}),
    ...(addressedNpcName !== undefined ? { addressedNpcName } : {}),
  };
  await options.firestore
    .collection(COLLECTIONS.partyChatMessages)
    .doc(message.messageId)
    .set(message);
  return projectMessage(message);
}
