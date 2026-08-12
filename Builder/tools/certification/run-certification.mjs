#!/usr/bin/env node
/**
 * Frozen Local Certification Mode runner — the Phase 0 Builder Verification.
 *
 * Blueprint ownership: Sections 1.11.9 (Frozen Local Certification Mode),
 * 1.11.12 step 6 (final Builder Verification against the frozen candidate),
 * 1.12.7 (Certification Run Record), and 25 Phase 0 ("freeze the Phase 0
 * candidate and repeat the final page proof from a clean Frozen Local
 * Certification start").
 *
 * The sequence is deliberately unforgiving:
 *   1. Verify the pinned toolchain and the blueprint source.
 *   2. Refuse to proceed unless Builder Root is clean.
 *   3. Materialize the exact tracked candidate into Runtime Root.
 *   4. Install dependencies from the lockfile and build inside that copy.
 *   5. Start fresh processes and a fresh emulator baseline on isolated ports.
 *   6. Run the required suites against that runtime only.
 *   7. Re-hash the source afterwards; any change invalidates the attempt.
 *   8. Write an immutable Certification Run Record and Builder Verification
 *      Package under Evidence Root.
 */

import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  ARENA_HOST,
  FROZEN_PORTS,
  startArenaInstance,
  startProcessAndWait,
} from '../arena/arena-instance.mjs';
import { LOCAL_PROJECT_ID } from '../arena/project.mjs';
import { computeCandidateIdentity, listTrackedFiles } from '../candidate/candidate-identity.mjs';
import { runCodeCompletenessScan } from './code-completeness-scan.mjs';
import { collectGreenfieldEvidence } from './greenfield-evidence.mjs';
import { verifyToolchain } from '../verify-toolchain.mjs';
import {
  BUILDER_ROOT,
  ensureWorkspaceTree,
  resolveWorkspace,
} from '../workspace/working-directory.mjs';

const PHASE = 'phase-0';

