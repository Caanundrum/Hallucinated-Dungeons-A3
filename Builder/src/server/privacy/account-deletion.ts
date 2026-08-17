/**
 * Local Arena account deletion-request path.
 *
 * Honest bound: this records a deletion request against local development
 * identity data in the emulator. It is not a hosted production erasure claim
 * and does not assert GDPR/CCPA completion for a multi-tenant cloud product.
 *
 * Soft-delete marks `deletionRequestedAt` on the development identity so the
 * signed-in session can still read status without breaking the rest of the app.
 */

import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import { COLLECTIONS } from '../persistence/firestore.js';

export const ACCOUNT_DELETION_LOCAL_ARENA_NOTICE =
  'Local Arena only: this records a request to clear local development data in the emulator. It is not a hosted production account-deletion claim.';

export interface AccountDeletionStatus {
  readonly requested: boolean;
  readonly requestedAt: string | null;
  readonly notice: string;
}

function toIsoString(value: Timestamp | Date | string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value.toDate().toISOString();
}

export async function getAccountDeletionStatus(
  firestore: Firestore,
  accountId: string,
): Promise<AccountDeletionStatus> {
  const requestSnap = await firestore
    .collection(COLLECTIONS.accountDeletionRequests)
    .doc(accountId)
    .get();
  if (requestSnap.exists) {
    const data = requestSnap.data() as { requestedAt?: Timestamp | Date | string };
    return {
      requested: true,
      requestedAt: toIsoString(data.requestedAt),
      notice: ACCOUNT_DELETION_LOCAL_ARENA_NOTICE,
    };
  }

  const identitySnap = await firestore
    .collection(COLLECTIONS.developmentIdentities)
    .doc(accountId)
    .get();
  const identity = identitySnap.data() as
    | { deletionRequestedAt?: Timestamp | Date | string | null }
    | undefined;
  const requestedAt = toIsoString(identity?.deletionRequestedAt ?? null);
  return {
    requested: requestedAt !== null,
    requestedAt,
    notice: ACCOUNT_DELETION_LOCAL_ARENA_NOTICE,
  };
}

/**
 * Stores a deletion-request document and soft-marks the development identity.
 * Idempotent: a second request refreshes timestamps but keeps the same shape.
 */
export async function requestAccountDeletion(
  firestore: Firestore,
  accountId: string,
  now: Date = new Date(),
): Promise<AccountDeletionStatus> {
  const requestedAt = now.toISOString();

  await firestore.collection(COLLECTIONS.accountDeletionRequests).doc(accountId).set({
    accountId,
    requestedAt: now,
    status: 'requested',
    scope: 'local_arena_development_data',
    notice: ACCOUNT_DELETION_LOCAL_ARENA_NOTICE,
  });

  await firestore.collection(COLLECTIONS.developmentIdentities).doc(accountId).set(
    {
      deletionRequestedAt: now,
      deletionRequestStatus: 'requested',
    },
    { merge: true },
  );

  return {
    requested: true,
    requestedAt,
    notice: ACCOUNT_DELETION_LOCAL_ARENA_NOTICE,
  };
}
