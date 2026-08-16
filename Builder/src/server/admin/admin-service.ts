/**
 * Admin panel service — Phase 4.
 *
 * Bootstrap admin is nick.donner@gmail.com (server-verified email only).
 * Admin capability is additive; ordinary play uses the same account without
 * elevated mechanical privilege.
 */

import { createHash, randomUUID } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';

import { BOOTSTRAP_ADMIN_EMAIL, isBootstrapAdminEmail } from './admin-auth.js';
import { COLLECTIONS } from '../persistence/firestore.js';

export type AdminAuditEvent = {
  readonly id: string;
  readonly actorUid: string;
  readonly actorEmail: string;
  readonly action: string;
  readonly detail: string;
  readonly atMs: number;
};

export type AdminPanelSnapshot = {
  readonly isAdmin: boolean;
  readonly bootstrapEmail: string;
  readonly actorEmail: string | null;
  readonly actorAccountId: string;
  readonly auditEvents: readonly AdminAuditEvent[];
  readonly providerMode: string;
  readonly aiKillSwitch: boolean;
  readonly notice: string;
};

function hashId(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

/** Firestore forbids document ids that begin and end with `__`. */
const AI_KILL_SWITCH_DOC_ID = 'ai_kill_switch_meta';

export function assertAdminEmail(email: string | null | undefined): void {
  if (!isBootstrapAdminEmail(email)) {
    throw new Error('Admin access requires bootstrap admin identity.');
  }
}

export async function listAdminAuditEvents(
  firestore: Firestore,
  limit = 40,
): Promise<AdminAuditEvent[]> {
  const snap = await firestore.collection(COLLECTIONS.adminAuditEvents).get();
  return snap.docs
    .map((doc) => doc.data() as AdminAuditEvent)
    .filter((row) => typeof row.id === 'string' && row.id !== AI_KILL_SWITCH_DOC_ID)
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, limit);
}

export async function recordAdminAudit(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly email: string;
  readonly action: string;
  readonly detail: string;
}): Promise<AdminAuditEvent> {
  assertAdminEmail(options.email);
  const event: AdminAuditEvent = {
    id: hashId([options.accountId, options.action, String(Date.now()), randomUUID()]),
    actorUid: options.accountId,
    actorEmail: options.email,
    action: options.action,
    detail: options.detail,
    atMs: Date.now(),
  };
  await options.firestore.collection(COLLECTIONS.adminAuditEvents).doc(event.id).set(event);
  return event;
}

export async function getAiKillSwitch(firestore: Firestore): Promise<boolean> {
  const doc = await firestore
    .collection(COLLECTIONS.adminAuditEvents)
    .doc(AI_KILL_SWITCH_DOC_ID)
    .get();
  if (!doc.exists) return false;
  const data = doc.data() as { enabled?: boolean };
  return Boolean(data.enabled);
}

export async function setAiKillSwitch(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly email: string;
  readonly enabled: boolean;
}): Promise<boolean> {
  assertAdminEmail(options.email);
  await options.firestore.collection(COLLECTIONS.adminAuditEvents).doc(AI_KILL_SWITCH_DOC_ID).set({
    id: AI_KILL_SWITCH_DOC_ID,
    enabled: options.enabled,
    updatedAtMs: Date.now(),
    updatedBy: options.email,
  });
  await recordAdminAudit({
    firestore: options.firestore,
    accountId: options.accountId,
    email: options.email,
    action: 'ai_kill_switch',
    detail: options.enabled ? 'enabled' : 'disabled',
  });
  return options.enabled;
}

export async function buildAdminPanelSnapshot(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly email: string | null;
  readonly providerMode: string;
}): Promise<AdminPanelSnapshot> {
  const isAdmin = isBootstrapAdminEmail(options.email);
  if (!isAdmin) {
    return {
      isAdmin: false,
      bootstrapEmail: BOOTSTRAP_ADMIN_EMAIL,
      actorEmail: options.email,
      actorAccountId: options.accountId,
      auditEvents: [],
      providerMode: options.providerMode,
      aiKillSwitch: false,
      notice:
        'Admin panel requires the server-verified bootstrap Google account. Client-supplied email cannot grant access.',
    };
  }
  const [auditEvents, aiKillSwitch] = await Promise.all([
    listAdminAuditEvents(options.firestore),
    getAiKillSwitch(options.firestore),
  ]);
  return {
    isAdmin: true,
    bootstrapEmail: BOOTSTRAP_ADMIN_EMAIL,
    actorEmail: options.email,
    actorAccountId: options.accountId,
    auditEvents,
    providerMode: options.providerMode,
    aiKillSwitch,
    notice:
      'Administrator is an additive capability. Ordinary table play for this account uses the same seat, perception, and Timing Authority rules as any other player.',
  };
}
