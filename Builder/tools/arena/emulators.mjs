/**
 * Firebase Emulator Suite process control for the Local Arena.
 *
 * Blueprint ownership: Sections 1.11.8 (Local Arena), 22.5 (local stack
 * startup, readiness, deterministic certification), and appendix C.ARENA.4
 * (startup, health checks, clean shutdown, port conflict reporting).
 */

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';

import { BUILDER_ROOT } from '../workspace/working-directory.mjs';

/**
 * @typedef {object} EmulatorPorts
 * @property {number} firestore
 * @property {number} auth
 * @property {number} ui
 */

/**
 * Writes an emulator configuration for one arena instance.
 *
 * The generated file lives beside the runtime it serves, never inside the
 * candidate source, so changing ports for an isolated certification run cannot
 * change the candidate hash.
 *
 * @param {object} options
 * @param {string} options.configPath   Absolute path of the config file to write.
 * @param {string} options.rulesPath    Absolute path of the candidate's firestore.rules.
 * @param {EmulatorPorts} options.ports
 * @param {string} options.host
 */
export async function writeEmulatorConfig({ configPath, rulesPath, ports, host }) {
  await mkdir(dirname(configPath), { recursive: true });
  const config = {
    firestore: { rules: rulesPath },
    emulators: {
      singleProjectMode: true,
      auth: { host, port: ports.auth },
      firestore: { host, port: ports.firestore },
      ui: { enabled: true, host, port: ports.ui },
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

/**
 * Resolves true when a TCP port accepts a connection before the deadline.
 *
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 */
export function portAccepts(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Fails fast with an actionable message when a required port is already taken.
 *
 * @param {string} host
 * @param {Record<string, number>} ports
 */
export async function assertPortsAvailable(host, ports) {
  /** @type {string[]} */
  const conflicts = [];
  for (const [name, port] of Object.entries(ports)) {
    if (await portAccepts(host, port, 400)) {
      conflicts.push(`${name} (${host}:${port})`);
    }
  }
  if (conflicts.length > 0) {
    throw new Error(
      `Local Arena cannot start: these ports are already in use: ${conflicts.join(', ')}. Stop the process holding them, or start the arena with different ports.`,
    );
  }
}

/**
 * Starts the emulator suite and resolves once every required service accepts
 * connections. Rejects if the process exits first or readiness times out.
 *
 * @param {object} options
 * @param {string} options.configPath
 * @param {string} options.projectId
 * @param {string} options.host
 * @param {EmulatorPorts} options.ports
 * @param {string} options.logPath
 * @param {number} [options.readinessTimeoutMs]
 */
export async function startEmulators({
  configPath,
  projectId,
  host,
  ports,
  logPath,
  readinessTimeoutMs = 120_000,
}) {
  await mkdir(dirname(logPath), { recursive: true });
  const logStream = createWriteStream(logPath, { flags: 'a' });

  const firebaseBin = join(BUILDER_ROOT, 'node_modules', '.bin', 'firebase');
  const child = spawn(
    firebaseBin,
    ['emulators:start', '--config', configPath, '--project', projectId],
    {
      cwd: BUILDER_ROOT,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  /** @type {Error | null} */
  let exitError = null;
  child.once('exit', (code, signal) => {
    if (code !== 0) {
      exitError = new Error(
        `Firebase emulators exited early (code=${code} signal=${signal}). See ${logPath}.`,
      );
    }
  });

  const deadline = Date.now() + readinessTimeoutMs;
  const required = [
    ['firestore', ports.firestore],
    ['auth', ports.auth],
    ['ui', ports.ui],
  ];

  while (Date.now() < deadline) {
    if (exitError !== null) {
      throw exitError;
    }
    const states = await Promise.all(required.map(([, port]) => portAccepts(host, port, 500)));
    if (states.every(Boolean)) {
      return {
        child,
        stop: () => stopProcess(child, logStream),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  await stopProcess(child, logStream);
  throw new Error(
    `Firebase emulators did not become ready within ${readinessTimeoutMs}ms. See ${logPath}.`,
  );
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {import('node:fs').WriteStream} [logStream]
 */
export async function stopProcess(child, logStream) {
  if (child.exitCode !== null || child.signalCode !== null) {
    logStream?.end();
    return;
  }
  await new Promise((resolve) => {
    const finish = () => resolve(undefined);
    child.once('exit', finish);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, 8000);
    setTimeout(finish, 12_000);
  });
  logStream?.end();
}
