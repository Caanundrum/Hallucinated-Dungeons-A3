/**
 * SRD 5.2.1 character-creation rules manifest.
 *
 * Blueprint ownership: Sections 1.5.8.1 (familiar SRD terminology authority)
 * and 6.4 (character creation must calculate from rules data). Section 25
 * assigns the full structured SRD data and conformance harness to Phase 3;
 * this manifest is the character-creation subset Phase 1 genuinely needs, and
 * nothing more.
 *
 * ── Provenance, stated plainly ───────────────────────────────────────────
 * The blueprint expects "approved licensed rules data" as an input
 * (Section 1.4.1). No such file was supplied with the repository, so this
 * manifest was authored by Builder from the SRD 5.2.1 rules content. Its
 * *structure* is verified mechanically by tests/unit/srd-manifest.test.mjs.
 * Its *fidelity to the printed SRD* has NOT been verified against the source
 * document and must be reviewed by a human before this data can be called
 * approved licensed rules data. `RULES_MANIFEST_PROVENANCE` below carries
 * that status in machine-readable form so no later phase can mistake it for
 * a reviewed artifact.
 *
 * Scope note: spells are carried as identity only (name, level, school, and
 * the class lists they appear on), which is everything selection at level 1
 * requires. Spell effects, targeting, and areas belong to Phase 3.
 */

import type { Ability } from '../../shared/character-contract.js';

export const RULES_VERSION = 'srd-5.2.1-character-creation-v1';

export const RULES_MANIFEST_PROVENANCE = {
  source: 'SRD 5.2.1',
  license: 'Creative Commons Attribution 4.0 International',
  attribution:
    'This work includes material from the System Reference Document 5.2.1 by Wizards of the Coast LLC, available under the Creative Commons Attribution 4.0 International License.',
  authoredBy: 'Builder',
  fidelityVerification: 'PENDING_HUMAN_REVIEW',
  note: 'Structure is machine-verified. Fidelity to the printed SRD requires human review before this is treated as approved licensed rules data.',
} as const;

export interface SkillRecord {
  readonly id: string;
  readonly label: string;
  readonly ability: Ability;
}

export interface ArmorRecord {
  readonly id: string;
  readonly label: string;
  readonly category: 'light' | 'medium' | 'heavy' | 'shield';
  readonly baseArmorClass: number;
  /** Maximum Dexterity modifier added, or null when the full modifier applies. */
  readonly dexterityCap: number | null;
  readonly strengthRequirement: number | null;
  readonly stealthDisadvantage: boolean;
}

export interface WeaponRecord {
  readonly id: string;
  readonly label: string;
  readonly category: 'simple-melee' | 'simple-ranged' | 'martial-melee' | 'martial-ranged';
  readonly damage: string;
  readonly damageType: string;
  readonly properties: readonly string[];
}

export interface OptionChoice {
  readonly id: string;
  readonly label: string;
  readonly choose: number;
  /** Short player-facing help for what this choice is asking. */
  readonly helper: string;
  readonly from: readonly {
    readonly id: string;
    readonly label: string;
    /** What this option does, shown in the wizard and on the sheet. */
    readonly summary: string;
  }[];
  /** When set, the options are skill ids and the result grants skill proficiency. */
  readonly grantsSkillProficiency?: boolean;
}

export interface FeatureRecord {
  readonly name: string;
  readonly summary: string;
  /** When set, the feature is shown on the sheet only at this character level or higher. */
  readonly minLevel?: number;
}

export interface EquipmentOption {
  readonly id: string;
  readonly label: string;
  readonly items: readonly { readonly name: string; readonly quantity: number }[];
  readonly gold: number;
  /** Armor and weapon ids in this option, used to derive Armor Class and attacks. */
  readonly armorIds: readonly string[];
  readonly weaponIds: readonly string[];
}

export interface SpeciesRecord {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly size: string;
  readonly speed: number;
  readonly senses: readonly string[];
  readonly features: readonly FeatureRecord[];
  readonly choices: readonly OptionChoice[];
  /** Extra Hit Points per level, as Dwarven Toughness grants. */
  readonly hitPointsPerLevel: number;
}

export interface BackgroundRecord {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  /** The three abilities this Background may increase. */
  readonly abilityOptions: readonly Ability[];
  readonly originFeat: string;
  readonly skillIds: readonly string[];
  readonly toolProficiency: string;
  readonly equipmentOptions: readonly EquipmentOption[];
}

export interface ClassSpellcasting {
  readonly ability: Ability;
  readonly cantripsKnown: number;
  readonly spellsAvailable: number;
  readonly preparationStyle: 'prepared' | 'known';
  readonly level1SlotCount: number;
  readonly spellListId: string;
}

export interface ClassRecord {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly hitDie: number;
  readonly savingThrowProficiencies: readonly Ability[];
  readonly skillChoiceCount: number;
  /** Skill ids the class may choose from; empty means any skill. */
  readonly skillChoiceIds: readonly string[];
  readonly armorProficiencies: readonly string[];
  readonly weaponProficiencies: readonly string[];
  readonly toolProficiencies: readonly string[];
  readonly features: readonly FeatureRecord[];
  readonly choices: readonly OptionChoice[];
  readonly equipmentOptions: readonly EquipmentOption[];
  readonly spellcasting: ClassSpellcasting | null;
  /** Unarmored Defense variants that replace the ordinary Armor Class formula. */
  readonly unarmoredDefenseAbility: Ability | null;
}

export interface SpellRecord {
  readonly id: string;
  readonly label: string;
  readonly level: 0 | 1;
  readonly school: string;
  readonly lists: readonly string[];
}

export const SKILLS: readonly SkillRecord[] = [
  { id: 'acrobatics', label: 'Acrobatics', ability: 'dexterity' },
  { id: 'animal-handling', label: 'Animal Handling', ability: 'wisdom' },
  { id: 'arcana', label: 'Arcana', ability: 'intelligence' },
  { id: 'athletics', label: 'Athletics', ability: 'strength' },
  { id: 'deception', label: 'Deception', ability: 'charisma' },
  { id: 'history', label: 'History', ability: 'intelligence' },
  { id: 'insight', label: 'Insight', ability: 'wisdom' },
  { id: 'intimidation', label: 'Intimidation', ability: 'charisma' },
  { id: 'investigation', label: 'Investigation', ability: 'intelligence' },
  { id: 'medicine', label: 'Medicine', ability: 'wisdom' },
  { id: 'nature', label: 'Nature', ability: 'intelligence' },
  { id: 'perception', label: 'Perception', ability: 'wisdom' },
  { id: 'performance', label: 'Performance', ability: 'charisma' },
  { id: 'persuasion', label: 'Persuasion', ability: 'charisma' },
  { id: 'religion', label: 'Religion', ability: 'intelligence' },
  { id: 'sleight-of-hand', label: 'Sleight of Hand', ability: 'dexterity' },
  { id: 'stealth', label: 'Stealth', ability: 'dexterity' },
  { id: 'survival', label: 'Survival', ability: 'wisdom' },
];

export const ARMOR: readonly ArmorRecord[] = [
  { id: 'padded', label: 'Padded Armor', category: 'light', baseArmorClass: 11, dexterityCap: null, strengthRequirement: null, stealthDisadvantage: true },
  { id: 'leather', label: 'Leather Armor', category: 'light', baseArmorClass: 11, dexterityCap: null, strengthRequirement: null, stealthDisadvantage: false },
  { id: 'studded-leather', label: 'Studded Leather Armor', category: 'light', baseArmorClass: 12, dexterityCap: null, strengthRequirement: null, stealthDisadvantage: false },
  { id: 'hide', label: 'Hide Armor', category: 'medium', baseArmorClass: 12, dexterityCap: 2, strengthRequirement: null, stealthDisadvantage: false },
  { id: 'chain-shirt', label: 'Chain Shirt', category: 'medium', baseArmorClass: 13, dexterityCap: 2, strengthRequirement: null, stealthDisadvantage: false },
  { id: 'scale-mail', label: 'Scale Mail', category: 'medium', baseArmorClass: 14, dexterityCap: 2, strengthRequirement: null, stealthDisadvantage: true },
  { id: 'breastplate', label: 'Breastplate', category: 'medium', baseArmorClass: 14, dexterityCap: 2, strengthRequirement: null, stealthDisadvantage: false },
  { id: 'half-plate', label: 'Half Plate Armor', category: 'medium', baseArmorClass: 15, dexterityCap: 2, strengthRequirement: null, stealthDisadvantage: true },
  { id: 'ring-mail', label: 'Ring Mail', category: 'heavy', baseArmorClass: 14, dexterityCap: 0, strengthRequirement: null, stealthDisadvantage: true },
  { id: 'chain-mail', label: 'Chain Mail', category: 'heavy', baseArmorClass: 16, dexterityCap: 0, strengthRequirement: 13, stealthDisadvantage: true },
  { id: 'splint', label: 'Splint Armor', category: 'heavy', baseArmorClass: 17, dexterityCap: 0, strengthRequirement: 15, stealthDisadvantage: true },
  { id: 'plate', label: 'Plate Armor', category: 'heavy', baseArmorClass: 18, dexterityCap: 0, strengthRequirement: 15, stealthDisadvantage: true },
  { id: 'shield', label: 'Shield', category: 'shield', baseArmorClass: 2, dexterityCap: null, strengthRequirement: null, stealthDisadvantage: false },
];

