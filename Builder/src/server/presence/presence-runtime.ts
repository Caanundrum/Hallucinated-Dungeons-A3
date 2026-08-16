/**
 * In-memory + Firestore-backed campaign presence registry — Phase 4.
 *
 * Heartbeats keep a device online. Missed heartbeats enter reconnect grace
 * before offline. Active-Initiative disconnect lock is applied by callers that
 * hold Timing Authority when a seated actor drops to grace/offline.
 */

import { randomUUID } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';

import {
  PRESENCE_RECONNECT_GRACE_MS,
  PRESENCE_STALE_AFTER_MS,
  type CampaignPresenceProjection,
  type PresenceDeviceProjection,
  type PresenceStatus,
} from '../../shared/presence-contract.js';
import { COLLECTIONS, FieldValue } from '../persistence/firestore.js';

/** Online window slightly larger than client heartbeat interval. */
const PRESENCE_HEARTBEAT_ONLINE_MS = 12_000;

interface StoredPresenceDevice {
  readonly presenceId: string;
  readonly campaignId: string;
  readonly accountId: string;
  readonly displayLabel: string;
  readonly deviceSessionId: string;
  readonly tabId: string;
  readonly seatId: string | null;
  readonly spectator: boolean;
  readonly lastHeartbeatAt: string;
  readonly connectedAt: string;
  readonly status: PresenceStatus;
}

function deriveStatus(device: StoredPresenceDevice, nowMs: number): PresenceStatus {
  const age = nowMs - Date.parse(device.lastHeartbeatAt);
  if (device.spectator) {
    if (age <= PRESENCE_HEARTBEAT_ONLINE_MS) return 'spectator';
    if (age <= PRESENCE_RECONNECT_GRACE_MS) return 'grace';
    return 'absent';
  }
  if (age <= PRESENCE_HEARTBEAT_ONLINE_MS) return 'online';
  if (age <= PRESENCE_RECONNECT_GRACE_MS) return 'grace';
  if (age <= PRESENCE_STALE_AFTER_MS) return 'offline';
  return 'absent';
}

function projectDevice(device: StoredPresenceDevice, nowMs: number): PresenceDeviceProjection {
  return {
    deviceSessionId: device.deviceSessionId,
    accountId: device.accountId,
    displayLabel: device.displayLabel,
    seatId: device.seatId,
    status: deriveStatus(device, nowMs),
    lastHeartbeatAt: device.lastHeartbeatAt,
    connectedAt: device.connectedAt,
    tabId: device.tabId,
  };
}

export function projectCampaignPresence(
  campaignId: string,
  devices: readonly StoredPresenceDevice[],
  stateVersion: number,
  now: Date = new Date(),
): CampaignPresenceProjection {
  const nowMs = now.getTime();
  const projected = devices.map((device) => projectDevice(device, nowMs));
  const onlineAccountIds = [
    ...new Set(projected.filter((row) => row.status === 'online' || row.status === 'spectator').map((row) => row.accountId)),
  ];
  const graceAccountIds = [
    ...new Set(projected.filter((row) => row.status === 'grace').map((row) => row.accountId)),
  ];
  return {
    campaignId,
    stateVersion,
    updatedAt: now.toISOString(),
    devices: projected,
    onlineAccountIds,
    graceAccountIds,
  };
}

export async function heartbeatPresence(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly accountId: string;
  readonly displayLabel: string;
  readonly deviceSessionId: string;
  readonly tabId: string;
  readonly seatId: string | null;
  readonly spectator: boolean;
  readonly now?: Date;
}): Promise<CampaignPresenceProjection> {
  const now = options.now ?? new Date();
  const presenceId = `${options.campaignId}:${options.deviceSessionId}:${options.tabId}`;
  const ref = options.firestore.collection(COLLECTIONS.campaignPresence).doc(presenceId);
  const existing = await ref.get();
  const connectedAt =
    existing.exists && typeof existing.data()?.connectedAt === 'string'
      ? (existing.data()!.connectedAt as string)
      : now.toISOString();
  const record: StoredPresenceDevice = {
    presenceId,
    campaignId: options.campaignId,
    accountId: options.accountId,
    displayLabel: options.displayLabel,
    deviceSessionId: options.deviceSessionId,
    tabId: options.tabId,
    seatId: options.seatId,
    spectator: options.spectator,
    lastHeartbeatAt: now.toISOString(),
    connectedAt,
    status: options.spectator ? 'spectator' : 'online',
  };
  await ref.set({ ...record, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const metaRef = options.firestore.collection(COLLECTIONS.campaignPresenceMeta).doc(options.campaignId);
  const meta = await metaRef.get();
  const nextVersion =
    meta.exists && typeof meta.data()?.stateVersion === 'number'
      ? (meta.data()!.stateVersion as number) + 1
      : 1;
  await metaRef.set(
    { campaignId: options.campaignId, stateVersion: nextVersion, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return loadCampaignPresence(options.firestore, options.campaignId, now);
}

export async function loadCampaignPresence(
  firestore: Firestore,
  campaignId: string,
  now: Date = new Date(),
): Promise<CampaignPresenceProjection> {
  const snapshot = await firestore
    .collection(COLLECTIONS.campaignPresence)
    .where('campaignId', '==', campaignId)
    .get();
  const devices = snapshot.docs.map((doc) => doc.data() as StoredPresenceDevice);
  const versionSnap = await firestore.collection(COLLECTIONS.campaignPresenceMeta).doc(campaignId).get();
  const stateVersion =
    versionSnap.exists && typeof versionSnap.data()?.stateVersion === 'number'
      ? (versionSnap.data()!.stateVersion as number)
      : 0;
  return projectCampaignPresence(campaignId, devices, stateVersion, now);
}

/** True when a seated account has left online and is within reconnect grace. */
export function accountInDisconnectGrace(
  presence: CampaignPresenceProjection,
  accountId: string,
): boolean {
  return presence.graceAccountIds.includes(accountId) && !presence.onlineAccountIds.includes(accountId);
}

export function newPresenceTabId(): string {
  return randomUUID();
}
