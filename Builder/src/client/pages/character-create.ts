/**
 * The character-creation wizard.
 *
 * Blueprint ownership: Sections 1.5.8.2 (identity-last ordering) and 6.4 (the
 * character creation rules contract).
 *
 * The rule that shapes this file: the server decides everything mechanical.
 * Each confirmed change is saved to the draft and the server returns the new
 * derived sheet, the remaining unresolved decisions, and the options that are
 * legal next. The wizard renders that answer. It never computes a modifier,
 * never decides whether a choice is legal, and never enables the final
 * Create Character action on its own — `draft.canCreate` is the only
 * authority for that.
 */

import {
  ABILITIES,
  ABILITY_LABELS,
  STANDARD_ARRAY,
  WIZARD_STEPS,
  WIZARD_STEP_LABELS,
  type Ability,
  type CharacterChoices,
  type WizardStep,
} from '../../shared/character-contract.js';
import {
  ApiFailure,
  applyQuickStartTemplate,
  createCharacter,
  discardDraft,
  openDraft,
  saveDraft,
  type DraftResponse,
} from '../api.js';
import { renderCharacterSheet } from '../character-sheet-view.js';
import { escapeHtml } from '../dom-utils.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

const POINT_BUY_RANGE = [8, 9, 10, 11, 12, 13, 14, 15];