export const WEAPONS: readonly WeaponRecord[] = [
  { id: 'club', label: 'Club', category: 'simple-melee', damage: '1d4', damageType: 'Bludgeoning', properties: ['Light'] },
  { id: 'dagger', label: 'Dagger', category: 'simple-melee', damage: '1d4', damageType: 'Piercing', properties: ['Finesse', 'Light', 'Thrown'] },
  { id: 'greatclub', label: 'Greatclub', category: 'simple-melee', damage: '1d8', damageType: 'Bludgeoning', properties: ['Two-Handed'] },
  { id: 'handaxe', label: 'Handaxe', category: 'simple-melee', damage: '1d6', damageType: 'Slashing', properties: ['Light', 'Thrown'] },
  { id: 'javelin', label: 'Javelin', category: 'simple-melee', damage: '1d6', damageType: 'Piercing', properties: ['Thrown'] },
  { id: 'light-hammer', label: 'Light Hammer', category: 'simple-melee', damage: '1d4', damageType: 'Bludgeoning', properties: ['Light', 'Thrown'] },
  { id: 'mace', label: 'Mace', category: 'simple-melee', damage: '1d6', damageType: 'Bludgeoning', properties: [] },
  { id: 'quarterstaff', label: 'Quarterstaff', category: 'simple-melee', damage: '1d6', damageType: 'Bludgeoning', properties: ['Versatile (1d8)'] },
  { id: 'sickle', label: 'Sickle', category: 'simple-melee', damage: '1d4', damageType: 'Slashing', properties: ['Light'] },
  { id: 'spear', label: 'Spear', category: 'simple-melee', damage: '1d6', damageType: 'Piercing', properties: ['Thrown', 'Versatile (1d8)'] },
  { id: 'dart', label: 'Dart', category: 'simple-ranged', damage: '1d4', damageType: 'Piercing', properties: ['Finesse', 'Thrown'] },
  { id: 'light-crossbow', label: 'Light Crossbow', category: 'simple-ranged', damage: '1d8', damageType: 'Piercing', properties: ['Ammunition', 'Loading', 'Two-Handed'] },
  { id: 'shortbow', label: 'Shortbow', category: 'simple-ranged', damage: '1d6', damageType: 'Piercing', properties: ['Ammunition', 'Two-Handed'] },
  { id: 'sling', label: 'Sling', category: 'simple-ranged', damage: '1d4', damageType: 'Bludgeoning', properties: ['Ammunition'] },
  { id: 'battleaxe', label: 'Battleaxe', category: 'martial-melee', damage: '1d8', damageType: 'Slashing', properties: ['Versatile (1d10)'] },
  { id: 'flail', label: 'Flail', category: 'martial-melee', damage: '1d8', damageType: 'Bludgeoning', properties: [] },
  { id: 'glaive', label: 'Glaive', category: 'martial-melee', damage: '1d10', damageType: 'Slashing', properties: ['Heavy', 'Reach', 'Two-Handed'] },
  { id: 'greataxe', label: 'Greataxe', category: 'martial-melee', damage: '1d12', damageType: 'Slashing', properties: ['Heavy', 'Two-Handed'] },
  { id: 'greatsword', label: 'Greatsword', category: 'martial-melee', damage: '2d6', damageType: 'Slashing', properties: ['Heavy', 'Two-Handed'] },
  { id: 'longsword', label: 'Longsword', category: 'martial-melee', damage: '1d8', damageType: 'Slashing', properties: ['Versatile (1d10)'] },
  { id: 'maul', label: 'Maul', category: 'martial-melee', damage: '2d6', damageType: 'Bludgeoning', properties: ['Heavy', 'Two-Handed'] },
  { id: 'rapier', label: 'Rapier', category: 'martial-melee', damage: '1d8', damageType: 'Piercing', properties: ['Finesse'] },
  { id: 'scimitar', label: 'Scimitar', category: 'martial-melee', damage: '1d6', damageType: 'Slashing', properties: ['Finesse', 'Light'] },
  { id: 'shortsword', label: 'Shortsword', category: 'martial-melee', damage: '1d6', damageType: 'Piercing', properties: ['Finesse', 'Light'] },
  { id: 'warhammer', label: 'Warhammer', category: 'martial-melee', damage: '1d8', damageType: 'Bludgeoning', properties: ['Versatile (1d10)'] },
  { id: 'longbow', label: 'Longbow', category: 'martial-ranged', damage: '1d8', damageType: 'Piercing', properties: ['Ammunition', 'Heavy', 'Two-Handed'] },
];

