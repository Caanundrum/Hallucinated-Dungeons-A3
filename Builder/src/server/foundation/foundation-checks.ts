/**
 * The Phase 0 canonical write/read path.
 *
 * Blueprint ownership: Section 25 Phase 0 ("one minimal authenticated browser
 * journey that causes a server-authorized emulator write and renders the
 * persisted result back in the page") plus the Canonical Projection Binding
 * rule in Section 1.2.
 *
 * A foundation check is deliberately not a product feature. It is the smallest
 * honest proof that an authenticated player action reaches durable emulator
 * storage, is owned by exactly one account, survives a refresh, and cannot be
 * committed twice by a retried request.
 */

import { randomUUID } from 'node:crypto';

import { type Firestore, type Timestamp } from 'firebase-admin/firestore';

import type {
  FoundationCheckProjection,
  FoundationProjection,
} from '../../shared/contract.js';
import { COLLECTIONS } from '../persistence/firestore.js';

/** Number of most recent checks the owner projection returns. */
export const PROJECTION_PAGE_SIZE = 20;

export interface CommitResult {
  readonly duplicate: boolean;
  readonly check: FoundationCheckProjection;
  readonly projection: FoundationProjection;
}

interface StoredCheck {
  readonly checkId: string;
  readonly ownerAccountId: string;
  readonly requestId: string;
  readonly note: string;
  readonly sequence: number;
  readonly recordedAt: Timestamp;
}

function toProjection(stored: StoredCheck): FoundationCheckProjection {
  return {
    checkId: stored.checkId,
    note: stored.note,
    recordedAt: stored.recordedAt.toDate().toISOString(),
    sequence: stored.sequence,
  };
}

/**
 * Commits one foundation check for the owning account.
 *
 * Idempotency is keyed on `(accountId, requestId)` and enforced inside a
 * Firestore transaction together with the sequence and projection-version
 * increments. A retried or double-submitted request therefore returns the
 * original committed record instead of creating a second one, and the
 * projection version does not advance for the duplicate.
 */
export async function commitFoundationCheck(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
  readonly requestId: string;
  readonly note: string;
}): Promise<CommitResult> {
  const { firestore, accountId, requestId, note } = options;

  const projectionRef = firestore.collection(COLLECTIONS.foundationProjections).doc(accountId);
  const idempotencyKey = `${accountId}:${requestId}`;

  const committed = await firestore.runTransaction(async (transaction) => {
    const duplicateQuery = firestore
      .collection(COLLECTIONS.foundationChecks)
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1);
    const duplicateSnapshot = await transaction.get(duplicateQuery);

    const projectionSnapshot = await transaction.get(projectionRef);
    const currentVersion = projectionSnapshot.exists
      ? ((projectionSnapshot.data()?.projectionVersion as number | undefined) ?? 0)
      : 0;

    if (!duplicateSnapshot.empty) {
      const existing = duplicateSnapshot.docs[0]!.data() as StoredCheck;
      return { duplicate: true, stored: existing, projectionVersion: currentVersion };
    }

    const sequence = currentVersion + 1;
    const checkId = randomUUID();
    const recordedAt = new Date();
    const checkRef = firestore.collection(COLLECTIONS.foundationChecks).doc(checkId);

    transaction.set(checkRef, {
      checkId,
      ownerAccountId: accountId,
      requestId,
      idempotencyKey,
      note,
      sequence,
      recordedAt,
    });
    transaction.set(
      projectionRef,
      { accountId, projectionVersion: sequence, updatedAt: recordedAt },
      { merge: true },
    );

    return {
      duplicate: false,
      stored: {
        checkId,
        ownerAccountId: accountId,
        requestId,
        note,
        sequence,
        recordedAt: recordedAt as unknown as Timestamp,
      },
      projectionVersion: sequence,
    };
  });

  const projection = await readFoundationProjection({ firestore, accountId });

  const storedRecordedAt = committed.stored.recordedAt;
  const check: FoundationCheckProjection =
    storedRecordedAt instanceof Date
      ? {
          checkId: committed.stored.checkId,
          note: committed.stored.note,
          recordedAt: storedRecordedAt.toISOString(),
          sequence: committed.stored.sequence,
        }
      : toProjection(committed.stored);

  return { duplicate: committed.duplicate, check, projection };
}

/**
 * Reads the owner-scoped projection. Ownership is enforced by the query, not
 * by the browser: a caller can only ever receive records whose
 * `ownerAccountId` equals their authenticated account.
 */
export async function readFoundationProjection(options: {
  readonly firestore: Firestore;
  readonly accountId: string;
}): Promise<FoundationProjection> {
  const { firestore, accountId } = options;

  const [projectionSnapshot, checksSnapshot] = await Promise.all([
    firestore.collection(COLLECTIONS.foundationProjections).doc(accountId).get(),
    firestore
      .collection(COLLECTIONS.foundationChecks)
      .where('ownerAccountId', '==', accountId)
      .orderBy('sequence', 'desc')
      .limit(PROJECTION_PAGE_SIZE)
      .get(),
  ]);

  const projectionVersion = projectionSnapshot.exists
    ? ((projectionSnapshot.data()?.projectionVersion as number | undefined) ?? 0)
    : 0;

  const checks = checksSnapshot.docs.map((doc) => toProjection(doc.data() as StoredCheck));

  return { accountId, projectionVersion, checks };
}
