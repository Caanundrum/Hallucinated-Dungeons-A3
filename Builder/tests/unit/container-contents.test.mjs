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