export const SPECIES: readonly SpeciesRecord[] = [
  {
    id: 'human',
    label: 'Human',
    summary: 'Adaptable and driven, with an extra skill and an origin feat.',
    size: 'Medium',
    speed: 30,
    senses: [],
    hitPointsPerLevel: 0,
    features: [
      { name: 'Resourceful', summary: 'You gain Heroic Inspiration whenever you finish a Long Rest.' },
      { name: 'Skillful', summary: 'You gain proficiency in one skill of your choice.' },
      { name: 'Versatile', summary: 'You gain an Origin feat of your choice.' },
    ],
    choices: [
      {
        id: 'human-skillful',
        label: 'Skillful — choose one skill',
        helper: 'Humans train broadly. Pick one extra skill you are proficient with.',
        choose: 1,
        grantsSkillProficiency: true,
        from: SKILLS.map((skill) => ({
          id: skill.id,
          label: skill.label,
          summary: `Gain proficiency in ${skill.label}.`,
        })),
      },
    ],
  },
  {
    id: 'dwarf',
    label: 'Dwarf',
    summary: 'Hardy and stone-wise, with superior Darkvision and extra Hit Points.',
    size: 'Medium',
    speed: 30,
    senses: ['Darkvision 120 ft.'],
    hitPointsPerLevel: 1,
    features: [
      { name: 'Dwarven Resilience', summary: 'You have Resistance to Poison damage and Advantage on saving throws against being Poisoned.' },
      { name: 'Dwarven Toughness', summary: 'Your Hit Point maximum increases by 1, and by 1 again whenever you gain a level.' },
      { name: 'Stonecunning', summary: 'As a Bonus Action you gain Tremorsense with a range of 60 feet for 10 minutes.' },
    ],
    choices: [],
  },
  {
    id: 'elf',
    label: 'Elf',
    summary: 'Long-lived and perceptive, shaped by an Elven Lineage.',
    size: 'Medium',
    speed: 30,
    senses: ['Darkvision 60 ft.'],
    hitPointsPerLevel: 0,
    features: [
      { name: 'Fey Ancestry', summary: 'You have Advantage on saving throws you make to avoid or end the Charmed condition.' },
      { name: 'Keen Senses', summary: 'You gain proficiency in one of Insight, Perception, or Survival.' },
      { name: 'Trance', summary: 'You do not need to sleep, and magic cannot put you to sleep.' },
    ],
    choices: [
      {
        id: 'elven-lineage',
        label: 'Elven Lineage',
        helper: 'Your Elven Lineage shapes magic and movement. Pick the one that fits this character.',
        choose: 1,
        from: [
          { id: 'drow', label: 'Drow', summary: 'Superior Darkvision and the Dancing Lights cantrip.' },
          { id: 'high-elf', label: 'High Elf', summary: 'You know one Wizard cantrip of your choice.' },
          { id: 'wood-elf', label: 'Wood Elf', summary: 'Speed 35 feet, and you can Hide when lightly obscured by nature.' },
        ],
      },
      {
        id: 'elf-keen-senses',
        label: 'Keen Senses — choose Insight, Perception, or Survival',
        helper: 'Elves notice more. Choose which of these three skills you are proficient with.',
        choose: 1,
        grantsSkillProficiency: true,
        from: [
          { id: 'insight', label: 'Insight', summary: 'Gain proficiency in Insight.' },
          { id: 'perception', label: 'Perception', summary: 'Gain proficiency in Perception.' },
          { id: 'survival', label: 'Survival', summary: 'Gain proficiency in Survival.' },
        ],
      },
    ],
  },
  {
    id: 'halfling',
    label: 'Halfling',
    summary: 'Small, lucky, and remarkably hard to corner.',
    size: 'Small',
    speed: 30,
    senses: [],
    hitPointsPerLevel: 0,
    features: [
      { name: 'Brave', summary: 'You have Advantage on saving throws you make to avoid or end the Frightened condition.' },
      { name: 'Halfling Nimbleness', summary: 'You can move through the space of any creature that is a size larger than you.' },
      { name: 'Luck', summary: 'When you roll a 1 on the d20 of a D20 Test, you can reroll the die once.' },
      { name: 'Naturally Stealthy', summary: 'You can take the Hide action even when obscured only by a creature at least one size larger.' },
    ],
    choices: [],
  },
  {
    id: 'dragonborn',
    label: 'Dragonborn',
    summary: 'Draconic heritage granting a Breath Weapon and matching Resistance.',
    size: 'Medium',
    speed: 30,
    senses: ['Darkvision 60 ft.'],
    hitPointsPerLevel: 0,
    features: [
      { name: 'Breath Weapon', summary: 'You can replace one attack with a burst of damage of your ancestry type.' },
      { name: 'Damage Resistance', summary: 'You have Resistance to the damage type of your Draconic Ancestry.' },
      {
        name: 'Draconic Flight',
        summary: 'At level 5 you can sprout spectral wings for 10 minutes.',
        minLevel: 5,
      },
    ],
    choices: [
      {
        id: 'draconic-ancestry',
        label: 'Draconic Ancestry',
        helper: 'Your dragon blood sets your Breath Weapon damage type and Resistance. Pick one ancestry.',
        choose: 1,
        from: [
          { id: 'black', label: 'Black (Acid)', summary: 'Breath Weapon and Resistance deal with Acid.' },
          { id: 'blue', label: 'Blue (Lightning)', summary: 'Breath Weapon and Resistance deal with Lightning.' },
          { id: 'brass', label: 'Brass (Fire)', summary: 'Breath Weapon and Resistance deal with Fire.' },
          { id: 'bronze', label: 'Bronze (Lightning)', summary: 'Breath Weapon and Resistance deal with Lightning.' },
          { id: 'copper', label: 'Copper (Acid)', summary: 'Breath Weapon and Resistance deal with Acid.' },
          { id: 'gold', label: 'Gold (Fire)', summary: 'Breath Weapon and Resistance deal with Fire.' },
          { id: 'green', label: 'Green (Poison)', summary: 'Breath Weapon and Resistance deal with Poison.' },
          { id: 'red', label: 'Red (Fire)', summary: 'Breath Weapon and Resistance deal with Fire.' },
          { id: 'silver', label: 'Silver (Cold)', summary: 'Breath Weapon and Resistance deal with Cold.' },
          { id: 'white', label: 'White (Cold)', summary: 'Breath Weapon and Resistance deal with Cold.' },
        ],
      },
    ],
  },
  {
    id: 'gnome',
    label: 'Gnome',
    summary: 'Small and quick-minded, with a resilient mind and a chosen lineage.',
    size: 'Small',
    speed: 30,
    senses: ['Darkvision 60 ft.'],
    hitPointsPerLevel: 0,
    features: [
      { name: 'Gnomish Cunning', summary: 'You have Advantage on Intelligence, Wisdom, and Charisma saving throws.' },
    ],
    choices: [
      {
        id: 'gnomish-lineage',
        label: 'Gnomish Lineage',
        helper: 'Forest and Rock Gnomes lean different ways with magic and craft. Pick one lineage.',
        choose: 1,
        from: [
          { id: 'forest-gnome', label: 'Forest Gnome', summary: 'You know the Minor Illusion cantrip.' },
          { id: 'rock-gnome', label: 'Rock Gnome', summary: 'You know the Mending and Prestidigitation cantrips.' },
        ],
      },
    ],
  },
  {
    id: 'goliath',
    label: 'Goliath',
    summary: 'Giant-blooded, fast on foot, and able to carry far more than their frame suggests.',
    size: 'Medium',
    speed: 35,
    senses: [],
    hitPointsPerLevel: 0,
    features: [
      { name: 'Large Form', summary: 'At level 5 you can become Large for 10 minutes.' },
      { name: 'Powerful Build', summary: 'You count as one size larger for carrying capacity and for lifting, dragging, or pushing.' },
    ],
    choices: [
      {
        id: 'giant-ancestry',
        label: 'Giant Ancestry',
        helper: 'Your Giant Ancestry grants a special trick tied to a giant kind. Pick one — details appear with the option.',
        choose: 1,
        from: [
          { id: 'cloud', label: "Cloud's Jaunt", summary: 'As a Bonus Action, teleport up to 30 feet to an unoccupied space you can see.' },
          { id: 'fire', label: "Fire's Burn", summary: 'When you hit with an attack roll, deal extra Fire damage once per turn.' },
          { id: 'frost', label: "Frost's Chill", summary: 'When you hit with an attack roll, deal extra Cold damage and reduce Speed once per turn.' },
          { id: 'hill', label: "Hill's Tumble", summary: 'When you hit a Large or smaller creature, you can knock it Prone once per turn.' },
          { id: 'stone', label: "Stone's Endurance", summary: 'When you take damage, use your Reaction to reduce it by 1d12 + your Constitution modifier.' },
          { id: 'storm', label: "Storm's Thunder", summary: 'When you take damage from a creature within 60 feet, deal Thunder damage back once per turn.' },
        ],
      },
    ],
  },
  {
    id: 'orc',
    label: 'Orc',
    summary: 'Relentless and explosive, with superior Darkvision and a second wind of endurance.',
    size: 'Medium',
    speed: 30,
    senses: ['Darkvision 120 ft.'],
    hitPointsPerLevel: 0,
    features: [
      { name: 'Adrenaline Rush', summary: 'You can take the Dash action as a Bonus Action and gain Temporary Hit Points.' },
      { name: 'Relentless Endurance', summary: 'When reduced to 0 Hit Points but not killed outright, you can drop to 1 instead, once per Long Rest.' },
    ],
    choices: [],
  },
  {
    id: 'tiefling',
    label: 'Tiefling',
    summary: 'Marked by a fiendish legacy that grants innate magic.',
    size: 'Medium',
    speed: 30,
    senses: ['Darkvision 60 ft.'],
    hitPointsPerLevel: 0,
    features: [
      { name: 'Otherworldly Presence', summary: 'You know the Thaumaturgy cantrip, cast with your Fiendish Legacy ability.' },
    ],
    choices: [
      {
        id: 'fiendish-legacy',
        label: 'Fiendish Legacy',
        helper: 'Your Fiendish Legacy picks the spell list your innate magic follows. Choose one legacy.',
        choose: 1,
        from: [
          { id: 'abyssal', label: 'Abyssal', summary: 'Poison Resistance and Abyssal legacy spells as you gain levels.' },
          { id: 'chthonic', label: 'Chthonic', summary: 'Necrotic Resistance and Chthonic legacy spells as you gain levels.' },
          { id: 'infernal', label: 'Infernal', summary: 'Fire Resistance and Infernal legacy spells as you gain levels.' },
        ],
      },
    ],
  },
  {
    id: 'aasimar',
    label: 'Aasimar',
    summary: 'Touched by the Upper Planes, able to heal with a touch and shed light.',
    size: 'Medium',
    speed: 30,
    senses: ['Darkvision 60 ft.'],
    hitPointsPerLevel: 0,
    features: [
      { name: 'Celestial Resistance', summary: 'You have Resistance to Necrotic damage and Radiant damage.' },
      { name: 'Healing Hands', summary: 'As a Magic action you can touch a creature and restore Hit Points.' },
      { name: 'Light Bearer', summary: 'You know the Light cantrip, cast with Charisma.' },
    ],
    choices: [],
  },
];

/** Every Background grants a kit or a flat 50 GP, per the SRD. */
function backgroundEquipment(
  kitId: string,
  kitLabel: string,
  items: readonly { readonly name: string; readonly quantity: number }[],
  gold: number,
): readonly EquipmentOption[] {
  return [
    { id: kitId, label: kitLabel, items, gold, armorIds: [], weaponIds: [] },
    { id: `${kitId}-gold`, label: '50 GP', items: [], gold: 50, armorIds: [], weaponIds: [] },
  ];
}

