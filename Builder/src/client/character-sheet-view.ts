/**
 * Renders a server-derived character sheet.
 *
 * Blueprint ownership: Section 6.5 — "Every derived value must be
 * recomputable. The character sheet must expose a 'Why is this number?'
 * control for important values. The explanation must list base value,
 * modifiers, conditions, equipment, temporary effects, and rule identifiers."
 *
 * Every number here comes from the server's `DerivedValue`, including its
 * components. The client performs no arithmetic of its own, so what the
 * explanation shows and what the number says cannot disagree.
 */

import {
  ABILITIES,
  ABILITY_LABELS,
  formatModifier,
  type DerivedCharacterSheet,
  type DerivedValue,
} from '../shared/character-contract.js';
import { escapeHtml } from './dom-utils.js';

/** A value with its "Why is this number?" explanation attached. */
function explained(
  label: string,
  derived: DerivedValue,
  testId: string,
  format: (value: number) => string = (value) => String(value),
): string {
  return `
    <div class="stat">
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-value" data-testid="${escapeHtml(testId)}">${escapeHtml(format(derived.value))}</span>
      <details class="stat-why">
        <summary>Why is this number?</summary>
        <ul>
          ${derived.components
            .map(
              (component) =>
                `<li>${escapeHtml(component.label)}: ${escapeHtml(formatModifier(component.amount))}
                  <code>${escapeHtml(component.ruleId)}</code></li>`,
            )
            .join('')}
        </ul>
      </details>
    </div>`;
}

export function renderCharacterSheet(sheet: DerivedCharacterSheet): string {
  const abilityBlock = ABILITIES.map((ability) => {
    const score = sheet.abilityScores[ability];
    return `
      <div class="ability-card">
        <span class="ability-name">${escapeHtml(ABILITY_LABELS[ability])}</span>
        <span class="ability-score" data-testid="ability-${ability}">${score.value}</span>
        <span class="ability-modifier">${escapeHtml(formatModifier(sheet.abilityModifiers[ability]))}</span>
        <details class="stat-why">
          <summary>Why is this number?</summary>
          <ul>
            ${score.components
              .map(
                (component) =>
                  `<li>${escapeHtml(component.label)}: ${escapeHtml(formatModifier(component.amount))}
                    <code>${escapeHtml(component.ruleId)}</code></li>`,
              )
              .join('')}
          </ul>
        </details>
      </div>`;
  }).join('');

  const skillRows = sheet.skills
    .map(
      (skill) => `
      <li${skill.proficient ? ' class="proficient"' : ''} data-testid="skill-${escapeHtml(skill.id)}">
        <span>${escapeHtml(skill.label)}</span>
        <span>${escapeHtml(formatModifier(skill.bonus.value))}${skill.proficient ? ' · proficient' : ''}</span>
      </li>`,
    )
    .join('');

  const savingThrowRows = ABILITIES.map(
    (ability) => `
      <li${sheet.savingThrowProficiencies.includes(ability) ? ' class="proficient"' : ''}>
        <span>${escapeHtml(ABILITY_LABELS[ability])}</span>
        <span>${escapeHtml(formatModifier(sheet.savingThrows[ability].value))}</span>
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
                ${escapeHtml(formatModifier(attack.attackBonus.value))} to hit ·
                ${escapeHtml(attack.damage)} ${escapeHtml(attack.damageType)}
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
      <section class="panel" aria-labelledby="spellcasting-heading">
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
    <section class="panel" aria-labelledby="core-stats-heading">
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

    <section class="panel" aria-labelledby="abilities-heading">
      <h2 id="abilities-heading">Ability Scores</h2>
      <div class="ability-grid">${abilityBlock}</div>
    </section>

    <section class="panel" aria-labelledby="saves-heading">
      <h2 id="saves-heading">Saving Throws</h2>
      <ul class="stat-list">${savingThrowRows}</ul>
    </section>

    <section class="panel" aria-labelledby="skills-heading">
      <h2 id="skills-heading">Skills</h2>
      <ul class="stat-list">${skillRows}</ul>
    </section>

    <section class="panel" aria-labelledby="attacks-heading">
      <h2 id="attacks-heading">Attacks</h2>
      ${attackRows}
    </section>

    ${spellBlock}

    <section class="panel" aria-labelledby="features-heading">
      <h2 id="features-heading">Features and Traits</h2>
      <ul class="record-list" data-testid="feature-list">
        ${sheet.features
          .map(
            (feature) => `
          <li>
            <span class="record-note">${escapeHtml(feature.name)}</span>
            <span class="record-meta">${escapeHtml(feature.source)} — ${escapeHtml(feature.summary)}</span>
          </li>`,
          )
          .join('')}
      </ul>
    </section>

    <section class="panel" aria-labelledby="equipment-heading">
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
    </section>`;
}
