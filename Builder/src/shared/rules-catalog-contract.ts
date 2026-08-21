/**
 * Browseable rules catalog for the table Rules pane.
 *
 * This is a look-up surface only — no AI, no rulings, no state mutation.
 * Entries come from the structured SRD character-creation manifest plus the
 * short Phase 3 combat/progression explanation cards.
 */

export const RULES_CATALOG_CATEGORIES = [
  'core_mechanics',
  'conditions',
  'skills',
  'classes',
  'species',
  'backgrounds',
  'weapons',
  'armor',
  'spells',
] as const;
export type RulesCatalogCategory = (typeof RULES_CATALOG_CATEGORIES)[number];

export const RULES_CATALOG_CATEGORY_LABELS: Record<RulesCatalogCategory, string> = {
  core_mechanics: 'Core mechanics',
  conditions: 'Conditions',
  skills: 'Skills',
  classes: 'Classes',
  species: 'Species',
  backgrounds: 'Backgrounds',
  weapons: 'Weapons',
  armor: 'Armor',
  spells: 'Spells',
};

export interface RulesCatalogEntryProjection {
  readonly entryId: string;
  readonly category: RulesCatalogCategory;
  readonly title: string;
  readonly summary: string;
  readonly details: readonly string[];
  readonly source: string;
}

export interface RulesCatalogProjection {
  readonly rulesVersion: string;
  readonly notice: string;
  readonly categories: readonly {
    readonly id: RulesCatalogCategory;
    readonly label: string;
    readonly entryCount: number;
  }[];
  readonly entries: readonly RulesCatalogEntryProjection[];
}