export const BACKGROUNDS: readonly BackgroundRecord[] = [
  {
    id: 'acolyte', label: 'Acolyte', summary: 'You served a temple and learned its rites.',
    abilityOptions: ['intelligence', 'wisdom', 'charisma'], originFeat: 'Magic Initiate (Cleric)',
    skillIds: ['insight', 'religion'], toolProficiency: "Calligrapher's Supplies",
    equipmentOptions: backgroundEquipment('acolyte-kit', "Calligrapher's Supplies, Book (prayers), Holy Symbol, Parchment (10), Robe", [
      { name: "Calligrapher's Supplies", quantity: 1 }, { name: 'Book (prayers)', quantity: 1 }, { name: 'Holy Symbol', quantity: 1 }, { name: 'Parchment', quantity: 10 }, { name: 'Robe', quantity: 1 },
    ], 8),
  },
  {
    id: 'artisan', label: 'Artisan', summary: 'You apprenticed to a trade and know its tools.',
    abilityOptions: ['strength', 'dexterity', 'intelligence'], originFeat: 'Crafter',
    skillIds: ['investigation', 'persuasion'], toolProficiency: "Artisan's Tools",
    equipmentOptions: backgroundEquipment('artisan-kit', "Artisan's Tools, Pouch (2), Traveler's Clothes", [
      { name: "Artisan's Tools", quantity: 1 }, { name: 'Pouch', quantity: 2 }, { name: "Traveler's Clothes", quantity: 1 },
    ], 32),
  },
  {
    id: 'charlatan', label: 'Charlatan', summary: 'You made your way by confidence and forgery.',
    abilityOptions: ['dexterity', 'constitution', 'charisma'], originFeat: 'Skilled',
    skillIds: ['deception', 'sleight-of-hand'], toolProficiency: 'Forgery Kit',
    equipmentOptions: backgroundEquipment('charlatan-kit', "Forgery Kit, Costume, Fine Clothes", [
      { name: 'Forgery Kit', quantity: 1 }, { name: 'Costume', quantity: 1 }, { name: 'Fine Clothes', quantity: 1 },
    ], 15),
  },
  {
    id: 'criminal', label: 'Criminal', summary: 'You worked outside the law and stayed alert.',
    abilityOptions: ['dexterity', 'constitution', 'intelligence'], originFeat: 'Alert',
    skillIds: ['sleight-of-hand', 'stealth'], toolProficiency: "Thieves' Tools",
    equipmentOptions: backgroundEquipment('criminal-kit', "Thieves' Tools, Dagger (2), Pouch (2), Traveler's Clothes", [
      { name: "Thieves' Tools", quantity: 1 }, { name: 'Dagger', quantity: 2 }, { name: 'Pouch', quantity: 2 }, { name: "Traveler's Clothes", quantity: 1 },
    ], 16),
  },
  {
    id: 'entertainer', label: 'Entertainer', summary: 'You performed for crowds and learned to read them.',
    abilityOptions: ['strength', 'dexterity', 'charisma'], originFeat: 'Musician',
    skillIds: ['acrobatics', 'performance'], toolProficiency: 'Musical Instrument',
    equipmentOptions: backgroundEquipment('entertainer-kit', "Musical Instrument, Costume (2), Mirror, Perfume, Traveler's Clothes", [
      { name: 'Musical Instrument', quantity: 1 }, { name: 'Costume', quantity: 2 }, { name: 'Mirror', quantity: 1 }, { name: 'Perfume', quantity: 1 }, { name: "Traveler's Clothes", quantity: 1 },
    ], 11),
  },
  {
    id: 'farmer', label: 'Farmer', summary: 'You worked the land and grew tough doing it.',
    abilityOptions: ['strength', 'constitution', 'wisdom'], originFeat: 'Tough',
    skillIds: ['animal-handling', 'nature'], toolProficiency: "Carpenter's Tools",
    equipmentOptions: backgroundEquipment('farmer-kit', "Carpenter's Tools, Healer's Kit, Iron Pot, Shovel, Sickle, Traveler's Clothes", [
      { name: "Carpenter's Tools", quantity: 1 }, { name: "Healer's Kit", quantity: 1 }, { name: 'Iron Pot', quantity: 1 }, { name: 'Shovel', quantity: 1 }, { name: 'Sickle', quantity: 1 }, { name: "Traveler's Clothes", quantity: 1 },
    ], 30),
  },
  {
    id: 'guard', label: 'Guard', summary: 'You stood watch and learned to notice what others missed.',
    abilityOptions: ['strength', 'intelligence', 'wisdom'], originFeat: 'Alert',
    skillIds: ['athletics', 'perception'], toolProficiency: 'Gaming Set',
    equipmentOptions: backgroundEquipment('guard-kit', "Gaming Set, Spear, Light Crossbow, Bolts (20), Hooded Lantern, Manacles, Quiver, Traveler's Clothes", [
      { name: 'Gaming Set', quantity: 1 }, { name: 'Spear', quantity: 1 }, { name: 'Light Crossbow', quantity: 1 }, { name: 'Bolts', quantity: 20 }, { name: 'Hooded Lantern', quantity: 1 }, { name: 'Manacles', quantity: 1 }, { name: 'Quiver', quantity: 1 }, { name: "Traveler's Clothes", quantity: 1 },
    ], 12),
  },
  {
    id: 'guide', label: 'Guide', summary: 'You led travelers through wild country.',
    abilityOptions: ['dexterity', 'constitution', 'wisdom'], originFeat: 'Magic Initiate (Druid)',
    skillIds: ['stealth', 'survival'], toolProficiency: "Cartographer's Tools",
    equipmentOptions: backgroundEquipment('guide-kit', "Cartographer's Tools, Shortbow, Arrows (20), Bedroll, Quiver, Tent, Traveler's Clothes", [
      { name: "Cartographer's Tools", quantity: 1 }, { name: 'Shortbow', quantity: 1 }, { name: 'Arrows', quantity: 20 }, { name: 'Bedroll', quantity: 1 }, { name: 'Quiver', quantity: 1 }, { name: 'Tent', quantity: 1 }, { name: "Traveler's Clothes", quantity: 1 },
    ], 3),
  },
  {
    id: 'hermit', label: 'Hermit', summary: 'You lived apart and studied what solitude taught you.',
    abilityOptions: ['constitution', 'wisdom', 'charisma'], originFeat: 'Healer',
    skillIds: ['medicine', 'religion'], toolProficiency: 'Herbalism Kit',
    equipmentOptions: backgroundEquipment('hermit-kit', "Herbalism Kit, Quarterstaff, Bedroll, Book (philosophy), Lamp, Oil (3), Traveler's Clothes", [
      { name: 'Herbalism Kit', quantity: 1 }, { name: 'Quarterstaff', quantity: 1 }, { name: 'Bedroll', quantity: 1 }, { name: 'Book (philosophy)', quantity: 1 }, { name: 'Lamp', quantity: 1 }, { name: 'Oil', quantity: 3 }, { name: "Traveler's Clothes", quantity: 1 },
    ], 16),
  },
  {
    id: 'merchant', label: 'Merchant', summary: 'You bought and sold, and learned to read people and roads.',
    abilityOptions: ['constitution', 'intelligence', 'charisma'], originFeat: 'Lucky',
    skillIds: ['animal-handling', 'persuasion'], toolProficiency: "Navigator's Tools",
    equipmentOptions: backgroundEquipment('merchant-kit', "Navigator's Tools, Pouch (2), Traveler's Clothes", [
      { name: "Navigator's Tools", quantity: 1 }, { name: 'Pouch', quantity: 2 }, { name: "Traveler's Clothes", quantity: 1 },
    ], 22),
  },
  {
    id: 'noble', label: 'Noble', summary: 'You were raised to privilege and expectation.',
    abilityOptions: ['strength', 'intelligence', 'charisma'], originFeat: 'Skilled',
    skillIds: ['history', 'persuasion'], toolProficiency: 'Gaming Set',
    equipmentOptions: backgroundEquipment('noble-kit', 'Gaming Set, Fine Clothes, Perfume', [
      { name: 'Gaming Set', quantity: 1 }, { name: 'Fine Clothes', quantity: 1 }, { name: 'Perfume', quantity: 1 },
    ], 29),
  },
  {
    id: 'sage', label: 'Sage', summary: 'You studied, and the habit never left you.',
    abilityOptions: ['constitution', 'intelligence', 'wisdom'], originFeat: 'Magic Initiate (Wizard)',
    skillIds: ['arcana', 'history'], toolProficiency: "Calligrapher's Supplies",
    equipmentOptions: backgroundEquipment('sage-kit', "Calligrapher's Supplies, Book (history), Parchment (8), Quarterstaff, Robe", [
      { name: "Calligrapher's Supplies", quantity: 1 }, { name: 'Book (history)', quantity: 1 }, { name: 'Parchment', quantity: 8 }, { name: 'Quarterstaff', quantity: 1 }, { name: 'Robe', quantity: 1 },
    ], 8),
  },
  {
    id: 'sailor', label: 'Sailor', summary: 'You crewed a ship and learned to hold your footing.',
    abilityOptions: ['strength', 'dexterity', 'wisdom'], originFeat: 'Tavern Brawler',
    skillIds: ['acrobatics', 'perception'], toolProficiency: "Navigator's Tools",
    equipmentOptions: backgroundEquipment('sailor-kit', "Navigator's Tools, Dagger, Rope, Traveler's Clothes", [
      { name: "Navigator's Tools", quantity: 1 }, { name: 'Dagger', quantity: 1 }, { name: 'Rope', quantity: 1 }, { name: "Traveler's Clothes", quantity: 1 },
    ], 20),
  },
  {
    id: 'scribe', label: 'Scribe', summary: 'You copied and checked documents until detail became instinct.',
    abilityOptions: ['dexterity', 'intelligence', 'wisdom'], originFeat: 'Skilled',
    skillIds: ['investigation', 'perception'], toolProficiency: "Calligrapher's Supplies",
    equipmentOptions: backgroundEquipment('scribe-kit', "Calligrapher's Supplies, Fine Clothes, Lamp, Oil (3), Parchment (12)", [
      { name: "Calligrapher's Supplies", quantity: 1 }, { name: 'Fine Clothes', quantity: 1 }, { name: 'Lamp', quantity: 1 }, { name: 'Oil', quantity: 3 }, { name: 'Parchment', quantity: 12 },
    ], 23),
  },
  {
    id: 'soldier', label: 'Soldier', summary: 'You served in a fighting force and learned its discipline.',
    abilityOptions: ['strength', 'dexterity', 'constitution'], originFeat: 'Savage Attacker',
    skillIds: ['athletics', 'intimidation'], toolProficiency: 'Gaming Set',
    equipmentOptions: backgroundEquipment('soldier-kit', "Gaming Set, Spear, Shortbow, Arrows (20), Healer's Kit, Quiver, Traveler's Clothes", [
      { name: 'Gaming Set', quantity: 1 }, { name: 'Spear', quantity: 1 }, { name: 'Shortbow', quantity: 1 }, { name: 'Arrows', quantity: 20 }, { name: "Healer's Kit", quantity: 1 }, { name: 'Quiver', quantity: 1 }, { name: "Traveler's Clothes", quantity: 1 },
    ], 14),
  },
  {
    id: 'wayfarer', label: 'Wayfarer', summary: 'You lived by your wits on the road and in the streets.',
    abilityOptions: ['dexterity', 'wisdom', 'charisma'], originFeat: 'Lucky',
    skillIds: ['insight', 'stealth'], toolProficiency: "Thieves' Tools",
    equipmentOptions: backgroundEquipment('wayfarer-kit', "Thieves' Tools, Dagger (2), Gaming Set, Bedroll, Pouch (2), Traveler's Clothes", [
      { name: "Thieves' Tools", quantity: 1 }, { name: 'Dagger', quantity: 2 }, { name: 'Gaming Set', quantity: 1 }, { name: 'Bedroll', quantity: 1 }, { name: 'Pouch', quantity: 2 }, { name: "Traveler's Clothes", quantity: 1 },
    ], 16),
  },
];

