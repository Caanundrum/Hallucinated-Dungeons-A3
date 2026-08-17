/**
 * Shared Local Arena instance lifecycle.
 *
 * Blueprint ownership: Section 22.5 — "The local stack must start through one
 * documented orchestration entry point from the Builder Root. It may invoke
 * multiple approved tools, but it must produce one Local Stack Manifest and
 * one readiness result."
 *
 * Both Rapid Builder Mode and Frozen Local Certification Mode start through
 * this module so the two modes cannot drift into different readiness rules.
 */

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { computeCandidateIdentity } from '../candidate/candidate-identity.mjs';
import { runBlueprintPreflight } from '../blueprint/preflight.mjs';
import { verifyToolchain } from '../verify-toolchain.mjs';
import {
  assertPortsAvailable,
  portAccepts,
  startEmulators,
  stopProcess,
  writeEmulatorConfig,
} from './emulators.mjs';
import {
  buildLocalStackManifest,
  verifyReadiness,
  writeLocalStackManifest,
} from './local-stack-manifest.mjs';
import { clearArenaData, SEED_VERSION, seedArenaBaseline } from './seed.mjs';

export const ARENA_HOST = '127.0.0.1';

export const RAPID_PORTS = { firestore: 8080, auth: 9099, ui: 4000, server: 5174, client: 5173 };
export const FROZEN_PORTS = { firestore: 8180, auth: 9199, ui: 4100, server: 5274, client: 5274 };

/**
 * Starts a Node process and waits until its port accepts connections.
 *
 * @param {object} options
 * @param {string} options.command
 * @param {string[]} options.args
 * @param {string} options.cwd
 * @param {NodeJS.ProcessEnv} options.env
 * @param {string} options.logPath
 * @param {number} options.port
 * @param {string} options.label
 * @param {number} [options.timeoutMs]
 */
export async function startProcessAndWait({
  command,
  args,
  cwd,
  env,
  logPath,
  port,
  label,
  timeoutMs = 60_000,
}) {
  await mkdir(dirname(logPath), { recursive: true });
  const logStream = createWriteStream(logPath, { flags: 'a' });

  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  /** @type {Error | null} */
  let exitError = null;
  child.once('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      exitError = new Error(`${label} exited early (code=${code} signal=${signal}). See ${logPath}.`);
    }
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exitError !== null) {
      logStream.end();
      throw exitError;
    }
    if (await portAccepts(ARENA_HOST, port, 400)) {
      return { child, stop: () => stopProcess(child, logStream) };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  await stopProcess(child, logStream);
  throw new Error(`${label} did not listen on port ${port} within ${timeoutMs}ms. See ${logPath}.`);
}

/**
 * Brings up one complete Local Arena: emulators, deterministic baseline,
 * application server, and client. Produces one manifest and one readiness
 * result, and tears everything down if any step fails.
 *
 * @param {object} options
 * @param {import('../workspace/working-directory.mjs').WorkspacePaths} options.paths
 * @param {'rapid_builder' | 'frozen_certification'} options.runtimeMode
 * @param {string} options.instanceDir     Runtime directory for logs, config, manifest.
 * @param {string} options.candidateSourceDir Directory the server and rules are served from.
 * @param {typeof RAPID_PORTS} options.ports
 * @param {(context: { env: NodeJS.ProcessEnv, ports: typeof RAPID_PORTS, instanceDir: string, candidateSourceDir: string }) => Promise<{ stop: () => Promise<void> }>} options.startClient
 * @param {string} options.projectId
 */
