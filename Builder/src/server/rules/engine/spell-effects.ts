import type {
  AreaCell,
  AreaTarget,
} from '../../../shared/rules-combat-contract.js';
import { areaFootprint } from './areas.js';

export interface SpellEffect {
  readonly spellId: string;
  readonly label: string;
  readonly level: number;
  readonly targetKind: 'creature' | 'self' | 'area';
  readonly resolution: 'attack' | 'save' | 'healing' | 'condition';
  readonly damageExpression: string | null;
  readonly damageType: string | null;
  readonly healingExpression: string | null;
  readonly saveAbility: 'dexterity' | null;
  readonly halfDamageOnSave: boolean;
  readonly concentration: boolean;
  readonly area: {
    readonly shape: 'cone';
    readonly sizeFeet: number;
    readonly heightFeet: number;
  } | null;
}

export const SPELL_EFFECTS: Readonly<Record<string, SpellEffect>> = Object.fromEntries(
  [
    {
      spellId: 'fire-bolt',
      label: 'Fire Bolt',
      level: 0,
      targetKind: 'creature',
      resolution: 'attack',
      damageExpression: '1d10',
      damageType: 'fire',
      healingExpression: null,
      saveAbility: null,
      halfDamageOnSave: false,
      concentration: false,
      area: null,
    },
    {
      spellId: 'sacred-flame',
      label: 'Sacred Flame',
      level: 0,
      targetKind: 'creature',
      resolution: 'save',
      damageExpression: '1d8',
      damageType: 'radiant',
      healingExpression: null,
      saveAbility: 'dexterity',
      halfDamageOnSave: false,
      concentration: false,
      area: null,
    },
    {
      spellId: 'guiding-bolt',
      label: 'Guiding Bolt',
      level: 1,
      targetKind: 'creature',
      resolution: 'attack',
      damageExpression: '4d6',
      damageType: 'radiant',
      healingExpression: null,
      saveAbility: null,
      halfDamageOnSave: false,
      concentration: false,
      area: null,
    },
    {
      spellId: 'cure-wounds',
      label: 'Cure Wounds',
      level: 1,
      targetKind: 'creature',
      resolution: 'healing',
      damageExpression: null,
      damageType: null,
      healingExpression: '1d8',
      saveAbility: null,
      halfDamageOnSave: false,
      concentration: false,
      area: null,
    },
    {
      spellId: 'burning-hands',
      label: 'Burning Hands',
      level: 1,
      targetKind: 'area',
      resolution: 'save',
      damageExpression: '3d6',
      damageType: 'fire',
      healingExpression: null,
      saveAbility: 'dexterity',
      halfDamageOnSave: true,
      concentration: false,
      area: { shape: 'cone', sizeFeet: 15, heightFeet: 10 },
    },
    {
      spellId: 'shield',
      label: 'Shield',
      level: 1,
      targetKind: 'self',
      resolution: 'condition',
      damageExpression: null,
      damageType: null,
      healingExpression: null,
      saveAbility: null,
      halfDamageOnSave: false,
      concentration: false,
      area: null,
    },
    {
      spellId: 'bless',
      label: 'Bless',
      level: 1,
      targetKind: 'creature',
      resolution: 'condition',
      damageExpression: null,
      damageType: null,
      healingExpression: null,
      saveAbility: null,
      halfDamageOnSave: false,
      concentration: true,
      area: null,
    },
  ].map((effect) => [effect.spellId, effect]),
) as Readonly<Record<string, SpellEffect>>;

export function spellEffect(spellId: string): SpellEffect {
  const effect = SPELL_EFFECTS[spellId];
  if (effect === undefined) {
    throw new Error('That spell is not implemented in the Phase 3 encounter rules.');
  }
  return effect;
}

export function spellAreaCells(
  spellId: string,
  placement: AreaTarget,
): readonly AreaCell[] {
  const effect = spellEffect(spellId);
  if (effect.area === null) {
    throw new Error(`${effect.label} does not use area placement.`);
  }
  return areaFootprint({
    ...placement,
    shape: effect.area.shape,
    sizeFeet: effect.area.sizeFeet,
    heightFeet: effect.area.heightFeet,
  });
}
