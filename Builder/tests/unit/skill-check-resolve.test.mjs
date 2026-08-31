import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildSkillCheckDraftSummary,
  resolveSkillAttemptFromSummary,
} from '../../dist/server/table/skill-check-resolve.js';

function stubSheet(options = {}) {
  return {
    skills: [
      {
        id: 'investigation',
        label: 'Investigation',
        ability: 'intelligence',
        proficient: false,
        bonus: { value: 2, components: [] },
      },
      {
        id: 'sleight-of-hand',
        label: 'Sleight of Hand',
        ability: 'dexterity',
        proficient: false,
        bonus: { value: 3, components: [] },
      },
    ],
    equipment: options.tools
      ? [{ name: "Thieves' Tools", quantity: 1 }]
      : [{ name: 'Longsword', quantity: 1 }],
    proficiencies: [],
    abilityModifiers: {
      strength: 1,
      dexterity: 3,
      constitution: 2,
      intelligence: 2,
      wisdom: 0,
      charisma: -1,
    },
  };
}

test('PQA-154: skill draft summary cites sheet modifiers and tool gap', () => {
  const summary = buildSkillCheckDraftSummary(
    stubSheet({ tools: false }),
    'I inspect the doorway for traps then pick the lock',
  );
  assert.match(summary, /^Ready to /i);
  assert.match(summary, /Investigation/);
  assert.match(summary, /Sleight of Hand/);
  assert.match(summary, /does not list Thieves/i);
  assert.match(summary, /Confirm to roll/i);
});

test('PQA-156: resolving Ready-to draft rolls checks and returns outcomes', () => {
  const draft = buildSkillCheckDraftSummary(
    stubSheet({ tools: true }),
    'I carefully check for traps and pick the lock',
  );
  const resolved = resolveSkillAttemptFromSummary(stubSheet({ tools: true }), draft);
  assert.ok(resolved);
  assert.match(resolved.summary, /Trap search/);
  assert.match(resolved.summary, /Lock attempt/);
  assert.match(resolved.summary, /d20/);
  assert.ok(resolved.rolls.length >= 1);
  assert.equal(typeof resolved.lockYielded, 'boolean');
});

test('FQA-003: resolved trap search names the wooden doorway from the draft', () => {
  const draft = buildSkillCheckDraftSummary(
    stubSheet({ tools: true }),
    'I inspect the wooden doorway east for traps without touching it.',
  );
  assert.match(draft, /wooden doorway east/i);
  const resolved = resolveSkillAttemptFromSummary(stubSheet({ tools: true }), draft);
  assert.ok(resolved);
  assert.match(resolved.summary, /Trap search on the wooden doorway east/i);
  assert.match(resolved.summary, /wooden doorway east/i);
  assert.doesNotMatch(resolved.summary, /confirmed target/i);
});

test('A1: unlocked-door language does not draft a lock attempt', () => {
  const summary = buildSkillCheckDraftSummary(
    stubSheet({ tools: true }),
    'Beyond the unlocked door I see mist.',
  );
  assert.doesNotMatch(summary, /Sleight of Hand|attempt the lock/i);
});

test('non-skill sync summaries do not resolve as checks', () => {
  assert.equal(
    resolveSkillAttemptFromSummary(stubSheet(), 'I heard your declaration.'),
    null,
  );
});