export const SPELLS: readonly SpellRecord[] = [
  { id: 'acid-splash', label: 'Acid Splash', level: 0, school: 'Evocation', lists: ['sorcerer', 'wizard'] },
  { id: 'blade-ward', label: 'Blade Ward', level: 0, school: 'Abjuration', lists: ['bard', 'sorcerer', 'warlock', 'wizard'] },
  { id: 'chill-touch', label: 'Chill Touch', level: 0, school: 'Necromancy', lists: ['sorcerer', 'warlock', 'wizard'] },
  { id: 'dancing-lights', label: 'Dancing Lights', level: 0, school: 'Illusion', lists: ['bard', 'sorcerer', 'wizard'] },
  { id: 'druidcraft', label: 'Druidcraft', level: 0, school: 'Transmutation', lists: ['druid'] },
  { id: 'eldritch-blast', label: 'Eldritch Blast', level: 0, school: 'Evocation', lists: ['warlock'] },
  { id: 'fire-bolt', label: 'Fire Bolt', level: 0, school: 'Evocation', lists: ['sorcerer', 'wizard'] },
  { id: 'guidance', label: 'Guidance', level: 0, school: 'Divination', lists: ['cleric', 'druid'] },
  { id: 'light', label: 'Light', level: 0, school: 'Evocation', lists: ['bard', 'cleric', 'sorcerer', 'wizard'] },
  { id: 'mage-hand', label: 'Mage Hand', level: 0, school: 'Conjuration', lists: ['bard', 'sorcerer', 'warlock', 'wizard'] },
  { id: 'mending', label: 'Mending', level: 0, school: 'Transmutation', lists: ['bard', 'cleric', 'druid', 'sorcerer', 'wizard'] },
  { id: 'message', label: 'Message', level: 0, school: 'Transmutation', lists: ['bard', 'sorcerer', 'wizard'] },
  { id: 'minor-illusion', label: 'Minor Illusion', level: 0, school: 'Illusion', lists: ['bard', 'sorcerer', 'warlock', 'wizard'] },
  { id: 'poison-spray', label: 'Poison Spray', level: 0, school: 'Necromancy', lists: ['druid', 'sorcerer', 'warlock', 'wizard'] },
  { id: 'prestidigitation', label: 'Prestidigitation', level: 0, school: 'Transmutation', lists: ['bard', 'sorcerer', 'warlock', 'wizard'] },
  { id: 'produce-flame', label: 'Produce Flame', level: 0, school: 'Conjuration', lists: ['druid'] },
  { id: 'ray-of-frost', label: 'Ray of Frost', level: 0, school: 'Evocation', lists: ['sorcerer', 'wizard'] },
  { id: 'resistance', label: 'Resistance', level: 0, school: 'Abjuration', lists: ['cleric', 'druid'] },
  { id: 'sacred-flame', label: 'Sacred Flame', level: 0, school: 'Evocation', lists: ['cleric'] },
  { id: 'shillelagh', label: 'Shillelagh', level: 0, school: 'Transmutation', lists: ['druid'] },
  { id: 'shocking-grasp', label: 'Shocking Grasp', level: 0, school: 'Evocation', lists: ['sorcerer', 'wizard'] },
  { id: 'spare-the-dying', label: 'Spare the Dying', level: 0, school: 'Necromancy', lists: ['cleric', 'druid'] },
  { id: 'thaumaturgy', label: 'Thaumaturgy', level: 0, school: 'Transmutation', lists: ['cleric'] },
  { id: 'true-strike', label: 'True Strike', level: 0, school: 'Divination', lists: ['bard', 'sorcerer', 'warlock', 'wizard'] },
  { id: 'vicious-mockery', label: 'Vicious Mockery', level: 0, school: 'Enchantment', lists: ['bard'] },
  { id: 'alarm', label: 'Alarm', level: 1, school: 'Abjuration', lists: ['ranger', 'wizard'] },
  { id: 'animal-friendship', label: 'Animal Friendship', level: 1, school: 'Enchantment', lists: ['bard', 'druid', 'ranger'] },
  { id: 'bane', label: 'Bane', level: 1, school: 'Enchantment', lists: ['bard', 'cleric'] },
  { id: 'bless', label: 'Bless', level: 1, school: 'Enchantment', lists: ['cleric', 'paladin'] },
  { id: 'burning-hands', label: 'Burning Hands', level: 1, school: 'Evocation', lists: ['sorcerer', 'wizard'] },
  { id: 'charm-person', label: 'Charm Person', level: 1, school: 'Enchantment', lists: ['bard', 'druid', 'sorcerer', 'warlock', 'wizard'] },
  { id: 'command', label: 'Command', level: 1, school: 'Enchantment', lists: ['bard', 'cleric', 'paladin'] },
  { id: 'cure-wounds', label: 'Cure Wounds', level: 1, school: 'Abjuration', lists: ['bard', 'cleric', 'druid', 'paladin', 'ranger'] },
  { id: 'detect-magic', label: 'Detect Magic', level: 1, school: 'Divination', lists: ['bard', 'cleric', 'druid', 'paladin', 'ranger', 'sorcerer', 'wizard'] },
  { id: 'disguise-self', label: 'Disguise Self', level: 1, school: 'Illusion', lists: ['bard', 'sorcerer', 'wizard'] },
  { id: 'divine-favor', label: 'Divine Favor', level: 1, school: 'Transmutation', lists: ['paladin'] },
  { id: 'entangle', label: 'Entangle', level: 1, school: 'Conjuration', lists: ['druid'] },
  { id: 'faerie-fire', label: 'Faerie Fire', level: 1, school: 'Evocation', lists: ['bard', 'druid'] },
  { id: 'false-life', label: 'False Life', level: 1, school: 'Necromancy', lists: ['sorcerer', 'wizard'] },
  { id: 'feather-fall', label: 'Feather Fall', level: 1, school: 'Transmutation', lists: ['bard', 'sorcerer', 'wizard'] },
  { id: 'fog-cloud', label: 'Fog Cloud', level: 1, school: 'Conjuration', lists: ['druid', 'ranger', 'sorcerer', 'wizard'] },
  { id: 'goodberry', label: 'Goodberry', level: 1, school: 'Conjuration', lists: ['druid', 'ranger'] },
  { id: 'guiding-bolt', label: 'Guiding Bolt', level: 1, school: 'Evocation', lists: ['cleric'] },
  { id: 'healing-word', label: 'Healing Word', level: 1, school: 'Abjuration', lists: ['bard', 'cleric', 'druid'] },
  { id: 'heroism', label: 'Heroism', level: 1, school: 'Enchantment', lists: ['bard', 'paladin'] },
  { id: 'hex', label: 'Hex', level: 1, school: 'Enchantment', lists: ['warlock'] },
  { id: 'hunters-mark', label: "Hunter's Mark", level: 1, school: 'Divination', lists: ['paladin', 'ranger', 'warlock'] },
  { id: 'identify', label: 'Identify', level: 1, school: 'Divination', lists: ['bard', 'wizard'] },
  { id: 'inflict-wounds', label: 'Inflict Wounds', level: 1, school: 'Necromancy', lists: ['cleric'] },
  { id: 'jump', label: 'Jump', level: 1, school: 'Transmutation', lists: ['druid', 'ranger', 'sorcerer', 'wizard'] },
  { id: 'longstrider', label: 'Longstrider', level: 1, school: 'Transmutation', lists: ['bard', 'druid', 'ranger', 'wizard'] },
  { id: 'mage-armor', label: 'Mage Armor', level: 1, school: 'Abjuration', lists: ['sorcerer', 'wizard'] },
  { id: 'magic-missile', label: 'Magic Missile', level: 1, school: 'Evocation', lists: ['sorcerer', 'wizard'] },
  { id: 'protection-from-evil-and-good', label: 'Protection from Evil and Good', level: 1, school: 'Abjuration', lists: ['cleric', 'paladin', 'warlock', 'wizard'] },
  { id: 'purify-food-and-drink', label: 'Purify Food and Drink', level: 1, school: 'Transmutation', lists: ['cleric', 'druid', 'paladin'] },
  { id: 'sanctuary', label: 'Sanctuary', level: 1, school: 'Abjuration', lists: ['cleric'] },
  { id: 'shield', label: 'Shield', level: 1, school: 'Abjuration', lists: ['sorcerer', 'wizard'] },
  { id: 'shield-of-faith', label: 'Shield of Faith', level: 1, school: 'Abjuration', lists: ['cleric', 'paladin'] },
  { id: 'silent-image', label: 'Silent Image', level: 1, school: 'Illusion', lists: ['bard', 'sorcerer', 'wizard'] },
  { id: 'sleep', label: 'Sleep', level: 1, school: 'Enchantment', lists: ['bard', 'sorcerer', 'wizard'] },
  { id: 'speak-with-animals', label: 'Speak with Animals', level: 1, school: 'Divination', lists: ['bard', 'druid', 'ranger'] },
  { id: 'thunderwave', label: 'Thunderwave', level: 1, school: 'Evocation', lists: ['bard', 'druid', 'sorcerer', 'wizard'] },
  { id: 'unseen-servant', label: 'Unseen Servant', level: 1, school: 'Conjuration', lists: ['bard', 'warlock', 'wizard'] },
  { id: 'witch-bolt', label: 'Witch Bolt', level: 1, school: 'Evocation', lists: ['sorcerer', 'warlock', 'wizard'] },
];

