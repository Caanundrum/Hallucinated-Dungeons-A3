import type { Ability } from '../../../shared/character-contract.js';
import type {
  CombatantProjection,
  DeathSaveProjection,
} from '../../../shared/rules-combat-contract.js';
import { applyCondition, removeCondition } from './conditions.js';
import {
  parseDamageExpression,
  rollD20,
  rollDamage,
  rollDie,
  type RandomSource,
} from './dice.js';

export interface AttackResolution {
  readonly hit: boolean;
  readonly critical: boolean;
  readonly attackTotal: number;
  readonly damage: number;
  readonly rolls: readonly number[];
  readonly target: CombatantProjection;
}

export interface SaveResolution {
  readonly success: boolean;
  readonly total: number;
  readonly rolls: readonly number[];
  readonly natural: number;
}

export interface DeathSaveResolution {
  readonly natural: number;
  readonly outcome: 'success' | 'failure' | 'critical_failure' | 'revived' | 'stable' | 'dead';
  readonly combatant: CombatantProjection;
}

function unconscious(combatant: CombatantProjection): CombatantProjection {
  return {
    ...combatant,
    currentHitPoints: 0,
    conditions: applyCondition(combatant.conditions, 'unconscious', 'Hit Points reduced to 0'),
    actionEconomy: {
      ...combatant.actionEconomy,
      actionAvailable: false,
      bonusActionAvailable: false,
      reactionAvailable: false,
      movementRemainingFeet: 0,
      deathSaveAvailable: false,
    },
    concentrationSpellId: null,
  };
}

export function applyTemporaryHitPoints(
  combatant: CombatantProjection,
  amount: number,
): CombatantProjection {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error('Temporary Hit Points must be a non-negative integer.');
  }
  return { ...combatant, temporaryHitPoints: Math.max(combatant.temporaryHitPoints, amount) };
}

export function applyDamage(
  combatant: CombatantProjection,
  amount: number,
  options: { readonly critical?: boolean } = {},
): CombatantProjection {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error('Damage must be a non-negative integer.');
  }
  if (amount === 0 || combatant.deathSaves.dead) {
    return combatant;
  }

  if (combatant.currentHitPoints === 0) {
    const addedFailures = options.critical === true ? 2 : 1;
    const failures = Math.min(3, combatant.deathSaves.failures + addedFailures);
    return {
      ...combatant,
      deathSaves: {
        ...combatant.deathSaves,
        failures,
        dead: failures >= 3,
      },
    };
  }

  const absorbed = Math.min(amount, combatant.temporaryHitPoints);
  const afterTemporary = amount - absorbed;
  const hitPointsBefore = combatant.currentHitPoints;
  const currentHitPoints = Math.max(0, hitPointsBefore - afterTemporary);
  const massiveDamage = currentHitPoints === 0 && afterTemporary - hitPointsBefore >= combatant.maxHitPoints;
  const damaged: CombatantProjection = {
    ...combatant,
    temporaryHitPoints: combatant.temporaryHitPoints - absorbed,
    currentHitPoints,
    deathSaves: massiveDamage
      ? { successes: 0, failures: 3, stable: false, dead: true }
      : combatant.deathSaves,
  };
  return currentHitPoints === 0 ? unconscious(damaged) : damaged;
}

export function applyHealing(
  combatant: CombatantProjection,
  amount: number,
): CombatantProjection {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error('Healing must be a non-negative integer.');
  }
  if (combatant.deathSaves.dead || amount === 0) {
    return combatant;
  }
  const currentHitPoints = Math.min(combatant.maxHitPoints, combatant.currentHitPoints + amount);
  return {
    ...combatant,
    currentHitPoints,
    conditions:
      currentHitPoints > 0
        ? removeCondition(combatant.conditions, 'unconscious')
        : combatant.conditions,
    deathSaves:
      currentHitPoints > 0
        ? { successes: 0, failures: 0, stable: false, dead: false }
        : combatant.deathSaves,
  };
}

