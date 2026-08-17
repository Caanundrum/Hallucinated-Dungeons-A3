/**
 * Legal document acceptance history.
 *
 * Blueprint ownership: Section 1.8.5 / Phase 7. Players record acceptance of
 * the current registry version. The client never invents which version was
 * accepted — the server stamps route, version, and content digest.
 */

import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import { isLegalRoute, type LegalRoute } from '../../shared/routes.js';
import { COLLECTIONS } from '../persistence/firestore.js';
import { getLegalDocument, listLegalDocuments } from './legal-registry.js';

export interface LegalAcceptanceItemProjection {
  readonly route: LegalRoute;
  readonly title: string;
  readonly version: string;
  readonly contentDigest: string;
  readonly reConsentRequired: boolean;
  readonly accepted: boolean;
  readonly acceptedAt: string | null;
}

export interface LegalAcceptanceProjection {
  readonly accountId: string;
  readonly documents: readonly LegalAcceptanceItemProjection[];
  readonly allCurrentAccepted: boolean;
}

function toIso(value: Timestamp | Date | string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

export async function readLegalAcceptance(
  firestore: Firestore,
  accountId: string,
): Promise<LegalAcceptanceProjection> {
  const snapshot = await firestore.collection(COLLECTIONS.legalAcceptances).doc(accountId).get();
  const stored = snapshot.exists
    ? (snapshot.data() as {
        documents?: Record<
          string,
          { version?: string; contentDigest?: string; acceptedAt?: Timestamp | Date | string }
        >;
      })
    : { documents: {} };
  const accepted = stored.documents ?? {};

  const documents = listLegalDocuments().map((document) => {
    const record = accepted[document.route];
    const matchesCurrent =
      record !== undefined &&
      record.version === document.version &&
      record.contentDigest === document.contentDigest;
    return {
      route: document.route,
      title: document.title,
      version: document.version,
      contentDigest: document.contentDigest,
      reConsentRequired: document.reConsentRequired,
      accepted: matchesCurrent,
      acceptedAt: matchesCurrent ? toIso(record?.acceptedAt) : null,
    };
  });

  return {
    accountId,
    documents,
    allCurrentAccepted: documents.every((document) => document.accepted),
  };
}

export async function acceptCurrentLegalDocument(
  firestore: Firestore,
  accountId: string,
  route: string,
  now = new Date(),
): Promise<LegalAcceptanceProjection> {
  if (!isLegalRoute(route)) {
    throw new Error('Unknown legal document route.');
  }
  const document = getLegalDocument(route);
  if (document === null) {
    throw new Error('Unknown legal document route.');
  }

  const ref = firestore.collection(COLLECTIONS.legalAcceptances).doc(accountId);
  const existing = await ref.get();
  const previous = existing.exists
    ? ((existing.data() as { documents?: Record<string, unknown> }).documents ?? {})
    : {};

  await ref.set(
    {
      accountId,
      documents: {
        ...previous,
        [route]: {
          route,
          version: document.version,
          contentDigest: document.contentDigest,
          acceptedAt: now,
        },
      },
      updatedAt: now,
    },
    { merge: true },
  );

  return readLegalAcceptance(firestore, accountId);
}