function weaponKit(
  id: string,
  label: string,
  items: readonly { readonly name: string; readonly quantity: number }[],
  gold: number,
  armorIds: readonly string[],
  weaponIds: readonly string[],
): EquipmentOption {
  return { id, label, items, gold, armorIds, weaponIds };
}

export const CLASSES: readonly ClassRecord[] = [
  {
    id: 'barbarian', label: 'Barbarian', summary: 'A durable frontline martial combatant who fights in a Rage.',
    hitDie: 12, savingThrowProficiencies: ['strength', 'constitution'], skillChoiceCount: 2,
    skillChoiceIds: ['animal-handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'],
    armorProficiencies: ['Light armor', 'Medium armor', 'Shields'], weaponProficiencies: ['Simple weapons', 'Martial weapons'], toolProficiencies: [],
    features: [
      { name: 'Rage', summary: 'You can enter a Rage as a Bonus Action, gaining damage resistance and bonus damage.' },
      { name: 'Unarmored Defense', summary: 'While not wearing armor, your Armor Class equals 10 plus your Dexterity and Constitution modifiers.' },
      { name: 'Weapon Mastery', summary: 'You gain the mastery property of two weapons you are proficient with.' },
    ],
    choices: [], unarmoredDefenseAbility: 'constitution', spellcasting: null,
    equipmentOptions: [
      weaponKit('barbarian-a', "Greataxe, Handaxe (4), Explorer's Pack, 15 GP", [{ name: 'Greataxe', quantity: 1 }, { name: 'Handaxe', quantity: 4 }, { name: "Explorer's Pack", quantity: 1 }], 15, [], ['greataxe', 'handaxe']),
      weaponKit('barbarian-b', '75 GP', [], 75, [], []),
    ],
  },
  {
    id: 'bard', label: 'Bard', summary: 'A versatile spellcaster who inspires allies and talks their way through trouble.',
    hitDie: 8, savingThrowProficiencies: ['dexterity', 'charisma'], skillChoiceCount: 3, skillChoiceIds: [],
    armorProficiencies: ['Light armor'], weaponProficiencies: ['Simple weapons'], toolProficiencies: ['Three Musical Instruments'],
    features: [
      { name: 'Bardic Inspiration', summary: 'As a Bonus Action you can give another creature a Bardic Inspiration die.' },
      { name: 'Spellcasting', summary: 'You cast Bard spells using Charisma.' },
    ],
    choices: [], unarmoredDefenseAbility: null,
    spellcasting: { ability: 'charisma', cantripsKnown: 2, spellsAvailable: 4, preparationStyle: 'known', level1SlotCount: 2, spellListId: 'bard' },
    equipmentOptions: [
      weaponKit('bard-a', "Leather Armor, Dagger (2), Musical Instrument, Entertainer's Pack, 19 GP", [{ name: 'Leather Armor', quantity: 1 }, { name: 'Dagger', quantity: 2 }, { name: 'Musical Instrument', quantity: 1 }, { name: "Entertainer's Pack", quantity: 1 }], 19, ['leather'], ['dagger']),
      weaponKit('bard-b', '90 GP', [], 90, [], []),
    ],
  },
  {
    id: 'cleric', label: 'Cleric', summary: 'A divine spellcaster who heals, protects, and channels their deity.',
    hitDie: 8, savingThrowProficiencies: ['wisdom', 'charisma'], skillChoiceCount: 2,
    skillChoiceIds: ['history', 'insight', 'medicine', 'persuasion', 'religion'],
    armorProficiencies: ['Light armor', 'Medium armor', 'Shields'], weaponProficiencies: ['Simple weapons'], toolProficiencies: [],
    features: [
      { name: 'Divine Order', summary: 'You commit to a sacred role as Protector or Thaumaturge.' },
      { name: 'Spellcasting', summary: 'You cast Cleric spells using Wisdom.' },
    ],
    choices: [
      {
        id: 'divine-order',
        label: 'Divine Order',
        helper: 'Clerics swear to a Divine Order that shapes their training. Pick Protector or Thaumaturge.',
        choose: 1,
        from: [
          { id: 'protector', label: 'Protector', summary: 'Training with Martial weapons and Heavy armor.' },
          { id: 'thaumaturge', label: 'Thaumaturge', summary: 'An extra cantrip and Arcana or Religion expertise-style benefit at the table.' },
        ],
      },
    ],
    unarmoredDefenseAbility: null,
    spellcasting: { ability: 'wisdom', cantripsKnown: 3, spellsAvailable: 4, preparationStyle: 'prepared', level1SlotCount: 2, spellListId: 'cleric' },
    equipmentOptions: [
      weaponKit('cleric-a', "Chain Shirt, Shield, Mace, Holy Symbol, Priest's Pack, 7 GP", [{ name: 'Chain Shirt', quantity: 1 }, { name: 'Shield', quantity: 1 }, { name: 'Mace', quantity: 1 }, { name: 'Holy Symbol', quantity: 1 }, { name: "Priest's Pack", quantity: 1 }], 7, ['chain-shirt', 'shield'], ['mace']),
      weaponKit('cleric-b', '110 GP', [], 110, [], []),
    ],
  },
  {
    id: 'druid', label: 'Druid', summary: 'A primal spellcaster bound to the natural world.',
    hitDie: 8, savingThrowProficiencies: ['intelligence', 'wisdom'], skillChoiceCount: 2,
    skillChoiceIds: ['arcana', 'animal-handling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'],
    armorProficiencies: ['Light armor', 'Shields'], weaponProficiencies: ['Simple weapons'], toolProficiencies: ['Herbalism Kit'],
    features: [
      { name: 'Druidic', summary: 'You know Druidic, the secret language of Druids.' },
      { name: 'Primal Order', summary: 'You commit to a druidic role as Magician or Warden.' },
      { name: 'Spellcasting', summary: 'You cast Druid spells using Wisdom.' },
    ],
    choices: [
      {
        id: 'primal-order',
        label: 'Primal Order',
        helper: 'Druids follow a Primal Order. Magician leans spells; Warden leans steel and hide.',
        choose: 1,
        from: [
          { id: 'magician', label: 'Magician', summary: 'An extra cantrip and a boost when you use a Druidic Focus.' },
          { id: 'warden', label: 'Warden', summary: 'Martial weapon proficiency and Medium armor training.' },
        ],
      },
    ],
    unarmoredDefenseAbility: null,
    spellcasting: { ability: 'wisdom', cantripsKnown: 2, spellsAvailable: 4, preparationStyle: 'prepared', level1SlotCount: 2, spellListId: 'druid' },
    equipmentOptions: [
      weaponKit('druid-a', "Leather Armor, Shield, Sickle, Druidic Focus, Explorer's Pack, Herbalism Kit, 9 GP", [{ name: 'Leather Armor', quantity: 1 }, { name: 'Shield', quantity: 1 }, { name: 'Sickle', quantity: 1 }, { name: 'Druidic Focus', quantity: 1 }, { name: "Explorer's Pack", quantity: 1 }, { name: 'Herbalism Kit', quantity: 1 }], 9, ['leather', 'shield'], ['sickle']),
      weaponKit('druid-b', '50 GP', [], 50, [], []),
    ],
  },
  {
    id: 'fighter', label: 'Fighter', summary: 'A durable frontline martial combatant with a chosen Fighting Style.',
    hitDie: 10, savingThrowProficiencies: ['strength', 'constitution'], skillChoiceCount: 2,
    skillChoiceIds: ['acrobatics', 'animal-handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'persuasion', 'survival'],
    armorProficiencies: ['Light armor', 'Medium armor', 'Heavy armor', 'Shields'], weaponProficiencies: ['Simple weapons', 'Martial weapons'], toolProficiencies: [],
    features: [
      { name: 'Fighting Style', summary: 'You adopt a particular style of fighting as your specialty.' },
      { name: 'Second Wind', summary: 'You can use a Bonus Action to regain Hit Points.' },
      { name: 'Weapon Mastery', summary: 'You gain the mastery property of three weapons you are proficient with.' },
    ],
    choices: [
      {
        id: 'fighting-style',
        label: 'Fighting Style',
        helper: 'A Fighting Style is a permanent combat habit. Pick one — its bonus applies on your sheet when the conditions match.',
        choose: 1,
        from: [
          { id: 'archery', label: 'Archery', summary: '+2 to attack rolls you make with ranged weapons.' },
          { id: 'defense', label: 'Defense', summary: '+1 to Armor Class while you are wearing armor.' },
          { id: 'dueling', label: 'Dueling', summary: '+2 damage when attacking with a one-handed melee weapon and no other weapons.' },
          { id: 'great-weapon-fighting', label: 'Great Weapon Fighting', summary: 'Reroll 1s and 2s on damage dice for two-handed or versatile melee weapons.' },
          { id: 'protection', label: 'Protection', summary: 'With a Shield, impose Disadvantage on an attack against a nearby ally (Reaction).' },
          { id: 'two-weapon-fighting', label: 'Two-Weapon Fighting', summary: 'Add your ability modifier to the bonus attack when fighting with two weapons.' },
        ],
      },
    ],
    unarmoredDefenseAbility: null, spellcasting: null,
    equipmentOptions: [
      weaponKit('fighter-a', "Chain Mail, Greatsword, Javelin (4), Dungeoneer's Pack, 4 GP", [{ name: 'Chain Mail', quantity: 1 }, { name: 'Greatsword', quantity: 1 }, { name: 'Javelin', quantity: 4 }, { name: "Dungeoneer's Pack", quantity: 1 }], 4, ['chain-mail'], ['greatsword', 'javelin']),
      weaponKit('fighter-b', "Studded Leather Armor, Scimitar, Shortsword, Longbow, Arrows (20), Dungeoneer's Pack, 11 GP", [{ name: 'Studded Leather Armor', quantity: 1 }, { name: 'Scimitar', quantity: 1 }, { name: 'Shortsword', quantity: 1 }, { name: 'Longbow', quantity: 1 }, { name: 'Arrows', quantity: 20 }, { name: "Dungeoneer's Pack", quantity: 1 }], 11, ['studded-leather'], ['scimitar', 'shortsword', 'longbow']),
      weaponKit('fighter-c', '155 GP', [], 155, [], []),
    ],
  },
  {
    id: 'monk', label: 'Monk', summary: 'A fast unarmored martial artist who fights with focus and discipline.',
    hitDie: 8, savingThrowProficiencies: ['strength', 'dexterity'], skillChoiceCount: 2,
    skillChoiceIds: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'],
    armorProficiencies: [], weaponProficiencies: ['Simple weapons', 'Martial weapons with the Light property'], toolProficiencies: ["One type of Artisan's Tools or Musical Instrument"],
    features: [
      { name: 'Martial Arts', summary: 'Your unarmed strikes and Monk weapons use a Martial Arts die and Dexterity.' },
      { name: 'Unarmored Defense', summary: 'While unarmored and not using a Shield, your Armor Class equals 10 plus your Dexterity and Wisdom modifiers.' },
    ],
    choices: [], unarmoredDefenseAbility: 'wisdom', spellcasting: null,
    equipmentOptions: [
      weaponKit('monk-a', "Spear, Dagger (5), Artisan's Tools or Musical Instrument, Explorer's Pack, 11 GP", [{ name: 'Spear', quantity: 1 }, { name: 'Dagger', quantity: 5 }, { name: "Artisan's Tools or Musical Instrument", quantity: 1 }, { name: "Explorer's Pack", quantity: 1 }], 11, [], ['spear', 'dagger']),
      weaponKit('monk-b', '50 GP', [], 50, [], []),
    ],
  },
  {
    id: 'paladin', label: 'Paladin', summary: 'A sworn martial spellcaster who heals by touch and smites by oath.',
    hitDie: 10, savingThrowProficiencies: ['wisdom', 'charisma'], skillChoiceCount: 2,
    skillChoiceIds: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'],
    armorProficiencies: ['Light armor', 'Medium armor', 'Heavy armor', 'Shields'], weaponProficiencies: ['Simple weapons', 'Martial weapons'], toolProficiencies: [],
    features: [
      { name: 'Lay On Hands', summary: 'You have a pool of healing power that restores Hit Points by touch.' },
      { name: 'Spellcasting', summary: 'You cast Paladin spells using Charisma.' },
      { name: 'Weapon Mastery', summary: 'You gain the mastery property of two weapons you are proficient with.' },
    ],
    choices: [], unarmoredDefenseAbility: null,
    spellcasting: { ability: 'charisma', cantripsKnown: 0, spellsAvailable: 2, preparationStyle: 'prepared', level1SlotCount: 2, spellListId: 'paladin' },
    equipmentOptions: [
      weaponKit('paladin-a', "Chain Mail, Shield, Longsword, Javelin (6), Holy Symbol, Priest's Pack, 9 GP", [{ name: 'Chain Mail', quantity: 1 }, { name: 'Shield', quantity: 1 }, { name: 'Longsword', quantity: 1 }, { name: 'Javelin', quantity: 6 }, { name: 'Holy Symbol', quantity: 1 }, { name: "Priest's Pack", quantity: 1 }], 9, ['chain-mail', 'shield'], ['longsword', 'javelin']),
      weaponKit('paladin-b', '150 GP', [], 150, [], []),
    ],
  },
  {
    id: 'ranger', label: 'Ranger', summary: 'A wilderness martial spellcaster who marks and hunts a quarry.',
    hitDie: 10, savingThrowProficiencies: ['strength', 'dexterity'], skillChoiceCount: 3,
    skillChoiceIds: ['animal-handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'],
    armorProficiencies: ['Light armor', 'Medium armor', 'Shields'], weaponProficiencies: ['Simple weapons', 'Martial weapons'], toolProficiencies: [],
    features: [
      { name: 'Favored Enemy', summary: "You always have Hunter's Mark prepared and can cast it a number of times per Long Rest." },
      { name: 'Spellcasting', summary: 'You cast Ranger spells using Wisdom.' },
      { name: 'Weapon Mastery', summary: 'You gain the mastery property of two weapons you are proficient with.' },
    ],
    choices: [], unarmoredDefenseAbility: null,
    spellcasting: { ability: 'wisdom', cantripsKnown: 0, spellsAvailable: 2, preparationStyle: 'prepared', level1SlotCount: 2, spellListId: 'ranger' },
    equipmentOptions: [
      weaponKit('ranger-a', "Studded Leather Armor, Scimitar, Shortsword, Longbow, Arrows (20), Druidic Focus, Explorer's Pack, 7 GP", [{ name: 'Studded Leather Armor', quantity: 1 }, { name: 'Scimitar', quantity: 1 }, { name: 'Shortsword', quantity: 1 }, { name: 'Longbow', quantity: 1 }, { name: 'Arrows', quantity: 20 }, { name: 'Druidic Focus', quantity: 1 }, { name: "Explorer's Pack", quantity: 1 }], 7, ['studded-leather'], ['scimitar', 'shortsword', 'longbow']),
      weaponKit('ranger-b', '150 GP', [], 150, [], []),
    ],
  },
  {
    id: 'rogue', label: 'Rogue', summary: 'A precise skirmisher who strikes from advantage and excels at skills.',
    hitDie: 8, savingThrowProficiencies: ['dexterity', 'intelligence'], skillChoiceCount: 4,
    skillChoiceIds: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight-of-hand', 'stealth'],
    armorProficiencies: ['Light armor'], weaponProficiencies: ['Simple weapons', 'Martial weapons with the Finesse or Light property'], toolProficiencies: ["Thieves' Tools"],
    features: [
      { name: 'Expertise', summary: 'You gain Expertise in two of your skill proficiencies.' },
      { name: 'Sneak Attack', summary: 'You deal extra damage once per turn when you have Advantage or an ally is adjacent.' },
      { name: "Thieves' Cant", summary: 'You know the secret mix of dialect, jargon, and code used by rogues.' },
      { name: 'Weapon Mastery', summary: 'You gain the mastery property of two weapons you are proficient with.' },
    ],
    choices: [], unarmoredDefenseAbility: null, spellcasting: null,
    equipmentOptions: [
      weaponKit('rogue-a', "Studded Leather Armor, Dagger (2), Shortsword, Shortbow, Arrows (20), Thieves' Tools, Burglar's Pack, 8 GP", [{ name: 'Studded Leather Armor', quantity: 1 }, { name: 'Dagger', quantity: 2 }, { name: 'Shortsword', quantity: 1 }, { name: 'Shortbow', quantity: 1 }, { name: 'Arrows', quantity: 20 }, { name: "Thieves' Tools", quantity: 1 }, { name: "Burglar's Pack", quantity: 1 }], 8, ['studded-leather'], ['dagger', 'shortsword', 'shortbow']),
      weaponKit('rogue-b', '100 GP', [], 100, [], []),
    ],
  },
  {
    id: 'sorcerer', label: 'Sorcerer', summary: 'An innate spellcaster whose magic wells up from within.',
    hitDie: 6, savingThrowProficiencies: ['constitution', 'charisma'], skillChoiceCount: 2,
    skillChoiceIds: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'],
    armorProficiencies: [], weaponProficiencies: ['Simple weapons'], toolProficiencies: [],
    features: [
      { name: 'Innate Sorcery', summary: 'As a Bonus Action you can unleash your innate magic for one minute.' },
      { name: 'Spellcasting', summary: 'You cast Sorcerer spells using Charisma.' },
    ],
    choices: [], unarmoredDefenseAbility: null,
    spellcasting: { ability: 'charisma', cantripsKnown: 4, spellsAvailable: 2, preparationStyle: 'known', level1SlotCount: 2, spellListId: 'sorcerer' },
    equipmentOptions: [
      weaponKit('sorcerer-a', "Spear, Dagger (2), Arcane Focus, Dungeoneer's Pack, 28 GP", [{ name: 'Spear', quantity: 1 }, { name: 'Dagger', quantity: 2 }, { name: 'Arcane Focus', quantity: 1 }, { name: "Dungeoneer's Pack", quantity: 1 }], 28, [], ['spear', 'dagger']),
      weaponKit('sorcerer-b', '50 GP', [], 50, [], []),
    ],
  },
  {
    id: 'warlock', label: 'Warlock', summary: 'A pact spellcaster whose power is granted by an otherworldly patron.',
    hitDie: 8, savingThrowProficiencies: ['wisdom', 'charisma'], skillChoiceCount: 2,
    skillChoiceIds: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'],
    armorProficiencies: ['Light armor'], weaponProficiencies: ['Simple weapons'], toolProficiencies: [],
    features: [
      { name: 'Eldritch Invocations', summary: 'You learn Eldritch Invocations that reshape your pact magic.' },
      { name: 'Pact Magic', summary: 'You cast Warlock spells using Charisma, regaining slots on a Short Rest.' },
    ],
    choices: [
      {
        id: 'eldritch-invocation',
        label: 'Eldritch Invocation',
        helper: 'Invocations are permanent pact tricks. Pick one you know at level 1.',
        choose: 1,
        from: [
          { id: 'agonizing-blast', label: 'Agonizing Blast', summary: 'Add your Charisma modifier to Eldritch Blast damage.' },
          { id: 'armor-of-shadows', label: 'Armor of Shadows', summary: 'Cast Mage Armor on yourself at will (AC 13 + Dexterity while unarmored).' },
          { id: 'devils-sight', label: "Devil's Sight", summary: 'See normally in Magical and nonmagical Darkness out to 120 feet.' },
          { id: 'eldritch-mind', label: 'Eldritch Mind', summary: 'Advantage on Constitution saving throws to maintain Concentration.' },
          { id: 'mask-of-many-faces', label: 'Mask of Many Faces', summary: 'Cast Disguise Self at will without a spell slot.' },
          { id: 'pact-of-the-blade', label: 'Pact of the Blade', summary: 'Conjure or bond a pact weapon and use it as your spellcasting focus.' },
        ],
      },
    ],
    unarmoredDefenseAbility: null,
    spellcasting: { ability: 'charisma', cantripsKnown: 2, spellsAvailable: 2, preparationStyle: 'known', level1SlotCount: 1, spellListId: 'warlock' },
    equipmentOptions: [
      weaponKit('warlock-a', "Leather Armor, Sickle, Dagger (2), Arcane Focus, Book (occult lore), Scholar's Pack, 15 GP", [{ name: 'Leather Armor', quantity: 1 }, { name: 'Sickle', quantity: 1 }, { name: 'Dagger', quantity: 2 }, { name: 'Arcane Focus', quantity: 1 }, { name: 'Book (occult lore)', quantity: 1 }, { name: "Scholar's Pack", quantity: 1 }], 15, ['leather'], ['sickle', 'dagger']),
      weaponKit('warlock-b', '100 GP', [], 100, [], []),
    ],
  },
  {
    id: 'wizard', label: 'Wizard', summary: 'A studied spellcaster who prepares magic from a spellbook.',
    hitDie: 6, savingThrowProficiencies: ['intelligence', 'wisdom'], skillChoiceCount: 2,
    skillChoiceIds: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'nature', 'religion'],
    armorProficiencies: [], weaponProficiencies: ['Simple weapons'], toolProficiencies: [],
    features: [
      { name: 'Arcane Recovery', summary: 'Once per day after a Short Rest you can recover expended spell slots.' },
      { name: 'Ritual Adept', summary: 'You can cast any spell in your spellbook as a Ritual if it has the Ritual tag.' },
      { name: 'Spellcasting', summary: 'You cast Wizard spells using Intelligence.' },
    ],
    choices: [], unarmoredDefenseAbility: null,
    spellcasting: { ability: 'intelligence', cantripsKnown: 3, spellsAvailable: 4, preparationStyle: 'prepared', level1SlotCount: 2, spellListId: 'wizard' },
    equipmentOptions: [
      weaponKit('wizard-a', "Quarterstaff, Dagger (2), Arcane Focus, Robe, Spellbook, Scholar's Pack, 5 GP", [{ name: 'Quarterstaff', quantity: 1 }, { name: 'Dagger', quantity: 2 }, { name: 'Arcane Focus', quantity: 1 }, { name: 'Robe', quantity: 1 }, { name: 'Spellbook', quantity: 1 }, { name: "Scholar's Pack", quantity: 1 }], 5, [], ['quarterstaff', 'dagger']),
      weaponKit('wizard-b', '55 GP', [], 55, [], []),
    ],
  },
];

