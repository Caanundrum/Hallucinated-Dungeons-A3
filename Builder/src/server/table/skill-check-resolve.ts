/**
 * Resolve exploration skill attempts committed via table.sync (PQA-152–156).
 */

import type { DerivedCharacterSheet } from '../../shared/character-contract.js';
import type { SkillCheckIntent } from '../../shared/intent-draft-contract.js';
import { textRequestsLockPicking } from '../../shared/play-authority-contract.js';
import { rollD20 } from '../rules/engine/dice.js';

export interface SkillAttemptResolution {
  readonly summary: string;
  readonly rolls: readonly number[];
  /** True when a lock attempt was rolled and succeeded (A2 → map unlock). */
  readonly lockYielded: boolean;
  /** True when the primary check succeeded against its DC. */
  readonly succeeded?: boolean;
  /** Structured intent when resolved via a typed SkillCheckIntent payload. */
  readonly intent?: SkillCheckIntent;
}

const DEFAULT_TRAP_DC = 13;
const DEFAULT_LOCK_DC = 15;

function skillBonus(sheet: DerivedCharacterSheet, skillId: string): {
  readonly label: string;
  readonly bonus: number;
  readonly proficient: boolean;
} {
  const skill = sheet.skills.find((entry) => entry.id === skillId);
  if (skill !== undefined) {
    return { label: skill.label, bonus: skill.bonus.value, proficient: skill.proficient };
  }
  const ability =
    skillId === 'sleight-of-hand' || skillId === 'stealth'
      ? 'dexterity'
      : skillId === 'investigation' || skillId === 'perception'
        ? skillId === 'perception'
          ? 'wisdom'
          : 'intelligence'
        : 'dexterity';
  return {
    label: skillId,
    bonus: sheet.abilityModifiers[ability],
    proficient: false,
  };
}

function hasThievesTools(sheet: DerivedCharacterSheet): boolean {
  const haystack = [
    ...(sheet.equipment ?? []).map((item) => item.name),
    ...(sheet.proficiencies ?? []).map((entry) => entry.label),
  ]
    .join(' ')
    .toLowerCase();
  return /thieves'?(\s*tools)?/.test(haystack);
}

