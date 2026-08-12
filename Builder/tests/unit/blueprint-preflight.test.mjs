import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runBlueprintPreflight } from '../../tools/blueprint/preflight.mjs';
import { resolveWorkspace } from '../../tools/workspace/working-directory.mjs';

/** Lightweight Phase 0 blueprint preflight (Section 1.9 bootstrap exception). */

const workspace = resolveWorkspace({});

test('the authoritative blueprint passes preflight', async () => {
  const result = await runBlueprintPreflight(workspace.workingDirectory);
  assert.equal(result.ok, true, result.failures.join('; '));
  assert.equal(result.version, 'ALPHA_3_V1');
  assert.equal(result.sourceHash.length, 64);
  assert.ok(result.lineCount > 10_000);
});

test('a truncated blueprint fails preflight', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'hd-blueprint-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));

  const source = await readFile(
    join(workspace.workingDirectory, 'HALLUCINATED_DUNGEONS_ALPHA_3_MASTER_BLUEPRINT_V1.md'),
    'utf8',
  );
  await writeFile(
    join(scratch, 'HALLUCINATED_DUNGEONS_ALPHA_3_MASTER_BLUEPRINT_V1.md'),
    source.slice(0, 4000),
    'utf8',
  );

  const result = await runBlueprintPreflight(scratch);
  assert.equal(result.ok, false);
  assert.ok(
    result.failures.some((failure) => failure.includes('Required controlling heading is missing')),
    `expected a missing-heading failure, got: ${result.failures.join('; ')}`,
  );
});

test('a blueprint with merge markers fails preflight', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'hd-blueprint-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));

  const target = join(scratch, 'HALLUCINATED_DUNGEONS_ALPHA_3_MASTER_BLUEPRINT_V1.md');
  await copyFile(
    join(workspace.workingDirectory, 'HALLUCINATED_DUNGEONS_ALPHA_3_MASTER_BLUEPRINT_V1.md'),
    target,
  );
  const source = await readFile(target, 'utf8');
  await writeFile(target, `${source}\n<<<<<<< HEAD\nconflicting text\n`, 'utf8');

  const result = await runBlueprintPreflight(scratch);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes('merge conflict markers')));
});

test('a missing blueprint fails preflight', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'hd-blueprint-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));

  const result = await runBlueprintPreflight(scratch);
  assert.equal(result.ok, false);
  assert.match(result.failures[0], /No authoritative Master Blueprint/);
});