/**
 * Quick-start templates.
 *
 * Section 1.5.8.2: "Quick-start follows the same principle. The player
 * chooses a mechanically complete SRD template first, may review or edit
 * legal choices, and supplies the character's identity only at the final
 * identity/review step." Each template therefore fills every mechanical
 * decision and deliberately leaves identity empty.
 */
export interface QuickStartTemplate {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly classId: string;
  readonly backgroundId: string;
  readonly speciesId: string;
  readonly baseAbilityScores: Record<string, number>;
  readonly backgroundAbilityBonuses: Record<string, number>;
  readonly classSkillIds: readonly string[];
  readonly speciesChoiceIds: Readonly<Record<string, string>>;
  readonly classChoiceIds: Readonly<Record<string, readonly string[]>>;
  readonly classEquipmentOptionId: string;
  readonly backgroundEquipmentOptionId: string;
  readonly cantripIds: readonly string[];
  readonly spellIds: readonly string[];
}

export const QUICK_START_TEMPLATES: readonly QuickStartTemplate[] = [
  {
    id: 'stalwart-defender', label: 'Stalwart Defender',
    summary: 'A Dwarf Fighter who stands in front. Heavy armor, a greatsword, and the highest Hit Points on offer.',
    classId: 'fighter', backgroundId: 'soldier', speciesId: 'dwarf',
    baseAbilityScores: { strength: 15, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 13, charisma: 8 },
    backgroundAbilityBonuses: { strength: 2, constitution: 1 },
    classSkillIds: ['perception', 'survival'],
    speciesChoiceIds: {}, classChoiceIds: { 'fighting-style': ['defense'] },
    classEquipmentOptionId: 'fighter-a', backgroundEquipmentOptionId: 'soldier-kit',
    cantripIds: [], spellIds: [],
  },
  {
    id: 'devoted-healer', label: 'Devoted Healer',
    summary: 'A Human Cleric who keeps the party standing. Chain shirt, shield, and healing magic.',
    classId: 'cleric', backgroundId: 'acolyte', speciesId: 'human',
    baseAbilityScores: { strength: 13, dexterity: 10, constitution: 14, intelligence: 8, wisdom: 15, charisma: 12 },
    backgroundAbilityBonuses: { wisdom: 2, charisma: 1 },
    classSkillIds: ['medicine', 'persuasion'],
    speciesChoiceIds: { 'human-skillful': 'athletics' }, classChoiceIds: { 'divine-order': ['protector'] },
    classEquipmentOptionId: 'cleric-a', backgroundEquipmentOptionId: 'acolyte-kit',
    cantripIds: ['guidance', 'sacred-flame', 'light'], spellIds: ['cure-wounds', 'bless', 'guiding-bolt', 'healing-word'],
  },
  {
    id: 'shadow-scout', label: 'Shadow Scout',
    summary: 'A Halfling Rogue who finds the trap first. Four skill proficiencies and a finesse blade.',
    classId: 'rogue', backgroundId: 'criminal', speciesId: 'halfling',
    baseAbilityScores: { strength: 8, dexterity: 15, constitution: 13, intelligence: 14, wisdom: 12, charisma: 10 },
    backgroundAbilityBonuses: { dexterity: 2, constitution: 1 },
    classSkillIds: ['acrobatics', 'investigation', 'perception', 'insight'],
    speciesChoiceIds: {}, classChoiceIds: {},
    classEquipmentOptionId: 'rogue-a', backgroundEquipmentOptionId: 'criminal-kit',
    cantripIds: [], spellIds: [],
  },
  {
    id: 'studious-mage', label: 'Studious Mage',
    summary: 'A Tiefling Wizard with a spellbook and a plan. Fragile, but the widest spell selection at level 1.',
    classId: 'wizard', backgroundId: 'sage', speciesId: 'tiefling',
    baseAbilityScores: { strength: 8, dexterity: 14, constitution: 13, intelligence: 15, wisdom: 12, charisma: 10 },
    backgroundAbilityBonuses: { intelligence: 2, constitution: 1 },
    classSkillIds: ['insight', 'investigation'],
    speciesChoiceIds: { 'fiendish-legacy': 'infernal' }, classChoiceIds: {},
    classEquipmentOptionId: 'wizard-a', backgroundEquipmentOptionId: 'sage-kit',
    cantripIds: ['fire-bolt', 'mage-hand', 'prestidigitation'],
    spellIds: ['burning-hands', 'shield', 'magic-missile', 'sleep'],
  },
];

export function findQuickStartTemplate(id: string): QuickStartTemplate | null {
  return QUICK_START_TEMPLATES.find((entry) => entry.id === id) ?? null;
}

export function findClass(id: string | null): ClassRecord | null {
  return CLASSES.find((entry) => entry.id === id) ?? null;
}
export function findSpecies(id: string | null): SpeciesRecord | null {
  return SPECIES.find((entry) => entry.id === id) ?? null;
}
export function findBackground(id: string | null): BackgroundRecord | null {
  return BACKGROUNDS.find((entry) => entry.id === id) ?? null;
}
export function findSkill(id: string): SkillRecord | null {
  return SKILLS.find((entry) => entry.id === id) ?? null;
}
export function findArmor(id: string): ArmorRecord | null {
  return ARMOR.find((entry) => entry.id === id) ?? null;
}
export function findWeapon(id: string): WeaponRecord | null {
  return WEAPONS.find((entry) => entry.id === id) ?? null;
}
export function findSpell(id: string): SpellRecord | null {
  return SPELLS.find((entry) => entry.id === id) ?? null;
}
export function spellsForList(listId: string, level: 0 | 1): readonly SpellRecord[] {
  return SPELLS.filter((spell) => spell.level === level && spell.lists.includes(listId));
}