/** Runs a command and captures its result for the run record. */
function runCommand(command, args, options) {
  const started = new Date();
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  return {
    command: `${command} ${args.join(' ')}`,
    cwd: options?.cwd ?? process.cwd(),
    startedAt: started.toISOString(),
    endedAt: new Date().toISOString(),
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Copies exactly the tracked candidate files into the runtime directory.
 * Nothing untracked, generated, or role-owned is carried across.
 */
async function materializeCandidate(runtimeCandidateDir) {
  await rm(runtimeCandidateDir, { recursive: true, force: true });
  await mkdir(runtimeCandidateDir, { recursive: true });

  const files = await listTrackedFiles();
  for (const relativePath of files) {
    const destination = join(runtimeCandidateDir, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(BUILDER_ROOT, relativePath), destination);
  }
  return files.length;
}

async function main() {
  const startedAt = new Date();
  const paths = resolveWorkspace();
  await ensureWorkspaceTree(paths);

  /** @type {Array<object>} */
  const steps = [];
  /** @type {string[]} */
  const failures = [];

  const record = (name, ok, detail) => {
    steps.push({ name, ok, detail });
    console.log(`  [${ok ? 'pass' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) {
      failures.push(name);
    }
  };

  console.log('Phase 0 Builder Verification — Frozen Local Certification Mode\n');

  // 1. Pinned toolchain.
  const toolchain = verifyToolchain();
  record(
    'pinned_toolchain_verified',
    toolchain.ok,
    toolchain.checks.map((check) => `${check.tool} ${check.version}`).join(', '),
  );

  // 2. Clean Builder Root.
  const candidateBefore = await computeCandidateIdentity();
  record(
    'builder_root_clean',
    candidateBefore.clean,
    candidateBefore.clean
      ? `${candidateBefore.candidateId} (${candidateBefore.fileCount} tracked files)`
      : `uncommitted: ${candidateBefore.dirtyPaths.join(', ')}`,
  );
  if (!candidateBefore.clean) {
    await writeAttempt({
      paths,
      startedAt,
      candidate: candidateBefore,
      steps,
      failures,
      commandRuns: [],
      status: 'FAILED',
    });
    console.error(
      '\nBuilder Verification FAILED: a frozen candidate cannot be cut from a dirty tree.',
    );
    process.exit(1);
  }

  // 3. Code Completeness Scan.
  const scan = await runCodeCompletenessScan();
  record(
    'code_completeness_scan',
    scan.ok,
    `${scan.filesScanned} files scanned, ${scan.findings.length} classified finding(s)`,
  );

  // 4. Greenfield cleanliness evidence.
  const greenfield = await collectGreenfieldEvidence();
  record(
    'greenfield_source_tree_clean',
    greenfield.ok,
    greenfield.ok
      ? `${greenfield.evidence.treeManifest.fileCount} tracked files, ${greenfield.evidence.dependencies.packageCount} locked packages`
      : greenfield.violations.map((violation) => `${violation.rule}@${violation.path}`).join(', '),
  );

  const runtimeCandidateDir = join(paths.runtimeRoot, 'candidates', candidateBefore.candidateId);
  const instanceDir = join(paths.runtimeRoot, 'certification', candidateBefore.candidateId);
  const evidenceDir = join(
    paths.evidenceRoot,
    PHASE,
    `${candidateBefore.candidateId}-${startedAt.toISOString().replace(/[:.]/g, '-')}`,
  );
  await mkdir(evidenceDir, { recursive: true });

  /** @type {Array<object>} */
  const commandRuns = [];

  // 4. Materialize and build the candidate from its lockfile.
  const copied = await materializeCandidate(runtimeCandidateDir);
  record('candidate_materialized', true, `${copied} tracked files -> ${runtimeCandidateDir}`);

  const install = runCommand('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: runtimeCandidateDir,
  });
  commandRuns.push(install);
  record(
    'clean_dependency_install_from_lockfile',
    install.exitCode === 0,
    `npm ci exit=${install.exitCode}`,
  );

  const build = runCommand('npm', ['run', 'build'], { cwd: runtimeCandidateDir });
  commandRuns.push(build);
  record('candidate_build', build.exitCode === 0, `npm run build exit=${build.exitCode}`);

  if (failures.length > 0) {
    await writeAttempt({
      paths,
      startedAt,
      candidate: candidateBefore,
      steps,
      failures,
      commandRuns,
      status: 'FAILED',
      evidenceDir,
      scan,
      greenfield,
    });
    console.error('\nBuilder Verification FAILED before the runtime could start.');
    process.exit(1);
  }

  // 5. Start the frozen runtime on isolated ports with a fresh baseline.
  let arena;
  try {
    arena = await startArenaInstance({
      paths,
      runtimeMode: 'frozen_certification',
      instanceDir,
      candidateSourceDir: runtimeCandidateDir,
      ports: FROZEN_PORTS,
      projectId: LOCAL_PROJECT_ID,
      // The frozen runtime serves the built bundle from the application server,
      // so there is no separate client process to start.
      startClient: async () => ({ stop: async () => {} }),
    });
    record(
      'frozen_runtime_ready',
      arena.readiness.ok,
      `${arena.clientOrigin} candidate=${arena.candidate.candidateId}`,
    );
  } catch (error) {
    record('frozen_runtime_ready', false, error.message);
    await writeAttempt({
      paths,
      startedAt,
      candidate: candidateBefore,
      steps,
      failures,
      commandRuns,
      status: 'FAILED',
      evidenceDir,
      scan,
      greenfield,
    });
    console.error(`\nBuilder Verification FAILED: ${error.message}`);
    process.exit(1);
  }

  /** @type {object | null} */
  let e2eResults = null;

  try {
    // 6. Required suites against the frozen runtime.
    const unit = runCommand('node', ['--test', 'tests/unit/*.test.mjs'], {
      cwd: runtimeCandidateDir,
      shell: true,
    });
    commandRuns.push(unit);
    const unitCounts = parseNodeTestCounts(unit.stdout);
    record(
      'focused_unit_suite',
      unit.exitCode === 0 && unitCounts.pass > 0 && unitCounts.fail === 0,
      `exit=${unit.exitCode} pass=${unitCounts.pass} fail=${unitCounts.fail} skipped=${unitCounts.skipped}`,
    );

    const e2eOutputDir = join(evidenceDir, 'browser');
    const e2e = runCommand(
      join(runtimeCandidateDir, 'node_modules', '.bin', 'playwright'),
      ['test'],
      {
        cwd: runtimeCandidateDir,
        env: {
          ...process.env,
          HD_E2E_BASE_URL: arena.clientOrigin,
          HD_E2E_OUTPUT_DIR: e2eOutputDir,
        },
      },
    );
    commandRuns.push(e2e);

    try {
      e2eResults = JSON.parse(await readFile(join(e2eOutputDir, 'results.json'), 'utf8'));
    } catch {
      e2eResults = null;
    }

    const stats = summarizeE2e(e2eResults);
    record(
      'actual_page_self_play_and_smoke_spine',
      e2e.exitCode === 0 && stats.total > 0 && stats.failed === 0 && stats.skipped === 0,
      `${stats.passed}/${stats.total} passed, ${stats.failed} failed, ${stats.skipped} skipped`,
    );

    // A suite that reports success without executing assertions is not evidence.
    record(
      'browser_suite_executed_expected_scenarios',
      stats.total >= 13,
      `${stats.total} scenario(s) executed`,
    );
  } finally {
    await arena.stop();
  }

  // 7. The candidate must not have changed during the run.
  const candidateAfter = await computeCandidateIdentity();
  record(
    'candidate_unchanged_during_run',
    candidateAfter.sourceTreeHash === candidateBefore.sourceTreeHash && candidateAfter.clean,
    `${candidateAfter.candidateId}`,
  );

  const status = failures.length === 0 ? 'PASSED' : 'FAILED';
  const recordPath = await writeAttempt({
    paths,
    startedAt,
    candidate: candidateBefore,
    steps,
    failures,
    commandRuns,
    status,
    evidenceDir,
    scan,
    greenfield,
    manifest: arena.manifest,
    manifestPath: arena.manifestPath,
    readiness: arena.readiness,
    e2eResults,
  });

  console.log(`\nCertification Run Record: ${recordPath}`);
  if (status !== 'PASSED') {
    console.error(`\nPhase 0 Builder Verification FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\nPhase 0 Builder Verification PASSED against the frozen candidate.');
  console.log(`Candidate ${candidateBefore.candidateId} is READY_FOR_QA.`);
}

/**
 * Reads the node:test TAP summary. A runner that exits zero without executing
 * assertions is not evidence, so the counts are checked rather than the code.
 *
 * @param {string} stdout
 */
function parseNodeTestCounts(stdout) {
  const read = (label) => {
    const match = new RegExp(`^# ${label} (\\d+)$`, 'm').exec(stdout);
    return match === null ? 0 : Number(match[1]);
  };
  return { pass: read('pass'), fail: read('fail'), skipped: read('skipped') };
}

/** @param {object | null} results */
function summarizeE2e(results) {
  if (results === null) {
    return { total: 0, passed: 0, failed: 0, skipped: 0 };
  }
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const testCase of spec.tests ?? []) {
        total += 1;
        const status = testCase.status ?? testCase.results?.[0]?.status;
        if (status === 'expected') {
          passed += 1;
        } else if (status === 'skipped') {
          skipped += 1;
        } else {
          failed += 1;
        }
      }
    }
    for (const child of suite.suites ?? []) {
      visit(child);
    }
  };
  for (const suite of results.suites ?? []) {
    visit(suite);
  }
  return { total, passed, failed, skipped };
}

/**
 * Writes the immutable Certification Run Record (Section 1.12.7). Failed
 * attempts are written too: an interrupted or failed attempt stays visible.
 */
async function writeAttempt(options) {
  const {
    paths,
    startedAt,
    candidate,
    steps,
    failures,
    commandRuns,
    status,
    evidenceDir,
    scan = null,
    greenfield = null,
    manifest = null,
    manifestPath = null,
    readiness = null,
    e2eResults = null,
  } = options;

  const targetDir =
    evidenceDir ??
    join(
      paths.evidenceRoot,
      PHASE,
      `${candidate.candidateId}-${startedAt.toISOString().replace(/[:.]/g, '-')}`,
    );
  await mkdir(targetDir, { recursive: true });

  const runRecord = {
    recordType: 'certification_run_record',
    recordVersion: '1',
    phase: PHASE,
    status,
    mode: 'frozen_certification',
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    candidate: {
      candidateId: candidate.candidateId,
      sourceTreeHash: candidate.sourceTreeHash,
      commit: candidate.commit,
      dirtyTree: !candidate.clean,
      dirtyPaths: candidate.dirtyPaths,
      dependencyLockHash: candidate.dependencyLockHash,
      rulesHash: candidate.rulesHash,
      fileCount: candidate.fileCount,
    },
    blueprintVersion: manifest?.blueprint?.version ?? null,
    blueprintSourceHash: manifest?.blueprint?.sourceHash ?? null,
    localStackManifestPath: manifestPath,
    localStackManifest: manifest,
    readiness,
    runtime: {
      node: process.versions.node,
      platform: `${process.platform}-${process.arch}`,
    },
    steps,
    failures,
    codeCompletenessScan: scan,
    greenfieldEvidence: greenfield,
    commands: commandRuns.map((run) => ({
      command: run.command,
      cwd: run.cwd,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      exitCode: run.exitCode,
      stdoutTail: run.stdout.slice(-4000),
      stderrTail: run.stderr.slice(-4000),
    })),
    browserSuite: e2eResults === null ? null : summarizeE2e(e2eResults),
  };

  const recordPath = join(targetDir, 'certification-run-record.json');
  await writeFile(recordPath, `${JSON.stringify(runRecord, null, 2)}\n`, 'utf8');
  return recordPath;
}

main().catch((error) => {
  console.error(`\nCertification run errored: ${error.stack ?? error.message}`);
  process.exit(1);
});
