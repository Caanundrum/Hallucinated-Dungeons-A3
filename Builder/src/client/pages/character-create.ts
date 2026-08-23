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
  CHARACTER_NAME_MAX_LENGTH,
  CHARACTER_TEXT_MAX_LENGTH,
  MAX_ABILITY_ROLL_ATTEMPTS,
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  WIZARD_STEPS,
  WIZARD_STEP_LABELS,
  availableScoresFromPool,
  pointBuyCost,
  pointBuyScoresForAbility,
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
  rollDraftAbilities,
  saveDraft,
  type DraftResponse,
} from '../api.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { renderCharacterSheet, renderLiveSheetPreview } from '../character-sheet-view.js';
import { confirmInApp } from '../confirm-dialog.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

/** Short labels for the step train — full titles stay on the step heading. */
const STEP_TRAIN_LABELS: Record<WizardStep, string> = {
  class: 'Class',
  background: 'Background',
  species: 'Species',
  abilities: 'Abilities',
  equipment: 'Gear',
  features: 'Features',
  identity: 'Identity',
};

/** One helpful guide line per step. Humor is fine; inventing fake options is not. */
const STEP_HELPERS: Record<WizardStep, string> = {
  class:
    'Class is your adventuring job on the SRD roster — Fighter, Wizard, and the rest. Pick one, then choose its skill proficiencies below.',
  background:
    'Your Background is life before the dungeon. Clicking an option shows its details at the bottom — skills, tools, feat, and ability increases.',
  species:
    'Species is who walks into the tavern. Pick one to see size, senses, and any lineage or skill choices below.',
  abilities:
    'Assign the numbers that make your hero impressive in the ways you care about. Standard array, point buy, or up to three rolls — your call.',
  equipment:
    'Pack for adventure, not for a weekend city break. If it does not fit in a backpack, the dungeon will notice.',
  features:
    'Lock in the clever tricks your Class actually knows at level 1. Each choice below has a short explanation — read it before you pick.',
  identity:
    'Name your adventurer and review the sheet. Hover highlighted numbers for How we got this. Create Character stays locked until every mechanical choice is legal.',
};

const TUTORIAL_STEPS: readonly { title: string; body: string }[] = [
  {
    title: 'What you are building',
    body: 'A character is the adventurer you play. Numbers on the sheet come from rules choices — Class, Background, Species, and Ability Scores — not from guesswork.',
  },
  {
    title: 'The steps in order',
    body: 'Class is your job in a fight or party. Background is your past. Species is your people. Ability Scores are Strength, Dexterity, and the rest. Gear and features come next; you name them last.',
  },
  {
    title: 'How the sheet stays honest',
    body: 'The server checks every pick against the SRD. Continue stays locked until a step is legal. Hover any highlighted number later for “How we got this.”',
  },
  {
    title: 'Ready-made option',
    body: 'If you want to skip custom building, use “In a hurry?” for a ready-made adventurer you can rename. That path is optional — custom building stays the main flow.',
  },
];

/** Dismissed for this page session only (non-authoritative UI preference). */
let tutorialDismissedThisSession = false;

type BonusPattern = 'plus-two-plus-one' | 'plus-one-each';

function inferBonusPattern(
  bonuses: Partial<Record<Ability, number>>,
  abilityOptions: readonly Ability[],
): BonusPattern | null {
  const amounts = abilityOptions
    .map((ability) => bonuses[ability] ?? 0)
    .filter((amount) => amount !== 0)
    .sort((a, b) => b - a);
  const key = amounts.join(',');
  if (key === '1,1,1') {
    return 'plus-one-each';
  }
  if (key === '2,1') {
    return 'plus-two-plus-one';
  }
  return null;
}

function bonusesForPlusOneEach(abilityOptions: readonly Ability[]): Partial<Record<Ability, number>> {
  const bonuses: Partial<Record<Ability, number>> = {};
  for (const ability of abilityOptions) {
    bonuses[ability] = 1;
  }
  return bonuses;
}

