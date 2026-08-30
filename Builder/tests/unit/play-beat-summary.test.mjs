import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isIntentDraftConfirmCopy,
  resolvedSummaryAfterTableConfirm,
} from '../../dist/shared/play-beat-summary.js';

test('isIntentDraftConfirmCopy detects Ready-to / Confirm-to intercept copy', () => {
  assert.equal(
    isIntentDraftConfirmCopy(
      'Ready to step through the open doorway in Quiet chamber. Confirm to commit the step.',
    ),
    true,
  );
  assert.equal(
    isIntentDraftConfirmCopy('Opened the door and stepped through the doorway.'),
    false,
  );
});

test('resolvedSummaryAfterTableConfirm never returns Confirm-to draft copy', () => {
  const openCross = resolvedSummaryAfterTableConfirm({
    commandType: 'table.open_door',
    draftSummary:
      'Ready to open the door beside you and step through. Confirm to open it and cross the doorway.',
    declaration: 'I open the unlocked doorway and step through.',
    openCross: true,
  });
  assert.equal(openCross, 'Opened the door and stepped through the doorway.');
  assert.equal(isIntentDraftConfirmCopy(openCross), false);

  const stepOnly = resolvedSummaryAfterTableConfirm({
    commandType: 'table.move',
    draftSummary:
      'Ready to step through the open doorway in Quiet chamber. Confirm to commit the step.',
    declaration: 'I step through the open doorway.',
    eventSummary:
      'Ready to step through the open doorway in Quiet chamber. Confirm to commit the step.',
  });
  assert.equal(stepOnly, 'Stepped through the open doorway.');
  assert.equal(isIntentDraftConfirmCopy(stepOnly), false);

  const openOnly = resolvedSummaryAfterTableConfirm({
    commandType: 'table.open_door',
    draftSummary: 'Ready to open the door beside you. Confirm to open it on the map.',
  });
  assert.equal(openOnly, 'Opened the door.');
});
