#!/usr/bin/env node
/**
 * Rapid Builder Mode entry point for the Local Arena.
 *
 * Blueprint ownership: Sections 1.11.9 (Rapid Builder Mode permits hot reload
 * and iterative diagnostics) and 22.5 (one documented orchestration entry
 * point, one Local Stack Manifest, one readiness result).
 *
 * This mode is for building and self-play. It is never phase evidence:
 * certification runs through `npm run certify:phase0`.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import {
  ARENA_HOST,
  RAPID_PORTS,
  startArenaInstance,
  startProcessAndWait,
} from './arena-instance.mjs';
import { LOCAL_PROJECT_ID } from './project.mjs';
import {
  BUILDER_ROOT,
  ensureWorkspaceTree,
  resolveWorkspace,
  WorkspaceError,
} from '../workspace/working-directory.mjs';

async function main() {
  const paths = resolveWorkspace();
  await ensureWorkspaceTree(paths);

  const build = spawnSync('npm', ['run', 'build:server'], {
    cwd: BUILDER_ROOT,
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    throw new Error('Server build failed; the Local Arena will not start against stale output.');
  }

  const instanceDir = join(paths.runtimeRoot, 'rapid-builder');

  const arena = await startArenaInstance({
    paths,
    runtimeMode: 'rapid_builder',
    instanceDir,
    candidateSourceDir: BUILDER_ROOT,
    ports: RAPID_PORTS,
    projectId: LOCAL_PROJECT_ID,
    startClient: async ({ ports }) =>
      startProcessAndWait({
        command: join(BUILDER_ROOT, 'node_modules', '.bin', 'vite'),
        args: [
          '--config',
          join(BUILDER_ROOT, 'vite.config.ts'),
          '--host',
          ARENA_HOST,
          '--port',
          String(ports.client),
          '--strictPort',
        ],
        cwd: BUILDER_ROOT,
        env: { ...process.env, HD_SERVER_PORT: String(ports.server) },
        logPath: join(instanceDir, 'logs', 'client.log'),
        port: ports.client,
        label: 'Vite dev server',
      }),
  });

  console.log('');
  console.log('Local Arena is ready (Rapid Builder Mode).');
  console.log(`  Candidate            ${arena.candidate.candidateId}${arena.candidate.clean ? '' : ' (working tree has uncommitted changes)'}`);
  console.log(`  Blueprint            ${arena.blueprint.version} (${arena.blueprint.fileName})`);
  console.log(`  Page                 ${arena.clientOrigin}`);
  console.log(`  Server               ${arena.serverOrigin}`);
  console.log(`  Emulator UI          ${arena.manifest.origins.emulatorUi}`);
  console.log(`  Local Stack Manifest ${arena.manifestPath}`);
  console.log('');
  for (const check of arena.readiness.checks) {
    console.log(`  [ready] ${check.name} — ${check.detail}`);
  }
  console.log('');
  console.log('Press Ctrl+C to stop the arena.');

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`\nStopping the Local Arena (${signal})…`);
    await arena.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  if (error instanceof WorkspaceError) {
    console.error(`Working Directory resolution failed: ${error.message}`);
    process.exit(78);
  }
  console.error(`\nLocal Arena failed to start.\n${error.message}`);
  process.exit(1);
});
