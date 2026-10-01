import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  answerContainerContentsQuery,
  containerLabelHintFromText,
} from '../../dist/shared/container-contents.js';

test('containerLabelHintFromText extracts satchel and crate labels', () => {
  assert.equal(containerLabelHintFromText('I inspect the courier satchel'), 'courier satchel');
  assert.equal(containerLabelHintFromText('I search the crates'), 'crates');
});

test('unauthored open container answers honestly without inventing loot', () => {
  const answer = answerContainerContentsQuery({
    containerLabel: 'courier satchel',
    view: { contents: null, discovery: 'visible', open: true },
  });
  assert.equal(answer.ok, true);
  assert.match(answer.body, /no contents are authored/i);
});

test('closed hidden container refuses invented peek', () => {
  const answer = answerContainerContentsQuery({
    containerLabel: 'freight crate',
    view: { contents: null, discovery: 'hidden', open: false },
  });
  assert.equal(answer.ok, false);
  assert.match(answer.body, /closed/i);
});

test('authored empty container reports empty', () => {
  const answer = answerContainerContentsQuery({
    containerLabel: 'crate',
    view: { contents: [], discovery: 'searched', open: true },
  });
  assert.match(answer.body, /empty/i);
});

test('take container prop does not invent contents take (VDM-005)', () => {
  const answer = answerContainerContentsQuery({
    containerLabel: 'courier satchel',
    view: { contents: null, discovery: 'visible', open: true },
    wantsTakeContainer: true,
  });
  assert.equal(answer.ok, true);
  assert.match(answer.body, /portable prop/i);
  assert.doesNotMatch(answer.body, /no contents are authored/i);
  assert.doesNotMatch(answer.body, /take .+ from/i);
  assert.match(answer.body, /Empty or not|irrelevant/i);
  assert.match(answer.body, /cannot yet commit|not wired|nothing is stowed/i);
  assert.doesNotMatch(answer.body, /\bConfirm\b/i);
});

test('take from container still uses contents rules (VDM-005)', () => {
  const answer = answerContainerContentsQuery({
    containerLabel: 'courier satchel',
    view: {
      contents: [{ itemId: 'letter-1', label: 'sealed letter' }],
      discovery: 'visible',
      open: true,
    },
    wantsTake: true,
  });
  assert.match(answer.body, /sealed letter/i);
  assert.match(answer.body, /from courier satchel/i);
});
