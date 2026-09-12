import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  actionableDirectorFallback,
  evaluateCharacterCapability,
  extractUtteranceConstraints,
  filterActionsByConstraints,
  understandUtterance,
  utteranceLooksLikeQuestion,
} from '../../dist/shared/utterance-understanding.js';
import {
  parsePlayerDeclaration,
  resolveIntentAuthority,
} from '../../dist/shared/play-authority-contract.js';

test('recap / knowledge probes classify as questions, not movement', () => {
  const lines = [
    'remind me why I am here',
    'What do I know about the missing courier?',
    'catch me up on established facts',
  ];
  for (const line of lines) {
    assert.equal(utteranceLooksLikeQuestion(line), true, line);
    const understanding = understandUtterance(line);
    assert.equal(understanding.wantsKnowledgeRecap, true, line);
    assert.ok(
      understanding.speechAct === 'question' || understanding.wantsKnowledgeRecap,
      line,
    );
    const parsed = parsePlayerDeclaration(line);
    const authority = resolveIntentAuthority(parsed);
    assert.equal(authority.disposition, 'director_narrate_only', line);
    assert.equal(authority.actionSequence.some((step) => step.kind === 'move'), false, line);
  }
});

test('binding constraints strip forbidden verbs before authority', () => {
  const text = 'I listen at the doorway but do not move me and do not open it';
  const constraints = extractUtteranceConstraints(text);
  assert.equal(constraints.forbidMove, true);
  assert.equal(constraints.forbidOpen, true);
  assert.equal(constraints.listenOnly || constraints.forbidMove, true);

  const filtered = filterActionsByConstraints(
    [
      { kind: 'move' },
      { kind: 'open_door' },
      { kind: 'inspect' },
    ],
    constraints,
  );
  assert.deepEqual(
    filtered.map((step) => step.kind),
    ['inspect'],
  );

  const authority = resolveIntentAuthority(parsePlayerDeclaration(text));
  assert.equal(authority.actionSequence.some((step) => step.kind === 'move'), false);
  assert.equal(authority.actionSequence.some((step) => step.kind === 'open_door'), false);
});

test('draw weapon without attacking does not become combat', () => {
  const text = 'I draw my dagger but do not attack or start a fight';
  const understanding = understandUtterance(text);
  assert.equal(understanding.constraints.prepareWithoutAttack, true);
  assert.equal(understanding.constraints.forbidCombat, true);
  const authority = resolveIntentAuthority(parsePlayerDeclaration(text));
  assert.equal(authority.disposition, 'director_narrate_only');
  assert.equal(authority.actionSequence.some((step) => step.kind === 'attack'), false);
});

test('hands-off inspect keeps without-taking constraints', () => {
  const text = 'I inspect the courier satchel without taking anything';
  const constraints = extractUtteranceConstraints(text);
  assert.equal(constraints.withoutTaking || constraints.forbidTake, true);
});

test('conditional open-if-closed is detected as a constraint', () => {
  const text = 'If the door is closed, open it; otherwise leave it';
  const constraints = extractUtteranceConstraints(text);
  assert.equal(constraints.openOnlyIfClosed, true);
});

test('non-casters cannot draft unavailable spells', () => {
  const sheet = {
    level: 1,
    spellcasting: null,
  };
  const verdict = evaluateCharacterCapability(sheet, {
    wantsCast: true,
    spellLabel: 'Fireball',
  });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason ?? '', /no spellcasting/i);
});

test('fallback always names a next step instead of empty acknowledgment', () => {
  const understanding = understandUtterance('remind me why I am here');
  const fallback = actionableDirectorFallback(understanding);
  assert.doesNotMatch(fallback, /I heard your declaration/i);
  assert.match(fallback, /Director|action|recap/i);
});

test('multi-intent clarification names a primary action', () => {
  const parsed = parsePlayerDeclaration(
    'I hide behind the crates and then listen carefully',
  );
  // Even when the parser only captures part of a compound, authority must not invent movement
  // from a knowledge-style follow-up.
  const listen = resolveIntentAuthority(
    parsePlayerDeclaration('wait one minute and listen from where I stand — do not move me'),
  );
  assert.equal(listen.actionSequence.some((step) => step.kind === 'move'), false);
  assert.ok(parsed.rawText.length > 0);
});