/** Build the confirmable draft summary for trap/lock declarations (PQA-152–154). */
export function buildSkillCheckDraftSummary(
  sheet: DerivedCharacterSheet | null,
  text: string,
  options: {
    readonly candidateLabels?: readonly string[];
  } = {},
): string {
  const wantsStealth = /\b(?:hide|hiding|conceal|take\s+cover|stealth|crouch\s+behind|duck\s+behind|sneak(?:s|ing)?|slip(?:s|ping)?)\b/i.test(text);
  const wantsSearch = /\bsearch(?:es|ing)?\b/i.test(text);
  const wantsTrap = /(trap|disarm)/.test(text);
  // "pick up" is inventory — never force a lock draft (VDM-005).
  const wantsLock =
    !/\bpick(?:ing|ed)?\s+up\b/i.test(text) &&
    (textRequestsLockPicking(text) ||
      (/\block\b/.test(text) && !/\bunlocked\b/.test(text)));
  // Broad room surveys are Director perception — never "Which feature…".
  const broadSurvey =
    /\b(?:survey|look\s+around|peer\s+around|look\s+and\s+listen)\b/i.test(text) ||
    (/\b(?:examin(?:e|es|ing)|search(?:es|ing)?|investigat(?:e|es|ing)|inspect(?:s|ing)?)\b/i.test(
      text,
    ) &&
      /\b(?:chamber|room|scene|surroundings|area|here)\b/i.test(text) &&
      !/\b(?:door|doorway|gate|lock|lamp|bench|workbench|crate|counter|trap|mark)\b/i.test(text) &&
      !wantsTrap &&
      !wantsLock &&
      !wantsStealth);
  if (broadSurvey) {
    return 'You look and listen across the scene — the Game Director narrates what is perceptible. Name a single feature only if you want a focused Investigation roll.';
  }
  const ambiguousTarget =
    /\b(most suspicious|anything unusual|something suspicious|visible feature|the area|this area|the room|the chamber)\b/i.test(
      text,
    ) && !/\b(door|doorway|gate|lock|lamp|bench|workbench|crate|counter|trap|mark)\b/i.test(text);
  const candidates = options.candidateLabels ?? [];
  // Only force a feature pick when the player asked for a focused roll without a target.
  if (
    (wantsTrap || wantsLock) &&
    (ambiguousTarget || (candidates.length > 1 && !/\b(door|doorway|gate|lock)\b/i.test(text)))
  ) {
    const list =
      candidates.length > 0
        ? candidates.slice(0, 6).join('; ')
        : 'name the doorway, prop, or square you mean';
    return `Which feature are you examining? Choose one before the table prepares a roll: ${list}.`;
  }

  const namedTarget = (() => {
    const eastWest = text.match(
      /\b(?:the\s+)?(?:wooden\s+)?door(?:way)?(?:\s+(?:to\s+the\s+)?(east|west|north|south))?\b/i,
    );
    if (eastWest !== null) {
      const facing = eastWest[1]?.toLowerCase();
      return facing !== undefined ? `wooden doorway ${facing}` : 'wooden doorway';
    }
    const sanitized = text.replace(/[.,;!?]+$/, '');
    if (wantsStealth) {
      const hideBehind = sanitized.match(
        /\b(?:behind|near|under|by|in|past|around)\s+(?:the\s+)?([a-zA-Z0-9_\s'-]+?)(?:\s+(?:and|to|while|for|without)\b|[.,;!?]|$)/i,
      );
      if (hideBehind !== null && hideBehind[1]?.trim()) {
        const candidate = hideBehind[1].trim();
        if (/^shadows$/i.test(candidate)) {
          return 'the shadows';
        }
        if (!/^(?:me|myself|it|them|here)$/i.test(candidate)) {
          return candidate;
        }
      }
    }
    const approachTarget = sanitized.match(
      /\b(?:approach(?:es|ing)?|head(?:s|ing)?\s+to|move\s+to|walk\s+to)\s+(?:the\s+)?([a-zA-Z0-9_\s'-]+?)(?:\s+(?:to|and|for)\b|[.,;!?]|$)/i,
    );
    if (approachTarget !== null && approachTarget[1]?.trim()) {
      const candidate = approachTarget[1].trim();
      if (!/^(?:me|myself|it|them|here|closer|door|doorway)$/i.test(candidate)) {
        return candidate;
      }
    }
    const actionTarget = sanitized.match(
      /\b(?:investigat(?:e|es|ing)?|search(?:es|ing)?|inspect(?:s|ing)?|examin(?:e|es|ing)?|check(?:s|ing)?(?:\s+beneath|\s+under)?)\s+(?:the\s+)?([a-zA-Z0-9_\s'-]+?)(?:\s+(?:for|using|with|to|and|without)\b|[.,;!?]|$)/i,
    );
    if (actionTarget !== null && actionTarget[1]?.trim()) {
      const candidate = actionTarget[1].trim();
      if (
        !/^(?:area|room|chamber|here|surroundings)$/i.test(candidate) &&
        !/^(?:its|their|his|her|it|them)\b/i.test(candidate)
      ) {
        return candidate;
      }
    }
    const strippedPassiveAgent = sanitized.replace(
      /\b(?:left|made|dropped|hidden|written|sent|carried)\s+by\s+(?:the\s+)?[a-zA-Z0-9_\s'-]+$/i,
      '',
    );
    const hideBehind = strippedPassiveAgent.match(
      /\b(?:behind|near|under|by|in|past|around)\s+(?:the\s+)?([a-zA-Z0-9_\s'-]+?)(?:\s+(?:and|to|while|for|without)\b|[.,;!?]|$)/i,
    );
    if (hideBehind !== null && hideBehind[1]?.trim()) {
      const candidate = hideBehind[1].trim();
      if (/^shadows$/i.test(candidate)) {
        return 'the shadows';
      }
      if (!/^(?:me|myself|it|them|here)$/i.test(candidate)) {
        return candidate;
      }
    }
    return 'named target';
  })();

  if (sheet === null) {
    if (wantsStealth) {
      return 'Ready to hide. Confirm to roll the Stealth check on the table.';
    }
    return wantsTrap
      ? 'Ready to search the doorway for traps, then attempt the lock if it looks safe. Confirm to roll the checks on the table.'
      : 'Ready to attempt the lock or inspection. Confirm to roll the check on the table.';
  }

  if (wantsStealth) {
    const stealth = skillBonus(sheet, 'stealth');
    const targetPhrase = namedTarget === 'named target' ? 'the shadows' : namedTarget;
    const verb = /\bsneak/i.test(text) ? 'sneak past' : 'hide behind';
    const targetWithArticle = targetPhrase.startsWith('the ') ? targetPhrase : `the ${targetPhrase}`;
    return `Ready to ${verb} ${targetWithArticle} (Stealth ${stealth.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(stealth.bonus)}; DC 12). Confirm to roll the check on the table.`;
  }

  const investigation = skillBonus(sheet, 'investigation');
  const sleight = skillBonus(sheet, 'sleight-of-hand');
  const tools = hasThievesTools(sheet);
  const toolNote = tools
    ? 'Thieves’ Tools are on your sheet.'
    : 'Your sheet does not list Thieves’ Tools — the lock attempt uses Sleight of Hand without tool proficiency.';

  if (wantsTrap && wantsLock) {
    return [
      `Ready to search the ${namedTarget} for traps (Investigation ${investigation.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(investigation.bonus)}; DC ${DEFAULT_TRAP_DC})`,
      `then attempt the lock (Sleight of Hand ${sleight.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(sleight.bonus)}; DC ${DEFAULT_LOCK_DC}).`,
      toolNote,
      'Confirm to roll both checks on the table. Narration will stay on that target only.',
    ].join(' ');
  }
  if (wantsLock) {
    return [
      `Ready to attempt the lock (Sleight of Hand ${sleight.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(sleight.bonus)}; DC ${DEFAULT_LOCK_DC}).`,
      toolNote,
      'Confirm to roll the check on the table.',
    ].join(' ');
  }
  if (wantsSearch) {
    return [
      `Ready to search the ${namedTarget} (Investigation ${investigation.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(investigation.bonus)}; DC ${DEFAULT_TRAP_DC}).`,
      'Confirm to roll the check on the table. Narration will stay on that target only.',
    ].join(' ');
  }
  if (wantsTrap) {
    return [
      `Ready to search the ${namedTarget} for traps (Investigation ${investigation.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(investigation.bonus)}; DC ${DEFAULT_TRAP_DC}).`,
      'Confirm to roll the check on the table. Narration will stay on that target only.',
    ].join(' ');
  }
  return [
    `Ready to inspect the ${namedTarget} (Investigation ${investigation.proficient ? 'proficient' : 'not proficient'}, ${formatBonus(investigation.bonus)}; DC ${DEFAULT_TRAP_DC}).`,
    'Confirm to roll the check on the table. Narration will stay on that target only.',
  ].join(' ');
}

function formatBonus(bonus: number): string {
  return bonus >= 0 ? `+${bonus}` : `${bonus}`;
}

/** Pull the named inspect target from a Ready-to draft summary (FQA-003). */
export function namedInspectTargetFromDraft(draftSummary: string): string {
  const hide = /Ready to (?:hide behind|sneak past|hide in)\s+(?:the\s+)?(.+?)\s*\(/i.exec(draftSummary);
  if (hide?.[1]?.trim()) {
    return hide[1].trim().replace(/\s+/g, ' ');
  }
  const attempt = /Ready to attempt\s+(?:the\s+)?(.+?)\s*\(/i.exec(draftSummary);
  if (attempt?.[1]?.trim()) {
    return attempt[1].trim().replace(/\s+/g, ' ');
  }
  const inspect =
    /Ready to (?:inspect|search)\s+(?:the\s+)?(.+?)(?:\s+for traps)?\s*\(/i.exec(draftSummary) ??
    /Ready to (?:inspect|search)\s+(?:the\s+)?(.+?)(?:\s+for traps)?(?:\.|,|$)/i.exec(draftSummary);
  const raw = inspect?.[1]?.trim();
  if (raw !== undefined && raw.length > 0 && !/^named target$/i.test(raw)) {
    return raw.replace(/\s+/g, ' ');
  }
  const door = draftSummary.match(
    /\b(?:the\s+)?(?:wooden\s+)?door(?:way)?(?:\s+(?:to\s+the\s+)?(east|west|north|south))?\b/i,
  );
  if (door !== null) {
    const facing = door[1]?.toLowerCase();
    return facing !== undefined ? `wooden doorway ${facing}` : 'wooden doorway';
  }
  return 'confirmed target';
}

const DISPATCHED_SKILL_MAP: Readonly<Record<string, { readonly id: string; readonly label: string }>> = {
  acrobatics: { id: 'acrobatics', label: 'Acrobatics' },
  'animal handling': { id: 'animal-handling', label: 'Animal Handling' },
  'animal-handling': { id: 'animal-handling', label: 'Animal Handling' },
  arcana: { id: 'arcana', label: 'Arcana' },
  athletics: { id: 'athletics', label: 'Athletics' },
  deception: { id: 'deception', label: 'Deception' },
  history: { id: 'history', label: 'History' },
  insight: { id: 'insight', label: 'Insight' },
  intimidation: { id: 'intimidation', label: 'Intimidation' },
  investigation: { id: 'investigation', label: 'Investigation' },
  medicine: { id: 'medicine', label: 'Medicine' },
  nature: { id: 'nature', label: 'Nature' },
  perception: { id: 'perception', label: 'Perception' },
  performance: { id: 'performance', label: 'Performance' },
  persuasion: { id: 'persuasion', label: 'Persuasion' },
  religion: { id: 'religion', label: 'Religion' },
  'sleight of hand': { id: 'sleight-of-hand', label: 'Sleight of Hand' },
  'sleight-of-hand': { id: 'sleight-of-hand', label: 'Sleight of Hand' },
  stealth: { id: 'stealth', label: 'Stealth' },
  survival: { id: 'survival', label: 'Survival' },
};

/**
 * Resolve a committed skill-check draft against the seated sheet.
 * Returns null when the summary is not a skill attempt.
 */
export function resolveSkillAttemptFromSummary(
  sheet: DerivedCharacterSheet | null,
  draftSummary: string,
): SkillAttemptResolution | null {
  if (!/^Ready to /i.test(draftSummary.trim())) {
    return null;
  }
  const text = draftSummary.toLowerCase();
  const explicitDcMatch = /\bDC\s+(\d+)\b/i.exec(draftSummary);
  const explicitDc =
    explicitDcMatch !== null ? Math.max(5, Math.min(30, Number(explicitDcMatch[1]))) : null;
  const parentheticalSkillMatch = /\(([A-Za-z -]+?)(?:\s+(?:proficient|not proficient))?\s*[,;]/i.exec(
    draftSummary,
  );
  const dispatchedSkill =
    parentheticalSkillMatch?.[1] !== undefined
      ? (DISPATCHED_SKILL_MAP[parentheticalSkillMatch[1].trim().toLowerCase()] ?? null)
      : null;

  const wantsStealth =
    dispatchedSkill?.id === 'stealth' || /ready to hide|ready to sneak|\bstealth\b/.test(text);
  const wantsTrap =
    dispatchedSkill?.id === 'investigation' ||
    (dispatchedSkill === null && /trap|search|inspect|investigat/.test(text));
  const wantsLock =
    dispatchedSkill?.id === 'sleight-of-hand' ||
    /sleight|thieves|lock attempt|ready to (?:pick|unlock)|\bunlock\b/.test(text) ||
    (!wantsTrap && !wantsStealth && dispatchedSkill === null && /\block(?:ed)?\b/.test(text));
  if (!wantsStealth && !wantsTrap && !wantsLock && dispatchedSkill === null) {
    return null;
  }

  if (sheet === null) {
    return {
      summary:
        'Seat a character before resolving skill attempts. The table did not roll.',
      rolls: [],
      lockYielded: false,
    };
  }

  const namedTarget = namedInspectTargetFromDraft(draftSummary);
  const parts: string[] = [];
  const rolls: number[] = [];
  let lockYielded = false;

  if (wantsStealth) {
    const dc = explicitDc ?? 12;
    const skill = skillBonus(sheet, 'stealth');
    const roll = rollD20('normal', skill.bonus);
    rolls.push(roll.natural);
    const success = roll.total >= dc;
    const verb = /sneak/i.test(draftSummary) ? 'sneak past' : 'hide behind';
    const targetWithArticle = namedTarget.startsWith('the ') ? namedTarget : `the ${namedTarget}`;
    parts.push(
      `Stealth check to ${verb} ${targetWithArticle} (Stealth ${formatBonus(skill.bonus)}): d20 ${roll.natural} ${formatBonus(skill.bonus)} = ${roll.total} vs DC ${dc} — ${
        success
          ? `you succeed in using cover and stay unseen by those nearby`
          : `cover is insufficient to stay fully hidden`
      }.`,
    );
  }

  if (wantsTrap) {
    const dc = explicitDc ?? DEFAULT_TRAP_DC;
    const skill = skillBonus(sheet, 'investigation');
    const roll = rollD20('normal', skill.bonus);
    rolls.push(roll.natural);
    const success = roll.total >= dc;
    const isTrapSpecific =
      /for traps|trap search/i.test(draftSummary) ||
      /\b(?:door|doorway|gate)\b/i.test(namedTarget);
    if (isTrapSpecific) {
      parts.push(
        `Trap search on the ${namedTarget} (Investigation ${formatBonus(skill.bonus)}): d20 ${roll.natural} ${formatBonus(skill.bonus)} = ${roll.total} vs DC ${dc} — ${
          success
            ? `no trap found on the ${namedTarget}`
            : `you cannot tell if the ${namedTarget} is trapped`
        }.`,
      );
    } else {
      const verb = /ready to search/i.test(draftSummary) ? 'Search' : 'Investigation';
      parts.push(
        `${verb} on the ${namedTarget} (Investigation ${formatBonus(skill.bonus)}): d20 ${roll.natural} ${formatBonus(skill.bonus)} = ${roll.total} vs DC ${dc} — ${
          success
            ? `you examine the ${namedTarget} thoroughly and note fine details and markings`
            : `you find no hidden mechanisms or unusual marks on the ${namedTarget}`
        }.`,
      );
    }
  }

  if (wantsLock) {
    const dc = explicitDc ?? DEFAULT_LOCK_DC;
    const skill = skillBonus(sheet, 'sleight-of-hand');
    const tools = hasThievesTools(sheet);
    const roll = rollD20('normal', skill.bonus);
    rolls.push(roll.natural);
    const success = roll.total >= dc;
    lockYielded = success;
    parts.push(
      `Lock attempt (Sleight of Hand ${formatBonus(skill.bonus)}${tools ? ', Thieves’ Tools' : ', no Thieves’ Tools'}): d20 ${roll.natural} ${formatBonus(skill.bonus)} = ${roll.total} vs DC ${dc} — ${
        success ? 'the lock yields' : 'the lock holds'
      }.`,
    );
  }

  if (!wantsStealth && !wantsTrap && !wantsLock && dispatchedSkill !== null) {
    const dc = explicitDc ?? 12;
    const skill = skillBonus(sheet, dispatchedSkill.id);
    const roll = rollD20('normal', skill.bonus);
    rolls.push(roll.natural);
    const success = roll.total >= dc;
    parts.push(
      `${dispatchedSkill.label} check on ${namedTarget} (${dispatchedSkill.label} ${formatBonus(skill.bonus)}): d20 ${roll.natural} ${formatBonus(skill.bonus)} = ${roll.total} vs DC ${dc} — ${
        success ? 'you succeed on the check' : 'the attempt falls short'
      }.`,
    );
  }

  return { summary: parts.join(' '), rolls, lockYielded };
}

/**
 * Build a structured SkillCheckIntent from a deterministic player declaration and sheet.
 */
export function buildSkillCheckIntentFromText(
  sheet: DerivedCharacterSheet | null,
  text: string,
  options: {
    readonly targetId?: string;
    readonly targetKind?: SkillCheckIntent['targetKind'];
    readonly targetLabel?: string;
    readonly dcOverride?: number;
  } = {},
): SkillCheckIntent | null {
  const wantsStealth = /\b(?:hide|hiding|conceal|take\s+cover|stealth|crouch\s+behind|duck\s+behind|sneak(?:s|ing)?|slip(?:s|ping)?)\b/i.test(
    text,
  );
  const wantsLock =
    !/\bpick(?:ing|ed)?\s+up\b/i.test(text) &&
    (textRequestsLockPicking(text) || (/\block\b/.test(text) && !/\bunlocked\b/.test(text)));
  const wantsForce = /\b(?:force|break|smash|kick\s+in|bash|shoulder)\b/i.test(text);
  const wantsTrap = /(trap|disarm)/.test(text);
  const wantsSearch = /\b(?:search(?:es|ing)?|investigat(?:e|es|ing)?|inspect(?:s|ing)?|examin(?:e|es|ing)?)\b/i.test(
    text,
  );

  if (!wantsStealth && !wantsLock && !wantsForce && !wantsTrap && !wantsSearch) {
    return null;
  }

  const skillId = wantsStealth
    ? 'stealth'
    : wantsLock
      ? 'sleight-of-hand'
      : wantsForce
        ? 'athletics'
        : 'investigation';
  const ability =
    skillId === 'stealth' || skillId === 'sleight-of-hand'
      ? 'dexterity'
      : skillId === 'athletics'
        ? 'strength'
        : 'intelligence';
  const dc =
    options.dcOverride ??
    (wantsStealth ? 12 : wantsLock || wantsForce ? DEFAULT_LOCK_DC : DEFAULT_TRAP_DC);
  const bonus = sheet !== null ? skillBonus(sheet, skillId).bonus : 0;
  const targetKind: SkillCheckIntent['targetKind'] =
    options.targetKind ??
    (/\b(?:door|doorway|gate|entry)\b/i.test(text)
      ? 'door'
      : wantsStealth
        ? 'environment'
        : 'object');
  const onSuccessMutation: SkillCheckIntent['onSuccessMutation'] = wantsLock
    ? targetKind === 'door'
      ? 'unlock_door'
      : 'unlock_object'
    : wantsForce
      ? 'force_open'
      : wantsTrap
        ? 'disarm_trap'
        : wantsSearch
          ? 'reveal_info'
          : 'none';

  return {
    skill: skillId,
    ability,
    dc,
    modifier: bonus,
    targetKind,
    ...(options.targetId !== undefined ? { targetId: options.targetId } : {}),
    ...(options.targetLabel !== undefined ? { targetLabel: options.targetLabel } : {}),
    onSuccessMutation,
  };
}

/**
 * Resolve a structured SkillCheckIntent payload directly without regex parsing.
 */
export function resolveStructuredSkillCheck(
  sheet: DerivedCharacterSheet | null,
  intent: SkillCheckIntent,
  customRollD20?: (mode: 'normal', modifier: number) => { natural: number; total: number },
): SkillAttemptResolution {
  const normalizedSkill = intent.skill.toLowerCase().trim().replace(/_/g, '-');
  const mapped = DISPATCHED_SKILL_MAP[normalizedSkill] ?? {
    id: normalizedSkill,
    label: intent.skill.charAt(0).toUpperCase() + intent.skill.slice(1).replace(/[-_]/g, ' '),
  };
  const computedSkill = sheet !== null ? skillBonus(sheet, mapped.id) : null;
  const modifier =
    typeof intent.modifier === 'number' && Number.isFinite(intent.modifier)
      ? intent.modifier
      : (computedSkill?.bonus ?? 0);
  const dc = Math.max(5, Math.min(30, intent.dc || 13));
  const roller = customRollD20 ?? rollD20;
  const roll = roller('normal', modifier);
  const succeeded = roll.total >= dc;
  const targetLabel = intent.targetLabel ?? intent.targetId ?? 'the target';
  const lockYielded =
    succeeded &&
    (intent.onSuccessMutation === 'unlock_door' ||
      intent.onSuccessMutation === 'unlock_object' ||
      (intent.onSuccessMutation === 'force_open' &&
        (intent.targetKind === 'door' || intent.targetKind === 'object')));

  let outcomeClause = succeeded ? 'you succeed on the check' : 'the attempt falls short';
  if (
    intent.onSuccessMutation === 'unlock_door' ||
    intent.onSuccessMutation === 'unlock_object'
  ) {
    outcomeClause = succeeded ? 'the lock yields' : 'the lock holds';
  } else if (intent.onSuccessMutation === 'force_open') {
    outcomeClause = succeeded
      ? `${targetLabel} gives way and forces open`
      : `${targetLabel} holds fast against the force`;
  } else if (intent.onSuccessMutation === 'disarm_trap') {
    outcomeClause = succeeded
      ? `you safely disarm or clear ${targetLabel}`
      : `you fail to disarm ${targetLabel}`;
  } else if (intent.onSuccessMutation === 'npc_give_item') {
    outcomeClause = succeeded
      ? `${targetLabel} is persuaded and hands over the item`
      : `${targetLabel} remains unconvinced`;
  } else if (mapped.id === 'stealth') {
    outcomeClause = succeeded
      ? 'you succeed in using cover and stay unseen by those nearby'
      : 'cover is insufficient to stay fully hidden';
  } else if (mapped.id === 'investigation') {
    outcomeClause = succeeded
      ? `you examine ${targetLabel} thoroughly and uncover key details`
      : `you find no hidden mechanisms or unusual marks on ${targetLabel}`;
  }

  const summary = `${mapped.label} check on ${targetLabel} (${mapped.label} ${formatBonus(modifier)}): d20 ${roll.natural} ${formatBonus(modifier)} = ${roll.total} vs DC ${dc} — ${outcomeClause}.`;

  return {
    summary,
    rolls: [roll.natural],
    lockYielded,
    succeeded,
    intent,
  };
}

