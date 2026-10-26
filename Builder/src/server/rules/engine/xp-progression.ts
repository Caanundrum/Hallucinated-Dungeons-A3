import {
  ABILITY_LABELS,
  formatArmorClassFormula,
  type Ability,
  type DerivedAttack,
  type DerivedCharacterSheet,
  type DerivedValue,
} from '../../../shared/character-contract.js';
import type {
  ProgressionDerivedProjection,
} from '../../../shared/rules-combat-contract.js';
import {
  deriveSpeedForSheet,
  isMonkWeapon,
  monkMartialArtsDieSides,
  upgradeDamageDieForMonk,
} from '../character-rules.js';
import {
  ARMOR,
  WEAPONS,
  findClass,
} from '../srd-manifest.js';

/** Cumulative XP required to attain each level, index 0 = level 1. */
export const XP_THRESHOLDS = [
  0,
  300,
  900,
  2_700,
  6_500,
  14_000,
  23_000,
  34_000,
  48_000,
  64_000,
  85_000,
  100_000,
  120_000,
  140_000,
  165_000,
  195_000,
  225_000,
  265_000,
  305_000,
  355_000,
] as const;

const FULL_CASTER_SLOTS: readonly (readonly number[])[] = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
] as const;

const FULL_CASTERS = new Set(['bard', 'cleric', 'druid', 'sorcerer', 'wizard']);
const HALF_CASTERS = new Set(['paladin', 'ranger']);

export function levelForExperience(experiencePoints: number): number {
  if (!Number.isSafeInteger(experiencePoints) || experiencePoints < 0) {
    throw new Error('Experience Points must be a non-negative integer.');
  }
  let level = 1;
  for (let index = 1; index < XP_THRESHOLDS.length; index += 1) {
    if (experiencePoints < XP_THRESHOLDS[index]!) {
      break;
    }
    level = index + 1;
  }
  return level;
}

export function experienceRequiredForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error('A character level must be from 1 to 20.');
  }
  return XP_THRESHOLDS[level - 1]!;
}

export function proficiencyBonusForLevel(level: number): number {
  experienceRequiredForLevel(level);
  return 2 + Math.floor((level - 1) / 4);
}

export function spellSlotsForClass(classId: string, level: number): readonly number[] {
  experienceRequiredForLevel(level);
  if (FULL_CASTERS.has(classId)) {
    return FULL_CASTER_SLOTS[level - 1]!;
  }
  if (HALF_CASTERS.has(classId)) {
    const effectiveLevel = Math.max(1, Math.ceil(level / 2));
    return FULL_CASTER_SLOTS[effectiveLevel - 1]!;
  }
  if (classId === 'warlock') {
    const slotCount = level === 1 ? 1 : level <= 10 ? 2 : level <= 16 ? 3 : 4;
    const slotLevel = Math.min(5, Math.ceil(level / 2));
    return Array.from({ length: slotLevel }, (_, index) => (index === slotLevel - 1 ? slotCount : 0));
  }
  return [];
}

export function attacksPerActionForClass(classId: string, level: number): number {
  experienceRequiredForLevel(level);
  if (classId === 'fighter') {
    return level >= 20 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
  }
  if (['barbarian', 'monk', 'paladin', 'ranger'].includes(classId) && level >= 5) {
    return 2;
  }
  return 1;
}

export interface SrdClassFeatureProgressionEntry {
  readonly level: number;
  readonly id: string;
  readonly label: string;
  readonly summary: string;
}

export const SRD_CLASS_FEATURES_BY_LEVEL: Readonly<
  Record<string, ReadonlyArray<SrdClassFeatureProgressionEntry>>