export async function startArenaInstance(options) {
  const {
    paths,
    runtimeMode,
    instanceDir,
    candidateSourceDir,
    ports,
    startClient,
    projectId,
  } = options;

  const toolchain = verifyToolchain();
  if (!toolchain.ok) {
    const failed = toolchain.checks.filter((check) => !check.ok).map((check) => check.tool);
    throw new Error(
      `Pinned toolchain verification failed for: ${failed.join(', ')}. Run "npm run verify:toolchain" for detail.`,
    );
  }

  const blueprint = await runBlueprintPreflight(paths.workingDirectory);
  if (!blueprint.ok) {
    throw new Error(
      `Blueprint preflight failed:\n  - ${blueprint.failures.join('\n  - ')}`,
    );
  }

  const candidate = await computeCandidateIdentity();
  if (runtimeMode === 'frozen_certification' && !candidate.clean) {
    throw new Error(
      `Frozen Local Certification Mode requires a clean Builder Root. Uncommitted paths:\n  - ${candidate.dirtyPaths.join('\n  - ')}`,
    );
  }

  await assertPortsAvailable(ARENA_HOST, {
    firestore: ports.firestore,
    auth: ports.auth,
    'emulator UI': ports.ui,
    server: ports.server,
    ...(ports.client === ports.server ? {} : { client: ports.client }),
  });

  const emulatorConfigPath = join(instanceDir, 'firebase.emulators.json');
  await writeEmulatorConfig({
    configPath: emulatorConfigPath,
    rulesPath: join(candidateSourceDir, 'firestore.rules'),
    ports: { firestore: ports.firestore, auth: ports.auth, ui: ports.ui },
    host: ARENA_HOST,
  });

  /** @type {Array<{ label: string, stop: () => Promise<void> }>} */
  const started = [];
  const teardown = async () => {
    for (const entry of started.reverse()) {
      await entry.stop();
    }
  };

  try {
    const emulators = await startEmulators({
      configPath: emulatorConfigPath,
      projectId,
      host: ARENA_HOST,
      ports: { firestore: ports.firestore, auth: ports.auth, ui: ports.ui },
      logPath: join(instanceDir, 'logs', 'emulators.log'),
    });
    started.push({ label: 'emulators', stop: emulators.stop });

    const firestoreHost = `${ARENA_HOST}:${ports.firestore}`;
    await clearArenaData({ firestoreHost, projectId });
    const seedVersion = await seedArenaBaseline({
      firestoreHost,
      projectId,
      candidateId: candidate.candidateId,
    });

    const clientOrigin = `http://${ARENA_HOST}:${ports.client}`;
    const serverOrigin = `http://${ARENA_HOST}:${ports.server}`;

    const serverEnv = {
      ...process.env,
      HD_ENV_SCHEMA_VERSION: '1',
      HD_ENVIRONMENT_CLASS: 'local',
      HD_RUNTIME_MODE: runtimeMode,
      HD_CANDIDATE_ID: candidate.candidateId,
      HD_BLUEPRINT_VERSION: blueprint.version,
      HD_FIREBASE_PROJECT_ID: projectId,
      HD_FIRESTORE_EMULATOR_HOST: firestoreHost,
      HD_AUTH_EMULATOR_HOST: `${ARENA_HOST}:${ports.auth}`,
      HD_SERVER_HOST: ARENA_HOST,
      HD_SERVER_PORT: String(ports.server),
      HD_CLIENT_ORIGIN: clientOrigin,
      HD_SEED_VERSION: seedVersion,
      HD_WORKING_DIRECTORY: paths.workingDirectory,
      HD_PUBLIC_SURFACE: process.env.HD_PUBLIC_SURFACE ?? 'local_arena',
    };
    if (runtimeMode === 'frozen_certification') {
      serverEnv.HD_CLIENT_BUNDLE_DIR = join(candidateSourceDir, 'dist', 'client');
    }

    const server = await startProcessAndWait({
      command: process.execPath,
      args: [join(candidateSourceDir, 'dist', 'server', 'index.js')],
      cwd: candidateSourceDir,
      env: serverEnv,
      logPath: join(instanceDir, 'logs', 'server.log'),
      port: ports.server,
      label: 'Local Arena server',
    });
    started.push({ label: 'server', stop: server.stop });

    const client = await startClient({
      env: serverEnv,
      ports,
      instanceDir,
      candidateSourceDir,
    });
    started.push({ label: 'client', stop: client.stop });

    const manifest = await buildLocalStackManifest({
      paths,
      candidate,
      blueprint,
      runtimeMode,
      projectId,
      host: ARENA_HOST,
      ports,
      clientOrigin,
      serverOrigin,
      seedVersion,
      emulatorConfigPath,
    });

    const manifestPath = join(instanceDir, 'local-stack-manifest.json');
    await writeLocalStackManifest(manifestPath, manifest);

    const readiness = await verifyReadiness(manifest);
    if (!readiness.ok) {
      const failures = readiness.checks
        .filter((check) => !check.ok)
        .map((check) => `${check.name}: ${check.detail}`);
      throw new Error(`Local Arena readiness failed:\n  - ${failures.join('\n  - ')}`);
    }

    return {
      candidate,
      blueprint,
      manifest,
      manifestPath,
      readiness,
      clientOrigin,
      serverOrigin,
      stop: teardown,
    };
  } catch (error) {
    await teardown();
    throw error;
  }
}

export { SEED_VERSION };
