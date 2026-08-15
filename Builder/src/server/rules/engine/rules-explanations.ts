import type { RuleExplanationProjection } from '../../../shared/rules-combat-contract.js';
import { CONDITION_IDS, type ConditionId } from '../../../shared/rules-combat-contract.js';
import { explainCondition } from './conditions.js';

const RULES: readonly RuleExplanationProjection[] = [
  {
    ruleId: 'combat.initiative',
    title: 'Initiative',
    summary: 'Each combatant rolls d20 plus its Initiative bonus; highest total acts first.',
    steps: ['Ties use Initiative bonus, then the stable combatant id.', 'A new round starts when the order wraps.'],
    source: 'SRD 5.2',
  },
  {
    ruleId: 'combat.action-economy',
    title: 'Action Economy',
    summary: 'On its turn a combatant has an Action, Bonus Action, movement, and one Reaction until its next turn.',
    steps: ['Attacks, spells, Ready, rests, and item use spend the Action.', 'A Reaction requires a server-issued Decision Window.'],
    source: 'SRD 5.2',
  },
  {
    ruleId: 'combat.attack',
    title: 'Attack Roll',
    summary: 'Roll d20, add the attack bonus, and compare the total with Armor Class.',
    steps: ['A natural 1 misses.', 'A natural 20 hits critically and rolls damage dice twice.', 'Damage first consumes Temporary Hit Points.'],
    source: 'SRD 5.2',
  },
  {
    ruleId: 'combat.death-saves',
    title: 'Death Saving Throws',
    summary: 'At 0 Hit Points, roll a d20 on each turn until stable, revived, or dead.',
    steps: ['10 or higher is a success; lower is a failure.', 'Three successes stabilize; three failures kill.', 'A natural 1 adds two failures; a natural 20 restores 1 Hit Point.'],
    source: 'SRD 5.2',
  },
  {
    ruleId: 'combat.rests',
    title: 'Short and Long Rests',
    summary: 'A Short Rest can spend a Hit Die; a Long Rest restores Hit Points and spell slots.',
    steps: ['Short Rest healing is the Hit Die plus Constitution modifier.', 'Long Rest restores half expended Hit Dice, at least one.'],
    source: 'SRD 5.2',
  },
  {
    ruleId: 'combat.reactions',
    title: 'Reactions and Ready',
    summary: 'Ready spends an Action and opens a single-use, server-issued Reaction Decision Window.',
    steps: ['Opportunity Attack requires a target in reach.', 'Shield spends a Reaction and a level 1 spell slot for +5 Armor Class.'],
    source: 'SRD 5.2',
  },
  {
    ruleId: 'spell.concentration',
    title: 'Concentration',
    summary: 'A combatant concentrates on only one spell and checks Constitution when damaged.',
    steps: ['The save DC is 10 or half the damage, whichever is higher.', 'Falling to 0 Hit Points or becoming incapacitated ends concentration.'],
    source: 'SRD 5.2',
  },
  {
    ruleId: 'spell.areas',
    title: 'Three-dimensional Areas',
    summary: 'Sphere, cube, cone, and line templates resolve to 5-foot square cells at explicit elevations.',
    steps: ['The server applies each spell’s canonical dimensions.', 'Only combatants whose position occupies a resolved cell are targets.'],
    source: 'Hallucinated Dungeons Phase 3',
  },
  {
    ruleId: 'progression.xp',
    title: 'XP-only Progression',
    summary: 'Characters earn levels only by reaching cumulative XP thresholds.',
    steps: ['One command awards server-validated XP.', 'Each Level Up advances one earned level and recomputes proficiency, Hit Points, attacks, and spell slots.', 'Single-class progression ends at level 20.'],
    source: 'SRD 5.2',
  },
] as const;

const RULE_MAP = new Map(RULES.map((rule) => [rule.ruleId, rule]));

export const RULE_EXPLANATION_IDS = [
  ...RULES.map((rule) => rule.ruleId),
  ...CONDITION_IDS.map((conditionId) => `condition.${conditionId}`),
] as const;

export function explainRule(ruleId: string): RuleExplanationProjection | null {
  const direct = RULE_MAP.get(ruleId);
  if (direct !== undefined) return direct;
  if (ruleId.startsWith('condition.')) {
    const conditionId = ruleId.slice('condition.'.length) as ConditionId;
    if ((CONDITION_IDS as readonly string[]).includes(conditionId)) {
      return explainCondition(conditionId);
    }
  }
  return null;
}