> = {
  barbarian: [
    { level: 1, id: 'rage', label: 'Rage', summary: 'Enter a Rage as a Bonus Action for Resistance to Bludgeoning, Piercing, and Slashing damage, bonus Rage Damage on Strength attacks, and Advantage on Strength checks and saves.' },
    { level: 1, id: 'unarmored-defense', label: 'Unarmored Defense', summary: 'While not wearing armor, your base Armor Class equals 10 + your Dexterity modifier + your Constitution modifier.' },
    { level: 1, id: 'weapon-mastery', label: 'Weapon Mastery', summary: 'Use the mastery properties of two kinds of Simple or Martial melee weapons of your choice.' },
    { level: 2, id: 'danger-sense', label: 'Danger Sense', summary: 'You have Advantage on Dexterity saving throws unless you have the Incapacitated condition.' },
    { level: 2, id: 'reckless-attack', label: 'Reckless Attack', summary: 'When you make your first attack roll on your turn using Strength, you can gain Advantage on Strength melee attack rolls this turn, while attack rolls against you have Advantage until your next turn.' },
    { level: 3, id: 'barbarian-subclass', label: 'Path of the Berserker (Barbarian Subclass)', summary: 'Channel your Rage into violent Frenzy, adding extra d6 damage on your first Reckless Attack hit each turn.' },
    { level: 3, id: 'primal-knowledge', label: 'Primal Knowledge', summary: 'Gain proficiency in another Barbarian skill and channel primal power to make certain skill checks using Strength while Raging.' },
    { level: 4, id: 'asi-4', label: 'Ability Score Improvement 4', summary: 'Gain the Ability Score Improvement feat (+2 to one ability score or +1 to two, max 20) or another feat of your choice.' },
    { level: 5, id: 'extra-attack', label: 'Extra Attack', summary: 'You can attack twice instead of once whenever you take the Attack action on your turn.' },
    { level: 5, id: 'fast-movement', label: 'Fast Movement', summary: 'Your Speed increases by 10 feet while you aren’t wearing Heavy armor.' },
    { level: 6, id: 'mindless-rage', label: 'Mindless Rage (Subclass Feature)', summary: 'You have Immunity to the Charmed and Frightened conditions while your Rage is active.' },
    { level: 7, id: 'feral-instinct', label: 'Feral Instinct', summary: 'You have Advantage on Initiative rolls.' },
    { level: 7, id: 'instinctive-pounce', label: 'Instinctive Pounce', summary: 'As part of the Bonus Action you take to enter your Rage, you can move up to half your Speed.' },
    { level: 8, id: 'asi-8', label: 'Ability Score Improvement 8', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 9, id: 'brutal-strike', label: 'Brutal Strike', summary: 'Forgo Reckless Attack Advantage on one Strength attack to deal an extra 1d10 damage and apply a Forceful Blow or Hamstring Blow effect.' },
    { level: 10, id: 'retaliation', label: 'Retaliation (Subclass Feature)', summary: 'When you take damage from a creature within 5 feet of you, you can take a Reaction to make one melee attack against that creature.' },
    { level: 11, id: 'relentless-rage', label: 'Relentless Rage', summary: 'If you drop to 0 Hit Points while Raging and don’t die outright, make a DC 10 Constitution save to drop to Hit Points equal to twice your Barbarian level instead.' },
    { level: 12, id: 'asi-12', label: 'Ability Score Improvement 12', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 13, id: 'improved-brutal-strike', label: 'Improved Brutal Strike', summary: 'Add Staggering Blow and Sundering Blow to your Brutal Strike options.' },
    { level: 14, id: 'intimidating-presence', label: 'Intimidating Presence (Subclass Feature)', summary: 'Take a Bonus Action to terrify creatures in a 30-foot Emanation (Wisdom save or Frightened for 1 minute).' },
    { level: 15, id: 'persistent-rage', label: 'Persistent Rage', summary: 'Regain all expended uses of Rage when you roll Initiative (once per Long Rest), and your Rage lasts 10 minutes without requiring attacks.' },
    { level: 16, id: 'asi-16', label: 'Ability Score Improvement 16', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 17, id: 'improved-brutal-strike-17', label: 'Improved Brutal Strike (2d10)', summary: 'Your Brutal Strike extra damage increases to 2d10, and you can apply two different Brutal Strike effects at once.' },
    { level: 18, id: 'indomitable-might', label: 'Indomitable Might', summary: 'If your total for a Strength check or Strength saving throw is less than your Strength score, you can use your Strength score instead.' },
    { level: 19, id: 'epic-boon', label: 'Epic Boon (Ability Score Improvement 19)', summary: 'Gain an Epic Boon feat or another feat of your choice for which you qualify.' },
    { level: 20, id: 'primal-champion', label: 'Primal Champion', summary: 'Your Strength and Constitution scores each increase by 4, to a maximum of 25.' },
  ],
  bard: [
    { level: 1, id: 'bardic-inspiration', label: 'Bardic Inspiration', summary: 'As a Bonus Action, grant a creature within 60 feet a Bardic Inspiration die (d6, scaling at higher levels) to add to a d20 Test within the next hour.' },
    { level: 1, id: 'spellcasting', label: 'Spellcasting', summary: 'Cast prepared Bard spells using Charisma as your spellcasting ability and a musical instrument as a Spellcasting Focus.' },
    { level: 2, id: 'expertise', label: 'Expertise', summary: 'Gain Expertise in two of your skill proficiencies of your choice, doubling your Proficiency Bonus for checks using them.' },
    { level: 2, id: 'jack-of-all-trades', label: 'Jack of All Trades', summary: 'Add half your Proficiency Bonus (round down) to any ability check that uses a skill proficiency you lack and doesn’t otherwise use your Proficiency Bonus.' },
    { level: 3, id: 'bard-subclass', label: 'College of Lore (Bard Subclass)', summary: 'Gain bonus proficiencies in three skills of your choice and use Cutting Words as a Reaction to subtract a Bardic Inspiration die from an enemy’s roll.' },
    { level: 4, id: 'asi-4', label: 'Ability Score Improvement 4', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 5, id: 'font-of-inspiration', label: 'Font of Inspiration', summary: 'Your Bardic Inspiration die becomes a d8, you regain all expended uses on a Short or Long Rest, and you can expend a spell slot to regain a use.' },
    { level: 6, id: 'magical-discoveries', label: 'Magical Discoveries (Subclass Feature)', summary: 'Learn two spells of your choice from the Cleric, Druid, or Wizard spell list; they always count as prepared Bard spells for you.' },
    { level: 7, id: 'countercharm', label: 'Countercharm', summary: 'When you or a creature within 30 feet fails a save against an effect that applies the Charmed or Frightened condition, take a Reaction to cause the save to be rerolled with Advantage.' },
    { level: 8, id: 'asi-8', label: 'Ability Score Improvement 8', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 9, id: 'expertise-9', label: 'Expertise (Additional Skills)', summary: 'Gain Expertise in two more of your skill proficiencies of your choice.' },
    { level: 10, id: 'magical-secrets', label: 'Magical Secrets', summary: 'Whenever you reach a Bard level that grants a new prepared spell, you can choose your new spells from the Bard, Cleric, Druid, and Wizard spell lists, and your Bardic Inspiration die becomes a d10.' },
    { level: 12, id: 'asi-12', label: 'Ability Score Improvement 12', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 14, id: 'peerless-skill', label: 'Peerless Skill (Subclass Feature)', summary: 'When you make an ability check or attack roll and fail, you can expend one Bardic Inspiration die and add it to the roll, potentially turning failure into success.' },
    { level: 15, id: 'bardic-inspiration-d12', label: 'Bardic Inspiration (d12)', summary: 'Your Bardic Inspiration die becomes a d12.' },
    { level: 16, id: 'asi-16', label: 'Ability Score Improvement 16', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 18, id: 'superior-inspiration', label: 'Superior Inspiration', summary: 'When you roll Initiative and have fewer than two uses of Bardic Inspiration remaining, you regain uses until you have two.' },
    { level: 19, id: 'epic-boon', label: 'Epic Boon (Ability Score Improvement 19)', summary: 'Gain an Epic Boon feat or another feat of your choice for which you qualify.' },
    { level: 20, id: 'words-of-creation', label: 'Words of Creation', summary: 'You always have the Power Word Heal and Power Word Kill spells prepared, and can target a second creature within 10 feet of the first when casting either spell.' },
  ],
  cleric: [
    { level: 1, id: 'spellcasting', label: 'Spellcasting', summary: 'Cast prepared Cleric spells using Wisdom as your spellcasting ability and a Holy Symbol as a Spellcasting Focus.' },
    { level: 1, id: 'divine-order', label: 'Divine Order', summary: 'Dedicate yourself to the Protector (Martial weapons and Heavy armor training) or Thaumaturge (extra cantrip and Wisdom bonus to Arcana/Religion checks) sacred role.' },
    { level: 2, id: 'channel-divinity', label: 'Channel Divinity', summary: 'Channel divine energy directly from the Outer Planes to fuel Divine Spark (heal or deal Radiant/Necrotic damage equal to 1d8 + Wisdom modifier) or Turn Undead.' },
    { level: 3, id: 'cleric-subclass', label: 'Life Domain (Cleric Subclass)', summary: 'Gain Domain Spells, Disciple of Life (+2 + spell level bonus HP restored by healing spells), and Preserve Life Channel Divinity.' },
    { level: 4, id: 'asi-4', label: 'Ability Score Improvement 4', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 5, id: 'sear-undead', label: 'Sear Undead', summary: 'Whenever you use Turn Undead, you can roll a number of d8s equal to your Wisdom modifier and deal that much Radiant damage to each Undead that fails its save.' },
    { level: 6, id: 'blessed-healer', label: 'Blessed Healer (Subclass Feature)', summary: 'When you cast a spell with a spell slot that restores Hit Points to another creature, you also regain 2 + the spell slot’s level Hit Points.' },
    { level: 7, id: 'blessed-strikes', label: 'Blessed Strikes', summary: 'Choose Divine Strike (once per turn add 1d8 Radiant or Necrotic damage to a weapon hit) or Potent Spellcasting (add Wisdom modifier to Cleric cantrip damage).' },
    { level: 8, id: 'asi-8', label: 'Ability Score Improvement 8', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 10, id: 'divine-intervention', label: 'Divine Intervention', summary: ' take a Magic action to call on your deity to cast any Cleric spell of level 5 or lower that doesn’t require a Reaction without expending a spell slot or Material components (once per Long Rest).' },
    { level: 12, id: 'asi-12', label: 'Ability Score Improvement 12', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 14, id: 'improved-blessed-strikes', label: 'Improved Blessed Strikes', summary: 'Divine Strike damage increases to 2d8, or Potent Spellcasting grants Temporary Hit Points equal to twice your Wisdom modifier to a creature within 60 feet.' },
    { level: 16, id: 'asi-16', label: 'Ability Score Improvement 16', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 17, id: 'supreme-healing', label: 'Supreme Healing (Subclass Feature)', summary: 'When you would normally roll one or more dice to restore Hit Points to a creature with a spell or Channel Divinity, use the highest number possible for each die instead of rolling.' },
    { level: 19, id: 'epic-boon', label: 'Epic Boon (Ability Score Improvement 19)', summary: 'Gain an Epic Boon feat or another feat of your choice for which you qualify.' },
    { level: 20, id: 'greater-divine-intervention', label: 'Greater Divine Intervention', summary: 'When you use Divine Intervention, you can choose the Wish spell, after which you can’t use Divine Intervention again for 2d4 Long Rests.' },
  ],
  druid: [
    { level: 1, id: 'druidic', label: 'Druidic', summary: 'You know Druidic, the secret language of Druids, and always have the Speak with Animals spell prepared.' },
    { level: 1, id: 'primal-order', label: 'Primal Order', summary: 'Dedicate yourself to the Magician (extra cantrip and Wisdom bonus to Arcana/Nature checks) or Warden (Martial weapons and Medium armor training) sacred role.' },
    { level: 1, id: 'spellcasting', label: 'Spellcasting', summary: 'Cast prepared Druid spells using Wisdom as your spellcasting ability and a Druidic Focus.' },
    { level: 2, id: 'wild-shape', label: 'Wild Shape', summary: 'As a Bonus Action, shape-shift into a Beast form you have learned, gaining Temporary Hit Points equal to your Druid level.' },
    { level: 2, id: 'wild-companion', label: 'Wild Companion', summary: 'Take a Magic action to expend a spell slot or a use of Wild Shape to cast the Find Familiar spell without Material components.' },
    { level: 3, id: 'druid-subclass', label: 'Circle of the Land (Druid Subclass)', summary: 'Attune to Arid, Polar, Temperate, or Tropical land spells and use Land’s Aid by expending Wild Shape to heal allies and damage foes in a 10-foot sphere.' },
    { level: 4, id: 'asi-4', label: 'Ability Score Improvement 4', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 5, id: 'wild-resurgence', label: 'Wild Resurgence', summary: 'Once on each of your turns, if you have no uses of Wild Shape left, you can expend a spell slot to give yourself one use, or expend one Wild Shape use to regain a level 1 spell slot (once per Long Rest).' },
    { level: 6, id: 'natural-recovery', label: 'Natural Recovery (Subclass Feature)', summary: 'Cast one prepared Circle spell without expending a spell slot (once per Long Rest) and recover expended spell slots during a Short Rest.' },
    { level: 7, id: 'elemental-fury', label: 'Elemental Fury', summary: 'Choose Potent Spellcasting (add Wisdom modifier to Druid cantrip damage) or Primal Strike (once per turn add 1d8 Cold, Fire, Lightning, or Thunder damage to a weapon or Beast attack).' },
    { level: 8, id: 'asi-8', label: 'Ability Score Improvement 8', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 10, id: 'natures-ward', label: 'Nature’s Ward (Subclass Feature)', summary: 'You are immune to the Poisoned condition and have Resistance to a damage type associated with your current Circle of the Land terrain.' },
    { level: 12, id: 'asi-12', label: 'Ability Score Improvement 12', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 14, id: 'natures-sanctuary', label: 'Nature’s Sanctuary (Subclass Feature)', summary: 'Expend a use of Wild Shape as a Magic action to conjure spectral trees and vines in a 15-foot Cube that grant Half Cover and Resistance to allies.' },
    { level: 15, id: 'improved-elemental-fury', label: 'Improved Elemental Fury', summary: 'Potent Spellcasting cantrips with a range of 10+ feet gain 300 feet of extra range, or Primal Strike extra damage increases to 2d8.' },
    { level: 16, id: 'asi-16', label: 'Ability Score Improvement 16', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 18, id: 'beast-spells', label: 'Beast Spells', summary: 'While using Wild Shape, you can cast spells in Beast form, except for any spell that has a Material component with a cost specified or that is consumed.' },
    { level: 19, id: 'epic-boon', label: 'Epic Boon (Ability Score Improvement 19)', summary: 'Gain an Epic Boon feat or another feat of your choice for which you qualify.' },
    { level: 20, id: 'archdruid', label: 'Archdruid', summary: 'Gain Evergreen Wild Shape (regain one use when rolling Initiative with none left), Nature Magician (convert Wild Shape uses into a spell slot), and Longevity.' },
  ],
  fighter: [
    { level: 1, id: 'fighting-style', label: 'Fighting Style', summary: 'Gain a Fighting Style feat of your choice (such as Defense, Dueling, Archery, or Great Weapon Fighting).' },
    { level: 1, id: 'second-wind', label: 'Second Wind', summary: 'As a Bonus Action, regain Hit Points equal to 1d10 + your Fighter level.' },
    { level: 1, id: 'weapon-mastery', label: 'Weapon Mastery', summary: 'Use the mastery properties of three kinds of Simple or Martial weapons of your choice.' },
    { level: 2, id: 'action-surge', label: 'Action Surge', summary: 'On your turn, you can take one additional action, except the Magic action (recharges on a Short or Long Rest).' },
    { level: 2, id: 'tactical-mind', label: 'Tactical Mind', summary: 'When you fail an ability check, you can expend a use of Second Wind to roll 1d10 and add it to the check; if it still fails, the Second Wind use isn’t expended.' },
    { level: 3, id: 'fighter-subclass', label: 'Champion (Fighter subclass)', summary: 'Your weapon attacks score a Critical Hit on a roll of 19 or 20 (Improved Critical), and you gain Remarkable Athlete (Advantage on Initiative and Athletics checks).' },
    { level: 4, id: 'asi-4', label: 'Ability Score Improvement 4', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 5, id: 'extra-attack', label: 'Extra Attack', summary: 'You can attack twice instead of once whenever you take the Attack action on your turn.' },
    { level: 5, id: 'tactical-shift', label: 'Tactical Shift', summary: 'Whenever you activate your Second Wind with a Bonus Action, you can move up to half your Speed without provoking Opportunity Attacks.' },
    { level: 6, id: 'asi-6', label: 'Ability Score Improvement 6', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 7, id: 'additional-fighting-style', label: 'Additional Fighting Style (Subclass Feature)', summary: 'You gain another Fighting Style feat of your choice.' },
    { level: 8, id: 'asi-8', label: 'Ability Score Improvement 8', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 9, id: 'indomitable', label: 'Indomitable', summary: 'If you fail a saving throw, you can reroll it with a bonus equal to your Fighter level (once per Long Rest, scaling at higher levels).' },
    { level: 9, id: 'tactical-master', label: 'Tactical Master', summary: 'When you attack with a weapon whose mastery property you can use, you can replace that property with the Push, Sap, or Slow property for that attack.' },
    { level: 10, id: 'heroic-warrior', label: 'Heroic Warrior (Subclass Feature)', summary: 'During combat, you can give yourself Heroic Inspiration at the start of your turn whenever you don’t have it.' },
    { level: 11, id: 'two-extra-attacks', label: 'Two Extra Attacks', summary: 'You can attack three times instead of once whenever you take the Attack action on your turn.' },
    { level: 12, id: 'asi-12', label: 'Ability Score Improvement 12', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 13, id: 'studied-attacks', label: 'Studied Attacks', summary: 'If you make an attack roll against a creature and miss, you have Advantage on your next attack roll against that creature before the end of your next turn.' },
    { level: 14, id: 'asi-14', label: 'Ability Score Improvement 14', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 15, id: 'superior-critical', label: 'Superior Critical (Subclass Feature)', summary: 'Your weapon attacks score a Critical Hit on a d20 roll of 18–20.' },
    { level: 16, id: 'asi-16', label: 'Ability Score Improvement 16', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 18, id: 'survivor', label: 'Survivor (Subclass Feature)', summary: 'Gain Defy Death (Advantage on Death Saving Throws and 18–20 counts as a 20) and Heroic Rally (regain 5 + Constitution modifier HP at the start of your turn when Bloodied).' },
    { level: 19, id: 'epic-boon', label: 'Epic Boon (Ability Score Improvement 19)', summary: 'Gain an Epic Boon feat or another feat of your choice for which you qualify.' },
    { level: 20, id: 'three-extra-attacks', label: 'Three Extra Attacks', summary: 'You can attack four times instead of once whenever you take the Attack action on your turn.' },
  ],
  monk: [
    { level: 1, id: 'martial-arts', label: 'Martial Arts', summary: 'Make an Unarmed Strike as a Bonus Action, use Dexterity for Unarmed Strikes and Monk weapons, and roll your Martial Arts die (d6, scaling to d12) for damage.' },
    { level: 1, id: 'unarmored-defense', label: 'Unarmored Defense', summary: 'While not wearing armor or wielding a Shield, your base Armor Class equals 10 + your Dexterity modifier + your Wisdom modifier.' },
    { level: 2, id: 'monks-focus', label: "Monk's Focus", summary: 'Gain Focus Points equal to your Monk level (recharging on a Short or Long Rest) to fuel Flurry of Blows, Patient Defense, and Step of the Wind.' },
    { level: 2, id: 'unarmored-movement', label: 'Unarmored Movement', summary: 'Your Speed increases by 10 feet while you aren’t wearing armor or wielding a Shield (scaling up to +30 feet at higher levels).' },
    { level: 2, id: 'uncanny-metabolism', label: 'Uncanny Metabolism', summary: 'When you roll Initiative, you can regain all expended Focus Points and regain Hit Points equal to your Martial Arts die + your Monk level (once per Long Rest).' },
    { level: 3, id: 'deflect-attacks', label: 'Deflect Attacks', summary: 'When an attack roll hits you and deals Bludgeoning, Piercing, or Slashing damage, take a Reaction to reduce the damage by 1d10 + your Dexterity modifier + your Monk level, and spend 1 Focus Point to redirect it if reduced to 0.' },
    { level: 3, id: 'monk-subclass', label: 'Warrior of the Open Hand (Monk Subclass)', summary: 'Whenever you hit a creature with a Flurry of Blows attack, you can impose Addle (no Opportunity Attacks), Push (15 ft), or Topple (Prone).' },
    { level: 4, id: 'asi-4', label: 'Ability Score Improvement 4', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 4, id: 'slow-fall', label: 'Slow Fall', summary: 'Take a Reaction when you fall to reduce any falling damage you take by an amount equal to five times your Monk level.' },
    { level: 5, id: 'extra-attack', label: 'Extra Attack', summary: 'You can attack twice instead of once whenever you take the Attack action on your turn.' },
    { level: 5, id: 'stunning-strike', label: 'Stunning Strike', summary: 'Once per turn when you hit a creature with a Monk weapon or Unarmed Strike, you can expend 1 Focus Point to force a Constitution save (Stunned on failure; Speed halved and next attack against it has Advantage on success).' },
    { level: 6, id: 'empowered-strikes', label: 'Empowered Strikes', summary: 'Whenever you deal damage with your Unarmed Strike, it can deal your choice of Force damage or its normal damage type.' },
    { level: 6, id: 'wholeness-of-body', label: 'Wholeness of Body (Subclass Feature)', summary: 'As a Bonus Action, roll your Martial Arts die and regain Hit Points equal to the roll plus your Wisdom modifier (uses equal to Wisdom modifier per Long Rest).' },
    { level: 7, id: 'evasion', label: 'Evasion', summary: 'When you’re subjected to an effect that allows a Dexterity saving throw to take only half damage, you instead take no damage if you succeed and only half damage if you fail.' },
    { level: 8, id: 'asi-8', label: 'Ability Score Improvement 8', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 9, id: 'acrobatic-movement', label: 'Acrobatic Movement', summary: 'While you aren’t wearing armor or wielding a Shield, you gain the ability to move along vertical surfaces and across liquids on your turn without falling during the movement.' },
    { level: 10, id: 'heightened-focus', label: 'Heightened Focus', summary: 'Flurry of Blows makes three Unarmed Strikes instead of two, Patient Defense grants Temporary Hit Points equal to two Martial Arts dice, and Step of the Wind lets you carry a willing creature.' },
    { level: 10, id: 'self-restoration', label: 'Self-Restoration', summary: 'At the end of each of your turns, you can remove the Charmed, Frightened, or Poisoned condition from yourself.' },
    { level: 11, id: 'fleet-step', label: 'Fleet Step (Subclass Feature)', summary: 'When you take a Bonus Action other than Step of the Wind, you can also use Step of the Wind immediately as part of that Bonus Action.' },
    { level: 12, id: 'asi-12', label: 'Ability Score Improvement 12', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 13, id: 'deflect-energy', label: 'Deflect Energy', summary: 'You can now use your Deflect Attacks feature against attacks that deal any damage type, not just Bludgeoning, Piercing, or Slashing.' },
    { level: 14, id: 'disciplined-survivor', label: 'Disciplined Survivor', summary: 'You have saving throw proficiency in all six abilities, and whenever you fail a saving throw you can expend 1 Focus Point to reroll it.' },
    { level: 15, id: 'perfect-focus', label: 'Perfect Focus', summary: 'When you roll Initiative and don’t use Uncanny Metabolism, if you have fewer than 4 Focus Points, you regain Focus Points until you have 4.' },
    { level: 16, id: 'asi-16', label: 'Ability Score Improvement 16', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 17, id: 'quivering-palm', label: 'Quivering Palm (Subclass Feature)', summary: 'Impart lethal vibrations on an Unarmed Strike hit and expend 4 Focus Points as a Magic action to deal 10d12 Force damage (half on a successful Constitution save).' },
    { level: 18, id: 'superior-defense', label: 'Superior Defense', summary: 'At the start of your turn, you can expend 3 Focus Points to gain Resistance to all damage except Force damage for 1 minute.' },
    { level: 19, id: 'epic-boon', label: 'Epic Boon (Ability Score Improvement 19)', summary: 'Gain an Epic Boon feat or another feat of your choice for which you qualify.' },
    { level: 20, id: 'body-and-mind', label: 'Body and Mind', summary: 'Your Dexterity and Wisdom scores each increase by 4, to a maximum of 25.' },
  ],
  paladin: [
    { level: 1, id: 'lay-on-hands', label: 'Lay on Hands', summary: 'As a Bonus Action, draw from a pool of healing power (5 × Paladin level HP) to restore Hit Points or expend 5 HP to remove the Poisoned condition.' },
    { level: 1, id: 'spellcasting', label: 'Spellcasting', summary: 'Cast prepared Paladin spells using Charisma as your spellcasting ability and a Holy Symbol as a Spellcasting Focus.' },
    { level: 1, id: 'weapon-mastery', label: 'Weapon Mastery', summary: 'Use the mastery properties of two kinds of weapons of your choice with which you have proficiency.' },
    { level: 2, id: 'fighting-style', label: 'Fighting Style', summary: 'Gain a Fighting Style feat of your choice or Blessed Warrior (two Cleric cantrips).' },
    { level: 2, id: 'paladins-smite', label: "Paladin's Smite", summary: 'You always have the Divine Smite spell prepared, and you can cast it once without expending a spell slot (regaining the free use on a Long Rest).' },
    { level: 3, id: 'channel-divinity', label: 'Channel Divinity', summary: 'Channel divine energy from the Outer Planes to fuel Divine Sense and your Sacred Oath Channel Divinity options.' },
    { level: 3, id: 'paladin-subclass', label: 'Oath of Devotion (Paladin Subclass)', summary: 'Gain Oath Spells and Sacred Weapon Channel Divinity (add your Charisma modifier to attack rolls with one weapon for 10 minutes as part of the Attack action).' },
    { level: 4, id: 'asi-4', label: 'Ability Score Improvement 4', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 5, id: 'extra-attack', label: 'Extra Attack', summary: 'You can attack twice instead of once whenever you take the Attack action on your turn.' },
    { level: 5, id: 'faithful-steed', label: 'Faithful Steed', summary: 'You always have the Find Steed spell prepared, and you can cast it once without expending a spell slot (recharging on a Long Rest).' },
    { level: 6, id: 'aura-of-protection', label: 'Aura of Protection', summary: 'You and your allies within a 10-foot Emanation gain a bonus to saving throws equal to your Charisma modifier (minimum +1) while you aren’t Incapacitated.' },
    { level: 7, id: 'aura-of-devotion', label: 'Aura of Devotion (Subclass Feature)', summary: 'You and your allies in your Aura of Protection have Immunity to the Charmed condition.' },
    { level: 8, id: 'asi-8', label: 'Ability Score Improvement 8', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 9, id: 'abjure-foes', label: 'Abjure Foes', summary: 'Take a Magic action and expend a Channel Divinity use to overwhelm foes within 60 feet (Wisdom save or Frightened and restricted to either moving or taking an action each turn).' },
    { level: 10, id: 'aura-of-courage', label: 'Aura of Courage', summary: 'You and your allies have Immunity to the Frightened condition while in your Aura of Protection.' },
    { level: 11, id: 'radiant-strikes', label: 'Radiant Strikes', summary: 'Whenever you hit a target with an attack roll using a Melee weapon or an Unarmed Strike, the target takes an extra 1d8 Radiant damage.' },
    { level: 12, id: 'asi-12', label: 'Ability Score Improvement 12', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 14, id: 'restoring-touch', label: 'Restoring Touch', summary: 'When you use Lay on Hands on a creature, you can also expend 5 HP from the pool to remove the Blinded, Charmed, Deafened, Frightened, Paralyzed, or Stunned condition.' },
    { level: 15, id: 'smite-of-protection', label: 'Smite of Protection (Subclass Feature)', summary: 'Whenever you cast Divine Smite, your Aura of Protection grants Half Cover to you and your allies inside it until the start of your next turn.' },
    { level: 16, id: 'asi-16', label: 'Ability Score Improvement 16', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 18, id: 'aura-expansion', label: 'Aura Expansion', summary: 'Your Aura of Protection is now a 30-foot Emanation.' },
    { level: 19, id: 'epic-boon', label: 'Epic Boon (Ability Score Improvement 19)', summary: 'Gain an Epic Boon feat or another feat of your choice for which you qualify.' },
    { level: 20, id: 'holy-nimbus', label: 'Holy Nimbus (Subclass Feature)', summary: 'As a Bonus Action, imbue your Aura of Protection with Sunlight for 10 minutes, granting Advantage on saves against Fiends and Undead and dealing Radiant damage to enemies starting their turn inside.' },
  ],
  ranger: [
    { level: 1, id: 'spellcasting', label: 'Spellcasting', summary: 'Cast prepared Ranger spells using Wisdom as your spellcasting ability and a Druidic Focus.' },
    { level: 1, id: 'favored-enemy', label: 'Favored Enemy', summary: 'You always have the Hunter’s Mark spell prepared, and you can cast it twice without expending a spell slot (scaling with Ranger level and recharging on a Long Rest).' },
    { level: 1, id: 'weapon-mastery', label: 'Weapon Mastery', summary: 'Use the mastery properties of two kinds of weapons of your choice with which you have proficiency.' },
    { level: 2, id: 'deft-explorer', label: 'Deft Explorer', summary: 'Gain Expertise in one of your skill proficiencies of your choice and learn two languages of your choice.' },
    { level: 2, id: 'fighting-style', label: 'Fighting Style', summary: 'Gain a Fighting Style feat of your choice or Druidic Warrior (two Druid cantrips).' },
    { level: 3, id: 'ranger-subclass', label: 'Hunter (Ranger Subclass)', summary: 'Gain Hunter’s Lore (know immunities, resistances, and vulnerabilities of a creature marked by Hunter’s Mark) and Hunter’s Prey (Colossus Slayer 1d8 extra damage or Horde Breaker).' },
    { level: 4, id: 'asi-4', label: 'Ability Score Improvement 4', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 5, id: 'extra-attack', label: 'Extra Attack', summary: 'You can attack twice instead of once whenever you take the Attack action on your turn.' },
    { level: 6, id: 'roving', label: 'Roving', summary: 'Your Speed increases by 10 feet while you aren’t wearing Heavy armor, and you gain a Climb Speed and a Swim Speed equal to your Speed.' },
    { level: 7, id: 'defensive-tactics', label: 'Defensive Tactics (Subclass Feature)', summary: 'Choose Escape the Horde (Opportunity Attacks against you have Disadvantage) or Multiattack Defense (after a creature hits you, it has Disadvantage on other attacks against you this turn).' },
    { level: 8, id: 'asi-8', label: 'Ability Score Improvement 8', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 9, id: 'expertise-9', label: 'Expertise (Additional Skills)', summary: 'Gain Expertise in two more of your skill proficiencies of your choice.' },
    { level: 10, id: 'tireless', label: 'Tireless', summary: 'Take a Magic action to give yourself 1d8 + Wisdom modifier Temporary Hit Points (Wisdom modifier uses per Long Rest), and reduce your Exhaustion level by 1 on a Short Rest.' },
    { level: 11, id: 'superior-hunters-prey', label: "Superior Hunter's Prey (Subclass Feature)", summary: 'Once per turn when you deal damage to a creature marked by your Hunter’s Mark, you can also deal that spell’s extra damage to a different creature within 30 feet of the first.' },
    { level: 12, id: 'asi-12', label: 'Ability Score Improvement 12', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 13, id: 'relentless-hunter', label: 'Relentless Hunter', summary: 'Taking damage can’t break your Concentration on Hunter’s Mark.' },
    { level: 14, id: 'natures-veil', label: "Nature's Veil", summary: 'As a Bonus Action, give yourself the Invisible condition until the end of your next turn (Wisdom modifier uses per Long Rest).' },
    { level: 15, id: 'superior-hunters-defense', label: "Superior Hunter's Defense (Subclass Feature)", summary: 'When you take damage, you can take a Reaction to give yourself Resistance to that damage and any other damage of the same type until the end of the current turn.' },
    { level: 16, id: 'asi-16', label: 'Ability Score Improvement 16', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 17, id: 'precise-hunter', label: 'Precise Hunter', summary: 'You have Advantage on attack rolls against the creature currently marked by your Hunter’s Mark.' },
    { level: 18, id: 'feral-senses', label: 'Feral Senses', summary: 'You gain Blindsight with a range of 30 feet.' },
    { level: 19, id: 'epic-boon', label: 'Epic Boon (Ability Score Improvement 19)', summary: 'Gain an Epic Boon feat or another feat of your choice for which you qualify.' },
    { level: 20, id: 'foe-slayer', label: 'Foe Slayer', summary: 'The damage die of your Hunter’s Mark is a d10 rather than a d6.' },
  ],
  rogue: [
    { level: 1, id: 'expertise', label: 'Expertise', summary: 'Gain Expertise in two of your skill proficiencies of your choice, doubling your Proficiency Bonus for checks using them.' },
    { level: 1, id: 'sneak-attack', label: 'Sneak Attack', summary: 'Once per turn, deal extra 1d6 damage (scaling by 1d6 every odd Rogue level) when you hit with a Finesse or Ranged weapon and have Advantage or an ally within 5 feet of the target.' },
    { level: 1, id: 'thieves-cant', label: "Thieves' Cant", summary: 'You know Thieves’ Cant and one other language of your choice.' },
    { level: 1, id: 'weapon-mastery', label: 'Weapon Mastery', summary: 'Use the mastery properties of two kinds of weapons of your choice with which you have proficiency.' },
    { level: 2, id: 'cunning-action', label: 'Cunning Action', summary: 'On your turn, you can take a Bonus Action to take the Dash, Disengage, or Hide action.' },
    { level: 3, id: 'rogue-subclass', label: 'Thief (Rogue Subclass)', summary: 'Gain Fast Hands (use Cunning Action to make a Sleight of Hand check, pick a lock, disarm a trap, or take the Utilize/Magic item action) and Second-Story Work (Climb Speed and Dexterity jumps).' },
    { level: 3, id: 'steady-aim', label: 'Steady Aim', summary: 'As a Bonus Action, give yourself Advantage on your next attack roll on the current turn if you haven’t moved yet this turn (reducing your Speed to 0 for the turn).' },
    { level: 4, id: 'asi-4', label: 'Ability Score Improvement 4', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 5, id: 'cunning-strike', label: 'Cunning Strike', summary: 'When you deal Sneak Attack damage, you can forgo 1d6 of the Sneak Attack dice to apply Poison (Poisoned), Trip (Prone), or Withdraw (move half Speed without Opportunity Attacks).' },
    { level: 5, id: 'uncanny-dodge', label: 'Uncanny Dodge', summary: 'When an attacker that you can see hits you with an attack roll, you can take a Reaction to halve the attack’s damage against you (round down).' },
    { level: 6, id: 'expertise-6', label: 'Expertise (Additional Skills)', summary: 'Gain Expertise in two more of your skill proficiencies of your choice.' },
    { level: 7, id: 'evasion', label: 'Evasion', summary: 'When you’re subjected to an effect that allows a Dexterity saving throw to take only half damage, you instead take no damage if you succeed and only half damage if you fail.' },
    { level: 7, id: 'reliable-talent', label: 'Reliable Talent', summary: 'Whenever you make an ability check that uses one of your skill or tool proficiencies, you can treat a d20 roll of 9 or lower as a 10.' },
    { level: 8, id: 'asi-8', label: 'Ability Score Improvement 8', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 9, id: 'supreme-sneak', label: 'Supreme Sneak (Subclass Feature)', summary: 'Gain the Stealth Attack Cunning Strike option (cost 1d6: if you have the Invisible condition from Hide, this attack doesn’t end that condition if you end your turn behind Three-Quarters or Total Cover).' },
    { level: 10, id: 'asi-10', label: 'Ability Score Improvement 10', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 11, id: 'improved-cunning-strike', label: 'Improved Cunning Strike', summary: 'You can use up to two Cunning Strike effects when you deal Sneak Attack damage, paying the die cost for each effect.' },
    { level: 12, id: 'asi-12', label: 'Ability Score Improvement 12', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 13, id: 'use-magic-device', label: 'Use Magic Device (Subclass Feature)', summary: 'Attune to up to four magic items at once, roll 1d6 when expending magic item charges (spending none on a 6), and use any Spell Scroll using Intelligence as your spellcasting ability.' },
    { level: 14, id: 'devious-strikes', label: 'Devious Strikes', summary: 'Add Daze (cost 2d6), Knock Out (cost 6d6: Unconscious), and Obscure (cost 3d6: Blinded) to your Cunning Strike options.' },
    { level: 15, id: 'slippery-mind', label: 'Slippery Mind', summary: 'You gain saving throw proficiency in Wisdom and Charisma.' },
    { level: 16, id: 'asi-16', label: 'Ability Score Improvement 16', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 17, id: 'thiefs-reflexes', label: "Thief's Reflexes (Subclass Feature)", summary: 'You can take two turns during the first round of any combat (taking your first turn at your normal Initiative and your second turn at your Initiative minus 10).' },
    { level: 18, id: 'elusive', label: 'Elusive', summary: 'No attack roll can have Advantage against you unless you have the Incapacitated condition.' },
    { level: 19, id: 'epic-boon', label: 'Epic Boon (Ability Score Improvement 19)', summary: 'Gain an Epic Boon feat or another feat of your choice for which you qualify.' },
    { level: 20, id: 'stroke-of-luck', label: 'Stroke of Luck', summary: 'If you fail a d20 Test, you can turn the roll into a 20 (once per Short or Long Rest).' },
  ],
  sorcerer: [
    { level: 1, id: 'spellcasting', label: 'Spellcasting', summary: 'Cast prepared Sorcerer spells using Charisma as your spellcasting ability and an Arcane Focus.' },
    { level: 1, id: 'innate-sorcery', label: 'Innate Sorcery', summary: 'As a Bonus Action, unleash simmering magic for 1 minute: your Sorcerer spell save DC increases by 1 and you have Advantage on the attack rolls of Sorcerer spells you cast (twice per Long Rest).' },
    { level: 2, id: 'font-of-magic', label: 'Font of Magic', summary: 'Gain Sorcery Points equal to your Sorcerer level to convert between Sorcery Points and spell slots as a Bonus Action.' },
    { level: 2, id: 'metamagic', label: 'Metamagic', summary: 'Learn two Metamagic options of your choice (such as Careful, Distant, Empowered, Heightened, Quickened, Subtle, or Twinned Spell) to twist spells to suit your needs.' },
    { level: 3, id: 'sorcerer-subclass', label: 'Draconic Sorcery (Sorcerer Subclass)', summary: 'Gain Draconic Spells and Draconic Resilience (your Hit Point maximum increases by 3 plus 1 per Sorcerer level, and your base AC when not wearing armor equals 10 + Dexterity + Charisma).' },
    { level: 4, id: 'asi-4', label: 'Ability Score Improvement 4', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 5, id: 'sorcerous-restoration', label: 'Sorcerous Restoration', summary: 'When you finish a Short Rest, you can regain expended Sorcery Points up to half your Sorcerer level (round down), once per Long Rest.' },
    { level: 6, id: 'elemental-affinity', label: 'Elemental Affinity (Subclass Feature)', summary: 'Gain Resistance to the damage type of your Draconic ancestry (Acid, Cold, Fire, Lightning, or Poison), and add your Charisma modifier to one damage roll of any Sorcerer spell that deals that damage type.' },
    { level: 7, id: 'sorcery-incarnate', label: 'Sorcery Incarnate', summary: 'If you have no uses of Innate Sorcery left, you can spend 2 Sorcery Points to activate it, and while Innate Sorcery is active you can use up to two Metamagic options on each spell you cast.' },
    { level: 8, id: 'asi-8', label: 'Ability Score Improvement 8', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 10, id: 'metamagic-10', label: 'Metamagic (Additional Options)', summary: 'Learn two additional Metamagic options of your choice.' },
    { level: 12, id: 'asi-12', label: 'Ability Score Improvement 12', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 14, id: 'dragon-wings', label: 'Dragon Wings (Subclass Feature)', summary: 'As a Bonus Action, sprout draconic wings and gain a Fly Speed of 60 feet for 1 hour (once per Long Rest or by spending 3 Sorcery Points).' },
    { level: 16, id: 'asi-16', label: 'Ability Score Improvement 16', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 17, id: 'metamagic-17', label: 'Metamagic (Mastery Options)', summary: 'Learn two more Metamagic options of your choice.' },
    { level: 18, id: 'dragon-companion', label: 'Dragon Companion (Subclass Feature)', summary: 'You can cast Summon Dragon without a Material component, and can cast it once per Long Rest without expending a spell slot.' },
    { level: 19, id: 'epic-boon', label: 'Epic Boon (Ability Score Improvement 19)', summary: 'Gain an Epic Boon feat or another feat of your choice for which you qualify.' },
    { level: 20, id: 'arcane-apotheosis', label: 'Arcane Apotheosis', summary: 'While your Innate Sorcery feature is active, you can use one Metamagic option on each of your turns without spending Sorcery Points on it.' },
  ],
  warlock: [
    { level: 1, id: 'eldritch-invocations', label: 'Eldritch Invocations', summary: 'Unearth Eldritch Invocations (such as Pact of the Blade, Pact of the Chain, Pact of the Tome, or Agonizing Blast), gaining more as you reach higher Warlock levels.' },
    { level: 1, id: 'pact-magic', label: 'Pact Magic', summary: 'Cast prepared Warlock spells using Charisma; your Pact Magic spell slots are all of the same level and recharge on a Short or Long Rest.' },
    { level: 2, id: 'magical-cunning', label: 'Magical Cunning', summary: 'Perform an esoteric rite for 1 minute to regain expended Pact Magic spell slots up to half your maximum (round up), once per Long Rest.' },
    { level: 3, id: 'warlock-subclass', label: 'Fiend Patron (Warlock Subclass)', summary: 'Gain Fiend Spells and Dark One’s Blessing (gain Temporary Hit Points equal to your Charisma modifier + your Warlock level whenever you reduce an enemy to 0 HP or an enemy within 10 feet drops to 0 HP).' },
    { level: 4, id: 'asi-4', label: 'Ability Score Improvement 4', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 6, id: 'dark-ones-own-luck', label: "Dark One's Own Luck (Subclass Feature)", summary: 'When you make an ability check or a saving throw, you can add 1d10 to the roll after seeing the roll (Charisma modifier uses per Long Rest).' },
    { level: 8, id: 'asi-8', label: 'Ability Score Improvement 8', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 9, id: 'contact-patron', label: 'Contact Patron', summary: 'You always have the Contact Other Plane spell prepared and can cast it once per Long Rest without expending a spell slot, automatically succeeding on its saving throw.' },
    { level: 10, id: 'fiendish-resilience', label: 'Fiendish Resilience (Subclass Feature)', summary: 'Choose one damage type other than Force whenever you finish a Short or Long Rest; you have Resistance to that damage type until you choose a different one.' },
    { level: 11, id: 'mystic-arcanum-6', label: 'Mystic Arcanum (Level 6 Spell)', summary: 'Your patron grants you a magical secret called an arcanum: choose one level 6 Warlock spell that you can cast once per Long Rest without expending a spell slot.' },
    { level: 12, id: 'asi-12', label: 'Ability Score Improvement 12', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 13, id: 'mystic-arcanum-7', label: 'Mystic Arcanum (Level 7 Spell)', summary: 'Gain a level 7 Warlock spell as an arcanum that you can cast once per Long Rest without expending a spell slot.' },
    { level: 14, id: 'hurl-through-hell', label: 'Hurl Through Hell (Subclass Feature)', summary: 'Once per turn when you hit a creature with an attack roll, force a Charisma save or banish it through the Lower Planes until the end of your next turn, dealing 8d10 Psychic damage if it isn’t a Fiend.' },
    { level: 15, id: 'mystic-arcanum-8', label: 'Mystic Arcanum (Level 8 Spell)', summary: 'Gain a level 8 Warlock spell as an arcanum that you can cast once per Long Rest without expending a spell slot.' },
    { level: 16, id: 'asi-16', label: 'Ability Score Improvement 16', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 17, id: 'mystic-arcanum-9', label: 'Mystic Arcanum (Level 9 Spell)', summary: 'Gain a level 9 Warlock spell as an arcanum that you can cast once per Long Rest without expending a spell slot.' },
    { level: 19, id: 'epic-boon', label: 'Epic Boon (Ability Score Improvement 19)', summary: 'Gain an Epic Boon feat or another feat of your choice for which you qualify.' },
    { level: 20, id: 'eldritch-master', label: 'Eldritch Master', summary: 'When you use your Magical Cunning feature, you regain all your expended Pact Magic spell slots.' },
  ],
  wizard: [
    { level: 1, id: 'spellcasting', label: 'Spellcasting', summary: 'Cast prepared Wizard spells from your spellbook using Intelligence as your spellcasting ability, and cast any Ritual spell in your spellbook without having it prepared.' },
    { level: 1, id: 'arcane-recovery', label: 'Arcane Recovery', summary: 'When you finish a Short Rest, recover expended spell slots with a combined level up to half your Wizard level (round up, none level 6+), once per Long Rest.' },
    { level: 2, id: 'scholar', label: 'Scholar', summary: 'While studying magic, you also specialized in another field: gain Expertise in one of your proficient skills from Arcana, History, Investigation, Medicine, Nature, or Religion.' },
    { level: 3, id: 'wizard-subclass', label: 'Evoker (Wizard Subclass)', summary: 'Gain Evocation Savant (two free Evocation spells added to your spellbook) and Potent Cantrip (creatures that succeed on a save against your damaging cantrips or that you miss with a cantrip attack still take half damage).' },
    { level: 4, id: 'asi-4', label: 'Ability Score Improvement 4', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 5, id: 'memorize-spell', label: 'Memorize Spell', summary: 'Whenever you finish a Short Rest, you can study your spellbook and replace one of the level 1+ Wizard spells you have prepared with another level 1+ spell from the book.' },
    { level: 6, id: 'sculpt-spells', label: 'Sculpt Spells (Subclass Feature)', summary: 'When you cast an Evocation spell that affects other creatures you can see, choose a number of them equal to 1 + the spell’s level to automatically succeed on their saves and take no damage from the spell.' },
    { level: 8, id: 'asi-8', label: 'Ability Score Improvement 8', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 10, id: 'empowered-evocation', label: 'Empowered Evocation (Subclass Feature)', summary: 'Whenever you cast a Wizard spell from the Evocation school, you can add your Intelligence modifier to one damage roll of that spell.' },
    { level: 12, id: 'asi-12', label: 'Ability Score Improvement 12', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 14, id: 'overchannel', label: 'Overchannel (Subclass Feature)', summary: 'When you cast a Wizard spell with a spell slot of levels 1–5 that deals damage, you can deal maximum damage with that spell on the turn you cast it.' },
    { level: 16, id: 'asi-16', label: 'Ability Score Improvement 16', summary: 'Gain the Ability Score Improvement feat or another feat for which you qualify.' },
    { level: 18, id: 'spell-mastery', label: 'Spell Mastery', summary: 'Choose a level 1 and a level 2 Wizard spell in your spellbook that have a casting time of an action; you always have them prepared and can cast them at their lowest level without expending a spell slot.' },
    { level: 19, id: 'epic-boon', label: 'Epic Boon (Ability Score Improvement 19)', summary: 'Gain an Epic Boon feat or another feat of your choice for which you qualify.' },
    { level: 20, id: 'signature-spells', label: 'Signature Spells', summary: 'Choose two level 3 Wizard spells in your spellbook; you always have them prepared and can cast each of them once at level 3 without expending a spell slot (recharging on a Short or Long Rest).' },
  ],
};

