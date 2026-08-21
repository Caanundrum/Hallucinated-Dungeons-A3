import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRulesCatalog } from '../../dist/server/rules/rules-catalog.js';
import { RULES_CATALOG_CATEGORIES } from '../../dist/shared/rules-catalog-contract.js';

test('rules catalog lists SRD categories without claiming full prose books', () => {
  const catalog = buildRulesCatalog();
  assert.equal(catalog.rulesVersion.length > 0, true);
  assert.match(catalog.notice, /does not make rulings/i);
  assert.deepEqual(
    catalog.categories.map((category) => category.id),
    [...RULES_CATALOG_CATEGORIES],
  );
  assert.ok(catalog.entries.some((entry) => entry.entryId === 'core:progression.xp'));
  const xp = catalog.entries.find((entry) => entry.entryId === 'core:progression.xp');
  assert.ok(xp);
  assert.match(xp.details.join(' '), /Game Director awards XP/i);
  assert.equal(xp.details.some((line) => /server-validated/i.test(line)), false);
  assert.ok(catalog.entries.some((entry) => entry.category === 'spells'));
  assert.ok(catalog.entries.some((entry) => entry.category === 'skills'));
  assert.ok(catalog.entries.length > 40);
});