export function mountCharacterCreatePage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Create a character');

  let current: DraftResponse | null = null;
  let activeStep: WizardStep = 'class';
  let busy = false;
  let error: string | null = null;

  async function commitChoices(next: CharacterChoices): Promise<void> {
    if (candidate === null || current === null || busy) {
      return;
    }
    busy = true;
    error = null;
    render();
    try {
      current = await saveDraft({
        candidateId: candidate.candidateId,
        draftId: current.draft.draftId,
        choices: next,
      });
    } catch (failure) {
      error = failure instanceof ApiFailure ? failure.message : 'That change could not be saved.';
    } finally {
      busy = false;
      render();
    }
  }

  function stepChecklist(): string {
    const draft = current?.draft;
    return `
      <ol class="wizard-steps" data-testid="wizard-steps">
        ${WIZARD_STEPS.map((step, index) => {
          const done = draft?.completedSteps.includes(step) === true;
          const isActive = step === activeStep;
          return `
            <li class="${done ? 'done' : ''} ${isActive ? 'active' : ''}">
              <button type="button" data-step="${step}" data-testid="step-${step}"
                aria-current="${isActive ? 'step' : 'false'}">
                <span class="step-number">${index + 1}</span>
                <span>${escapeHtml(WIZARD_STEP_LABELS[step])}</span>
                <span class="step-state">${done ? 'Resolved' : 'Unresolved'}</span>
              </button>
            </li>`;
        }).join('')}
      </ol>`;
  }

  function optionList(options: {
    readonly name: string;
    readonly testId: string;
    readonly entries: readonly { id: string; label: string; summary?: string }[];
    readonly selected: string | null;
  }): string {
    return `
      <div class="option-list" data-testid="${escapeHtml(options.testId)}">
        ${options.entries
          .map(
            (entry) => `
          <label class="option${options.selected === entry.id ? ' selected' : ''}">
            <input type="radio" name="${escapeHtml(options.name)}" value="${escapeHtml(entry.id)}"
              ${options.selected === entry.id ? 'checked' : ''} data-testid="option-${escapeHtml(entry.id)}" />
            <span class="option-label">${escapeHtml(entry.label)}</span>
            ${entry.summary === undefined ? '' : `<span class="option-summary">${escapeHtml(entry.summary)}</span>`}
          </label>`,
          )
          .join('')}
      </div>`;
  }

  function checkboxList(options: {
    readonly name: string;
    readonly testId: string;
    readonly entries: readonly { id: string; label: string }[];
    readonly selected: readonly string[];
  }): string {
    return `
      <div class="option-list compact" data-testid="${escapeHtml(options.testId)}">
        ${options.entries
          .map(
            (entry) => `
          <label class="option${options.selected.includes(entry.id) ? ' selected' : ''}">
            <input type="checkbox" name="${escapeHtml(options.name)}" value="${escapeHtml(entry.id)}"
              ${options.selected.includes(entry.id) ? 'checked' : ''} data-testid="check-${escapeHtml(entry.id)}" />
            <span class="option-label">${escapeHtml(entry.label)}</span>
          </label>`,
          )
          .join('')}
      </div>`;
  }

  function renderClassStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const detail = state.options.classDetail;
    const quickStart =
      state.draft.choices.classId !== null
        ? ''
        : `
        <section class="panel" aria-labelledby="quick-start-heading">
          <h3 id="quick-start-heading">Quick start</h3>
          <p>
            Start from a mechanically complete template, then review or change any legal choice.
            You still supply your character's identity at the final step.
          </p>
          ${optionList({
            name: 'quick-start',
            testId: 'quick-start-options',
            entries: state.options.quickStartTemplates.map((template) => ({
              id: template.id,
              label: template.label,
              summary: template.summary,
            })),
            selected: null,
          })}
        </section>`;

    return `
      ${quickStart}
      <h3>Choose a Class</h3>
      ${optionList({
        name: 'class',
        testId: 'class-options',
        entries: state.options.catalog.classes,
        selected: state.draft.choices.classId,
      })}
      ${
        detail === null
          ? ''
          : `
        <h3>${escapeHtml(detail.label)} skill proficiencies</h3>
        <p>Choose ${detail.skillChoiceCount}. Hit Die d${detail.hitDie}. Saving Throws:
          ${detail.savingThrowProficiencies.map((ability) => escapeHtml(ABILITY_LABELS[ability])).join(', ')}.</p>
        ${checkboxList({
          name: 'class-skill',
          testId: 'class-skill-options',
          entries: detail.skillOptions,
          selected: state.draft.choices.classSkillIds,
        })}`
      }`;
  }

  function renderBackgroundStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const detail = state.options.backgroundDetail;
    const bonuses = state.draft.choices.backgroundAbilityBonuses;

    return `
      <h3>Choose a Background</h3>
      ${optionList({
        name: 'background',
        testId: 'background-options',
        entries: state.options.catalog.backgrounds,
        selected: state.draft.choices.backgroundId,
      })}
      ${
        detail === null
          ? ''
          : `
        <h3>${escapeHtml(detail.label)} ability increases</h3>
        <p>
          Assign either +2 and +1 across two of these abilities, or +1 to each of the three.
          Grants ${escapeHtml(detail.skillLabels.join(' and '))}, ${escapeHtml(detail.toolProficiency)},
          and the ${escapeHtml(detail.originFeat)} feat.
        </p>
        <div class="ability-assign" data-testid="background-bonus-options">
          ${detail.abilityOptions
            .map(
              (ability) => `
            <label>
              <span>${escapeHtml(ABILITY_LABELS[ability])}</span>
              <select data-bonus-ability="${ability}" data-testid="bonus-${ability}">
                ${[0, 1, 2]
                  .map(
                    (amount) =>
                      `<option value="${amount}" ${(bonuses[ability] ?? 0) === amount ? 'selected' : ''}>+${amount}</option>`,
                  )
                  .join('')}
              </select>
            </label>`,
            )
            .join('')}
        </div>`
      }`;
  }

  function renderSpeciesStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const detail = state.options.speciesDetail;

    return `
      <h3>Choose a Species</h3>
      ${optionList({
        name: 'species',
        testId: 'species-options',
        entries: state.options.catalog.species,
        selected: state.draft.choices.speciesId,
      })}
      ${
        detail === null
          ? ''
          : `
        <p class="record-meta">
          ${escapeHtml(detail.size)} · Speed ${detail.speed} ft.
          ${detail.senses.length > 0 ? `· ${escapeHtml(detail.senses.join(', '))}` : ''}
        </p>
        ${detail.choices
          .map(
            (choice) => `
          <h3>${escapeHtml(choice.label)}</h3>
          <div class="ability-assign">
            <label>
              <span class="visually-hidden">${escapeHtml(choice.label)}</span>
              <select data-species-choice="${escapeHtml(choice.id)}" data-testid="species-choice-${escapeHtml(choice.id)}">
                <option value="">Choose…</option>
                ${choice.from
                  .map(
                    (option) =>
                      `<option value="${escapeHtml(option.id)}" ${
                        state.draft.choices.speciesChoiceIds[choice.id] === option.id ? 'selected' : ''
                      }>${escapeHtml(option.label)}</option>`,
                  )
                  .join('')}
              </select>
            </label>
          </div>`,
          )
          .join('')}`
      }`;
  }

  function renderAbilitiesStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const method = state.draft.choices.abilityMethod;
    const scores = state.draft.choices.baseAbilityScores;
    const values = method === 'standard-array' ? [...STANDARD_ARRAY] : POINT_BUY_RANGE;

    return `
      <h3>Ability-generation method</h3>
      <p>
        This campaign supports the standard array and point buy. Rolled abilities are not offered
        here: an authoritative roll belongs to the server-side dice system built in a later phase,
        and this page will not pretend to roll one.
      </p>
      ${optionList({
        name: 'ability-method',
        testId: 'ability-method-options',
        entries: [
          { id: 'standard-array', label: 'Standard array', summary: `Assign ${STANDARD_ARRAY.join(', ')} across the six Ability Scores.` },
          { id: 'point-buy', label: 'Point buy', summary: 'Spend 27 points on scores from 8 to 15.' },
        ],
        selected: method,
      })}
      <h3>Assign Ability Scores</h3>
      <div class="ability-assign" data-testid="ability-assignment">
        ${ABILITIES.map(
          (ability) => `
          <label>
            <span>${escapeHtml(ABILITY_LABELS[ability])}</span>
            <select data-ability="${ability}" data-testid="ability-select-${ability}">
              <option value="">—</option>
              ${values
                .map(
                  (score) =>
                    `<option value="${score}" ${scores[ability] === score ? 'selected' : ''}>${score}</option>`,
                )
                .join('')}
            </select>
          </label>`,
        ).join('')}
      </div>`;
  }

  function renderEquipmentStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const classDetail = state.options.classDetail;
    const backgroundDetail = state.options.backgroundDetail;

    if (classDetail === null || backgroundDetail === null) {
      return '<p class="empty-state">Choose a Class and Background first.</p>';
    }

    return `
      <h3>${escapeHtml(classDetail.label)} starting equipment</h3>
      ${optionList({
        name: 'class-equipment',
        testId: 'class-equipment-options',
        entries: classDetail.equipmentOptions.map((option) => ({ id: option.id, label: option.label })),
        selected: state.draft.choices.classEquipmentOptionId,
      })}
      <h3>${escapeHtml(backgroundDetail.label)} starting equipment</h3>
      ${optionList({
        name: 'background-equipment',
        testId: 'background-equipment-options',
        entries: backgroundDetail.equipmentOptions.map((option) => ({ id: option.id, label: option.label })),
        selected: state.draft.choices.backgroundEquipmentOptionId,
      })}`;
  }

  function renderFeaturesStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const detail = state.options.classDetail;
    if (detail === null) {
      return '<p class="empty-state">Choose a Class first.</p>';
    }

    const classChoices = detail.choices
      .map(
        (choice) => `
      <h3>${escapeHtml(choice.label)}</h3>
      <p>Choose ${choice.choose}.</p>
      ${checkboxList({
        name: `class-choice-${choice.id}`,
        testId: `class-choice-${escapeHtml(choice.id)}`,
        entries: choice.from,
        selected: state.draft.choices.classChoiceIds[choice.id] ?? [],
      })}`,
      )
      .join('');

    const spells =
      detail.spellcasting === null
        ? `<p class="empty-state" data-testid="no-spellcasting">${escapeHtml(detail.label)} does not cast spells at level 1.</p>`
        : `
        <h3>Cantrips</h3>
        <p>Choose ${detail.spellcasting.cantripsKnown}. Spellcasting ability: ${escapeHtml(detail.spellcasting.abilityLabel)}.</p>
        ${
          detail.spellcasting.cantripsKnown === 0
            ? '<p class="empty-state">This Class knows no cantrips at level 1.</p>'
            : checkboxList({
                name: 'cantrip',
                testId: 'cantrip-options',
                entries: detail.spellcasting.cantripOptions,
                selected: state.draft.choices.cantripIds,
              })
        }
        <h3>Level 1 Spells</h3>
        <p>Choose ${detail.spellcasting.spellsAvailable} to ${
          detail.spellcasting.preparationStyle === 'prepared' ? 'prepare' : 'know'
        }.</p>
        ${checkboxList({
          name: 'spell',
          testId: 'spell-options',
          entries: detail.spellcasting.spellOptions,
          selected: state.draft.choices.spellIds,
        })}`;

    return `
      <h3>${escapeHtml(detail.label)} level 1 features</h3>
      <ul class="record-list">
        ${detail.features
          .map(
            (feature) =>
              `<li><span class="record-note">${escapeHtml(feature.name)}</span><span class="record-meta">${escapeHtml(feature.summary)}</span></li>`,
          )
          .join('')}
      </ul>
      ${classChoices}
      ${spells}`;
  }

  function renderIdentityStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const identity = state.draft.choices.identity;

    return `
      <h3>Identity</h3>
      <p>
        Your character is defined mechanically above. Name them last, then review the complete
        sheet before creating them.
      </p>
      <label for="character-name">Name</label>
      <input id="character-name" type="text" data-identity="name" data-testid="identity-name"
        value="${escapeHtml(identity.name)}" autocomplete="off" />
      <label for="character-pronouns">Pronouns</label>
      <input id="character-pronouns" type="text" data-identity="pronouns" data-testid="identity-pronouns"
        value="${escapeHtml(identity.pronouns)}" autocomplete="off" />
      <label for="character-appearance">Appearance</label>
      <input id="character-appearance" type="text" data-identity="appearance" data-testid="identity-appearance"
        value="${escapeHtml(identity.appearance)}" autocomplete="off" />
      <label for="character-concept">Concept</label>
      <input id="character-concept" type="text" data-identity="concept" data-testid="identity-concept"
        value="${escapeHtml(identity.concept)}" autocomplete="off" />

      <h3>Final review</h3>
      ${
        state.draft.sheet === null
          ? '<p class="empty-state">Choose a Class, Background, and Species to see the sheet.</p>'
          : renderCharacterSheet(state.draft.sheet)
      }`;
  }

  function renderStepBody(): string {
    switch (activeStep) {
      case 'class':
        return renderClassStep();
      case 'background':
        return renderBackgroundStep();
      case 'species':
        return renderSpeciesStep();
      case 'abilities':
        return renderAbilitiesStep();
      case 'equipment':
        return renderEquipmentStep();
      case 'features':
        return renderFeaturesStep();
      case 'identity':
        return renderIdentityStep();
    }
  }

  function render(): void {
    const state = current;

    container.innerHTML = `
      <div class="page page-wide">
        <h1 data-testid="create-heading">Create a character</h1>
        <p class="tagline">
          Every choice is checked by the server against the SRD rules. The Create Character action
          stays unavailable while any required decision is unresolved.
        </p>
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="create-error">${escapeHtml(error)}</div>`
        }
        ${state === null ? '<p class="empty-state">Opening your draft…</p>' : ''}
        ${state === null ? '' : stepChecklist()}
        ${
          state === null
            ? ''
            : `
        <section class="panel" aria-labelledby="step-heading">
          <h2 id="step-heading" data-testid="active-step-heading">${escapeHtml(WIZARD_STEP_LABELS[activeStep])}</h2>
          ${renderStepBody()}
        </section>

        <section class="panel" aria-labelledby="unresolved-heading">
          <h2 id="unresolved-heading">Remaining decisions</h2>
          ${
            state.draft.unresolved.length === 0
              ? '<p data-testid="nothing-unresolved">Everything required is resolved.</p>'
              : `<ul class="record-list" data-testid="unresolved-list">
                  ${state.draft.unresolved
                    .map(
                      (item) => `
                    <li data-testid="unresolved-${escapeHtml(item.code)}">
                      <span class="record-note">${escapeHtml(WIZARD_STEP_LABELS[item.step])}</span>
                      <span class="record-meta">${escapeHtml(item.message)}</span>
                    </li>`,
                    )
                    .join('')}
                </ul>`
          }
          <div class="actions">
            <button type="button" data-testid="create-character"
              aria-disabled="${!state.draft.canCreate || busy}">
              ${busy ? 'Working…' : 'Create Character'}
            </button>
            <button type="button" class="secondary" data-testid="discard-draft" aria-disabled="${busy}">
              Discard draft
            </button>
          </div>
        </section>`
        }
      </div>`;

    bindEvents();
  }

  function bindEvents(): void {
    const state = current;
    if (state === null) {
      return;
    }
    const base = state.draft.choices;

    container.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((button) => {
      button.addEventListener('click', () => {
        activeStep = button.dataset.step as WizardStep;
        render();
      });
    });

    container.querySelectorAll<HTMLInputElement>('input[name="quick-start"]').forEach((input) => {
      input.addEventListener('change', () => {
        void (async () => {
          if (candidate === null || current === null || busy) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            current = await applyQuickStartTemplate({
              candidateId: candidate.candidateId,
              draftId: current.draft.draftId,
              templateId: input.value,
            });
            activeStep = 'identity';
          } catch (failure) {
            error = failure instanceof ApiFailure ? failure.message : 'That template could not be applied.';
          } finally {
            busy = false;
            render();
          }
        })();
      });
    });

    const radioHandlers: ReadonlyArray<[string, (value: string) => CharacterChoices]> = [
      ['class', (value) => ({ ...base, classId: value, classSkillIds: [], classChoiceIds: {}, classEquipmentOptionId: null, cantripIds: [], spellIds: [] })],
      ['background', (value) => ({ ...base, backgroundId: value, backgroundAbilityBonuses: {}, backgroundEquipmentOptionId: null })],
      ['species', (value) => ({ ...base, speciesId: value, speciesChoiceIds: {} })],
      ['ability-method', (value) => ({ ...base, abilityMethod: value as CharacterChoices['abilityMethod'], baseAbilityScores: {} })],
      ['class-equipment', (value) => ({ ...base, classEquipmentOptionId: value })],
      ['background-equipment', (value) => ({ ...base, backgroundEquipmentOptionId: value })],
    ];
    for (const [name, build] of radioHandlers) {
      container.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((input) => {
        input.addEventListener('change', () => void commitChoices(build(input.value)));
      });
    }

    container.querySelectorAll<HTMLInputElement>('input[name="class-skill"]').forEach((input) => {
      input.addEventListener('change', () => {
        const selected = [...container.querySelectorAll<HTMLInputElement>('input[name="class-skill"]:checked')].map(
          (checked) => checked.value,
        );
        void commitChoices({ ...base, classSkillIds: selected });
      });
    });

    for (const [name, key] of [
      ['cantrip', 'cantripIds'],
      ['spell', 'spellIds'],
    ] as const) {
      container.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((input) => {
        input.addEventListener('change', () => {
          const selected = [...container.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map(
            (checked) => checked.value,
          );
          void commitChoices({ ...base, [key]: selected });
        });
      });
    }

    container.querySelectorAll<HTMLInputElement>('input[name^="class-choice-"]').forEach((input) => {
      input.addEventListener('change', () => {
        const name = input.name;
        const choiceId = name.replace('class-choice-', '');
        const selected = [...container.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map(
          (checked) => checked.value,
        );
        void commitChoices({ ...base, classChoiceIds: { ...base.classChoiceIds, [choiceId]: selected } });
      });
    });

    container.querySelectorAll<HTMLSelectElement>('[data-ability]').forEach((select) => {
      select.addEventListener('change', () => {
        const ability = select.dataset.ability as Ability;
        const scores = { ...base.baseAbilityScores };
        if (select.value === '') {
          delete scores[ability];
        } else {
          scores[ability] = Number(select.value);
        }
        void commitChoices({ ...base, baseAbilityScores: scores });
      });
    });

    container.querySelectorAll<HTMLSelectElement>('[data-bonus-ability]').forEach((select) => {
      select.addEventListener('change', () => {
        const ability = select.dataset.bonusAbility as Ability;
        const bonuses = { ...base.backgroundAbilityBonuses };
        const amount = Number(select.value);
        if (amount === 0) {
          delete bonuses[ability];
        } else {
          bonuses[ability] = amount;
        }
        void commitChoices({ ...base, backgroundAbilityBonuses: bonuses });
      });
    });

    container.querySelectorAll<HTMLSelectElement>('[data-species-choice]').forEach((select) => {
      select.addEventListener('change', () => {
        const choiceId = select.dataset.speciesChoice ?? '';
        const selections = { ...base.speciesChoiceIds };
        if (select.value === '') {
          delete selections[choiceId];
        } else {
          selections[choiceId] = select.value;
        }
        void commitChoices({ ...base, speciesChoiceIds: selections });
      });
    });

    container.querySelectorAll<HTMLInputElement>('[data-identity]').forEach((input) => {
      // Identity text saves on change rather than on every keystroke, so a
      // draft save is not issued per character typed.
      input.addEventListener('change', () => {
        const field = input.dataset.identity as keyof CharacterChoices['identity'];
        void commitChoices({ ...base, identity: { ...base.identity, [field]: input.value } });
      });
    });

    container
      .querySelector<HTMLButtonElement>('[data-testid="create-character"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || current === null || busy || !current.draft.canCreate) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const character = await createCharacter({
              candidateId: candidate.candidateId,
              draftId: current.draft.draftId,
            });
            shell.announce(`${character.identity.name} created.`);
            navigate(`/characters/${character.characterId}`);
            return;
          } catch (failure) {
            error = failure instanceof ApiFailure ? failure.message : 'That character could not be created.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="discard-draft"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || current === null || busy) {
            return;
          }
          busy = true;
          render();
          try {
            await discardDraft({ candidateId: candidate.candidateId, draftId: current.draft.draftId });
            shell.announce('Draft discarded.');
            navigate('/characters');
            return;
          } catch (failure) {
            error = failure instanceof ApiFailure ? failure.message : 'That draft could not be discarded.';
          } finally {
            busy = false;
            render();
          }
        })();
      });
  }

  render();

  void (async () => {
    if (candidate === null) {
      error = 'The Local Arena server did not respond.';
      render();
      return;
    }
    try {
      current = await openDraft(candidate.candidateId);
      // Resume where the draft actually is: the first step still unresolved.
      activeStep =
        WIZARD_STEPS.find((step) => !current?.draft.completedSteps.includes(step)) ?? 'identity';
    } catch (failure) {
      error = failure instanceof ApiFailure ? failure.message : 'Your draft could not be opened.';
    }
    render();
  })();
}
