import { randomInt } from 'node:crypto';

export type RandomSource = (minimumInclusive: number, maximumExclusive: number) => number;

const cryptoRandom: RandomSource = (minimumInclusive, maximumExclusive) =>
  randomInt(minimumInclusive, maximumExclusive);

export interface DiceTerm {
  readonly count: number;
  readonly sides: number;
  readonly sign: 1 | -1;
}

export interface DamageExpression {
  readonly terms: readonly DiceTerm[];
  readonly modifier: number;
}

export interface DiceRollResult {
  readonly total: number;
  readonly rolls: readonly number[];
}

export interface D20RollResult extends DiceRollResult {
  readonly mode: 'normal' | 'advantage' | 'disadvantage';
  readonly natural: number;
}

function assertRandomResult(value: number, minimumInclusive: number, maximumExclusive: number): number {
  if (!Number.isInteger(value) || value < minimumInclusive || value >= maximumExclusive) {
    throw new RangeError('Random source returned a value outside the requested integer range.');
  }
  return value;
}

export function rollDie(sides: number, rng: RandomSource = cryptoRandom): number {
  if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
    throw new RangeError('A die must have between 2 and 1000 sides.');
  }
  return assertRandomResult(rng(1, sides + 1), 1, sides + 1);
}

export function rollD20(
  mode: 'normal' | 'advantage' | 'disadvantage' = 'normal',
  modifier = 0,
  rng: RandomSource = cryptoRandom,
): D20RollResult {
  if (!Number.isInteger(modifier) || Math.abs(modifier) > 100) {
    throw new RangeError('A d20 modifier must be an integer between -100 and 100.');
  }
  const rolls = mode === 'normal' ? [rollDie(20, rng)] : [rollDie(20, rng), rollDie(20, rng)];
  const natural =
    mode === 'advantage'
      ? Math.max(...rolls)
      : mode === 'disadvantage'
        ? Math.min(...rolls)
        : rolls[0]!;
  return { mode, natural, rolls, total: natural + modifier };
}

export function parseDamageExpression(expression: string): DamageExpression {
  const compact = expression.replace(/\s+/g, '').toLowerCase();
  if (compact.length === 0 || compact.length > 64 || !/^[+\-\dd]+$/.test(compact)) {
    throw new Error('Damage expression must contain dice and integer modifiers only.');
  }

  const pieces = compact.match(/[+-]?[^+-]+/g) ?? [];
  const terms: DiceTerm[] = [];
  let modifier = 0;
  for (const piece of pieces) {
    const sign: 1 | -1 = piece.startsWith('-') ? -1 : 1;
    const unsigned = piece.replace(/^[+-]/, '');
    const dice = /^(\d*)d(\d+)$/.exec(unsigned);
    if (dice !== null) {
      const count = dice[1] === '' ? 1 : Number(dice[1]);
      const sides = Number(dice[2]);
      if (!Number.isInteger(count) || count < 1 || count > 100) {
        throw new Error('A damage term must roll between 1 and 100 dice.');
      }
      if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
        throw new Error('A damage die must have between 2 and 1000 sides.');
      }
      terms.push({ count, sides, sign });
      continue;
    }
    if (!/^\d+$/.test(unsigned)) {
      throw new Error(`Invalid damage term: ${piece}`);
    }
    modifier += sign * Number(unsigned);
  }
  if (terms.length === 0 && modifier === 0) {
    throw new Error('Damage expression cannot resolve to an empty roll.');
  }
  if (!Number.isSafeInteger(modifier) || Math.abs(modifier) > 10_000) {
    throw new Error('Damage modifier is outside the supported range.');
  }
  return { terms, modifier };
}

export function rollDamage(
  expression: string,
  rng: RandomSource = cryptoRandom,
): DiceRollResult {
  const parsed = parseDamageExpression(expression);
  const rolls: number[] = [];
  let total = parsed.modifier;
  for (const term of parsed.terms) {
    for (let index = 0; index < term.count; index += 1) {
      const rolled = rollDie(term.sides, rng);
      rolls.push(rolled);
      total += rolled * term.sign;
    }
  }
  return { rolls, total: Math.max(0, total) };
}
