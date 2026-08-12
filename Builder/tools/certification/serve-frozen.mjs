#!/usr/bin/env node
/**
 * Launches an already-materialized frozen candidate for QA Player Validation.
 *
 * Blueprint ownership: Section 1.11.9 — "The frozen candidate is materialized
 * as a launchable certification runtime under Runtime Root with a manifest
 * linking runtime/build hashes back to the clean Builder Root source... QA
 * interacts with it through the declared local URL."
 *
 * This launcher never builds, installs, or edits Builder Root. It refuses to
 * serve a runtime that does not trace to the current clean candidate, so QA
 * cannot be handed a runtime that differs from the verified one.
 */

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { FROZEN_PORTS, startArenaInstance } from '../arena/arena-instance.mjs';
import { LOCAL_PROJECT_ID } from '../arena/project.mjs';
import { computeCandidateIdentity } from '../candidate/candidate-identity.mjs';
import { ensureWorkspaceTree, resolveWorkspace } from '../workspace/working-directory.mjs';

async function main() {
  const paths = resolveWorkspace();
  await ensureWorkspaceTree(paths);

  const requested = process.argv[2] ?? null;
  const candidate = await computeCandidateIdentity();

  if (!candidate.clean) {
    throw new Error(
      `Builder Root has uncommitted changes, so no runtime here can be the verified candidate:\n  - ${candidate.dirtyPaths.join('\n  - ')}`,
    );
  }
  if (requested !== null && requested !== candidate.candidateId) {
    throw new Error(
      `Requested candidate ${requested} but Builder Root currently is ${candidate.candidateId}. Check out the verified revision before serving it.`,
    );
  }

  const runtimeWorkingDir = join(paths.runtimeRoot, 'candidates', candidate.candidateId);
  const runtimeBuilderRoot = join(runtimeWorkingDir, 'Builder');
  if (!existsSync(join(runtimeBuilderRoot, 'dist', 'client', 'index.html'))) {
    const available = existsSync(join(paths.runtimeRoot, 'candidates'))
      ? (await readdir(join(paths.runtimeRoot, 'candidates'))).join(', ')
      : '(none)';
    throw new Error(
      `No built runtime exists for ${candidate.candidateId}. Run "npm run certify:phase0" first. Materialized candidates: ${available}`,
    );
  }

  const arena = await startArenaInstance({
    paths,
    runtimeMode: 'frozen_certification',
    instanceDir: join(paths.runtimeRoot, 'certification', candidate.candidateId),
    candidateSourceDir: runtimeBuilderRoot,
    ports: FROZEN_PORTS,
    projectId: LOCAL_PROJECT_ID,
    startClient: async () => ({ stop: async () => {} }),
  });

  console.log('');
  console.log('Frozen candidate is being served for player validation.');
  console.log(`  Candidate            ${arena.candidate.candidateId}`);
  console.log(`  Commit               ${arena.candidate.commit}`);
  console.log(`  Page                 ${arena.clientOrigin}`);
  console.log(`  Local Stack Manifest ${arena.manifestPath}`);
  console.log(`  Runtime source       ${runtimeBuilderRoot}`);
  console.log('');
  for (const check of arena.readiness.checks) {
    console.log(`  [ready] ${check.name} — ${check.detail}`);
  }
  console.log('');
  console.log('Press Ctrl+C to stop serving.');

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`\nStopping the frozen runtime (${signal})…`);
    await arena.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(`\nCannot serve the frozen candidate.\n${error.message}`);
  process.exit(1);
});
