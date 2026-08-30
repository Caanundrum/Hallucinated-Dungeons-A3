/**
 * Past-tense play-beat copy after a confirmed table action.
 * Intent Intercept drafts say "Ready to… Confirm to…"; those must never land in
 * Story so far / Director narration after the action has already resolved.
 */

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
}): string {
  if (options.openCross === true) {
    return 'Opened the door and stepped through the doorway.';
  }
  if (options.commandType === 'table.open_door') {
    return 'Opened the door.';
  }
  const draftAndDeclaration = `${options.draftSummary} ${options.declaration ?? ''}`;
  if (options.commandType === 'table.move') {
    if (
      /\b(step(?:s|ped)?\s+through|open doorway|through the (?:open )?door|cross the doorway)\b/i.test(
        draftAndDeclaration,
      )
    ) {
      return 'Stepped through the open doorway.';
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
