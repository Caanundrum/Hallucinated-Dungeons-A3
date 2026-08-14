/**
 * Content-addressed candidate identity.
 *
 * Blueprint ownership: Sections 1.11.9 (Frozen Local Certification Mode
 * requires "a content-addressed candidate") and 1.12.10 (evidence binds to the
 * candidate it names).
 *
 * The candidate hash covers exactly the tracked Builder Root source, the
 * dependency lock, and the security rules. QA, Runtime, Evidence, Checkpoint,
 * and archive artifacts are evidence *about* a candidate and are excluded, as
 * Section 1.11.1 requires.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';

import { BUILDER_ROOT } from '../workspace/working-directory.mjs';

const execFileAsync = promisify(execFile);

/**
 * @typedef {object} CandidateIdentity
 * @property {string} candidateId       Short content address, e.g. "cand-1a2b3c4d5e6f".
 * @property {string} sourceTreeHash    Full SHA-256 over tracked Builder Root source.
 * @property {string} commit            HEAD commit of the repository.
 * @property {boolean} clean            True when Builder Root has no uncommitted change.
 * @property {string[]} dirtyPaths      Uncommitted Builder Root paths, if any.
 * @property {number} fileCount         Number of tracked files covered by the hash.
 * @property {string} dependencyLockHash SHA-256 of package-lock.json.
 * @property {string} rulesHash         SHA-256 of firestore.rules.
 */

/**
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function git(args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: BUILDER_ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

/**
 * @param {string} absolutePath
 * @returns {Promise<string>}
 */
export async function hashFile(absolutePath) {
  const contents = await readFile(absolutePath);
  return createHash('sha256').update(contents).digest('hex');
}

/**
 * Computes the identity of the current Builder Root source state.
 *
 * @returns {Promise<CandidateIdentity>}
 */
export async function computeCandidateIdentity() {
  // `ls-files -s` yields mode, blob object id, stage, and path for every
  // tracked file, so the digest changes whenever any tracked byte changes.
  const listing = await git(['ls-files', '-s', '--', '.']);
  const entries = listing
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [meta, path] = line.split('\t');
      const [mode, objectId] = meta.split(' ');
      return { mode, objectId, path };
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const digest = createHash('sha256');
  digest.update('hallucinated-dungeons-alpha3-candidate-v1\n');
  for (const entry of entries) {
    digest.update(`${entry.mode} ${entry.objectId} ${entry.path}\n`);
  }
  const sourceTreeHash = digest.digest('hex');

  const status = await git(['status', '--porcelain', '--', '.']);
  const dirtyPaths = status
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.slice(line.indexOf(' ') + 1).trim());

  const commit = (await git(['rev-parse', 'HEAD'])).trim();

  return {
    candidateId: `cand-${sourceTreeHash.slice(0, 12)}`,
    sourceTreeHash,
    commit,
    clean: dirtyPaths.length === 0,
    dirtyPaths,
    fileCount: entries.length,
    dependencyLockHash: await hashFile(`${BUILDER_ROOT}/package-lock.json`),
    rulesHash: await hashFile(`${BUILDER_ROOT}/firestore.rules`),
  };
}

/**
 * Lists tracked Builder Root files relative to Builder Root. Used when
 * materializing a frozen runtime so only candidate source is copied.
 *
 * Frozen materialized candidates are not a git work tree, so when `git
 * ls-files` returns nothing we walk the on-disk source tree instead.
 *
 * @returns {Promise<string[]>}
 */
export async function listTrackedFiles() {
  const listing = await git(['ls-files', '--', '.']);
  const fromGit = listing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => relative('.', line));
  if (fromGit.length > 0) {
    return fromGit;
  }
  return walkFiles(BUILDER_ROOT, BUILDER_ROOT);
}

/**
 * @param {string} root
 * @param {string} current
 * @returns {Promise<string[]>}
 */
async function walkFiles(root, current) {
  const entries = await readdir(current, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'test-results') {
      continue;
    }
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, absolute)));
      continue;
    }
    if (entry.isFile()) {
      files.push(relative(root, absolute));
    }
  }
  return files.sort();
}