function classFeaturesForLevel(classId: string, level: number): readonly string[] {
  const table = SRD_CLASS_FEATURES_BY_LEVEL[classId];
  if (table !== undefined) {
    return table.filter((entry) => entry.level <= level).map((entry) => entry.label);
  }
  const features: string[] = ['Level 1 class features'];
  for (const improvementLevel of [4, 8, 12, 16, 19]) {
    if (level >= improvementLevel) features.push(`Ability Score Improvement ${improvementLevel}`);
  }
  return features;
}

function replaceProficiency(value: DerivedValue, proficiencyBonus: number): DerivedValue {
  const components = value.components.map((component) =>
    component.ruleId === 'proficiency-bonus' ||
    component.ruleId.startsWith('proficiency-bonus.') ||
    component.ruleId === 'feat.alert.initiative' ||
    component.ruleId.endsWith('.expertise')
      ? { ...component, amount: proficiencyBonus }
      : component,
  );
  return {
    components,
    value: components.reduce((total, component) => total + component.amount, 0),
  };
}

function classResourcesForLevel(
  baseSheet: DerivedCharacterSheet,
  classId: string,
  level: number,
): NonNullable<DerivedCharacterSheet['classResources']> {
  const prior = baseSheet.classResources ?? [];
  const byId = new Map(prior.map((resource) => [resource.id, resource]));
  const next: Array<{
    id: string;
    label: string;
    summary: string;
    remaining: number;
    maximum: number;
    recharge: string;
  }> = [];
  const secondWind = byId.get('second-wind');
  if (secondWind !== undefined || classId === 'fighter') {
    next.push(
      secondWind ?? {
        id: 'second-wind',
        label: 'Second Wind',
        summary: 'Regain hit points as a Bonus Action.',
        remaining: 1,
        maximum: 1,
        recharge: 'Short rest',
      },
    );
  }
  if (classId === 'fighter' && level >= 2) {
    const actionSurge = byId.get('action-surge');
    next.push(
      actionSurge ?? {
        id: 'action-surge',
        label: 'Action Surge',
        summary: 'Take one additional Action on your turn.',
        remaining: 1,
        maximum: 1,
        recharge: 'Short rest',
      },
    );
  }
  for (const resource of prior) {
    if (resource.id === 'second-wind' || resource.id === 'action-surge') {
      continue;
    }
    next.push(resource);
  }
  return next;
}

