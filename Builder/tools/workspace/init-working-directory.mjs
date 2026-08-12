#!/usr/bin/env node
/**
 * Creates the runtime-selected Working Directory tree.
 *
 * Blueprint ownership: Section 25 Phase 0 ("Resolve WORKING_DIRECTORY and
 * create the Builder, QA, Runtime, Evidence, Checkpoints, and Pending-Archive
 * subtrees").
 */

import { ensureWorkspaceTree, resolveWorkspace, WorkspaceError } from './working-directory.mjs';

async function main() {
  const paths = resolveWorkspace();
  await ensureWorkspaceTree(paths);

  console.log('Working Directory resolved and prepared.');
  console.log(`  WORKING_DIRECTORY   ${paths.workingDirectory}  (${paths.resolutionSource})`);
  console.log(`  Builder Root        ${paths.builderRoot}`);
  console.log(`  QA Root             ${paths.qaRoot}`);
  console.log(`  Runtime Root        ${paths.runtimeRoot}`);
  console.log(`  Evidence Root       ${paths.evidenceRoot}`);
  console.log(`  Checkpoint Root     ${paths.checkpointRoot}`);
  console.log(`  Pending Archive     ${paths.pendingArchiveRoot}`);
  console.log(
    `  Archive Directory   ${paths.archiveDirectory ?? 'ARCHIVE_PENDING (none configured)'}`,
  );
}

main().catch((error) => {
  if (error instanceof WorkspaceError) {
    console.error(`Working Directory resolution failed: ${error.message}`);
    process.exit(78);
  }
  console.error(error);
  process.exit(1);
});
