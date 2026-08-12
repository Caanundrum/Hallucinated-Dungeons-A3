/**
 * Runtime-selected Working Directory resolution.
 *
 * Blueprint ownership: Sections 1.11.1 (runtime-selected Working Directory)
 * and 1.11.2 (role-owned local subtrees).
 *
 * No drive letter, user profile, IDE workspace, or vendor path is hard-coded.
 * `HD_WORKING_DIRECTORY` selects the root when the operator sets it; otherwise
 * the root is derived from the location of Builder Root itself, which keeps a
 * fresh clone working without configuration while still recording one resolved
 * absolute path in the Local Stack Manifest.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of Builder Root, derived from this file's own location. */
export const BUILDER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const ROLE_SUBTREES = /** @type {const} */ ([
  'Builder',
  'QA',
  'Runtime',
  'Evidence',
  'Checkpoints',
  'Pending-Archive',
]);

export class WorkspaceError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

/**
 * @typedef {object} WorkspacePaths
 * @property {string} workingDirectory
 * @property {string} builderRoot
 * @property {string} qaRoot
 * @property {string} runtimeRoot
 * @property {string} evidenceRoot
 * @property {string} checkpointRoot
 * @property {string} pendingArchiveRoot
 * @property {string | null} archiveDirectory
 * @property {'configured' | 'ARCHIVE_PENDING'} archiveStatus
 * @property {'environment' | 'derived_from_builder_root'} resolutionSource
 */

/**
 * Resolves the Working Directory and every role-owned subtree.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {WorkspacePaths}
 */
export function resolveWorkspace(env = process.env) {
  const configured = (env.HD_WORKING_DIRECTORY ?? '').trim();

  /** @type {string} */
  let workingDirectory;
  /** @type {'environment' | 'derived_from_builder_root'} */
  let resolutionSource;

  if (configured !== '') {
    if (!isAbsolute(configured)) {
      throw new WorkspaceError(
        `HD_WORKING_DIRECTORY must be an absolute path. Received "${configured}".`,
      );
    }
    workingDirectory = resolve(configured);
    resolutionSource = 'environment';
  } else {
    workingDirectory = resolve(BUILDER_ROOT, '..');
    resolutionSource = 'derived_from_builder_root';
  }

  const builderRoot = join(workingDirectory, 'Builder');
  if (resolve(builderRoot) !== resolve(BUILDER_ROOT)) {
    throw new WorkspaceError(
      `Builder Root must resolve to <WORKING_DIRECTORY>/Builder. The resolved Working Directory "${workingDirectory}" implies "${builderRoot}", but this source tree is at "${BUILDER_ROOT}". Set HD_WORKING_DIRECTORY to the parent directory of the Builder source tree.`,
    );
  }

  const archiveConfigured = (env.HD_ARCHIVE_DIRECTORY ?? '').trim();
  if (archiveConfigured !== '' && !isAbsolute(archiveConfigured)) {
    throw new WorkspaceError(
      `HD_ARCHIVE_DIRECTORY must be an absolute path when configured. Received "${archiveConfigured}".`,
    );
  }
  const archiveDirectory = archiveConfigured === '' ? null : resolve(archiveConfigured);
  if (archiveDirectory !== null && isInside(archiveDirectory, workingDirectory)) {
    throw new WorkspaceError(
      'HD_ARCHIVE_DIRECTORY must be configured separately from the Working Directory; active work may not execute from the archive.',
    );
  }

  return {
    workingDirectory,
    builderRoot,
    qaRoot: join(workingDirectory, 'QA'),
    runtimeRoot: join(workingDirectory, 'Runtime'),
    evidenceRoot: join(workingDirectory, 'Evidence'),
    checkpointRoot: join(workingDirectory, 'Checkpoints'),
    pendingArchiveRoot: join(workingDirectory, 'Pending-Archive'),
    archiveDirectory,
    archiveStatus: archiveDirectory === null ? 'ARCHIVE_PENDING' : 'configured',
    resolutionSource,
  };
}

/**
 * True when `candidate` is the same path as `parent` or lives beneath it.
 *
 * @param {string} candidate
 * @param {string} parent
 */
export function isInside(candidate, parent) {
  const normalizedCandidate = resolve(candidate);
  const normalizedParent = resolve(parent);
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(normalizedParent + sep)
  );
}

/**
 * Creates any missing role subtree and writes a sentinel that records which
 * role owns writes there. The sentinels make a cross-role write detectable
 * rather than a matter of trust.
 *
 * @param {WorkspacePaths} paths
 * @returns {Promise<string[]>} directories that were created or already present
 */
export async function ensureWorkspaceTree(paths) {
  /** @type {Array<{ dir: string, owner: string, purpose: string }>} */
  const subtrees = [
    {
      dir: paths.qaRoot,
      owner: 'QA',
      purpose: 'QA-owned findings, scenarios, retest history, and validation evidence.',
    },
    {
      dir: paths.runtimeRoot,
      owner: 'Builder',
      purpose: 'Materialized certification runtimes, emulator data, and local stack manifests.',
    },
    {
      dir: paths.evidenceRoot,
      owner: 'Builder',
      purpose: 'Certification run records and Builder verification evidence.',
    },
    {
      dir: paths.checkpointRoot,
      owner: 'Builder',
      purpose: 'Durable phase checkpoints, candidate manifests, and phase certificates.',
    },
    {
      dir: paths.pendingArchiveRoot,
      owner: 'Builder',
      purpose: 'Packaged phase archives awaiting an available Archive Directory.',
    },
  ];

  /** @type {string[]} */
  const touched = [];
  for (const subtree of subtrees) {
    await mkdir(subtree.dir, { recursive: true });
    const sentinelPath = join(subtree.dir, '.hd-root.json');
    if (!existsSync(sentinelPath)) {
      await writeFile(
        sentinelPath,
        `${JSON.stringify(
          {
            workingDirectory: paths.workingDirectory,
            writeOwner: subtree.owner,
            purpose: subtree.purpose,
            blueprintSection: '1.11.1 / 1.11.2',
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    }
    touched.push(subtree.dir);
  }
  return touched;
}
