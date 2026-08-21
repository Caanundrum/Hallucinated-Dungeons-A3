import type {
  ConditionId,
  ConditionProjection,
  RuleExplanationProjection,
} from '../../../shared/rules-combat-contract.js';

export interface ConditionRule {
  readonly conditionId: ConditionId;
  readonly label: string;
  readonly summary: string;
  readonly effects: readonly string[];
}

const rules: readonly ConditionRule[] = [
  { conditionId: 'blinded', label: 'Blinded', summary: 'Cannot see.', effects: ['Automatically fails checks requiring sight.', 'Attacks have disadvantage; attacks against it have advantage.'] },
  { conditionId: 'charmed', label: 'Charmed', summary: 'Cannot attack or target the charmer harmfully.', effects: ['The charmer has advantage on social interaction checks.'] },
  { conditionId: 'deafened', label: 'Deafened', summary: 'Cannot hear.', effects: ['Automatically fails checks requiring hearing.'] },
  { conditionId: 'frightened', label: 'Frightened', summary: 'Disadvantaged while the source is visible.', effects: ['Cannot willingly move closer to the source.'] },
  { conditionId: 'grappled', label: 'Grappled', summary: 'Speed becomes 0.', effects: ['Ends when the grappler is incapacitated or moved out of reach.'] },
  { conditionId: 'incapacitated', label: 'Incapacitated', summary: 'Cannot take actions, bonus actions, or reactions.', effects: ['Concentration ends.'] },
  { conditionId: 'invisible', label: 'Invisible', summary: 'Cannot be seen without special senses.', effects: ['Attacks have advantage; attacks against it have disadvantage.'] },
  { conditionId: 'paralyzed', label: 'Paralyzed', summary: 'Incapacitated and cannot move or speak.', effects: ['Fails Strength and Dexterity saves.', 'Nearby hits are critical hits.'] },
  { conditionId: 'poisoned', label: 'Poisoned', summary: 'Attacks and ability checks have disadvantage.', effects: [] },
  { conditionId: 'prone', label: 'Prone', summary: 'Movement is limited to crawling until standing.', effects: ['Attacks have disadvantage.', 'Nearby attacks against it have advantage; distant attacks have disadvantage.'] },
  { conditionId: 'restrained', label: 'Restrained', summary: 'Speed becomes 0.', effects: ['Attacks have disadvantage; attacks against it have advantage.', 'Dexterity saves have disadvantage.'] },
  { conditionId: 'stunned', label: 'Stunned', summary: 'Incapacitated and cannot move.', effects: ['Fails Strength and Dexterity saves.', 'Attacks against it have advantage.'] },
  { conditionId: 'unconscious', label: 'Unconscious', summary: 'Incapacitated, prone, and unaware.', effects: ['Fails Strength and Dexterity saves.', 'Nearby hits are critical hits.'] },
  { conditionId: 'exhaustion', label: 'Exhaustion', summary: 'A cumulative penalty tracked by level.', effects: ['Phase 3 clears one level on a Long Rest.'] },
  { conditionId: 'guiding-bolt-marked', label: 'Guiding Bolt marked', summary: 'The next attack against this target has advantage.', effects: ['Consumed by the next attack before the caster’s next turn.'] },
  { conditionId: 'shielded', label: 'Shielded', summary: 'Shield grants +5 Armor Class until the start of the next turn.', effects: ['The reaction is available only while a reaction window is open.'] },
] as const;

export const CONDITION_CATALOG: Readonly<Record<ConditionId, ConditionRule>> = Object.fromEntries(
  rules.map((rule) => [rule.conditionId, rule]),
) as Readonly<Record<ConditionId, ConditionRule>>;

export function conditionRule(conditionId: ConditionId): ConditionRule {
  return CONDITION_CATALOG[conditionId];
}

export function applyCondition(
  conditions: readonly ConditionProjection[],
  conditionId: ConditionId,
  source: string,
  expiresAtRound: number | null = null,
): readonly ConditionProjection[] {
  const rule = conditionRule(conditionId);
  return [
    ...conditions.filter((condition) => condition.conditionId !== conditionId),
    { conditionId, label: rule.label, source, expiresAtRound },
  ];
}

export function removeCondition(
  conditions: readonly ConditionProjection[],
  conditionId: ConditionId,
): readonly ConditionProjection[] {
  return conditions.filter((condition) => condition.conditionId !== conditionId);
}

export function expireConditions(
  conditions: readonly ConditionProjection[],
  round: number,
): readonly ConditionProjection[] {
  return conditions.filter(
    (condition) => condition.expiresAtRound === null || condition.expiresAtRound > round,
  );
}

export function explainCondition(conditionId: ConditionId): RuleExplanationProjection {
  const rule = conditionRule(conditionId);
  return {
    ruleId: `condition.${conditionId}`,
    title: rule.label,
    summary: rule.summary,
    steps: rule.effects,
    source: 'SRD 5.2',
  };
}
