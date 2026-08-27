/**
 * Declaration-first Intent Intercept drafts.
 *
 * Players declare what their character does; the interpreter proposes a
 * confirmable command. The rules engine still owns all mechanical outcomes.
 */

/** Commands the NL interpreter may propose for confirmation. */
export const INTENT_DRAFT_COMMAND_TYPES = [
  'table.sync',
  'table.move',
  'table.open_door',
  'table.build_scene',
  'combat.attack',
  'combat.cast_spell',
  'inventory.use_item',
  'encounter.begin',
  'initiative.roll',
  'encounter.end',
  'combat.short_rest',
  'combat.long_rest',
] as const;
export type IntentDraftCommandType = (typeof INTENT_DRAFT_COMMAND_TYPES)[number];

export function isIntentDraftCommandType(value: unknown): value is IntentDraftCommandType {
  return (
    typeof value === 'string' &&
    (INTENT_DRAFT_COMMAND_TYPES as readonly string[]).includes(value)
  );
}

export function isRulesIntentDraftCommand(commandType: IntentDraftCommandType): boolean {
  return (
    commandType === 'combat.attack' ||
    commandType === 'combat.cast_spell' ||
    commandType === 'inventory.use_item' ||
    commandType === 'encounter.begin' ||
    commandType === 'initiative.roll' ||
    commandType === 'encounter.end' ||
    commandType === 'combat.short_rest' ||
    commandType === 'combat.long_rest'
  );
}

/** Framing tags for narration emphasis — never change HP, hit/miss, or damage. */
export const EPIC_FRAMING_TAGS = [
  'crit',
  'finishing_blow',
  'near_miss',
  'heroic_failure',
  'bold_stunt',
  'overkill',
] as const;
export type EpicFramingTag = (typeof EPIC_FRAMING_TAGS)[number];

export function deriveEpicFramingTags(
  mechanicsSummary: string,
  rolls: readonly number[] = [],
): readonly EpicFramingTag[] {
  const lower = mechanicsSummary.toLowerCase();
  const tags: EpicFramingTag[] = [];
  if (rolls.includes(20) || /\bcrit(?:ical)?\b/.test(lower)) {
    tags.push('crit');
  }
  if (
    /(?:to 0|drops? to 0|0 hit points|unconscious|defeated|kills?|slain|fallen)/.test(lower)
  ) {
    tags.push('finishing_blow');
  }
  if (/(?:overkill|excess damage|more than enough)/.test(lower)) {
    tags.push('overkill');
  }
  if (/(?:1 hit point|1 hp|barely standing|nearly fell|near miss)/.test(lower)) {
    tags.push('near_miss');
  }
  if (
    (/\bmiss(?:ed|es)?\b/.test(lower) || /\bfail(?:ed|ure)?\b/.test(lower)) &&
    (rolls.includes(1) || /\bnatural 1\b|\bfumble\b|\bbold\b|\bleap\b|\bgamble\b/.test(lower))
  ) {
    tags.push('heroic_failure');
  }
  if (/\bleap\b|\bwarhammer\b|\bcrash(?:es|ed)?\b|\bsplat\b|\bstunt\b/.test(lower)) {
    tags.push('bold_stunt');
  }
  return tags;
}

/**
 * Decide whether a persisted Intent Intercept draft may reopen after leave/rejoin.
 * Terminal states (failed/stale/cancelled/confirmed) must not return as actionable.
 */
export function parseRestorableIntentDraft(
  raw: string | null,
  campaignId: string,
): { readonly draft: Record<string, unknown>; readonly clearStored: boolean } | null {
  if (raw === null || raw.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.campaignId !== campaignId ||
      typeof parsed.draftId !== 'string' ||
      typeof parsed.proposedCommandType !== 'string' ||
      typeof parsed.summary !== 'string'
    ) {
      return { draft: {}, clearStored: true };
    }
    const state = parsed.interceptState;
    if (
      state === 'failed' ||
      state === 'stale' ||
      state === 'cancelled' ||
      state === 'confirmed'
    ) {
      return { draft: {}, clearStored: true };
    }
    if (state !== 'awaiting_confirmation' && state !== 'draft' && state !== undefined) {
      return { draft: {}, clearStored: true };
    }
    return {
      draft: {
        ...parsed,
        interceptState: 'awaiting_confirmation',
      },
      clearStored: false,
    };
  } catch {
    return { draft: {}, clearStored: true };
  }
}

/** Whether a live draft should be written to localStorage. */
export function shouldPersistIntentDraftState(interceptState: string): boolean {
  return (
    interceptState !== 'failed' &&
    interceptState !== 'stale' &&
    interceptState !== 'cancelled' &&
    interceptState !== 'confirmed'
  );
}
