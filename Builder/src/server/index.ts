/**
 * Local Arena server entry point.
 *
 * Fails closed: if the environment is missing, unknown, mixed, or non-local,
 * the process exits before opening a socket or touching the emulators.
 */

import type { Firestore } from 'firebase-admin/firestore';

import { EnvironmentError, loadServerEnvironment } from './config/environment.js';
import { createArenaServer } from './http/server.js';
import { COLLECTIONS, createCanonicalStore } from './persistence/firestore.js';

const CLEAN_SLATE_MIGRATION_DOC_ID = 'world-forge-clean-slate-v1';
const CLEAN_SLATE_COLLECTIONS = [
  'campaigns',
  'campaignMemberships',
  'campaignSeats',
  'campaignTableProjections',
  'campaignInvitations',
  'campaignSettings',
  'campaignSessions',
  'campaignMemory',
  'campaignEncounters',
  'campaignPresence',
  'campaignPresenceMeta',
  'campaignCommands',
  'campaignEvents',
  'partyChatMessages',
  'chronicleEntries',
  'timingAuthorities',
  'characterProgressions',
  'mapRuntimes',
  'characters',
  'characterDrafts',
] as const;

async function runWorldForgeCleanSlateMigrationIfNeeded(
  firestore: Firestore,
  environmentClass: string,
): Promise<void> {
  if (environmentClass !== 'milestone') {
    return;
  }
  try {
    const markerRef = firestore.collection(COLLECTIONS.arenaBaseline).doc(CLEAN_SLATE_MIGRATION_DOC_ID);
    const markerSnap = await markerRef.get();
    if (markerSnap.exists) {
      return;
    }
    process.stdout.write(`[arena-server] running one-time ${CLEAN_SLATE_MIGRATION_DOC_ID} wipe...\n`);
    for (const collectionName of CLEAN_SLATE_COLLECTIONS) {
      const snap = await firestore.collection(collectionName).get();
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = firestore.batch();
        for (const doc of snap.docs.slice(i, i + 400)) {
          batch.delete(doc.ref);
        }
        await batch.commit();
      }
    }
    await markerRef.set({
      migrationId: CLEAN_SLATE_MIGRATION_DOC_ID,
      completedAt: new Date().toISOString(),
    });
    process.stdout.write(`[arena-server] completed ${CLEAN_SLATE_MIGRATION_DOC_ID} wipe\n`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[arena-server] clean-slate migration warning: ${detail}\n`);
  }
}

async function main(): Promise<void> {
  process.stdout.write('[arena-server] process start\n');
  let env;
  try {
    env = loadServerEnvironment();
  } catch (error) {
    if (error instanceof EnvironmentError) {
      process.stderr.write(`[arena-server] refusing to start: ${error.message}\n`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const store = createCanonicalStore(env);
  await runWorldForgeCleanSlateMigrationIfNeeded(store.firestore, env.environmentClass);
  const arena = createArenaServer({ env, firestore: store.firestore, auth: store.auth });
  const address = await arena.listen();

  process.stdout.write(
    `[arena-server] ready mode=${env.runtimeMode} candidate=${env.candidateId} address=${address} client-origin=${env.clientOrigin}\n`,
  );

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdout.write(`[arena-server] shutting down on ${signal}\n`);
    void arena
      .close()
      .then(() => store.close())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[arena-server] shutdown failure: ${detail}\n`);
        process.exit(1);
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[arena-server] fatal: ${detail}\n`);
  process.exit(1);
});
