/**
 * End-to-end play authority receipt.
 *
 * Confirm must produce one receipt that locks draft intent to engine mutations
 * and post-resolution state. Narration, map, and timeline must agree with it.
 */

export const RESOLVED_ACTION_RECEIPT_SCHEMA = 'play-authority-receipt-v1' as const;

export type ReceiptTargetKind = 'door' | 'object' | 'token_path' | 'scene' | 'none';

export interface ReceiptMutation {
  readonly kind: 'door' | 'object' | 'token' | 'scene';
  readonly id: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

export interface ResolvedActionReceipt {
  readonly schemaVersion: typeof RESOLVED_ACTION_RECEIPT_SCHEMA;
  readonly draftId: string | null;
  readonly commandType: string;
  readonly declaration: string | null;
  readonly target: {
    readonly kind: ReceiptTargetKind;
    readonly edgeId?: string;
    readonly objectId?: string;
    readonly label: string;
  };
  readonly mutations: readonly ReceiptMutation[];
  /** Door leaf states after this commit (edgeId → open|closed|…). */
  readonly doorStatesAfter: Readonly<Record<string, string>>;
  /** True when a door the receipt names is open after resolution. */
  readonly namedDoorOpenAfter: boolean;
  /** Canonical past-tense seed for Director narration — never draft "Ready to…". */
  readonly narrationSeed: string;
  readonly blockedReason: string | null;
}

/** Player said they are NOT opening the door (negation / exclusion). */
export function declarationNegatesDoorOpen(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return (
    /\b(?:do(?:es)?\s+not|don't|dont|without|never)\s+(?:open(?:ing)?|push(?:ing)?\s+open|swing(?:ing)?\s+open)\b/i.test(
      trimmed,
    ) ||
    /\bbut\s+i\s+(?:do\s+not|don't|dont)\s+open\b/i.test(trimmed) ||
    /\bwithout\s+(?:open(?:ing)?\s+)?(?:it|them|the\s+door)\b/i.test(trimmed)
  );
}

/**
 * "Open the wooden doorway" is door authority — must not fuzzy-match prop labels
 * like "Wood pile" via substring wood⊂wooden.
 */
export function declarationIsDoorOpenOrPassage(text: string): boolean {
  if (declarationNegatesDoorOpen(text)) {
    return false;
  }
  const withoutOpenNoun = text.replace(
    /\bopen(?:ed)?\s+(?:wooden\s+)?(?:door|doorway|gate|entry(?:way)?)s?\b/gi,
    'doorway',
  );
  const openVerb =
    /\b(?:opens?|opening|push(?:es|ing)?|swings?|swinging)\b/i.test(withoutOpenNoun) &&
    /\b(?:door|doorway|gate|entry(?:way)?)\b/i.test(withoutOpenNoun);
  const passage =
    /\b(?:door|doorway|gate|entryway)\b/i.test(text) &&
    /\b(?:enter(?:s|ing)?|steps?|stepping|through|beyond)\b/i.test(text);
  return openVerb || passage;
}

/** Word-boundary label match — never treat "wooden" as a hit for label word "wood". */
export function declarationMentionsLabelWord(declaration: string, labelWord: string): boolean {
  const word = labelWord.toLowerCase().replace(/[^a-z0-9']/g, '');
  if (word.length < 4) {
    return false;
  }
  const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return pattern.test(declaration);
}

export function buildNarrationSeedFromReceipt(options: {
  readonly commandType: string;
  readonly targetLabel: string;
  readonly mutations: readonly ReceiptMutation[];
  readonly namedDoorOpenAfter: boolean;
  readonly openCross: boolean;
  readonly sceneTitle?: string;
  readonly eventSummary?: string;
  readonly blockedReason?: string | null;
}): string {
  const scene =
    options.sceneTitle !== undefined && options.sceneTitle.trim().length > 0
      ? options.sceneTitle.trim()
      : null;
  const inScene = scene !== null ? ` in ${scene}` : '';
  const sameScene =
    scene !== null ? ` Same scene — ${scene} remains current; no location change.` : '';

  if (
    typeof options.blockedReason === 'string' &&
    options.blockedReason.trim().length > 0
  ) {
    return options.blockedReason.trim();
  }

  if (
    typeof options.eventSummary === 'string' &&
    options.eventSummary.trim().length > 0 &&
    !/^Ready to /i.test(options.eventSummary) &&
    !/\bConfirm to\b/i.test(options.eventSummary)
  ) {
    return options.eventSummary.trim();
  }

  if (options.commandType === 'table.open_door') {
    if (options.openCross && options.namedDoorOpenAfter) {
      return `Opened ${options.targetLabel} and stepped through the doorway${inScene}.${sameScene}`;
    }
    if (!options.namedDoorOpenAfter) {
      return `Tried to open ${options.targetLabel}${inScene}, but the doorway is not open on the table.`;
    }
    return `Opened ${options.targetLabel}${inScene}. The doorway is now open.`;
  }

  if (options.commandType === 'table.move') {
    if (options.openCross && options.namedDoorOpenAfter) {
      return `Stepped through the open doorway (${options.targetLabel})${inScene}.${sameScene}`;
    }
    // Never claim crossing when the door is still closed.
    if (
      /\bdoor|doorway\b/i.test(options.targetLabel) &&
      !options.namedDoorOpenAfter
    ) {
      return `Moved on the table toward ${options.targetLabel}${inScene}. The doorway remains closed — no crossing.`;
    }
    return `Moved across the table${inScene}.`;
  }

  if (options.commandType === 'table.interact_object') {
    const mutation = options.mutations.find((entry) => entry.kind === 'object');
    if (mutation !== undefined) {
      return `At the table, ${mutation.label} changed from ${mutation.from} to ${mutation.to}${inScene}.`;
    }
    return `An object changed${inScene}.`;
  }

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

  if (options.commandType === 'table.build_scene') {
    return 'Built the chamber doorway on the table.';
  }

  return 'Action committed on the table.';
}

/** Assemble one receipt that Confirm, narration, and map must agree on. */
export function buildResolvedActionReceipt(options: {
  readonly draftId?: string | null;
  readonly commandType: string;
  readonly declaration?: string | null;
  readonly edgeId?: string;
  readonly objectId?: string;
  readonly targetLabel: string;
  readonly targetKind: ReceiptTargetKind;
  readonly mutations?: readonly ReceiptMutation[];
  readonly doorStatesAfter: Readonly<Record<string, string>>;
  readonly openCross?: boolean;
  readonly sceneTitle?: string;
  readonly eventSummary?: string;
  readonly blockedReason?: string | null;
}): ResolvedActionReceipt {
  const mutations = options.mutations ?? [];
  const namedDoorOpenAfter =
    options.edgeId !== undefined
      ? options.doorStatesAfter[options.edgeId] === 'open'
      : Object.values(options.doorStatesAfter).some((state) => state === 'open') &&
        options.targetKind === 'door';
  const narrationSeed = buildNarrationSeedFromReceipt({
    commandType: options.commandType,
    targetLabel: options.targetLabel,
    mutations,
    namedDoorOpenAfter:
      options.edgeId !== undefined
        ? options.doorStatesAfter[options.edgeId] === 'open'
        : namedDoorOpenAfter,
    openCross: options.openCross === true,
    ...(options.sceneTitle !== undefined ? { sceneTitle: options.sceneTitle } : {}),
    ...(options.eventSummary !== undefined ? { eventSummary: options.eventSummary } : {}),
    ...(options.blockedReason !== undefined
      ? { blockedReason: options.blockedReason }
      : {}),
  });
  return {
    schemaVersion: RESOLVED_ACTION_RECEIPT_SCHEMA,
    draftId: options.draftId ?? null,
    commandType: options.commandType,
    declaration:
      typeof options.declaration === 'string' && options.declaration.trim().length > 0
        ? options.declaration.trim().slice(0, 500)
        : null,
    target: {
      kind: options.targetKind,
      label: options.targetLabel,
      ...(options.edgeId !== undefined ? { edgeId: options.edgeId } : {}),
      ...(options.objectId !== undefined ? { objectId: options.objectId } : {}),
    },
    mutations,
    doorStatesAfter: { ...options.doorStatesAfter },
    namedDoorOpenAfter:
      options.edgeId !== undefined
        ? options.doorStatesAfter[options.edgeId] === 'open'
        : false,
    narrationSeed,
    blockedReason: options.blockedReason ?? null,
  };
}
