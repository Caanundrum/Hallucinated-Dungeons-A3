/**
 * Renders a server-derived character sheet.
 *
 * Blueprint ownership: Section 6.5 — every derived value must be recomputable,
 * and important values must expose an explanation control listing base value,
 * modifiers, conditions, equipment, and rule identifiers. The player-facing
 * label for that control is “How we got this” (hover/focus tooltip); the
 * blueprint’s older “Why is this number?” phrasing names the same requirement.
 *
 * Every number here comes from the server's `DerivedValue`, including its
 * components. The client performs no arithmetic of its own.
 */

import {
  ABILITIES,
  ABILITY_LABELS,
  formatModifier,
  type DerivedCharacterSheet,
  type DerivedValue,
} from '../shared/character-contract.js';
import { escapeHtml } from './dom-utils.js';

/** Player-facing label for a derivation rule id (hides raw machine ids). */
export function humanRuleLabel(ruleId: string): string {
  const known: Record<string, string> = {
    'proficiency-bonus': 'Proficiency Bonus',
    'proficiency-bonus.level-1': 'Proficiency Bonus (Level 1)',
    'armor.shield': 'Shield',
    'armor.unarmored': 'Unarmored',
    'passive.base': 'Passive base',
    'spellcasting.save-dc-base': 'Spell save DC base',
  };
  if (known[ruleId] !== undefined) {
    return known[ruleId];
  }
  if (ruleId.startsWith('proficiency-bonus.level-')) {
    return `Proficiency Bonus (Level ${ruleId.slice('proficiency-bonus.level-'.length)})`;
  }
  if (ruleId.startsWith('ability.')) {
    const ability = ruleId.slice('ability.'.length).replace(/-/g, ' ');
    return ability.replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  if (ruleId.startsWith('ability-method.')) {
    return `Ability scores (${ruleId.slice('ability-method.'.length).replace(/_/g, ' ')})`;
  }
  if (ruleId.startsWith('skill.')) {
    return ruleId
      .slice('skill.'.length)
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  if (ruleId.startsWith('armor.')) {
    return `Armor (${ruleId.slice('armor.'.length).replace(/-/g, ' ')})`;
  }
  if (ruleId.startsWith('weapon.')) {
    return `Weapon (${ruleId.slice('weapon.'.length).replace(/-/g, ' ')})`;
  }
  if (ruleId.startsWith('class.')) {
    const rest = ruleId.slice('class.'.length).replace(/\./g, ' · ').replace(/-/g, ' ');
    return rest.replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  if (ruleId.startsWith('species.')) {
    const rest = ruleId.slice('species.'.length).replace(/\./g, ' · ').replace(/-/g, ' ');
    return rest.replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  if (ruleId.startsWith('background.')) {
    const rest = ruleId.slice('background.'.length).replace(/\./g, ' · ').replace(/-/g, ' ');
    return `Background (${rest})`;
  }
  return ruleId
    .split(/[./]/)
    .map((part) => part.replace(/-/g, ' '))
    .join(' · ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function breakdownList(derived: DerivedValue): string {
  return `
    <ul class="stat-breakdown-list">
      ${derived.components
        .map(
          (component) =>
            `<li>${escapeHtml(component.label)}: ${escapeHtml(formatModifier(component.amount))}
              <span class="record-meta">${escapeHtml(humanRuleLabel(component.ruleId))}</span></li>`,
        )
        .join('')}
    </ul>`;
}

/** A value with a hover/focus “How we got this” breakdown tooltip. */
function explained(
  label: string,
  derived: DerivedValue,
  testId: string,
  format: (value: number) => string = (value) => String(value),
): string {
  return `
    <div class="stat">
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-value has-breakdown" tabindex="0" data-testid="${escapeHtml(testId)}"
        aria-describedby="${escapeHtml(testId)}-how">
        ${escapeHtml(format(derived.value))}
        <span class="stat-tooltip" role="tooltip" id="${escapeHtml(testId)}-how">
          <span class="stat-tooltip-title">How we got this</span>
          ${breakdownList(derived)}
        </span>
      </span>
    </div>`;
}

export function renderCharacterSheet(sheet: DerivedCharacterSheet): string {
  const abilityBlock = ABILITIES.map((ability) => {
    const score = sheet.abilityScores[ability];
    return `
      <div class="ability-card">
        <span class="ability-name">${escapeHtml(ABILITY_LABELS[ability])}</span>
        <span class="ability-score has-breakdown" tabindex="0" data-testid="ability-${ability}"
          aria-describedby="ability-${ability}-how">
          ${score.value}
          <span class="stat-tooltip" role="tooltip" id="ability-${ability}-how">
            <span class="stat-tooltip-title">How we got this</span>
            ${breakdownList(score)}
          </span>
        </span>
        <span class="ability-modifier">${escapeHtml(formatModifier(sheet.abilityModifiers[ability]))}</span>
      </div>`;
  }).join('');

  const skillRows = sheet.skills
    .map(
      (skill) => `
      <li${skill.proficient ? ' class="proficient"' : ''} data-testid="skill-${escapeHtml(skill.id)}">
        <span>${escapeHtml(skill.label)}</span>
        <span class="has-breakdown" tabindex="0"
          aria-describedby="skill-${escapeHtml(skill.id)}-how">
          ${escapeHtml(formatModifier(skill.bonus.value))}${skill.proficient ? ' · proficient' : ''}
          <span class="stat-tooltip" role="tooltip" id="skill-${escapeHtml(skill.id)}-how">
            <span class="stat-tooltip-title">How we got this</span>
            ${breakdownList(skill.bonus)}
          </span>
        </span>
      </li>`,
    )
    .join('');

  const savingThrowRows = ABILITIES.map(
    (ability) => `
      <li${sheet.savingThrowProficiencies.includes(ability) ? ' class="proficient"' : ''}>
        <span>${escapeHtml(ABILITY_LABELS[ability])}</span>
        <span class="has-breakdown" tabindex="0"
          aria-describedby="save-${ability}-how">
          ${escapeHtml(formatModifier(sheet.savingThrows[ability].value))}
          <span class="stat-tooltip" role="tooltip" id="save-${ability}-how">
            <span class="stat-tooltip-title">How we got this</span>
            ${breakdownList(sheet.savingThrows[ability])}
          </span>
        </span>
      </li>`,
  ).join('');

  const attackRows =
    sheet.attacks.length === 0
      ? '<p class="empty-state">No weapon attacks from your starting equipment.</p>'
      : `<ul class="record-list" data-testid="attack-list">
          ${sheet.attacks
            .map(
              (attack) => `
            <li>
              <span class="record-note">${escapeHtml(attack.name)}</span>
              <span class="record-meta">
                <span class="has-breakdown" tabindex="0">
                  ${escapeHtml(formatModifier(attack.attackBonus.value))} to hit
                  <span class="stat-tooltip" role="tooltip">
                    <span class="stat-tooltip-title">How we got this</span>
                    ${breakdownList(attack.attackBonus)}
                  </span>
                </span>
                · ${escapeHtml(attack.damage)} ${escapeHtml(attack.damageType)}
                ${attack.properties.length > 0 ? `· ${escapeHtml(attack.properties.join(', '))}` : ''}
              </span>
            </li>`,
            )
            .join('')}
        </ul>`;

  const spellBlock =
    sheet.spellcasting === null
      ? ''
      : `
      <section class="panel sheet-panel" aria-labelledby="spellcasting-heading">
        <h2 id="spellcasting-heading">Spellcasting</h2>
        <div class="stat-grid">
          ${explained('Spell Save DC', sheet.spellcasting.spellSaveDc, 'spell-save-dc')}
          ${explained('Spell Attack Bonus', sheet.spellcasting.spellAttackBonus, 'spell-attack-bonus', formatModifier)}
        </div>
        <p>
          Level 1 Spell Slots: <b>${sheet.spellcasting.level1SlotCount}</b> ·
          Spells are ${escapeHtml(sheet.spellcasting.preparationStyle)}
        </p>
        <p><b>Cantrips:</b> ${
          sheet.spellcasting.cantrips.length === 0
            ? 'None'
            : escapeHtml(sheet.spellcasting.cantrips.map((spell) => spell.name).join(', '))
        }</p>
        <p data-testid="sheet-spells"><b>Level 1 Spells:</b> ${
          sheet.spellcasting.spells.length === 0
            ? 'None'
            : escapeHtml(sheet.spellcasting.spells.map((spell) => spell.name).join(', '))
        }</p>
      </section>`;

  return `
    <p class="sheet-legend" data-testid="sheet-breakdown-legend">
      Hover or focus any highlighted number for <b>How we got this</b> — the breakdown of that total.
    </p>
    <div class="sheet-layout" data-testid="character-sheet-layout">
      <div class="sheet-column">
        <section class="panel sheet-panel" aria-labelledby="core-stats-heading">
          <h2 id="core-stats-heading">Core statistics</h2>
          <div class="stat-grid">
            ${explained('Hit Points', sheet.hitPoints, 'sheet-hit-points')}
            ${explained('Armor Class', sheet.armorClass, 'sheet-armor-class')}
            ${explained('Initiative', sheet.initiative, 'sheet-initiative', formatModifier)}
            ${explained('Speed', sheet.speed, 'sheet-speed', (value) => `${value} ft.`)}
            ${explained('Proficiency Bonus', sheet.proficiencyBonus, 'sheet-proficiency-bonus', formatModifier)}
            ${explained('Passive Perception', sheet.passivePerception, 'sheet-passive-perception')}
          </div>
          <p class="record-meta">Hit Dice ${escapeHtml(sheet.hitDice)} · Level ${sheet.level} · ${sheet.experiencePoints} XP</p>
        </section>

        <section class="panel sheet-panel" aria-labelledby="abilities-heading">
          <h2 id="abilities-heading">Ability Scores</h2>
          <div class="ability-grid">${abilityBlock}</div>
        </section>

        <section class="panel sheet-panel" aria-labelledby="saves-heading">
          <h2 id="saves-heading">Saving Throws</h2>
          <ul class="stat-list">${savingThrowRows}</ul>
        </section>

        <section class="panel sheet-panel" aria-labelledby="skills-heading">
          <h2 id="skills-heading">Skills</h2>
          <ul class="stat-list">${skillRows}</ul>
        </section>
      </div>

      <div class="sheet-column">
        <section class="panel sheet-panel" aria-labelledby="attacks-heading">
          <h2 id="attacks-heading">Attacks</h2>
          ${attackRows}
        </section>

        ${spellBlock}

        <section class="panel sheet-panel" aria-labelledby="features-heading">
          <h2 id="features-heading">Features and Traits</h2>
          <ul class="record-list" data-testid="feature-list">
            ${sheet.features
              .map(
                (feature) => `
              <li data-testid="feature-${escapeHtml(feature.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">
                <span class="record-note">${escapeHtml(feature.name)}</span>
                <span class="record-meta">${escapeHtml(feature.source)} — ${escapeHtml(feature.summary)}</span>
              </li>`,
              )
              .join('')}
          </ul>
        </section>

        <section class="panel sheet-panel" aria-labelledby="equipment-heading">
          <h2 id="equipment-heading">Equipment and Proficiencies</h2>
          <p data-testid="sheet-equipment">${
            sheet.equipment.length === 0
              ? 'No starting equipment chosen.'
              : escapeHtml(
                  sheet.equipment
                    .map((item) => (item.quantity > 1 ? `${item.name} (${item.quantity})` : item.name))
                    .join(', '),
                )
          }</p>
          <p><b>Gold:</b> ${sheet.currencyGold} GP</p>
          <p><b>Senses:</b> ${sheet.senses.length === 0 ? 'Normal vision' : escapeHtml(sheet.senses.join(', '))}</p>
          <p><b>Languages:</b> ${escapeHtml(sheet.languages.join(', '))}</p>
          <p class="record-meta">${sheet.proficiencies
            .map((proficiency) => `${escapeHtml(proficiency.label)} (${escapeHtml(proficiency.sourceLabel)})`)
            .join(' · ')}</p>
        </section>
      </div>
    </div>`;
}

/**
 * Compact live preview for the creation wizard sidebar. Same server-derived
 * numbers as the full sheet — just fewer panels so it fits beside the steps.
 */
export function renderLiveSheetPreview(
  sheet: DerivedCharacterSheet,
  options: { readonly abilitiesComplete?: boolean } = {},
): string {
  const abilitiesComplete = options.abilitiesComplete !== false;
  const abilityBlock = ABILITIES.map((ability) => {
    const score = sheet.abilityScores[ability];
    return `
      <div class="ability-card compact">
        <span class="ability-name">${escapeHtml(ABILITY_LABELS[ability])}</span>
        <span class="ability-score">${abilitiesComplete ? score.value : '—'}</span>
        <span class="ability-modifier">${
          abilitiesComplete ? escapeHtml(formatModifier(sheet.abilityModifiers[ability])) : '—'
        }</span>
      </div>`;
  }).join('');

  const proficientSkills = sheet.skills
    .filter((skill) => skill.proficient)
    .map((skill) => skill.label)
    .join(', ');

  const chosenFeatures = sheet.features
    .filter((feature) => feature.name.includes(':'))
    .map((feature) => feature.name)
    .join(', ');

  const gearSummary =
    sheet.equipment.length === 0 && sheet.currencyGold <= 0
      ? 'None yet'
      : [
          ...sheet.equipment.map((item) =>
            item.quantity > 1 ? `${item.name} (${item.quantity})` : item.name,
          ),
          sheet.currencyGold > 0 ? `${sheet.currencyGold} GP` : null,
        ]
          .filter((part): part is string => part !== null)
          .join(', ');

  return `
    <div class="live-sheet-body" data-testid="live-sheet-stats">
      <p class="sheet-legend compact">Hover highlighted totals for <b>How we got this</b>.</p>
      ${
        abilitiesComplete
          ? ''
          : `<p class="message notice" data-testid="preview-abilities-incomplete">
              Ability scores are incomplete — Hit Points, Armor Class, and modifiers stay blank until every score is assigned.
            </p>`
      }
      <div class="stat-grid compact">
        ${
          abilitiesComplete
            ? `${explained('Hit Points', sheet.hitPoints, 'preview-hit-points')}
        ${explained('Armor Class', sheet.armorClass, 'preview-armor-class')}
        ${explained('Initiative', sheet.initiative, 'preview-initiative', formatModifier)}
        ${explained('Speed', sheet.speed, 'preview-speed', (value) => `${value} ft.`)}`
            : `<p class="record-meta" data-testid="preview-hit-points">Hit Points —</p>
        <p class="record-meta" data-testid="preview-armor-class">Armor Class —</p>
        <p class="record-meta" data-testid="preview-initiative">Initiative —</p>
        <p class="record-meta" data-testid="preview-speed">Speed ${sheet.speed.value} ft.</p>`
        }
      </div>
      <div class="ability-grid compact">${abilityBlock}</div>
      <p class="record-meta"><b>Skills:</b> ${
        proficientSkills.length === 0 ? 'None yet' : escapeHtml(proficientSkills)
      }</p>
      <p class="record-meta" data-testid="preview-chosen-options"><b>Chosen options:</b> ${
        chosenFeatures.length === 0 ? 'None yet' : escapeHtml(chosenFeatures)
      }</p>
      <p class="record-meta"><b>Features:</b> ${
        sheet.features.length === 0
          ? 'None yet'
          : escapeHtml(sheet.features.map((feature) => feature.name).join(', '))
      }</p>
      <p class="record-meta"><b>Gear:</b> ${escapeHtml(gearSummary)}</p>
    </div>`;
}