export function deriveProgression(
  baseSheet: DerivedCharacterSheet,
  classId: string,
  level: number,
): ProgressionDerivedProjection {
  const classRecord = findClass(classId);
  if (classRecord === null) {
    throw new Error('The character Class is not available for progression.');
  }
  experienceRequiredForLevel(level);
  const constitutionModifier = baseSheet.abilityModifiers.constitution;
  const averageHitDie = Math.floor(classRecord.hitDie / 2) + 1;
  const speciesHpPerLevel = baseSheet.hitPoints.components.some(
    (c) => c.ruleId.startsWith('species.') && c.ruleId.endsWith('.hit-points'),
  )
    ? 1
    : 0;
  const toughHpPerLevel = baseSheet.hitPoints.components.some(
    (c) => c.ruleId === 'feat.tough.hit-points',
  )
    ? 2
    : 0;
  const hitPointsPerAdditionalLevel =
    Math.max(1, averageHitDie + constitutionModifier) + speciesHpPerLevel + toughHpPerLevel;
  const level1HpComponents = baseSheet.hitPoints.components.filter(
    (c) => !c.ruleId.endsWith('.hit-points-after-level-1'),
  );
  const level1BaseHp =
    level1HpComponents.length > 0
      ? level1HpComponents.reduce((sum, c) => sum + c.amount, 0)
      : baseSheet.hitPoints.value;
  return {
    proficiencyBonus: proficiencyBonusForLevel(level),
    maxHitPoints: level1BaseHp + (level - 1) * hitPointsPerAdditionalLevel,
    hitDice: `${level}d${classRecord.hitDie}`,
    attacksPerAction: attacksPerActionForClass(classId, level),
    spellSlots: spellSlotsForClass(classId, level),
    classFeatures: classFeaturesForLevel(classId, level),
  };
}

