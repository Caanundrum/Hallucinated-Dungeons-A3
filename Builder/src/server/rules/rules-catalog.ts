/**
 * Assembles the browseable Rules pane catalog from the SRD manifest and the
 * existing structured explanation cards.
 */

import {
  RULES_CATALOG_CATEGORIES,
  RULES_CATALOG_CATEGORY_LABELS,
  type RulesCatalogEntryProjection,
  type RulesCatalogProjection,
} from '../../shared/rules-catalog-contract.js';
import { CONDITION_IDS } from '../../shared/rules-combat-contract.js';
import { explainCondition } from './engine/conditions.js';
import { RULE_EXPLANATION_IDS, explainRule } from './engine/rules-explanations.js';
import {
  ARMOR,
  BACKGROUNDS,
  CLASSES,
  RULES_MANIFEST_PROVENANCE,
  RULES_VERSION,
  SKILLS,
  SPECIES,
  SPELLS,
  WEAPONS,
} from './srd-manifest.js';

const CATALOG_NOTICE =
  'Browse the SRD 5.2.1 reference used by this Alpha. This listing does not make rulings or change the table — ask the Game Director when you need a ruling for your character and scene.';

function coreMechanicEntries(): RulesCatalogEntryProjection[] {
  return RULE_EXPLANATION_IDS.filter((ruleId) => !ruleId.startsWith('condition.')).flatMap(
    (ruleId) => {
      const explanation = explainRule(ruleId);
      if (explanation === null) return [];
      return [
        {
          entryId: `core:${explanation.ruleId}`,
          category: 'core_mechanics' as const,
          title: explanation.title,
          summary: explanation.summary,
          details: explanation.steps,
          source: explanation.source,
        },
      ];
    },
  );
}

function conditionEntries(): RulesCatalogEntryProjection[] {
  return CONDITION_IDS.map((conditionId) => {
    const explanation = explainCondition(conditionId);
    return {
      entryId: `condition:${conditionId}`,
      category: 'conditions' as const,
      title: explanation.title,
      summary: explanation.summary,
      details: explanation.steps,
      source: explanation.source,
    };
  });
}

export function buildRulesCatalog(): RulesCatalogProjection {
  const entries: RulesCatalogEntryProjection[] = [
    ...coreMechanicEntries(),
    ...conditionEntries(),
    ...SKILLS.map((skill) => ({
      entryId: `skill:${skill.id}`,
      category: 'skills' as const,
      title: skill.label,
      summary: `${skill.label} checks use ${skill.ability.toUpperCase()}.`,
      details: [`Ability: ${skill.ability}`],
      source: RULES_MANIFEST_PROVENANCE.source,
    })),
    ...CLASSES.map((klass) => ({
      entryId: `class:${klass.id}`,
      category: 'classes' as const,
      title: klass.label,
      summary: klass.summary,
      details: [
        `Hit Die: d${klass.hitDie}`,
        `Saving throws: ${klass.savingThrowProficiencies.join(', ')}`,
        `Armor: ${klass.armorProficiencies.join(', ') || 'none'}`,
        `Weapons: ${klass.weaponProficiencies.join(', ') || 'none'}`,
      ],
      source: RULES_MANIFEST_PROVENANCE.source,
    })),
    ...SPECIES.map((species) => ({
      entryId: `species:${species.id}`,
      category: 'species' as const,
      title: species.label,
      summary: species.summary,
      details: [
        `Size: ${species.size}`,
        `Speed: ${species.speed} feet`,
        ...(species.senses.length > 0 ? [`Senses: ${species.senses.join(', ')}`] : []),
        ...species.features.map((feature) => `${feature.name}: ${feature.summary}`),
      ],
      source: RULES_MANIFEST_PROVENANCE.source,
    })),
    ...BACKGROUNDS.map((background) => ({
      entryId: `background:${background.id}`,
      category: 'backgrounds' as const,
      title: background.label,
      summary: background.summary,
      details: [
        `Origin feat: ${background.originFeat}`,
        `Skills: ${background.skillIds.join(', ')}`,
        `Tool: ${background.toolProficiency}`,
      ],
      source: RULES_MANIFEST_PROVENANCE.source,
    })),
    ...WEAPONS.map((weapon) => ({
      entryId: `weapon:${weapon.id}`,
      category: 'weapons' as const,
      title: weapon.label,
      summary: `${weapon.damage} ${weapon.damageType} (${weapon.category})`,
      details: [
        ...(weapon.properties.length > 0
          ? [`Properties: ${weapon.properties.join(', ')}`]
          : ['No special properties.']),
      ],
      source: RULES_MANIFEST_PROVENANCE.source,
    })),
    ...ARMOR.map((armor) => ({
      entryId: `armor:${armor.id}`,
      category: 'armor' as const,
      title: armor.label,
      summary: `Base AC ${armor.baseArmorClass} (${armor.category})`,
      details: [
        armor.dexterityCap === null
          ? 'Full Dexterity modifier applies.'
          : `Dexterity modifier capped at +${armor.dexterityCap}.`,
        armor.strengthRequirement === null
          ? 'No Strength requirement.'
          : `Requires Strength ${armor.strengthRequirement}.`,
        armor.stealthDisadvantage ? 'Stealth checks have disadvantage.' : 'No Stealth disadvantage.',
      ],
      source: RULES_MANIFEST_PROVENANCE.source,
    })),
    ...SPELLS.map((spell) => ({
      entryId: `spell:${spell.id}`,
      category: 'spells' as const,
      title: spell.label,
      summary: `Level ${spell.level} ${spell.school}`,
      details: [
        spell.level === 0 ? 'Cantrip' : `Spell level ${spell.level}`,
        `School: ${spell.school}`,
        `On class lists: ${spell.lists.join(', ')}`,
      ],
      source: RULES_MANIFEST_PROVENANCE.source,
    })),
  ];

  return {
    rulesVersion: RULES_VERSION,
    notice: CATALOG_NOTICE,
    categories: RULES_CATALOG_CATEGORIES.map((id) => ({
      id,
      label: RULES_CATALOG_CATEGORY_LABELS[id],
      entryCount: entries.filter((entry) => entry.category === id).length,
    })),
    entries,
  };
}