export function mountCharacterCreatePage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Create a character');

  let current: DraftResponse | null = null;
  let activeStep: WizardStep = 'class';
  let busy = false;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  let draftOpened = false;
  /** UI-only: remembers +2/+1 vs +1/+1/+1 before bonuses are fully assigned. */
  let backgroundBonusPattern: BonusPattern | null = null;
  let backgroundPlusTwo: Ability | '' = '';
  let backgroundPlusOne: Ability | '' = '';
  let quickStartOpen = false;
  let tutorialOpen = false;
  let tutorialStep = 0;
  let pendingChoices: CharacterChoices | null = null;
  /** Choices currently being saved — identity edits merge against this while busy. */
  let inFlightChoices: CharacterChoices | null = null;
  let openGeneration = 0;
  const mountToken = beginPageMount(container);

  function draftHasProgress(): boolean {
    if (current === null) {
      return false;
    }
    const choices = current.draft.choices;
    return (
      choices.classId !== null ||
      choices.backgroundId !== null ||
      choices.speciesId !== null ||
      Object.keys(choices.baseAbilityScores).length > 0
    );
  }

  function latestChoices(): CharacterChoices {
    return pendingChoices ?? inFlightChoices ?? current!.draft.choices;
  }

  function tutorialDismissed(): boolean {
    return tutorialDismissedThisSession;
  }

  function dismissTutorialPermanently(): void {
    tutorialDismissedThisSession = true;
  }

  async function openOwnedDraft(): Promise<void> {
    if (candidate === null) {
      error = 'The game server did not respond.';
      render();
      return;
    }
    if (getAccount() === null) {
      render();
      return;
    }
    const generation = ++openGeneration;
    try {
      const opened = await openDraft(candidate.candidateId);
      if (generation !== openGeneration || !isPageMountCurrent(container, mountToken)) {
        return;
      }
      current = opened;
      draftOpened = true;
      activeStep =
        WIZARD_STEPS.find((step) => !current?.draft.completedSteps.includes(step)) ?? 'identity';
    } catch (failure) {
      if (generation !== openGeneration || !isPageMountCurrent(container, mountToken)) {
        return;
      }
      error = failure instanceof ApiFailure ? failure.message : 'Your draft could not be opened.';
    }
    render();
  }

  async function commitChoices(next: CharacterChoices): Promise<void> {
    if (candidate === null || current === null) {
      return;
    }
    if (busy) {
      pendingChoices = next;
      return;
    }
    busy = true;
    error = null;
    pendingChoices = null;
    inFlightChoices = next;
    render();
    try {
      current = await saveDraft({
        candidateId: candidate.candidateId,
        draftId: current.draft.draftId,
        choices: next,
      });
      const firstIncomplete = WIZARD_STEPS.find(
        (step) => !current?.draft.completedSteps.includes(step),
      );
      if (firstIncomplete !== undefined) {
        const incompleteIndex = WIZARD_STEPS.indexOf(firstIncomplete);
        const activeIndex = WIZARD_STEPS.indexOf(activeStep);
        if (incompleteIndex < activeIndex) {
          activeStep = firstIncomplete;
        }
      }
    } catch (failure) {
      error = failure instanceof ApiFailure ? failure.message : 'That change could not be saved.';
    } finally {
      busy = false;
      inFlightChoices = null;
      if (pendingChoices !== null && candidate !== null && current !== null) {
        const queued = pendingChoices;
        pendingChoices = null;
        await commitChoices(queued);
        return;
      }
      render();
    }
  }

  function stepIsComplete(step: WizardStep): boolean {
    return current?.draft.unresolved.every((item) => item.step !== step) === true;
  }

  function blockersForStep(step: WizardStep): readonly string[] {
    return (current?.draft.unresolved ?? [])
      .filter((item) => item.step === step)
      .map((item) => item.message);
  }

  function stepTrain(): string {
    const draft = current?.draft;
    const activeIndex = WIZARD_STEPS.indexOf(activeStep);
    return `
      <nav class="wizard-train" aria-label="Character creation steps" data-testid="wizard-steps">
        <ol class="wizard-steps">
          ${WIZARD_STEPS.map((step, index) => {
            const done = draft?.completedSteps.includes(step) === true;
            const isActive = step === activeStep;
            const priorComplete =
              index === 0 ||
              WIZARD_STEPS.slice(0, index).every((prior) => draft?.completedSteps.includes(prior) === true);
            const allowed = index <= activeIndex || done || priorComplete;
            return `
              <li class="${done ? 'done' : ''} ${isActive ? 'active' : ''} ${allowed ? '' : 'locked'}">
                <button type="button" data-step="${step}" data-testid="step-${step}"
                  aria-current="${isActive ? 'step' : 'false'}"
                  aria-disabled="${allowed ? 'false' : 'true'}">
                  <span class="step-number">${index + 1}</span>
                  <span class="step-label">${escapeHtml(STEP_TRAIN_LABELS[step])}</span>
                </button>
              </li>`;
          }).join('')}
        </ol>
      </nav>`;
  }

  function wizardNav(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const stepIndex = WIZARD_STEPS.indexOf(activeStep);
    const isFirst = stepIndex <= 0;
    const isLast = activeStep === 'identity';
    const complete = stepIsComplete(activeStep);
    const blockers = blockersForStep(activeStep);

    const primary = isLast
      ? `
        <button type="button" data-testid="create-character"
          aria-disabled="${!state.draft.canCreate || busy}">
          ${busy ? 'Working…' : 'Create Character'}
        </button>`
      : `
        <button type="button" data-testid="wizard-continue"
          aria-disabled="${!complete || busy}">
          ${busy ? 'Saving…' : 'Continue'}
        </button>`;

    return `
      <div class="wizard-nav" data-testid="wizard-nav">
        ${
          blockers.length === 0
            ? isLast && state.draft.canCreate
              ? `<p class="wizard-ready" data-testid="nothing-unresolved">Everything required is ready. Create them when you are.</p>`
              : `<p class="wizard-coach" data-testid="step-coach">Looking good — keep going.</p>`
            : `<div class="wizard-coach" data-testid="step-blockers" role="status">
                <p>${escapeHtml(blockers[0]!)}</p>
                ${
                  blockers.length > 1
                    ? `<ul class="record-list compact" data-testid="step-blocker-list">
                        ${blockers
                          .slice(1)
                          .map((message) => `<li>${escapeHtml(message)}</li>`)
                          .join('')}
                      </ul>`
                    : ''
                }
              </div>`
        }
        <div class="wizard-nav-actions">
          <button type="button" class="secondary" data-testid="wizard-back"
            aria-disabled="${isFirst || busy}">
            Back
          </button>
          <button type="button" class="secondary" data-testid="discard-draft" aria-disabled="${busy}">
            Discard draft
          </button>
          ${primary}
        </div>
      </div>`;
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
          <label class="option${options.selected === entry.id ? ' selected' : ''}${busy ? ' disabled' : ''}">
            <input type="radio" name="${escapeHtml(options.name)}" value="${escapeHtml(entry.id)}"
              ${options.selected === entry.id ? 'checked' : ''} ${busy ? 'disabled' : ''}
              data-testid="option-${escapeHtml(entry.id)}" />
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
    readonly entries: readonly { id: string; label: string; summary?: string }[];
    readonly selected: readonly string[];
    /** When set, unchecked options disable once this many are selected. */
    readonly maxChoose?: number;
  }): string {
    const visibleSelected = options.selected.filter((id) =>
      options.entries.some((entry) => entry.id === id),
    );
    const atCap =
      options.maxChoose !== undefined && visibleSelected.length >= options.maxChoose;
    return `
      <div class="option-list compact" data-testid="${escapeHtml(options.testId)}">
        ${options.entries
          .map((entry) => {
            const isSelected = visibleSelected.includes(entry.id);
            const disabled = busy || (atCap && !isSelected);
            return `
          <label class="option${isSelected ? ' selected' : ''}${disabled ? ' disabled' : ''}">
            <input type="checkbox" name="${escapeHtml(options.name)}" value="${escapeHtml(entry.id)}"
              ${isSelected ? 'checked' : ''} ${disabled ? 'disabled' : ''}
              data-testid="check-${escapeHtml(entry.id)}" />
            <span class="option-label">${escapeHtml(entry.label)}</span>
            ${
              entry.summary === undefined
                ? ''
                : `<span class="option-summary">${escapeHtml(entry.summary)}</span>`
            }
          </label>`;
          })
          .join('')}
      </div>`;
  }

  function renderClassStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const detail = state.options.classDetail;

    return `
      <div class="wizard-side-actions">
        <button type="button" class="secondary" data-testid="open-quick-start">
          In a hurry? Use a ready-made character
        </button>
        ${
          tutorialDismissed()
            ? `<button type="button" class="secondary" data-testid="open-tutorial">
                 New to tabletop RPGs? Short tour
               </button>`
            : ''
        }
      </div>
      <h3>Choose a Class</h3>
      <p class="step-helper">${escapeHtml(STEP_HELPERS.class)}</p>
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
        <p>
          Choose ${detail.skillChoiceCount}. Hit Die d${detail.hitDie}. Saving Throws:
          ${detail.savingThrowProficiencies.map((ability) => escapeHtml(ABILITY_LABELS[ability])).join(', ')}.
          Skills your Background already grants are omitted so you do not lose a class pick.
        </p>
        ${checkboxList({
          name: 'class-skill',
          testId: 'class-skill-options',
          entries: detail.skillOptions.filter(
            (skill) =>
              !(state.options.backgroundDetail?.skillIds ?? []).includes(skill.id),
          ),
          selected: state.draft.choices.classSkillIds,
          maxChoose: detail.skillChoiceCount,
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
    const inferred = detail === null ? null : inferBonusPattern(bonuses, detail.abilityOptions);
    const pattern = backgroundBonusPattern ?? inferred;
    const plusTwoAbility: Ability | '' =
      backgroundPlusTwo !== ''
        ? backgroundPlusTwo
        : pattern === 'plus-two-plus-one'
          ? (detail!.abilityOptions.find((ability) => bonuses[ability] === 2) ?? '')
          : '';
    const plusOneAbility: Ability | '' =
      backgroundPlusOne !== ''
        ? backgroundPlusOne
        : pattern === 'plus-two-plus-one'
          ? (detail!.abilityOptions.find((ability) => bonuses[ability] === 1) ?? '')
          : '';

    return `
      <h3>Choose a Background</h3>
      <p class="step-helper" data-testid="background-nav-hint">${escapeHtml(STEP_HELPERS.background)}</p>
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
        <div class="detail-panel" data-testid="background-detail">
          <h3>${escapeHtml(detail.label)}</h3>
          <p>
            Grants ${escapeHtml(detail.skillLabels.join(' and '))}, ${escapeHtml(detail.toolProficiency)},
            and the ${escapeHtml(detail.originFeat)} feat.
          </p>
          <h3>Ability increases</h3>
          <p>
            Choose one legal pattern only — either +2 and +1 on two of these abilities, or +1 on each
            of the three. Illegal combinations are not offered.
          </p>
          <div class="option-list compact" data-testid="bonus-pattern-options">
            <label class="option${pattern === 'plus-two-plus-one' ? ' selected' : ''}">
              <input type="radio" name="bonus-pattern" value="plus-two-plus-one"
                ${pattern === 'plus-two-plus-one' ? 'checked' : ''}
                data-testid="bonus-pattern-plus-two-plus-one" />
              <span class="option-label">+2 and +1</span>
              <span class="option-summary">Two different abilities from the list below.</span>
            </label>
            <label class="option${pattern === 'plus-one-each' ? ' selected' : ''}">
              <input type="radio" name="bonus-pattern" value="plus-one-each"
                ${pattern === 'plus-one-each' ? 'checked' : ''}
                data-testid="bonus-pattern-plus-one-each" />
              <span class="option-label">+1 to each</span>
              <span class="option-summary">${detail.abilityOptions
                .map((ability) => ABILITY_LABELS[ability])
                .join(', ')}.</span>
            </label>
          </div>
          ${
            pattern !== 'plus-two-plus-one'
              ? pattern === 'plus-one-each'
                ? `<p class="wizard-coach" data-testid="bonus-plus-one-each-summary">
                    +1 applied to ${escapeHtml(
                      detail.abilityOptions.map((ability) => ABILITY_LABELS[ability]).join(', '),
                    )}.
                  </p>`
                : ''
              : `
            <div class="ability-assign" data-testid="background-bonus-options">
              <label>
                <span>+2 to</span>
                <select data-testid="bonus-plus-two" data-bonus-role="plus-two">
                  <option value="">Choose…</option>
                  ${detail.abilityOptions
                    .map(
                      (ability) =>
                        `<option value="${ability}" ${plusTwoAbility === ability ? 'selected' : ''} ${
                          plusOneAbility === ability ? 'disabled' : ''
                        }>${escapeHtml(ABILITY_LABELS[ability])}</option>`,
                    )
                    .join('')}
                </select>
              </label>
              <label>
                <span>+1 to</span>
                <select data-testid="bonus-plus-one" data-bonus-role="plus-one">
                  <option value="">Choose…</option>
                  ${detail.abilityOptions
                    .map(
                      (ability) =>
                        `<option value="${ability}" ${plusOneAbility === ability ? 'selected' : ''} ${
                          plusTwoAbility === ability ? 'disabled' : ''
                        }>${escapeHtml(ABILITY_LABELS[ability])}</option>`,
                    )
                    .join('')}
                </select>
              </label>
            </div>`
          }
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
      <p class="step-helper">${escapeHtml(STEP_HELPERS.species)}</p>
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
          <p class="step-helper" data-testid="choice-helper-${escapeHtml(choice.id)}">${escapeHtml(choice.helper)}</p>
          <div class="option-list compact" data-testid="species-choice-list-${escapeHtml(choice.id)}">
            ${choice.from
              .map(
                (option) => `
              <label class="option${
                state.draft.choices.speciesChoiceIds[choice.id] === option.id ? ' selected' : ''
              }">
                <input type="radio" name="species-choice-${escapeHtml(choice.id)}"
                  value="${escapeHtml(option.id)}"
                  ${state.draft.choices.speciesChoiceIds[choice.id] === option.id ? 'checked' : ''}
                  data-species-choice="${escapeHtml(choice.id)}"
                  data-testid="species-choice-${escapeHtml(choice.id)}-${escapeHtml(option.id)}" />
                <span class="option-label">${escapeHtml(option.label)}</span>
                ${
                  option.summary === undefined
                    ? ''
                    : `<span class="option-summary">${escapeHtml(option.summary)}</span>`
                }
              </label>`,
              )
              .join('')}
          </div>`,
          )
          .join('')}${
        state.draft.choices.speciesId === 'human' && state.options.originFeatOptions !== null
          ? `
        <h3>Versatile — choose an Origin feat</h3>
        <p class="step-helper">Humans gain one additional Origin feat from the SRD roster.</p>
        ${optionList({
          name: 'origin-feat',
          testId: 'origin-feat-options',
          entries: state.options.originFeatOptions,
          selected: state.draft.choices.chosenOriginFeatId,
        })}`
          : ''
      }`
      }`;
  }

  function renderMagicInitiateSection(options: {
    readonly title: string;
    readonly testIdPrefix: string;
    readonly detail: NonNullable<DraftResponse['options']['backgroundFeatDetail']>;
    readonly cantripIds: readonly string[];
    readonly spellIds: readonly string[];
    readonly cantripName: string;
    readonly spellName: string;
  }): string {
    return `
      <h3>${escapeHtml(options.title)}</h3>
      <p>Choose ${options.detail.cantripsKnown} cantrips and ${options.detail.spellsKnown} level 1 spell from the ${escapeHtml(options.detail.label)} list.</p>
      <h4>Cantrips</h4>
      ${checkboxList({
        name: options.cantripName,
        testId: `${options.testIdPrefix}-cantrip-options`,
        entries: options.detail.cantripOptions,
        selected: options.cantripIds,
        maxChoose: options.detail.cantripsKnown,
      })}
      <h4>Level 1 spell</h4>
      ${checkboxList({
        name: options.spellName,
        testId: `${options.testIdPrefix}-spell-options`,
        entries: options.detail.spellOptions,
        selected: options.spellIds,
        maxChoose: options.detail.spellsKnown,
      })}`;
  }

  function renderAbilitiesStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const method = state.draft.choices.abilityMethod;
    const scores = state.draft.choices.baseAbilityScores;
    const pool = state.draft.choices.rolledScorePool;
    const attempts = state.draft.choices.abilityRollAttempts;
    const rollsLeft = Math.max(0, MAX_ABILITY_ROLL_ATTEMPTS - attempts);
    const assignedList = ABILITIES.map((ability) => scores[ability]).filter(
      (score): score is number => score !== undefined,
    );
    const pointBuySpent = pointBuyCost(assignedList) ?? 0;

    return `
      <h3>Ability Scores</h3>
      <p class="step-helper">${escapeHtml(STEP_HELPERS.abilities)}</p>
      <h3>Ability-generation method</h3>
      <p>
        Standard array is the “I trust the recipe” option. Point buy is for people who enjoy
        spreadsheets. Rolled scores use 4d6 drop lowest — you get ${MAX_ABILITY_ROLL_ATTEMPTS} rolls
        max, and each new roll replaces the previous one (no going back).
      </p>
      ${optionList({
        name: 'ability-method',
        testId: 'ability-method-options',
        entries: [
          {
            id: 'standard-array',
            label: 'Standard array',
            summary: `Assign ${STANDARD_ARRAY.join(', ')} across the six Ability Scores. Each number is used once.`,
          },
          {
            id: 'point-buy',
            label: 'Point buy',
            summary: `Spend ${POINT_BUY_BUDGET} points on scores from 8 to 15. Options that blow the budget are not offered.`,
          },
          {
            id: 'rolled',
            label: 'Roll (4d6 drop lowest)',
            summary: `Up to ${MAX_ABILITY_ROLL_ATTEMPTS} rolls. Each roll replaces the last — earlier pools are gone.`,
          },
        ],
        selected: method,
      })}
      ${
        method !== 'rolled'
          ? ''
          : `
        <div class="roll-panel" data-testid="ability-roll-panel">
          <p data-testid="ability-roll-status">
            ${
              pool === null
                ? `No roll yet. You have ${MAX_ABILITY_ROLL_ATTEMPTS} attempts.`
                : `Current pool: ${pool.join(', ')}. Attempts used: ${attempts} of ${MAX_ABILITY_ROLL_ATTEMPTS}.`
            }
          </p>
          <button type="button" data-testid="roll-abilities"
            aria-disabled="${rollsLeft === 0 || busy}">
            ${
              rollsLeft === 0
                ? 'No rolls left'
                : pool === null
                  ? `Roll Ability Scores (${rollsLeft} left)`
                  : `Roll again (${rollsLeft} left)`
            }
          </button>
          <p class="nav-hint">Rolling again replaces this pool and clears your assignments. Previous rolls cannot be restored.</p>
        </div>`
      }
      ${
        method === 'point-buy'
          ? `<p class="nav-hint" data-testid="point-buy-budget">
              Points spent: ${pointBuySpent} of ${POINT_BUY_BUDGET}. Remaining: ${Math.max(0, POINT_BUY_BUDGET - pointBuySpent)}.
            </p>`
          : ''
      }
      <h3>Assign Ability Scores</h3>
      ${
        method === 'rolled' && pool === null
          ? '<p class="empty-state" data-testid="ability-roll-needed">Roll for scores before assigning them.</p>'
          : `
      <div class="ability-assign" data-testid="ability-assignment">
        ${ABILITIES.map((ability) => {
          const values =
            method === 'point-buy'
              ? pointBuyScoresForAbility(scores, ability)
              : method === 'standard-array'
                ? availableScoresFromPool([...STANDARD_ARRAY], scores, ability)
                : availableScoresFromPool(pool ?? [], scores, ability);
          const current = scores[ability];
          return `
          <label>
            <span>${escapeHtml(ABILITY_LABELS[ability])}</span>
            <select data-ability="${ability}" data-testid="ability-select-${ability}">
              <option value="">—</option>
              ${values
                .map(
                  (score) =>
                    `<option value="${score}" ${current === score ? 'selected' : ''}>${score}</option>`,
                )
                .join('')}
            </select>
          </label>`;
        }).join('')}
      </div>`
      }`;
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
      <h3>Starting equipment</h3>
      <p class="step-helper">${escapeHtml(STEP_HELPERS.equipment)}</p>
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
      <p class="step-helper" data-testid="choice-helper-${escapeHtml(choice.id)}">${escapeHtml(choice.helper)}</p>
      <p>Choose ${choice.choose}. Extra options lock once you hit that count.</p>
      ${checkboxList({
        name: `class-choice-${choice.id}`,
        testId: `class-choice-${escapeHtml(choice.id)}`,
        entries: choice.from,
        selected: state.draft.choices.classChoiceIds[choice.id] ?? [],
        maxChoose: choice.choose,
      })}`,
      )
      .join('');

    const spells =
      detail.spellcasting === null
        ? `<p class="empty-state" data-testid="no-spellcasting">${escapeHtml(detail.label)} does not cast spells at level 1.</p>`
        : `
        <h3>Cantrips</h3>
        <p>Choose ${detail.spellcasting.cantripsKnown}. Spellcasting ability: ${escapeHtml(detail.spellcasting.abilityLabel)}. Extra cantrips lock at that count.</p>
        ${
          detail.spellcasting.cantripsKnown === 0
            ? '<p class="empty-state">This Class knows no cantrips at level 1.</p>'
            : checkboxList({
                name: 'cantrip',
                testId: 'cantrip-options',
                entries: detail.spellcasting.cantripOptions,
                selected: state.draft.choices.cantripIds,
                maxChoose: detail.spellcasting.cantripsKnown,
              })
        }
        <h3>Level 1 Spells</h3>
        <p>Choose ${detail.spellcasting.spellsAvailable} to ${
          detail.spellcasting.preparationStyle === 'prepared' ? 'prepare' : 'know'
        }. Extra spells lock at that count.</p>
        ${checkboxList({
          name: 'spell',
          testId: 'spell-options',
          entries: detail.spellcasting.spellOptions,
          selected: state.draft.choices.spellIds,
          maxChoose: detail.spellcasting.spellsAvailable,
        })}`;

    return `
      <h3>${escapeHtml(detail.label)} level 1 features</h3>
      <p class="step-helper">${escapeHtml(STEP_HELPERS.features)}</p>
      <ul class="record-list">
        ${detail.features
          .map(
            (feature) =>
              `<li><span class="record-note">${escapeHtml(feature.name)}</span><span class="record-meta">${escapeHtml(feature.summary)}</span></li>`,
          )
          .join('')}
      </ul>
      ${classChoices}
      ${
        state.options.backgroundFeatDetail === null
          ? ''
          : renderMagicInitiateSection({
              title: `${state.options.backgroundFeatDetail.label} (Background)`,
              testIdPrefix: 'background-feat',
              detail: state.options.backgroundFeatDetail,
              cantripIds: state.draft.choices.backgroundFeatCantripIds,
              spellIds: state.draft.choices.backgroundFeatSpellIds,
              cantripName: 'background-feat-cantrip',
              spellName: 'background-feat-spell',
            })
      }
      ${
        state.options.originFeatDetail === null
          ? ''
          : renderMagicInitiateSection({
              title: `${state.options.originFeatDetail.label} (Versatile)`,
              testIdPrefix: 'origin-feat',
              detail: state.options.originFeatDetail,
              cantripIds: state.draft.choices.originFeatCantripIds,
              spellIds: state.draft.choices.originFeatSpellIds,
              cantripName: 'origin-feat-cantrip',
              spellName: 'origin-feat-spell',
            })
      }
      ${spells}`;
  }

  function renderIdentityStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const identity = state.draft.choices.identity;

    return `
      <h3>Identity & final review</h3>
      <p class="step-helper">${escapeHtml(STEP_HELPERS.identity)}</p>
      <label for="character-name">Name</label>
      <input id="character-name" type="text" data-identity="name" data-testid="identity-name"
        maxlength="${CHARACTER_NAME_MAX_LENGTH}"
        value="${escapeHtml(identity.name)}" autocomplete="off" placeholder="Something the bard can pronounce" />
      <label for="character-pronouns">Pronouns</label>
      <input id="character-pronouns" type="text" data-identity="pronouns" data-testid="identity-pronouns"
        maxlength="${CHARACTER_TEXT_MAX_LENGTH}"
        value="${escapeHtml(identity.pronouns)}" autocomplete="off" placeholder="Optional" />
      <label for="character-appearance">Appearance</label>
      <input id="character-appearance" type="text" data-identity="appearance" data-testid="identity-appearance"
        maxlength="${CHARACTER_TEXT_MAX_LENGTH}"
        value="${escapeHtml(identity.appearance)}" autocomplete="off" placeholder="Optional — scar, hat, ominous vibes…" />
      <label for="character-concept">Concept</label>
      <input id="character-concept" type="text" data-identity="concept" data-testid="identity-concept"
        maxlength="${CHARACTER_TEXT_MAX_LENGTH}"
        value="${escapeHtml(identity.concept)}" autocomplete="off" placeholder="Optional one-liner" />

      <h3>Final review</h3>
      ${
        state.draft.unresolved.some((item) => item.step !== 'identity')
          ? `<p class="message notice" data-testid="final-review-incomplete">
              Mechanics are still incomplete. Finish earlier steps before treating this sheet as final.
            </p>
            <ul class="record-list" data-testid="final-review-unresolved">
              ${state.draft.unresolved
                .filter((item) => item.step !== 'identity')
                .map(
                  (item) =>
                    `<li data-testid="final-review-unresolved-item">${escapeHtml(item.message)}</li>`,
                )
                .join('')}
            </ul>`
          : ''
      }
      ${
        state.draft.sheet === null
          ? '<p class="empty-state">Finish Class, Background, and Species to preview the sheet.</p>'
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

  function liveSheetPreview(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const choices = state.draft.choices;
    const classLabel =
      state.options.catalog.classes.find((entry) => entry.id === choices.classId)?.label ?? null;
    const backgroundLabel =
      state.options.catalog.backgrounds.find((entry) => entry.id === choices.backgroundId)?.label ??
      null;
    const speciesLabel =
      state.options.catalog.species.find((entry) => entry.id === choices.speciesId)?.label ?? null;

    return `
      <aside class="wizard-sheet-preview panel" data-testid="wizard-sheet-preview" aria-label="Live character sheet">
        <h2>Character so far</h2>
        <p class="record-meta" data-testid="preview-identity-line">
          ${escapeHtml(classLabel ?? 'Class unchosen')} ·
          ${escapeHtml(backgroundLabel ?? 'Background unchosen')} ·
          ${escapeHtml(speciesLabel ?? 'Species unchosen')}
        </p>
        ${
          state.draft.sheet === null
            ? `<p class="empty-state" data-testid="preview-waiting">
                Choose Class, Background, and Species to build the sheet here as you go.
              </p>`
            : renderLiveSheetPreview(state.draft.sheet, {
                abilitiesComplete: ABILITIES.every(
                  (ability) => state.draft.choices.baseAbilityScores[ability] !== undefined,
                ),
              })
        }
      </aside>`;
  }

  function quickStartModal(): string {
    const state = current;
    if (state === null || !quickStartOpen) {
      return '';
    }
    return `
      <div class="modal-backdrop" data-testid="quick-start-modal" role="presentation">
        <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-start-heading">
          <h2 id="quick-start-heading">Ready-made characters</h2>
          <p>
            These are complete, rules-valid adventurers. Pick one, rename them at Identity, and you
            can still edit every choice afterward. This is a head start — not a trap.
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
          <div class="modal-actions">
            <button type="button" class="secondary" data-testid="close-quick-start">Back to custom creation</button>
          </div>
        </div>
      </div>`;
  }

  function tutorialModal(): string {
    if (!tutorialOpen) {
      return '';
    }
    const step = TUTORIAL_STEPS[tutorialStep]!;
    const isLast = tutorialStep >= TUTORIAL_STEPS.length - 1;
    return `
      <div class="modal-backdrop" data-testid="tutorial-modal" role="presentation">
        <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="tutorial-heading">
          <h2 id="tutorial-heading">${escapeHtml(step.title)}</h2>
          <p data-testid="tutorial-body">${escapeHtml(step.body)}</p>
          <p class="record-meta">Step ${tutorialStep + 1} of ${TUTORIAL_STEPS.length}</p>
          <div class="modal-actions">
            <button type="button" class="secondary" data-testid="tutorial-skip">Skip tour</button>
            ${
              tutorialStep > 0
                ? `<button type="button" class="secondary" data-testid="tutorial-back">Back</button>`
                : ''
            }
            <button type="button" data-testid="tutorial-next">
              ${isLast ? 'Start creating' : 'Next'}
            </button>
          </div>
        </div>
      </div>`;
  }

  function tutorialAskBanner(): string {
    if (tutorialDismissed() || tutorialOpen || current === null) {
      return '';
    }
    return `
      <div class="message notice" data-testid="tutorial-ask" role="region" aria-label="Tutorial offer">
        <span>New to tabletop or RPG character sheets? A short tour explains the steps without changing any rules.</span>
        <div class="actions message-actions">
          <button type="button" data-testid="tutorial-ask-yes">Show me the tour</button>
          <button type="button" class="secondary" data-testid="tutorial-ask-no">No thanks</button>
        </div>
      </div>`;
  }

  function bindEvents(): void {
    const state = current;
    if (state === null) {
      return;
    }

    container.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true' || busy) {
          return;
        }
        const target = button.dataset.step as WizardStep;
        const targetIndex = WIZARD_STEPS.indexOf(target);
        const activeIndex = WIZARD_STEPS.indexOf(activeStep);
        const targetComplete = current?.draft.completedSteps.includes(target) === true;
        const goingBackOrCurrent = targetIndex <= activeIndex;
        const priorComplete =
          targetIndex === 0 ||
          WIZARD_STEPS.slice(0, targetIndex).every(
            (prior) => current?.draft.completedSteps.includes(prior) === true,
          );
        if (!goingBackOrCurrent && !targetComplete && !priorComplete) {
          error = 'Finish earlier steps before jumping ahead on the step train.';
          render();
          return;
        }
        activeStep = target;
        error = null;
        render();
      });
    });

    container
      .querySelector<HTMLButtonElement>('[data-testid="wizard-back"]')
      ?.addEventListener('click', () => {
        const index = WIZARD_STEPS.indexOf(activeStep);
        if (index <= 0 || busy) {
          return;
        }
        activeStep = WIZARD_STEPS[index - 1]!;
        render();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="wizard-continue"]')
      ?.addEventListener('click', () => {
        const index = WIZARD_STEPS.indexOf(activeStep);
        if (index < 0 || index >= WIZARD_STEPS.length - 1 || busy || !stepIsComplete(activeStep)) {
          return;
        }
        activeStep = WIZARD_STEPS[index + 1]!;
        render();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="open-quick-start"]')
      ?.addEventListener('click', () => {
        quickStartOpen = true;
        render();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="close-quick-start"]')
      ?.addEventListener('click', () => {
        quickStartOpen = false;
        render();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="open-tutorial"]')
      ?.addEventListener('click', () => {
        tutorialOpen = true;
        tutorialStep = 0;
        render();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="tutorial-ask-yes"]')
      ?.addEventListener('click', () => {
        tutorialOpen = true;
        tutorialStep = 0;
        render();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="tutorial-ask-no"]')
      ?.addEventListener('click', () => {
        dismissTutorialPermanently();
        render();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="tutorial-skip"]')
      ?.addEventListener('click', () => {
        dismissTutorialPermanently();
        tutorialOpen = false;
        tutorialStep = 0;
        render();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="tutorial-back"]')
      ?.addEventListener('click', () => {
        tutorialStep = Math.max(0, tutorialStep - 1);
        render();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="tutorial-next"]')
      ?.addEventListener('click', () => {
        if (tutorialStep >= TUTORIAL_STEPS.length - 1) {
          dismissTutorialPermanently();
          tutorialOpen = false;
          tutorialStep = 0;
          activeStep = 'class';
          render();
          return;
        }
        tutorialStep += 1;
        render();
      });

    container.querySelectorAll<HTMLInputElement>('input[name="quick-start"]').forEach((input) => {
      input.addEventListener('change', () => {
        void (async () => {
          if (candidate === null || current === null || busy) {
            return;
          }
          const hasProgress = draftHasProgress();
          if (hasProgress) {
            const accepted = await confirmInApp({
              title: 'Apply ready-made character?',
              body: 'Apply this ready-made character? It replaces your current draft choices. You can still edit afterward.',
              confirmLabel: 'Apply template',
              cancelLabel: 'Keep my draft',
              testId: 'confirm-quick-start',
            });
            if (!accepted) {
              input.checked = false;
              return;
            }
          }
          busy = true;
          error = null;
          quickStartOpen = false;
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

    const radioHandlers: ReadonlyArray<[string, (value: string) => CharacterChoices | null]> = [
      [
        'class',
        (value) => ({
          ...latestChoices(),
          classId: value,
          classSkillIds: [],
          classChoiceIds: {},
          classEquipmentOptionId: null,
          cantripIds: [],
          spellIds: [],
        }),
      ],
      [
        'background',
        (value) => {
          backgroundBonusPattern = null;
          backgroundPlusTwo = '';
          backgroundPlusOne = '';
          return {
            ...latestChoices(),
            backgroundId: value,
            backgroundAbilityBonuses: {},
            backgroundEquipmentOptionId: null,
            backgroundFeatCantripIds: [],
            backgroundFeatSpellIds: [],
          };
        },
      ],
      [
        'origin-feat',
        (value) => ({
          ...latestChoices(),
          chosenOriginFeatId: value,
          originFeatCantripIds: [],
          originFeatSpellIds: [],
        }),
      ],
      ['species', (value) => ({ ...latestChoices(), speciesId: value, speciesChoiceIds: {}, chosenOriginFeatId: null, originFeatCantripIds: [], originFeatSpellIds: [] })],
      ['class-equipment', (value) => ({ ...latestChoices(), classEquipmentOptionId: value })],
      [
        'background-equipment',
        (value) => ({ ...latestChoices(), backgroundEquipmentOptionId: value }),
      ],
    ];
    for (const [name, build] of radioHandlers) {
      container.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((input) => {
        input.addEventListener('change', () => {
          const next = build(input.value);
          if (next === null) {
            render();
            return;
          }
          void commitChoices(next);
        });
      });
    }

    container.querySelectorAll<HTMLInputElement>('input[name="ability-method"]').forEach((input) => {
      input.addEventListener('change', () => {
        void (async () => {
          const foundation = latestChoices();
          const clearing =
            Object.keys(foundation.baseAbilityScores).length > 0 ||
            (foundation.abilityMethod === 'rolled' && foundation.rolledScorePool !== null);
          if (clearing && input.value !== foundation.abilityMethod) {
            const accepted = await confirmInApp({
              title: 'Switch ability method?',
              body: 'Switching ability methods clears your current score assignments. Continue?',
              confirmLabel: 'Clear and switch',
              cancelLabel: 'Keep assignments',
              testId: 'confirm-ability-method',
            });
            if (!accepted) {
              render();
              return;
            }
          }
          await commitChoices({
            ...foundation,
            abilityMethod: input.value as CharacterChoices['abilityMethod'],
            baseAbilityScores: {},
            rolledScorePool: null,
            abilityRollAttempts: 0,
          });
        })();
      });
    });

    container.querySelectorAll<HTMLInputElement>('input[name="class-skill"]').forEach((input) => {
      input.addEventListener('change', () => {
        const foundation = latestChoices();
        const max = state.options.classDetail?.skillChoiceCount;
        let selected = [...container.querySelectorAll<HTMLInputElement>('input[name="class-skill"]:checked')].map(
          (checked) => checked.value,
        );
        if (max !== undefined && selected.length > max) {
          selected = selected.slice(0, max);
        }
        void commitChoices({ ...foundation, classSkillIds: selected });
      });
    });

    for (const [name, key, maxOf] of [
      ['cantrip', 'cantripIds', () => state.options.classDetail?.spellcasting?.cantripsKnown],
      ['spell', 'spellIds', () => state.options.classDetail?.spellcasting?.spellsAvailable],
      ['background-feat-cantrip', 'backgroundFeatCantripIds', () => state.options.backgroundFeatDetail?.cantripsKnown],
      ['background-feat-spell', 'backgroundFeatSpellIds', () => state.options.backgroundFeatDetail?.spellsKnown],
      ['origin-feat-cantrip', 'originFeatCantripIds', () => state.options.originFeatDetail?.cantripsKnown],
      ['origin-feat-spell', 'originFeatSpellIds', () => state.options.originFeatDetail?.spellsKnown],
    ] as const) {
      container.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((input) => {
        input.addEventListener('change', () => {
          const foundation = latestChoices();
          const max = maxOf();
          let selected = [...container.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map(
            (checked) => checked.value,
          );
          if (max !== undefined && selected.length > max) {
            selected = selected.slice(0, max);
          }
          void commitChoices({ ...foundation, [key]: selected });
        });
      });
    }

    container.querySelectorAll<HTMLInputElement>('input[name^="class-choice-"]').forEach((input) => {
      input.addEventListener('change', () => {
        const foundation = latestChoices();
        const name = input.name;
        const choiceId = name.replace('class-choice-', '');
        const max = state.options.classDetail?.choices.find((choice) => choice.id === choiceId)?.choose;
        let selected = [...container.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map(
          (checked) => checked.value,
        );
        if (max !== undefined && selected.length > max) {
          selected = selected.slice(0, max);
        }
        void commitChoices({
          ...foundation,
          classChoiceIds: { ...foundation.classChoiceIds, [choiceId]: selected },
        });
      });
    });

    container.querySelectorAll<HTMLSelectElement>('[data-ability]').forEach((select) => {
      select.addEventListener('change', () => {
        const foundation = latestChoices();
        const ability = select.dataset.ability as Ability;
        const scores = { ...foundation.baseAbilityScores };
        if (select.value === '') {
          delete scores[ability];
        } else {
          const nextScore = Number(select.value);
          if (foundation.abilityMethod === 'point-buy') {
            const legal = pointBuyScoresForAbility(scores, ability);
            if (!legal.includes(nextScore)) {
              return;
            }
          } else {
            const pool =
              foundation.abilityMethod === 'standard-array'
                ? [...STANDARD_ARRAY]
                : [...(foundation.rolledScorePool ?? [])];
            const legal = availableScoresFromPool(pool, scores, ability);
            if (!legal.includes(nextScore)) {
              return;
            }
          }
          scores[ability] = nextScore;
        }
        void commitChoices({ ...foundation, baseAbilityScores: scores });
      });
    });

    container.querySelectorAll<HTMLInputElement>('input[name="bonus-pattern"]').forEach((input) => {
      input.addEventListener('change', () => {
        const detail = state.options.backgroundDetail;
        if (detail === null) {
          return;
        }
        const nextPattern = input.value as BonusPattern;
        backgroundBonusPattern = nextPattern;
        backgroundPlusTwo = '';
        backgroundPlusOne = '';
        if (nextPattern === 'plus-one-each') {
          void commitChoices({
            ...latestChoices(),
            backgroundAbilityBonuses: bonusesForPlusOneEach(detail.abilityOptions),
          });
          return;
        }
        void commitChoices({ ...latestChoices(), backgroundAbilityBonuses: {} });
      });
    });

    const plusTwoSelect = container.querySelector<HTMLSelectElement>('[data-bonus-role="plus-two"]');
    const plusOneSelect = container.querySelector<HTMLSelectElement>('[data-bonus-role="plus-one"]');
    const commitPlusTwoPlusOne = (): void => {
      backgroundPlusTwo = (plusTwoSelect?.value ?? '') as Ability | '';
      backgroundPlusOne = (plusOneSelect?.value ?? '') as Ability | '';
      if (
        backgroundPlusTwo === '' ||
        backgroundPlusOne === '' ||
        backgroundPlusTwo === backgroundPlusOne
      ) {
        // Keep local picks visible; only persist once both abilities are set.
        render();
        return;
      }
      void commitChoices({
        ...latestChoices(),
        backgroundAbilityBonuses: {
          [backgroundPlusTwo]: 2,
          [backgroundPlusOne]: 1,
        },
      });
    };
    plusTwoSelect?.addEventListener('change', commitPlusTwoPlusOne);
    plusOneSelect?.addEventListener('change', commitPlusTwoPlusOne);

    container
      .querySelector<HTMLButtonElement>('[data-testid="roll-abilities"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || current === null || busy) {
            return;
          }
          if (current.draft.choices.abilityRollAttempts >= MAX_ABILITY_ROLL_ATTEMPTS) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            current = await rollDraftAbilities({
              candidateId: candidate.candidateId,
              draftId: current.draft.draftId,
            });
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Those Ability Scores could not be rolled.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container.querySelectorAll<HTMLInputElement>('[data-species-choice]').forEach((input) => {
      input.addEventListener('change', () => {
        const choiceId = input.dataset.speciesChoice ?? '';
        const foundation = latestChoices();
        void commitChoices({
          ...foundation,
          speciesChoiceIds: { ...foundation.speciesChoiceIds, [choiceId]: input.value },
        });
      });
    });

    container.querySelectorAll<HTMLInputElement>('[data-identity]').forEach((input) => {
      // Merge against in-flight / pending choices so a Pronouns blur cannot wipe a
      // Name save that is still round-tripping (HD-A3-PQA-001 / 051).
      const persistIdentity = (): void => {
        if (current === null) {
          return;
        }
        const field = input.dataset.identity as keyof CharacterChoices['identity'];
        const foundation = latestChoices();
        void commitChoices({
          ...foundation,
          identity: { ...foundation.identity, [field]: input.value },
        });
      };
      input.addEventListener('input', () => {
        window.clearTimeout((input as HTMLInputElement & { _hdIdentityTimer?: number })._hdIdentityTimer);
        (input as HTMLInputElement & { _hdIdentityTimer?: number })._hdIdentityTimer = window.setTimeout(
          persistIdentity,
          300,
        );
      });
      input.addEventListener('change', persistIdentity);
    });

    container
      .querySelector<HTMLButtonElement>('[data-testid="create-character"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || current === null || busy) {
            return;
          }
          // Flush visible identity fields before create so a typed name that has
          // not yet fired `change` still counts (and avoid a blur→save race).
          const foundation = latestChoices();
          const identity = { ...foundation.identity };
          container.querySelectorAll<HTMLInputElement>('[data-identity]').forEach((fieldInput) => {
            const field = fieldInput.dataset.identity as keyof CharacterChoices['identity'];
            identity[field] = fieldInput.value;
          });
          if (
            identity.name !== foundation.identity.name ||
            identity.pronouns !== foundation.identity.pronouns ||
            identity.appearance !== foundation.identity.appearance ||
            identity.concept !== foundation.identity.concept
          ) {
            await commitChoices({ ...foundation, identity });
          }
          if (current === null || !current.draft.canCreate) {
            const remaining = (current?.draft.unresolved ?? [])
              .map((item) => item.message)
              .slice(0, 3)
              .join(' ');
            error =
              remaining.length > 0
                ? `Cannot create yet. ${remaining}`
                : 'Cannot create yet. Finish every required choice first.';
            shell.announce(error);
            render();
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
            const returnCampaign = new URLSearchParams(window.location.search).get('returnCampaign');
            if (
              returnCampaign !== null &&
              /^[A-Za-z0-9-]{1,64}$/.test(returnCampaign) &&
              returnCampaign !== 'new'
            ) {
              navigate(
                `/campaigns/${returnCampaign}?seatCharacter=${encodeURIComponent(character.characterId)}`,
              );
              return;
            }
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
          if (
            !(await confirmInApp({
              title: 'Discard this draft?',
              body: 'Discard this draft? Your unfinished choices will be removed.',
              confirmLabel: 'Discard draft',
              cancelLabel: 'Keep draft',
              testId: 'confirm-discard-draft',
            }))
          ) {
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

  function captureFocus(): {
    readonly testId: string | null;
    readonly name: string | null;
    readonly value: string | null;
    readonly selectionStart: number | null;
    readonly selectionEnd: number | null;
  } {
    const prior = document.activeElement;
    return {
      testId: prior instanceof HTMLElement ? prior.getAttribute('data-testid') : null,
      name:
        prior instanceof HTMLInputElement ||
        prior instanceof HTMLSelectElement ||
        prior instanceof HTMLTextAreaElement
          ? prior.name
          : null,
      value:
        prior instanceof HTMLInputElement ||
        prior instanceof HTMLSelectElement ||
        prior instanceof HTMLTextAreaElement
          ? prior.value
          : null,
      selectionStart:
        prior instanceof HTMLInputElement || prior instanceof HTMLTextAreaElement
          ? prior.selectionStart
          : null,
      selectionEnd:
        prior instanceof HTMLInputElement || prior instanceof HTMLTextAreaElement
          ? prior.selectionEnd
          : null,
    };
  }

  function restoreFocus(captured: ReturnType<typeof captureFocus>): void {
    if (captured.testId !== null) {
      const restored = container.querySelector<HTMLElement>(
        `[data-testid="${CSS.escape(captured.testId)}"]`,
      );
      if (restored instanceof HTMLElement) {
        restored.focus();
        if (
          (restored instanceof HTMLInputElement || restored instanceof HTMLTextAreaElement) &&
          captured.selectionStart !== null &&
          captured.selectionEnd !== null
        ) {
          restored.setSelectionRange(captured.selectionStart, captured.selectionEnd);
        }
        return;
      }
    }
    if (captured.name !== null && captured.value !== null) {
      const named = [
        ...container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          `[name="${CSS.escape(captured.name)}"]`,
        ),
      ];
      const match = named.find((element) => element.value === captured.value) ?? named[0] ?? null;
      match?.focus();
    }
  }

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }

    if (getAccount() === null) {
      if (isHostedPlayerSurface(candidate)) {
        navigate('/', { replace: true });
        return;
      }
      container.innerHTML = renderSignedOutGate({
        title: 'Create a character',
        body: 'Sign in with a Local Arena development account before starting character creation. Your draft will be owned by that account.',
        candidate,
        busy: gateBusy,
        error: gateError,
      });
      bindSignedOutGate({
        container,
        shell,
        candidate,
        onSignedIn: () => {
          void openOwnedDraft();
        },
        setBusy: (next) => {
          gateBusy = next;
        },
        setError: (message) => {
          gateError = message;
        },
        render,
      });
      return;
    }

    const state = current;
    const focus = captureFocus();

    container.innerHTML = `
      <div class="page page-wide">
        <h1 data-testid="create-heading">Create a character</h1>
        <p class="tagline">
          Follow the steps in order — or hop the train above if you need to revisit a choice.
          The server checks every decision against the SRD, so Continue waits until this step is legal.
          On a wide screen, the sheet builds on the side so you can compare as you choose.
        </p>
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="create-error">${escapeHtml(error)}</div>
               ${
                 state === null
                   ? `<div class="actions">
                        <button type="button" data-testid="retry-open-draft">Retry</button>
                        <a href="/characters" data-link>Back to the Character Vault</a>
                      </div>`
                   : ''
               }`
        }
        ${tutorialAskBanner()}
        ${state === null && error === null ? '<p class="empty-state">Opening your draft…</p>' : ''}
        ${state === null ? '' : stepTrain()}
        ${
          state === null
            ? ''
            : `
        <div class="wizard-layout">
          <section class="panel wizard-step-panel" aria-labelledby="step-heading">
            <h2 id="step-heading" data-testid="active-step-heading">${escapeHtml(WIZARD_STEP_LABELS[activeStep])}</h2>
            ${renderStepBody()}
            ${wizardNav()}
          </section>
          ${liveSheetPreview()}
        </div>`
        }
        ${quickStartModal()}
        ${tutorialModal()}
      </div>`;

    container
      .querySelector<HTMLButtonElement>('[data-testid="retry-open-draft"]')
      ?.addEventListener('click', () => {
        error = null;
        void openOwnedDraft();
      });

    bindEvents();
    restoreFocus(focus);
  }

  render();

  subscribeAccount(() => {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    if (getAccount() === null) {
      current = null;
      draftOpened = false;
      pendingChoices = null;
      openGeneration += 1;
      render();
      return;
    }
    if (!draftOpened) {
      void openOwnedDraft();
    }
  });

  void openOwnedDraft();
}
