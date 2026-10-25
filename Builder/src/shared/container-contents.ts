/**
 * Container contents authorship — separate from open/closed leaf state.
 *
 * Missing contents means unauthored (honest limitation). Empty array means
 * authored empty. Discovery tracks what the party has actually learned.
 */

export const CONTENTS_DISCOVERY_STATES = ['hidden', 'visible', 'searched', 'taken'] as const;
export type ContentsDiscoveryState = (typeof CONTENTS_DISCOVERY_STATES)[number];

export interface AuthoredContentItem {
  readonly itemId: string;
  readonly label: string;
  /** When true, item is already removed into a character inventory. */
  readonly taken?: boolean;
}

export interface ContainerContentsView {
  /** null = unauthored; [] = authored empty; otherwise remaining items. */
  readonly contents: readonly AuthoredContentItem[] | null;
  readonly discovery: ContentsDiscoveryState;
  readonly open: boolean;
}

export interface ContainerContentsAnswer {
  readonly ok: boolean;
  readonly body: string;
  readonly nextDiscovery: ContentsDiscoveryState;
  readonly takenItems?: readonly string[];
}

export function answerContainerContentsQuery(options: {
  readonly containerLabel: string;
  readonly view: ContainerContentsView;
  readonly wantsTake?: boolean;
  /** Take the container itself as a portable prop — not an item from inside it. */
  readonly wantsTakeContainer?: boolean;
}): ContainerContentsAnswer {
  const label = options.containerLabel.trim() || 'the container';
  const { contents, discovery, open } = options.view;

  if (options.wantsTakeContainer === true) {
    return {
      ok: true,
      body: open
        ? `You mean ${label} itself — a portable prop, not a search of its contents. Empty or not, authored contents are irrelevant to carrying the bag. No matching portable container is on this scene to stow, so nothing is taken or removed from the map.`
        : `You mean ${label} itself — still a portable prop even while closed, not an invitation to invent contents. No matching portable container is on this scene to stow, so nothing is taken or removed from the map.`,
      nextDiscovery: discovery,
    };
  }

  if (!open && discovery === 'hidden') {
    return {
      ok: false,
      body: `${label} is closed. Open it before you can see inside — looking from here does not invent contents.`,
      nextDiscovery: discovery,
    };
  }

  if (contents === null) {
    return {
      ok: true,
      body: open
        ? `${label} is open, but no contents are authored for it on this table. Nothing to list, take, or invent — try another prop or ask the Director what avenues remain.`
        : `${label} has no authored contents on this table. Opening it will not create loot that was never written.`,
      nextDiscovery: open ? 'searched' : discovery,
    };
  }

  const remaining = contents.filter((item) => item.taken !== true);
  if (options.wantsTake) {
    if (remaining.length === 0) {
      return {
        ok: true,
        body:
          contents.length === 0
            ? `${label} is empty — there is nothing to take.`
            : `Everything that was in ${label} has already been taken.`,
        nextDiscovery: 'taken',
      };
    }
    const takenLabels = remaining.map((item) => item.label);
    return {
      ok: true,
      body: `You take ${takenLabels.join(', ')} from ${label} and stow ${takenLabels.length === 1 ? 'it' : 'them'} in your pack.`,
      nextDiscovery: 'taken',
      takenItems: takenLabels,
    };
  }

  if (remaining.length === 0) {
    return {
      ok: true,
      body:
        contents.length === 0
          ? `You look inside ${label}. It is empty.`
          : `You look inside ${label}. Nothing remains — its contents were already taken.`,
      nextDiscovery: contents.length === 0 ? 'searched' : 'taken',
    };
  }

  const list = remaining.map((item) => item.label).join(', ');
  return {
    ok: true,
    body:
      discovery === 'hidden' && !open
        ? `${label} still conceals its contents until opened.`
        : `Inside ${label} you can make out: ${list}.`,
    nextDiscovery: 'searched',
  };
}

/** Infer a container label hint from declaration text for matching. */
export function containerLabelHintFromText(text: string): string | null {
  const match = text.match(
    /\b(?:the\s+)?(courier\s+satchel|satchel|pack|bag|crate|crates|chest|box|barrel|urn|pouch)\b/i,
  );
  return match?.[1]?.toLowerCase() ?? null;
}

/** Portable bags the table may stow — not furniture crates/chests. */
export const PORTABLE_CONTAINER_LABEL =
  /\b(?:courier\s+satchel|satchel|pack|bag|pouch)\b/i;

/** Heavy room furniture/fixtures that cannot be pocketed into inventory. */
export const HEAVY_FIXTURE_LABEL =
  /\b(?:crate|crates|chest|box|barrel|urn|freight|table|bench|workbench|counter|bar|hearth|pillar|statue|altar|brazier|cart|rack|bed|bunk|shelf|shelves|throne|anvil|forge|cauldron|well|fountain|sarcophagus|pedestal|column|tree|boulder|stump|log|wagon|carriage|door|doorway|gate|stairs|stairway|ladder|window|wall|floor|ceiling)\b/i;

/** Portable items and quest props that a character can pick up and stow in inventory. */
export const PORTABLE_SCENE_PROP_LABEL =
  /\b(?:courier\s+satchel|satchel|pack|bag|pouch|key|cypher|cipher|bell|lantern|lamp|ledger|scroll|letter|note|journal|book|tome|map|seal|amulet|ring|coin|gem|relic|vial|potion|dagger|blade|sword|shield|bow|staff|wand|rod|orb|rope|compass|medallion|badge|token|torch|lockpick|tool|horn|flute|lute|chalice|goblet|crown|brooch|locket|pendant|stone|crystal|shard|bone|skull|idol|figurine|parchment|document|papers|manifest|writ|contract|cloak|boots|gloves|helm|hat|mask)\b/i;