/**
 * Recomputes all level-sensitive values represented by the Phase 1 sheet.
 * Original choices and derivation components remain the source of truth.
 */
export function recomputeSheetForLevel(
  baseSheet: DerivedCharacterSheet,
  classId: string,
  level: number,
  experiencePoints: number,
): DerivedCharacterSheet {
  const derived = deriveProgression(baseSheet, classId, level);
  const level1HpComponents = baseSheet.hitPoints.components.filter(
    (c) => !c.ruleId.endsWith('.hit-points-after-level-1'),
  );
  const level1BaseHp =
    level1HpComponents.length > 0
      ? level1HpComponents.reduce((sum, c) => sum + c.amount, 0)
      : baseSheet.hitPoints.value;
  const hitPointComponents = [
    ...level1HpComponents,
    ...(level > 1
      ? [{
          label: `Levels 2–${level}`,
          amount: derived.maxHitPoints - level1BaseHp,
          ruleId: `class.${classId}.hit-points-after-level-1`,
        }]
      : []),
  ];

  const equippedArmorItems = baseSheet.equipment.filter((entry) => entry.equipped !== false);
  const hasEquipmentList = baseSheet.equipment.length > 0;
  const wearingArmor = hasEquipmentList
    ? equippedArmorItems.some((entry) => {
        const lower = entry.name.trim().toLowerCase();
        return (
          entry.itemKind === 'armor' ||
          ARMOR.some((a) => a.category !== 'shield' && a.label.toLowerCase() === lower)
        );
      })
    : baseSheet.armorClass.components.some(
        (c) => c.ruleId.startsWith('armor.') && c.ruleId !== 'armor.shield',
      );
  const shieldEquipped = hasEquipmentList
    ? equippedArmorItems.some((entry) => {
        const lower = entry.name.trim().toLowerCase();
        return entry.itemKind === 'shield' || lower === 'shield';
      })
    : baseSheet.armorClass.components.some((c) => c.ruleId === 'armor.shield');
  const heavyArmorEquipped = hasEquipmentList
    ? equippedArmorItems.some((entry) => {
        const lower = entry.name.trim().toLowerCase();
        return ARMOR.some((a) => a.category === 'heavy' && a.label.toLowerCase() === lower);
      })
    : baseSheet.armorClass.components.some((c) =>
        ARMOR.some((a) => a.category === 'heavy' && c.ruleId === `armor.${a.id}`),
      );
  const monkMartialArts = classId === 'monk' && !wearingArmor && !shieldEquipped;

  const baseSpeedComponent =
    baseSheet.speed.components.find((c) => c.ruleId.startsWith('species.')) ??
    baseSheet.speed.components[0] ?? {
      label: 'Base Speed',
      amount: 30,
      ruleId: 'species.base.speed',
    };
  const updatedSpeed = deriveSpeedForSheet({
    baseSpeedComponent,
    classId,
    level,
    wearingArmor,
    shieldEquipped,
    heavyArmorEquipped,
  });

  const modifiers = baseSheet.abilityModifiers;
  const classRecord = findClass(classId);
  let updatedArmorClass = baseSheet.armorClass;
  if (
    classRecord !== null &&
    classRecord.unarmoredDefenseAbility !== null &&
    !wearingArmor &&
    !(classId === 'monk' && shieldEquipped) &&
    !baseSheet.armorClass.components.some(
      (c) => c.ruleId === `ability.${classRecord.unarmoredDefenseAbility}`,
    )
  ) {
    const unarmoredAbility = classRecord.unarmoredDefenseAbility;
    const acComponents = [
      {
        label: 'Unarmored Defense base',
        amount: 10,
        ruleId: `class.${classRecord.id}.unarmored-defense`,
      },
      {
        label: ABILITY_LABELS.dexterity,
        amount: modifiers.dexterity,
        ruleId: 'ability.dexterity',
      },
      {
        label: ABILITY_LABELS[unarmoredAbility],
        amount: modifiers[unarmoredAbility],
        ruleId: `ability.${unarmoredAbility}`,
      },
      ...(shieldEquipped
        ? [{ label: 'Shield', amount: 2, ruleId: 'armor.shield' }]
        : []),
    ];
    const acVal = acComponents.reduce((sum, c) => sum + c.amount, 0);
    const baseDerived: DerivedValue = { value: acVal, components: acComponents };
    updatedArmorClass = {
      ...baseDerived,
      formulaSummary: formatArmorClassFormula(baseDerived),
    };
  } else if (updatedArmorClass.formulaSummary === undefined) {
    updatedArmorClass = {
      ...updatedArmorClass,
      formulaSummary: formatArmorClassFormula(updatedArmorClass),
    };
  }
  const updatedAttacks: DerivedAttack[] = baseSheet.attacks.map((attack) => {
    const lowerName = attack.name.trim().toLowerCase();
    const matchedWeapon =
      WEAPONS.find((w) => w.label.toLowerCase() === lowerName) ?? null;
    if (lowerName === 'unarmed strike' && monkMartialArts) {
      const ability: Ability =
        modifiers.dexterity > modifiers.strength ? 'dexterity' : 'strength';
      const components = [
        {
          label: ABILITY_LABELS[ability],
          amount: modifiers[ability],
          ruleId: `ability.${ability}`,
        },
        {
          label: 'Proficiency Bonus',
          amount: derived.proficiencyBonus,
          ruleId: 'proficiency-bonus',
        },
      ];
      return {
        ...attack,
        damage: `1d${monkMartialArtsDieSides(level)}`,
        attackBonus: {
          components,
          value: components.reduce((sum, c) => sum + c.amount, 0),
        },
      };
    }
    if (matchedWeapon !== null) {
      const ranged = matchedWeapon.category.endsWith('ranged');
      const finesse = matchedWeapon.properties.includes('Finesse');
      const monkWeapon = monkMartialArts && isMonkWeapon(matchedWeapon);
      const ability: Ability = ranged
        ? 'dexterity'
        : (finesse || monkWeapon) && modifiers.dexterity > modifiers.strength
          ? 'dexterity'
          : 'strength';
      const components = attack.attackBonus.components.map((component) => {
        if (component.ruleId === 'proficiency-bonus') {
          return { ...component, amount: derived.proficiencyBonus };
        }
        if (component.ruleId.startsWith('ability.')) {
          return {
            label: ABILITY_LABELS[ability],
            amount: modifiers[ability],
            ruleId: `ability.${ability}`,
          };
        }
        return component;
      });
      return {
        ...attack,
        damage: monkWeapon
          ? upgradeDamageDieForMonk(matchedWeapon.damage, level)
          : matchedWeapon.damage,
        attackBonus: {
          components,
          value: components.reduce((sum, c) => sum + c.amount, 0),
        },
      };
    }
    const components = attack.attackBonus.components.map((component) =>
      component.ruleId === 'proficiency-bonus'
        ? { ...component, amount: derived.proficiencyBonus }
        : component,
    );
    return {
      ...attack,
      attackBonus: {
        components,
        value: components.reduce((sum, c) => sum + c.amount, 0),
      },
    };
  });

  if (
    monkMartialArts &&
    !updatedAttacks.some((a) => a.name.trim().toLowerCase() === 'unarmed strike')
  ) {
    const ability: Ability =
      modifiers.dexterity > modifiers.strength ? 'dexterity' : 'strength';
    const components = [
      {
        label: ABILITY_LABELS[ability],
        amount: modifiers[ability],
        ruleId: `ability.${ability}`,
      },
      {
        label: 'Proficiency Bonus',
        amount: derived.proficiencyBonus,
        ruleId: 'proficiency-bonus',
      },
    ];
    updatedAttacks.push({
      name: 'Unarmed Strike',
      attackBonus: {
        components,
        value: components.reduce((sum, c) => sum + c.amount, 0),
      },
      damage: `1d${monkMartialArtsDieSides(level)}`,
      damageType: 'bludgeoning',
      properties: [],
      ruleId: 'weapon.unarmed-strike',
    });
  }

  const updatedEquipment = baseSheet.equipment.map((entry) => {
    const lowerName = entry.name.trim().toLowerCase();
    const matchedWeapon =
      WEAPONS.find((w) => w.label.toLowerCase() === lowerName) ?? null;
    if (matchedWeapon === null) {
      return entry;
    }
    const ranged = matchedWeapon.category.endsWith('ranged');
    const finesse = matchedWeapon.properties.includes('Finesse');
    const monkWeapon = monkMartialArts && isMonkWeapon(matchedWeapon);
    const ability: Ability = ranged
      ? 'dexterity'
      : (finesse || monkWeapon) && modifiers.dexterity > modifiers.strength
        ? 'dexterity'
        : 'strength';
    const atkBonus = modifiers[ability] + derived.proficiencyBonus;
    const dmgMod = modifiers[ability];
    const dmgModStr = dmgMod > 0 ? `+${dmgMod}` : dmgMod < 0 ? `${dmgMod}` : '';
    const weaponDamage = monkWeapon
      ? upgradeDamageDieForMonk(matchedWeapon.damage, level)
      : matchedWeapon.damage;
    const catLabel = matchedWeapon.category
      .replace('-', ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const masteryMatch = /·\s*Mastery:\s*([^·]+)$/i.exec(entry.statsSummary ?? '');
    const masterySuffix =
      masteryMatch !== null ? ` · Mastery: ${masteryMatch[1]!.trim()}` : '';
    return {
      ...entry,
      itemKind: 'weapon' as const,
      statsSummary: `${catLabel} · ${atkBonus >= 0 ? `+${atkBonus}` : atkBonus} to hit · ${weaponDamage}${dmgModStr} ${matchedWeapon.damageType}${matchedWeapon.properties.length > 0 ? ` · ${matchedWeapon.properties.join(', ')}` : ''}${masterySuffix}`,
    };
  });

  return {
    ...baseSheet,
    level,
    experiencePoints,
    proficiencyBonus: {
      value: derived.proficiencyBonus,
      components: [{
        label: `Level ${level}`,
        amount: derived.proficiencyBonus,
        ruleId: `proficiency-bonus.level-${level}`,
      }],
    },
    hitPoints: { value: derived.maxHitPoints, components: hitPointComponents },
    hitPointsCurrent: derived.maxHitPoints,
    hitDice: derived.hitDice,
    armorClass: updatedArmorClass,
    speed: updatedSpeed,
    features: [
      ...baseSheet.features.filter(
        (feature) =>
          !derived.classFeatures.some(
            (label) =>
              feature.name === label ||
              feature.name.startsWith(`${label} `) ||
              feature.name.startsWith(`${label}:`),
          ),
      ),
      ...derived.classFeatures
        .filter((label) => !(label === 'Level 1 class features' && baseSheet.features.length > 0))
        .map((label) => {
          const existing = baseSheet.features.find(
            (feature) =>
              feature.name === label ||
              feature.name.startsWith(`${label} `) ||
              feature.name.startsWith(`${label}:`),
          );
          const srdEntry = (SRD_CLASS_FEATURES_BY_LEVEL[classId] ?? []).find(
            (entry) => entry.label === label,
          );
          const classLabel =
            findClass(classId)?.label ?? classId.charAt(0).toUpperCase() + classId.slice(1);
          return {
            name: existing !== undefined ? existing.name : label,
            source:
              existing !== undefined && !existing.source.startsWith('class.')
                ? existing.source
                : srdEntry !== undefined && srdEntry.level > 1
                  ? `${classLabel} ${srdEntry.level}`
                  : classLabel,
            summary:
              existing !== undefined
                ? existing.summary
                : (srdEntry?.summary ?? `Granted at character level ${level}.`),
          };
        }),
    ],
    savingThrows: Object.fromEntries(
      Object.entries(baseSheet.savingThrows).map(([ability, value]) => [
        ability,
        replaceProficiency(value, derived.proficiencyBonus),
      ]),
    ) as DerivedCharacterSheet['savingThrows'],
    skills: baseSheet.skills.map((skill) => ({
      ...skill,
      bonus: replaceProficiency(skill.bonus, derived.proficiencyBonus),
    })),
    passivePerception:
      baseSheet.passivePerception.components.length > 0
        ? replaceProficiency(baseSheet.passivePerception, derived.proficiencyBonus)
        : baseSheet.passivePerception,
    initiative: replaceProficiency(baseSheet.initiative, derived.proficiencyBonus),
    attacks: updatedAttacks,
    equipment: updatedEquipment,
    classResources: classResourcesForLevel(baseSheet, classId, level),
    ...(classId === 'fighter' && level >= 3
      ? { subclassLabel: 'Champion (Alpha default Fighter subclass)' }
      : {}),
    spellcasting:
      baseSheet.spellcasting === null
        ? null
        : {
            ...baseSheet.spellcasting,
            spellSaveDc: replaceProficiency(
              baseSheet.spellcasting.spellSaveDc,
              derived.proficiencyBonus,
            ),
            spellAttackBonus: replaceProficiency(
              baseSheet.spellcasting.spellAttackBonus,
              derived.proficiencyBonus,
            ),
            level1SlotCount: derived.spellSlots[0] ?? 0,
            level1SlotsRemaining: derived.spellSlots[0] ?? baseSheet.spellcasting.level1SlotsRemaining,
          },
  };
}
