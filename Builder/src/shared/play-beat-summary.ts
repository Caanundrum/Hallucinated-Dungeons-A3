/**
 * Past-tense play-beat copy after a confirmed table action.
 * Intent Intercept drafts say "Ready to… Confirm to…"; those must never land in
 * Story so far / Director narration after the action has already resolved.
 *
 * Prefer the resolved-action receipt narration seed when present — it is bound
 * to post-resolution door/object state and must not invent crossings.
 */

import type { ResolvedActionReceipt } from './resolved-action-receipt.js';
import { buildNarrationSeedFromReceipt } from './resolved-action-receipt.js';

export function isIntentDraftConfirmCopy(text: string): boolean {
  const trimmed = text.trim();
  return /^Ready to /i.test(trimmed) || /\bConfirm to\b/i.test(trimmed);
}

export function resolvedSummaryAfterTableConfirm(options: {
  readonly commandType: string;
  readonly draftSummary: string;
  readonly declaration?: string;
  readonly eventSummary?: string;
  readonly openCross?: boolean;
  readonly sceneTitle?: string;
  readonly receipt?: ResolvedActionReceipt | null;
  readonly namedDoorOpenAfter?: boolean;
  readonly targetLabel?: string;
}): string {
  if (
    options.receipt !== null &&
    options.receipt !== undefined &&
    options.receipt.narrationSeed.trim().length > 0
  ) {
    return options.receipt.narrationSeed.trim();
  }

  // When callers omit post-state, treat a successful open_door/openCross as open
  // (legacy Confirm path). Explicit false blocks crossing claims.
  const doorOpenKnown = options.namedDoorOpenAfter !== undefined;
  const namedDoorOpenAfter = doorOpenKnown
    ? options.namedDoorOpenAfter === true
    : options.commandType === 'table.open_door' || options.openCross === true;
  const targetLabel =
    typeof options.targetLabel === 'string' && options.targetLabel.trim().length > 0
      ? options.targetLabel.trim()
      : 'the wooden doorway';

  if (doorOpenKnown && (options.commandType === 'table.open_door' || options.openCross === true)) {
    return buildNarrationSeedFromReceipt({
      commandType: options.commandType,
      targetLabel,
      mutations: [],
      namedDoorOpenAfter,
      openCross: options.openCross === true && namedDoorOpenAfter,
      ...(options.sceneTitle !== undefined ? { sceneTitle: options.sceneTitle } : {}),
      ...(typeof options.eventSummary === 'string' &&
      options.eventSummary.trim().length > 0 &&
      !isIntentDraftConfirmCopy(options.eventSummary)
        ? { eventSummary: options.eventSummary }
        : {}),
    });
  }

  if (
    typeof options.eventSummary === 'string' &&
    options.eventSummary.trim().length > 0 &&
    !isIntentDraftConfirmCopy(options.eventSummary)
  ) {
    return options.eventSummary.trim();
  }
  const scene =
    options.sceneTitle !== undefined && options.sceneTitle.trim().length > 0
      ? options.sceneTitle.trim()
      : null;
  const inScene = scene !== null ? ` in ${scene}` : '';
  const sameSceneNote =
    scene !== null ? ` Same scene — ${scene} remains current; no location change.` : '';
  if (options.commandType === 'table.begin_adventure') {
    return scene !== null
      ? `The Game Director established ${scene} as the opening scene.`
      : 'The Game Director established the opening scene.';
  }
  if (options.commandType === 'table.travel_scene') {
    return scene !== null
      ? `The party arrives at ${scene}.`
      : 'The party traveled to a new scene.';
  }
  if (options.commandType === 'table.interact_object') {
    if (
      typeof options.eventSummary === 'string' &&
      options.eventSummary.trim().length > 0 &&
      !isIntentDraftConfirmCopy(options.eventSummary)
    ) {
      return options.eventSummary.trim();
    }
    return options.draftSummary.trim().length > 0 && !isIntentDraftConfirmCopy(options.draftSummary)
      ? options.draftSummary.trim()
      : `An object changed${inScene}.`;
  }
  if (options.openCross === true) {
    return `Opened the door and stepped through the doorway${inScene}.${sameSceneNote}`;
  }
  if (options.commandType === 'table.open_door') {
    return `Opened the door${inScene}.`;
  }
  const draftAndDeclaration = `${options.draftSummary} ${options.declaration ?? ''}`;
  if (options.commandType === 'table.move') {
    if (
      /\b(step(?:s|ped)?\s+through|open doorway|through the (?:open )?door|cross the doorway|step back through)\b/i.test(
        draftAndDeclaration,
      )
    ) {
      if (doorOpenKnown && !namedDoorOpenAfter) {
        return `Moved on the table toward the doorway${inScene}. The doorway remains closed — no crossing.`;
      }
      const reversing = /\bstep back through|back through\b/i.test(draftAndDeclaration);
      return reversing
        ? `Stepped back through the open doorway${inScene}.${sameSceneNote}`
        : `Stepped through the open doorway${inScene}.${sameSceneNote}`;
    }
    const event = options.eventSummary?.trim() ?? '';
    if (event.length > 0 && !isIntentDraftConfirmCopy(event)) {
      return event;
    }
    return 'Moved across the table.';
  }
  if (options.commandType === 'table.build_scene') {
    return 'Built the chamber doorway on the table.';
  }
  const event = options.eventSummary?.trim() ?? '';
  if (event.length > 0 && !isIntentDraftConfirmCopy(event)) {
    return event;
  }
  if (options.draftSummary.trim().length > 0 && !isIntentDraftConfirmCopy(options.draftSummary)) {
    return options.draftSummary.trim();
  }
  return 'Action committed on the table.';
}