export function labelLooksPortableContainer(label: string): boolean {
  return PORTABLE_CONTAINER_LABEL.test(label);
}

export function labelLooksPortableSceneProp(label: string): boolean {
  if (HEAVY_FIXTURE_LABEL.test(label) && !PORTABLE_CONTAINER_LABEL.test(label)) {
    return false;
  }
  return PORTABLE_CONTAINER_LABEL.test(label) || PORTABLE_SCENE_PROP_LABEL.test(label);
}

/**
 * Provides concise mechanical/functional summaries for non-weapon, non-armor
 * adventuring gear, consumables, tools, light sources, and recovered loot items.
 */
export function describeEquipmentItemMechanics(itemName: string): {
  readonly itemKind: 'gear';
  readonly statsSummary: string;
} {
  const lower = itemName.trim().toLowerCase();

  if (/\b(?:healing\s+draught|potion\s+of\s+healing|healing\s+potion|healing\s+elixir|restorative\s+draught)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Consumable · Bonus Action or Action: Restores 2d4 + 2 Hit Points when consumed',
    };
  }
  if (/\b(?:greater\s+healing|potion\s+of\s+greater\s+healing)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Consumable · Bonus Action or Action: Restores 4d4 + 4 Hit Points when consumed',
    };
  }
  if (/\b(?:antitoxin|antidote)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Consumable · Bonus Action: Grants Advantage on saving throws against Poison for 1 hour',
    };
  }
  if (/\b(?:potion|draught|elixir|philter|tonic|vial)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Consumable · Alchemical preparation; inspect label or drink as an Action/Bonus Action',
    };
  }
  if (/\b(?:bullseye\s+lantern)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Light source · Casts bright light in a 60-ft cone and dim light for an additional 60 ft',
    };
  }
  if (/\b(?:lantern|lamp)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Light source · Casts bright light in a 30-ft radius and dim light for an additional 30 ft',
    };
  }
  if (/\b(?:torch)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Light source · Casts bright light in a 20-ft radius and dim light for 20 ft (1 hour; 1 Fire damage on hit)',
    };
  }
  if (/\b(?:candle)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Light source · Casts bright light in a 5-ft radius and dim light for an additional 5 ft (1 hour)',
    };
  }
  if (/\b(?:thieves['’]?\s+tools|lockpick)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Tools · Utilize Action (DC 15 Dexterity check) to pick a lock or disarm a trap',
    };
  }
  if (/\b(?:healer['’]?\s+kit|bandages)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Kit · Utilize Action: Stabilize a dying creature at 0 HP without a Medicine check (10 uses)',
    };
  }
  if (/\b(?:crowbar)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Tool · Grants Advantage on Strength checks where the crowbar’s leverage can be applied',
    };
  }
  if (/\b(?:rope)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Adventuring gear · 50 feet of sturdy cordage for climbing, binding, or rigging (DC 17 Athletics to burst)',
    };
  }
  if (/\b(?:grappling\s+hook)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Adventuring gear · Utilize Action (DC 13 Acrobatics) to anchor a rope to a ledge or battlement',
    };
  }
  if (/\b(?:rations)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Consumable · 1 day of preserved trail food required to avoid malnutrition during travel',
    };
  }
  if (/\b(?:waterskin|canteen)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Adventuring gear · Holds 4 pints of water or liquid refreshment',
    };
  }
  if (/\b(?:tinderbox)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Adventuring gear · Bonus Action to light a candle, torch, or lantern; 1 minute to light a campfire',
    };
  }
  if (/\b(?:holy\s+symbol|amulet|reliquary|emblem)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Spellcasting focus · Channels divine magic and Channel Divinity when held or worn visibly',
    };
  }
  if (/\b(?:arcane\s+focus|wand|staff|rod|orb|crystal)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Spellcasting focus · Channels arcane spellcasting without non-costly Material components',
    };
  }
  if (/\b(?:druidic\s+focus|sprig\s+of\s+mistletoe|totem|wooden\s+staff|yew\s+wand)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Spellcasting focus · Channels primal Druid or Ranger spellcasting',
    };
  }
  if (/\b(?:spellbook)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Arcane tome · Contains your recorded Wizard spells and rituals for preparation and study',
    };
  }
  if (/\b(?:component\s+pouch)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Spellcasting gear · Holds all common Material components for spellcasting',
    };
  }
  if (/\b(?:lute|flute|lyre|horn|drum|viol|bagpipes|dulcimer|shawm|pan\s+flute)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Musical instrument · Can be played for Performance checks or used as a Bardic Spellcasting Focus',
    };
  }
  if (/\b(?:key)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Key · Unlocks its matching locked door, chest, or warded mechanism without a check',
    };
  }
  if (/\b(?:scroll|tome|book|journal|letter|note|map|manifest|writ|contract|parchment|document|papers|cypher|cipher)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Document · Contains written records, clues, or inscriptions that can be read or studied',
    };
  }
  if (/\b(?:pack|satchel|bag|pouch|backpack|chest|case|quiver)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Container · Stows and organizes carried adventuring supplies and recovered items',
    };
  }
  if (/\b(?:relic|seal|signet|medallion|badge|token|ring|brooch|locket|pendant|crown|gem|coin|gold)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Valuable / Token · Significant item, insignia, or treasure carried in your inventory',
    };
  }
  if (/\b(?:tools|supplies|kit|utensils|instruments)\b/.test(lower)) {
    return {
      itemKind: 'gear',
      statsSummary: 'Tools · Specialized implements used for ability checks (add Proficiency Bonus if proficient)',
    };
  }
  return {
    itemKind: 'gear',
    statsSummary: 'Adventuring gear · Utility item carried in your pack for exploration and field use',
  };
}