export function resolveSavingThrow(options: {
  readonly combatant: CombatantProjection;
  readonly ability: Ability;
  readonly difficultyClass: number;
  readonly mode?: 'normal' | 'advantage' | 'disadvantage';
  readonly rng?: RandomSource;
}): SaveResolution {
  const bonus = options.combatant.savingThrowBonuses[options.ability] ?? 0;
  const roll = rollD20(options.mode ?? 'normal', bonus, options.rng);
  return {
    success: roll.total >= options.difficultyClass,
    total: roll.total,
    natural: roll.natural,
    rolls: roll.rolls,
  };
}

export function resolveAttack(options: {
  readonly attacker: CombatantProjection;
  readonly target: CombatantProjection;
  readonly attackId?: string;
  readonly mode?: 'normal' | 'advantage' | 'disadvantage';
  readonly rng?: RandomSource;
}): AttackResolution {
  const attack =
    options.attacker.attacks.find((entry) => entry.attackId === options.attackId) ??
    options.attacker.attacks[0];
  if (attack === undefined) {
    throw new Error(`${options.attacker.name} has no available attack.`);
  }
  const marked = options.target.conditions.some(
    (condition) => condition.conditionId === 'guiding-bolt-marked',
  );
  const mode = marked ? 'advantage' : options.mode ?? 'normal';
  const attackRoll = rollD20(mode, attack.attackBonus, options.rng);
  const critical = attackRoll.natural === 20;
  const hit =
    attackRoll.natural !== 1 &&
    (critical || attackRoll.total >= options.target.armorClass);
  if (!hit) {
    return {
      hit,
      critical,
      attackTotal: attackRoll.total,
      damage: 0,
      rolls: attackRoll.rolls,
      target: options.target,
    };
  }

  const damageRoll = rollDamage(attack.damageExpression, options.rng);
  const criticalRolls: number[] = [];
  let criticalDamage = 0;
  if (critical) {
    for (const term of parseDamageExpression(attack.damageExpression).terms) {
      for (let index = 0; index < term.count; index += 1) {
        const rolled = rollDie(term.sides, options.rng);
        criticalRolls.push(rolled);
        criticalDamage += rolled * term.sign;
      }
    }
  }
  const damage = Math.max(0, damageRoll.total + criticalDamage);
  return {
    hit,
    critical,
    attackTotal: attackRoll.total,
    damage,
    rolls: [...attackRoll.rolls, ...damageRoll.rolls, ...criticalRolls],
    target: applyDamage(
      {
        ...options.target,
        conditions: marked
          ? removeCondition(options.target.conditions, 'guiding-bolt-marked')
          : options.target.conditions,
      },
      damage,
      { critical },
    ),
  };
}

export function resolveDeathSave(
  combatant: CombatantProjection,
  rng?: RandomSource,
): DeathSaveResolution {
  if (
    combatant.currentHitPoints !== 0 ||
    combatant.deathSaves.dead ||
    combatant.deathSaves.stable
  ) {
    throw new Error('Only an unstable combatant at 0 Hit Points makes Death Saving Throws.');
  }
  const natural = rollDie(20, rng);
  if (natural === 20) {
    return {
      natural,
      outcome: 'revived',
      combatant: applyHealing(combatant, 1),
    };
  }

  const deathSaves: DeathSaveProjection = { ...combatant.deathSaves };
  if (natural === 1) {
    const failures = Math.min(3, deathSaves.failures + 2);
    const dead = failures >= 3;
    return {
      natural,
      outcome: dead ? 'dead' : 'critical_failure',
      combatant: { ...combatant, deathSaves: { ...deathSaves, failures, dead } },
    };
  }
  if (natural >= 10) {
    const successes = Math.min(3, deathSaves.successes + 1);
    const stable = successes >= 3;
    return {
      natural,
      outcome: stable ? 'stable' : 'success',
      combatant: {
        ...combatant,
        deathSaves: { ...deathSaves, successes, stable },
      },
    };
  }
  const failures = Math.min(3, deathSaves.failures + 1);
  const dead = failures >= 3;
  return {
    natural,
    outcome: dead ? 'dead' : 'failure',
    combatant: { ...combatant, deathSaves: { ...deathSaves, failures, dead } },
  };
}
