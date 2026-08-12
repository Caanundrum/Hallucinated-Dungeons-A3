import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  BUILDER_ROOT,
  ensureWorkspaceTree,
  isInside,
  resolveWorkspace,
} from '../../tools/workspace/working-directory.mjs';

/** Role-owned subtree resolution (Sections 1.11.1, 1.11.2, appendix C.ARENA.2). */

function expectWorkspaceError(env, fragment) {
  assert.throws(
    () => resolveWorkspace(env),
    (error) => {
      assert.equal(error.name, 'WorkspaceError');
      assert.match(error.message, fragment);
      return true;
    },
  );
}

test('every role root resolves beneath the working directory', () => {
  const paths = resolveWorkspace({});
  assert.equal(paths.builderRoot, resolve(BUILDER_ROOT));
  for (const root of [
    paths.builderRoot,
    paths.qaRoot,
    paths.runtimeRoot,
    paths.evidenceRoot,
    paths.checkpointRoot,
    paths.pendingArchiveRoot,
  ]) {
    assert.equal(isInside(root, paths.workingDirectory), true, `${root} escaped the root`);
  }
});

test('the working directory defaults to the parent of Builder Root', () => {
  const paths = resolveWorkspace({});
  assert.equal(paths.resolutionSource, 'derived_from_builder_root');
  assert.equal(paths.workingDirectory, resolve(BUILDER_ROOT, '..'));
});

test('an explicit working directory is honored when it contains Builder Root', () => {
  const paths = resolveWorkspace({ HD_WORKING_DIRECTORY: resolve(BUILDER_ROOT, '..') });
  assert.equal(paths.resolutionSource, 'environment');
  assert.equal(paths.builderRoot, resolve(BUILDER_ROOT));
});

test('a working directory that does not contain this Builder Root is refused', () => {
  expectWorkspaceError(
    { HD_WORKING_DIRECTORY: '/some/other/place' },
    /Builder Root must resolve to <WORKING_DIRECTORY>\/Builder/,
  );
});

test('a relative working directory is refused', () => {
  expectWorkspaceError({ HD_WORKING_DIRECTORY: '../elsewhere' }, /must be an absolute path/);
});

test('an archive directory inside the working directory is refused', () => {
  expectWorkspaceError(
    { HD_ARCHIVE_DIRECTORY: join(resolve(BUILDER_ROOT, '..'), 'Archive') },
    /configured separately from the Working Directory/,
  );
});

test('the archive status is ARCHIVE_PENDING when none is configured', () => {
  const paths = resolveWorkspace({});
  assert.equal(paths.archiveDirectory, null);
  assert.equal(paths.archiveStatus, 'ARCHIVE_PENDING');
});

test('each created subtree records the role that owns writes there', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'hd-workspace-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));

  const paths = {
    workingDirectory: scratch,
    builderRoot: join(scratch, 'Builder'),
    qaRoot: join(scratch, 'QA'),
    runtimeRoot: join(scratch, 'Runtime'),
    evidenceRoot: join(scratch, 'Evidence'),
    checkpointRoot: join(scratch, 'Checkpoints'),
    pendingArchiveRoot: join(scratch, 'Pending-Archive'),
    archiveDirectory: null,
    archiveStatus: 'ARCHIVE_PENDING',
    resolutionSource: 'environment',
  };

  await ensureWorkspaceTree(paths);

  const qaSentinel = JSON.parse(await readFile(join(paths.qaRoot, '.hd-root.json'), 'utf8'));
  assert.equal(qaSentinel.writeOwner, 'QA');

  const evidenceSentinel = JSON.parse(
    await readFile(join(paths.evidenceRoot, '.hd-root.json'), 'utf8'),
  );
  assert.equal(evidenceSentinel.writeOwner, 'Builder');
});
