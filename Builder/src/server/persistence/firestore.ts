/**
 * Canonical persistence access for the Local Arena.
 *
 * Blueprint ownership: Section 25 Phase 0 ("one minimal authenticated browser
 * journey that causes a server-authorized emulator write"). Every canonical
 * write in Phase 0 travels through this module so the browser never holds
 * database authority (Section 2.2).
 */

import { cert, deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';

import type { ServerEnvironment } from '../config/environment.js';

export const COLLECTIONS = {
  developmentIdentities: 'developmentIdentities',
  developmentSessions: 'developmentSessions',
  foundationChecks: 'foundationChecks',
  foundationProjections: 'foundationProjections',
  arenaBaseline: 'arenaBaseline',
  characterDrafts: 'characterDrafts',
  characters: 'characters',
  campaigns: 'campaigns',
  campaignMemberships: 'campaignMemberships',
  campaignInvitations: 'campaignInvitations',
  campaignSeats: 'campaignSeats',
  campaignSettings: 'campaignSettings',
  accountSettings: 'accountSettings',
  accountDeletionRequests: 'accountDeletionRequests',
  partyChatMessages: 'partyChatMessages',
  chronicleEntries: 'chronicleEntries',
  campaignCommands: 'campaignCommands',
  campaignEvents: 'campaignEvents',
  campaignTableProjections: 'campaignTableProjections',
  campaignEncounters: 'campaignEncounters',
  characterProgressions: 'characterProgressions',
  timingAuthorities: 'timingAuthorities',
  campaignPresence: 'campaignPresence',
  campaignPresenceMeta: 'campaignPresenceMeta',
  adminAuditEvents: 'adminAuditEvents',
  campaignMemory: 'campaignMemory',
  campaignSessions: 'campaignSessions',
  legalAcceptances: 'legalAcceptances',
} as const;

export interface CanonicalStore {
  readonly app: App;
  readonly firestore: Firestore;
  readonly auth: Auth;
  readonly close: () => Promise<void>;
}

const APP_NAME = 'hallucinated-dungeons-local-arena';

/**
 * Connects the admin SDK to the emulator suite. The emulator host variables
 * are set from the validated `HD_*` schema rather than read ambiently, so a
 * stale shell variable cannot silently redirect canonical writes.
 */
export function createCanonicalStore(env: ServerEnvironment): CanonicalStore {
  if (env.environmentClass === 'local') {
    if (env.firestoreEmulator === null || env.authEmulator === null) {
      throw new Error('Local Arena persistence requires emulator hosts.');
    }
    process.env.FIRESTORE_EMULATOR_HOST = `${env.firestoreEmulator.host}:${env.firestoreEmulator.port}`;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = `${env.authEmulator.host}:${env.authEmulator.port}`;
  } else {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  }

  const existing = getApps().find((candidate) => candidate.name === APP_NAME);
  const app =
    existing ??
    initializeApp(hostedAdminOptions(env), APP_NAME);

  const firestore = getFirestore(app);
  firestore.settings({ ignoreUndefinedProperties: false });

  return {
    app,
    firestore,
    auth: getAuth(app),
    close: async () => {
      await deleteApp(app);
    },
  };
}

function hostedAdminOptions(env: ServerEnvironment): {
  readonly projectId: string;
  readonly credential?: ReturnType<typeof cert>;
} {
  if (env.environmentClass === 'local') {
    return { projectId: env.firebaseProjectId };
  }
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT ?? process.env.GOOGLE_CLOUD_KEYFILE_JSON ?? '').trim();
  if (raw.startsWith('{')) {
    return {
      projectId: env.firebaseProjectId,
      credential: cert(JSON.parse(raw) as Record<string, string>),
    };
  }
  const filePath = (process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim();
  if (filePath !== '') {
    return {
      projectId: env.firebaseProjectId,
      credential: cert(filePath),
    };
  }
  return { projectId: env.firebaseProjectId };
}

/** Re-exported so call sites do not import the admin SDK directly. */
export { FieldValue, cert };
