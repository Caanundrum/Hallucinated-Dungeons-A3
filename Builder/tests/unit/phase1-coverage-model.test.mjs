import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { join } from 'node:path';

/**
 * The published Phase 1 coverage model must enumerate required sections and
 * point at real executable suites (C.AUTONOMY.10 / Section 1.12.9).
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const MODEL_PATH = join(ROOT, 'Checkpoints/phase-1/PHASE_1_COVERAGE_MODEL.md');

test('coverage model publishes dimensions, constraints, pairwise, risk, and residual gaps', async () => {
  const model = await readFile(MODEL_PATH, 'utf8');
  for (const heading of [
    '## 1. Finite dimensions',
    '## 2. Invalid constraints',
    '## 3. Exhaustive numeric boundaries',
    '## 4. Pairwise selection',
    '## 5. High-risk interactions',
    '## 6. Legal journey',
    '## 7. Restart, resume, ownership',
    '## 8. Residual gaps',
    '## 9. Execution binding',
  ]) {
    assert.match(model, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(model, /P1-PW-01/);
  assert.match(model, /P1-RK-01/);
  assert.match(model, /P1-RS-02/);
  assert.match(model, /BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION/);
});

test('coverage model case evidence files exist under Builder tests', async () => {
  const required = [
    'Builder/tests/e2e/phase1-reentry.spec.ts',
    'Builder/tests/e2e/phase1-campaigns.spec.ts',
    'Builder/tests/e2e/phase1-characters.spec.ts',
    'Builder/tests/e2e/phase1-settings-dock.spec.ts',
    'Builder/tests/e2e/smoke-spine.spec.ts',
    'Builder/tests/e2e/qa-regressions.spec.ts',
    'Builder/tests/unit/character-rules.test.mjs',
    'Builder/tests/unit/campaign-contract.test.mjs',
    'Builder/tests/unit/settings-communication-contract.test.mjs',
  ];
  for (const relative of required) {
    await access(join(ROOT, relative));
  }
});
