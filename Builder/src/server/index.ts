/**
 * Local Arena server entry point.
 *
 * Fails closed: if the environment is missing, unknown, mixed, or non-local,
 * the process exits before opening a socket or touching the emulators.
 */

import { EnvironmentError, loadServerEnvironment } from './config/environment.js';
import { createArenaServer } from './http/server.js';
import { createCanonicalStore } from './persistence/firestore.js';

async function main(): Promise<void> {
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
