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
  POINT_BUY_COSTS,
  STANDARD_ARRAY,
  WIZARD_STEPS,
  WIZARD_STEP_LABELS,
  abilityModifier,
  availableScoresFromPool,
  formatModifier,
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
  generatePortrait,
  openDraft,
  rollDraftAbilities,
  saveDraft,
  type DraftResponse,
} from '../api.js';
import {
  APPEARANCE_PROMPT_MAX_LENGTH,
  validateAppearancePrompt,
} from '../../shared/portrait-contract.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { isCreatorTutorialDismissed, setCreatorTutorialDismissed } from '../browser-preferences.js';
import { renderCharacterSheet, renderLiveSheetPreview } from '../character-sheet-view.js';
import { confirmInApp } from '../confirm-dialog.js';
import { escapeHtml } from '../dom-utils.js';
import {
  bindLegalPlayGatePage,
  isLegalPlayBlocked,
  loadLegalPlayAcceptance,
  renderLegalPlayGatePage,
  type LegalAcceptanceProjection,
} from '../legal-play-gate.js';
import { beginPageMount, isPageMountCurrent, registerPageCleanup } from '../page-mount.js';
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

/** Visual 3-stage carousel grouping SRD wizard steps (matches actual Class → Background → Species order). */
const CAROUSEL_STAGES = [
  {
    id: 'archetype',
    label: 'Archetype',
    summary: 'Class, background & species',
    steps: ['class', 'background', 'species'] as const satisfies readonly WizardStep[],
  },
  {
    id: 'foundation',
    label: 'Foundation',
    summary: 'Attributes & loadout',
    steps: ['abilities', 'equipment'] as const satisfies readonly WizardStep[],
  },
  {
    id: 'identity',
    label: 'Identity',
    summary: 'Features & name',
    steps: ['features', 'identity'] as const satisfies readonly WizardStep[],
  },
] as const;

function carouselStageForStep(step: WizardStep): (typeof CAROUSEL_STAGES)[number] {
  return (
    CAROUSEL_STAGES.find((stage) => (stage.steps as readonly WizardStep[]).includes(step)) ??
    CAROUSEL_STAGES[0]!
  );
}

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
  let quickStartAppliedNotice: string | null = null;
  let tutorialOpen = false;
  let tutorialStep = 0;
  let pendingChoices: CharacterChoices | null = null;
  /** Choices currently being saved — identity edits merge against this while busy. */
  let inFlightChoices: CharacterChoices | null = null;
  /** Unsaved keystrokes in Identity inputs so displayChoices() stays up to date without mutating server draft.choices. */
  let localIdentityDraft: CharacterChoices['identity'] | null = null;
  let silentIdentitySaveInFlight = false;
  /** Advance to next wizard step once the in-flight save finishes. */
  let pendingAdvance = false;
  /** Physical Appearance text typed in the portrait section; survives re-renders. */
  let portraitPromptText: string | null = null;
  let portraitBusy = false;
  let portraitError: string | null = null;
  let openGeneration = 0;
  let legalAcceptance: LegalAcceptanceProjection | null = null;
  let legalGateBusy = false;
  let legalGateError: string | null = null;
  let legalGateLoading = false;
  const mountToken = beginPageMount(container);
  let identityDebounceTimer: number | null = null;
  let activeSavePromise: Promise<void> | null = null;
  registerPageCleanup(container, mountToken, () => {
    if (identityDebounceTimer !== null) {
      window.clearTimeout(identityDebounceTimer);
      identityDebounceTimer = null;
    }
  });

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

  function hasDownstreamFromClass(choices: CharacterChoices): boolean {
    return (
      choices.backgroundId !== null ||
      choices.speciesId !== null ||
      Object.keys(choices.baseAbilityScores).length > 0 ||
      choices.classSkillIds.length > 0 ||
      choices.cantripIds.length > 0 ||
      choices.spellIds.length > 0 ||
      choices.spellbookIds.length > 0 ||
      choices.classEquipmentOptionId !== null ||
      Object.keys(choices.classChoiceIds).length > 0
    );
  }

  function hasDownstreamFromBackground(choices: CharacterChoices): boolean {
    return (
      choices.speciesId !== null ||
      Object.keys(choices.baseAbilityScores).length > 0 ||
      Object.keys(choices.backgroundAbilityBonuses).length > 0 ||
      choices.backgroundEquipmentOptionId !== null ||
      choices.backgroundFeatCantripIds.length > 0 ||
      choices.backgroundFeatSpellIds.length > 0
    );
  }

  function hasDownstreamFromSpecies(choices: CharacterChoices): boolean {
    return (
      choices.chosenOriginFeatId !== null ||
      Object.keys(choices.speciesChoiceIds).length > 0 ||
      choices.originFeatCantripIds.length > 0 ||
      choices.originFeatSpellIds.length > 0 ||
      Object.keys(choices.baseAbilityScores).length > 0
    );
  }

  function latestChoices(): CharacterChoices {
    return pendingChoices ?? inFlightChoices ?? current!.draft.choices;
  }

  /** Optimistic UI selection while a save is in flight or queued. */
  function displayChoices(): CharacterChoices {
    const base = latestChoices();
    return localIdentityDraft === null ? base : { ...base, identity: localIdentityDraft };
  }

  function tutorialDismissed(): boolean {
    return tutorialDismissedThisSession || isCreatorTutorialDismissed();
  }

  function dismissTutorialPermanently(): void {
    tutorialDismissedThisSession = true;
    setCreatorTutorialDismissed();
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
      localIdentityDraft = null;
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

  function scrollToWizardTop(): void {
    const docEl = document.documentElement;
    const prevBehavior = docEl !== null ? docEl.style.scrollBehavior : '';
    if (docEl !== null) {
      docEl.style.scrollBehavior = 'auto';
    }
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, 0);
    }
    if (docEl !== null) {
      docEl.scrollTop = 0;
    }
    if (document.body !== null) {
      document.body.scrollTop = 0;
    }
    container.scrollTop = 0;
    const stepHeading = container.querySelector<HTMLElement>('[data-testid="active-step-heading"]');
    stepHeading?.focus({ preventScroll: true });
    if (docEl !== null) {
      docEl.style.scrollBehavior = prevBehavior;
    }
  }

  function isIdentityInputFocused(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !container.contains(active)) {
      return false;
    }
    return (
      active.hasAttribute('data-identity') ||
      active.getAttribute('data-testid') === 'identity-physical-appearance'
    );
  }

  async function commitChoices(
    next: CharacterChoices,
    options?: { readonly silentDom?: boolean },
  ): Promise<void> {
    const p = commitChoicesInner(next, options);
    activeSavePromise = p;
    return p;
  }

  async function commitChoicesInner(
    next: CharacterChoices,
    options?: { readonly silentDom?: boolean },
  ): Promise<void> {
    if (candidate === null || current === null) {
      return;
    }
    if (busy) {
      pendingChoices = next;
      return;
    }
    const silent = options?.silentDom === true || (activeStep === 'identity' && isIdentityInputFocused());
    busy = true;
    silentIdentitySaveInFlight = silent;
    error = null;
    pendingChoices = null;
    inFlightChoices = next;
    if (silent) {
      syncIdentityStepDomInPlace();
    }
    try {
      current = await saveDraft({
        candidateId: candidate.candidateId,
        draftId: current.draft.draftId,
        choices: next,
      });
      if (
        localIdentityDraft !== null &&
        localIdentityDraft.name === current.draft.choices.identity.name &&
        localIdentityDraft.pronouns === current.draft.choices.identity.pronouns &&
        localIdentityDraft.appearance === current.draft.choices.identity.appearance &&
        localIdentityDraft.concept === current.draft.choices.identity.concept
      ) {
        localIdentityDraft = null;
      }
      // Do not auto-rewind activeStep here. A late/stale save that still lists an
      // earlier step incomplete was yanking players (and e2e) back to Class after
      // Continue. Downstream clears on class/species change already handle invalidation.
    } catch (failure) {
      error = failure instanceof ApiFailure ? failure.message : 'That change could not be saved.';
    } finally {
      busy = false;
      silentIdentitySaveInFlight = false;
      inFlightChoices = null;
      if (pendingChoices !== null && candidate !== null && current !== null) {
        const queued = pendingChoices;
        pendingChoices = null;
        await commitChoices(queued, options);
        return;
      }
      let advancedStep = false;
      if (pendingAdvance) {
        pendingAdvance = false;
        const index = WIZARD_STEPS.indexOf(activeStep);
        if (
          index >= 0 &&
          index < WIZARD_STEPS.length - 1 &&
          stepIsComplete(activeStep)
        ) {
          activeStep = WIZARD_STEPS[index + 1]!;
          advancedStep = true;
        }
      }
      if (advancedStep) {
        render();
        scrollToWizardTop();
      } else if (
        error === null &&
        activeStep === 'identity' &&
        (options?.silentDom === true || isIdentityInputFocused())
      ) {
        syncIdentityStepDomInPlace();
      } else {
        render();
      }
    }
  }

  function effectiveUnresolved(): DraftResponse['draft']['unresolved'] {
    const raw = current?.draft.unresolved ?? [];
    if (current === null) {
      return raw;
    }
    const hasName = displayChoices().identity.name.trim().length > 0;
    if (hasName) {
      return raw.filter((item) => item.step !== 'identity');
    }
    if (!raw.some((item) => item.step === 'identity')) {
      return [...raw, { step: 'identity', code: 'MISSING_NAME', message: 'Enter a character name.' }];
    }
    return raw;
  }

  function effectiveCanCreate(): boolean {
    if (current === null) {
      return false;
    }
    const hasName = displayChoices().identity.name.trim().length > 0;
    const nonIdentityUnresolved = current.draft.unresolved.some(
      (item) => item.step !== 'identity',
    );
    return hasName && !nonIdentityUnresolved;
  }

  function blockersForStep(step: WizardStep): readonly string[] {
    const hasBg = displayChoices().backgroundId !== null;
    return effectiveUnresolved()
      .filter(
        (item) =>
          item.step === step ||
          (step === 'background' &&
            hasBg &&
            (item.code === 'CLASS_SKILL_COUNT' ||
              item.code === 'CLASS_SKILL_BACKGROUND_OVERLAP')),
      )
      .map((item) => item.message);
  }

  function stepIsComplete(step: WizardStep): boolean {
    return blockersForStep(step).length === 0;
  }

  function stepTrain(): string {
    const draft = current?.draft;
    const activeStage = carouselStageForStep(activeStep);
    const activeIndex = WIZARD_STEPS.indexOf(activeStep);
    const stageSteps = activeStage.steps as readonly WizardStep[];
    const localIndex = stageSteps.indexOf(activeStep);
    return `
      <nav class="wizard-carousel" aria-label="Character creation stages" data-testid="wizard-carousel">
        <ol class="wizard-carousel-stages" data-testid="wizard-carousel-stages">
          ${CAROUSEL_STAGES.map((stage, stageIndex) => {
            const steps = stage.steps as readonly WizardStep[];
            const isActive = stage.id === activeStage.id;
            const done = steps.every((step) => draft?.completedSteps.includes(step) === true);
            const firstStep = steps[0]!;
            const firstIndex = WIZARD_STEPS.indexOf(firstStep);
            const priorComplete =
              firstIndex === 0 ||
              WIZARD_STEPS.slice(0, firstIndex).every(
                (prior) => draft?.completedSteps.includes(prior) === true,
              );
            const allowed = stageIndex === 0 || done || priorComplete || activeIndex >= firstIndex;
            return `
              <li class="${done ? 'done' : ''} ${isActive ? 'active' : ''} ${allowed ? '' : 'locked'}">
                <button type="button" data-carousel-stage="${stage.id}" data-step="${firstStep}"
                  data-testid="carousel-stage-${stage.id}"
                  aria-current="${isActive ? 'step' : 'false'}"
                  aria-disabled="${allowed ? 'false' : 'true'}">
                  <span class="carousel-stage-number">${stageIndex + 1}</span>
                  <span class="carousel-stage-label">${escapeHtml(stage.label)}</span>
                  <span class="carousel-stage-summary">${escapeHtml(stage.summary)}</span>
                </button>
              </li>`;
          }).join('')}
        </ol>
      </nav>
      <div class="wizard-stage-context" data-testid="wizard-stage-context" aria-label="Current stage steps">
        <p class="wizard-stage-context-meta" data-testid="wizard-stage-context-meta">
          ${escapeHtml(activeStage.label)} · Step ${localIndex + 1} of ${stageSteps.length}
        </p>
        <div class="wizard-local-steps" role="group" aria-label="Steps in ${escapeHtml(activeStage.label)}" data-testid="wizard-local-steps">
          ${stageSteps
            .map((step) => {
              const done = draft?.completedSteps.includes(step) === true;
              const isActive = step === activeStep;
              const stepIndex = WIZARD_STEPS.indexOf(step);
              const priorComplete =
                stepIndex === 0 ||
                WIZARD_STEPS.slice(0, stepIndex).every(
                  (prior) => draft?.completedSteps.includes(prior) === true,
                );
              const allowed = stepIndex <= activeIndex || done || priorComplete;
              return `
                <button type="button" class="wizard-local-step${done ? ' done' : ''}${isActive ? ' active' : ''}${allowed ? '' : ' locked'}"
                  data-step="${step}" data-testid="step-${step}"
                  aria-current="${isActive ? 'step' : 'false'}"
                  aria-disabled="${allowed ? 'false' : 'true'}">
                  ${escapeHtml(STEP_TRAIN_LABELS[step])}
                </button>`;
            })
            .join('')}
        </div>
      </div>`;
  }

  function wizardNavStatusMarkup(): string {
    const isLast = activeStep === 'identity';
    const canCreateNow = effectiveCanCreate();
    const blockers = blockersForStep(activeStep);
    return blockers.length === 0
      ? isLast && canCreateNow
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
        </div>`;
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
    const canCreateNow = effectiveCanCreate();
    const navBusy = busy && !silentIdentitySaveInFlight;

    const primary = isLast
      ? `
        <button type="button" data-testid="create-character"
          aria-disabled="${!canCreateNow || navBusy}">
          ${navBusy ? 'Working…' : 'Create Character'}
        </button>`
      : `
        <button type="button" data-testid="wizard-continue"
          aria-disabled="${!complete}">
          ${navBusy && complete ? 'Saving…' : 'Continue'}
        </button>`;

    return `
      <div class="wizard-nav" data-testid="wizard-nav">
        <div data-testid="wizard-nav-status">
          ${wizardNavStatusMarkup()}
        </div>
        <div class="wizard-nav-actions">
          <button type="button" class="secondary" data-testid="wizard-back"
            aria-disabled="${isFirst || navBusy}">
            Back
          </button>
          <button type="button" class="secondary" data-testid="discard-draft" aria-disabled="${navBusy}">
            Discard draft
          </button>
          ${primary}
        </div>
      </div>`;
  }

  function splitBriefAndHoverDetails(summary: string | undefined): {
    readonly brief: string | null;
    readonly details: readonly string[];
  } {
    if (summary === undefined || summary.trim().length === 0) {
      return { brief: null, details: [] };
    }
    const parts = summary
      .split(/\s*·\s*/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length <= 1) {
      return { brief: parts[0] ?? null, details: [] };
    }
    return {
      brief: parts[0] ?? null,
      details: parts.slice(1),
    };
  }

  function optionList(options: {
    readonly name: string;
    readonly testId: string;
    readonly entries: readonly { id: string; label: string; summary?: string }[];
    readonly selected: string | null;
    readonly hoverDetails?: boolean;
  }): string {
    return `
      <div class="option-list option-card-grid" data-testid="${escapeHtml(options.testId)}">
        ${options.entries
          .map((entry) => {
            const { brief, details } = splitBriefAndHoverDetails(entry.summary);
            const showHover =
              details.length > 0 || (options.hoverDetails === true && brief !== null);
            const hoverLines = details.length > 0 ? details : brief !== null ? [brief] : [];
            return `
          <label class="option option-card${options.selected === entry.id ? ' selected' : ''}${showHover ? ' has-breakdown option-with-hover' : ''}" ${showHover ? 'tabindex="0"' : ''}>
            <input type="radio" name="${escapeHtml(options.name)}" value="${escapeHtml(entry.id)}"
              ${options.selected === entry.id ? 'checked' : ''}
              data-testid="option-${escapeHtml(entry.id)}" />
            <span class="option-card-crest" aria-hidden="true">${escapeHtml(entry.label.slice(0, 1))}</span>
            <span class="option-label">${escapeHtml(entry.label)}</span>
            ${brief === null ? '' : `<span class="option-summary">${escapeHtml(brief)}</span>`}
            ${
              showHover
                ? `<span class="stat-tooltip option-hover-tooltip" role="tooltip">
                     <span class="stat-tooltip-title">${escapeHtml(entry.label)} — Details &amp; Stats</span>
                     ${brief !== null && details.length > 0 ? `<span class="tooltip-brief-lead">${escapeHtml(brief)}</span>` : ''}
                     <ul class="stat-breakdown-list">
                       ${hoverLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
                     </ul>
                   </span>`
                : ''
            }
          </label>`;
          })
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
    /** Prefix for per-option test ids (defaults to `check`). */
    readonly optionTestIdPrefix?: string;
    /** When true, renders a hover/focus popup tooltip with the full spell/feature stats & description and hides inline summary text. */
    readonly tooltipSummaries?: boolean;
  }): string {
    const visibleSelected = options.selected.filter((id) =>
      options.entries.some((entry) => entry.id === id),
    );
    const atCap =
      options.maxChoose !== undefined && visibleSelected.length >= options.maxChoose;
    const optionPrefix = options.optionTestIdPrefix ?? 'check';
    return `
      <div class="option-list compact" data-testid="${escapeHtml(options.testId)}">
        ${options.entries
          .map((entry) => {
            const isSelected = visibleSelected.includes(entry.id);
            // Cap still blocks over-select; busy must NOT disable — rapid picks queue via pendingChoices.
            const disabled = atCap && !isSelected;
            const hasTooltip = options.tooltipSummaries === true && entry.summary !== undefined;
            return `
          <label class="option${isSelected ? ' selected' : ''}${disabled ? ' disabled' : ''}${hasTooltip ? ' has-breakdown spell-option-with-tooltip' : ''}" ${hasTooltip ? 'tabindex="0"' : ''}>
            <input type="checkbox" name="${escapeHtml(options.name)}" value="${escapeHtml(entry.id)}"
              ${isSelected ? 'checked' : ''} ${disabled ? 'disabled' : ''}
              data-testid="${escapeHtml(optionPrefix)}-${escapeHtml(entry.id)}" />
            <span class="option-label">${escapeHtml(entry.label)}</span>
            ${
              entry.summary === undefined || options.tooltipSummaries === true
                ? ''
                : `<span class="option-summary">${escapeHtml(entry.summary)}</span>`
            }
            ${
              hasTooltip
                ? `<span class="stat-tooltip spell-hover-tooltip" role="tooltip">
                     <span class="stat-tooltip-title">${escapeHtml(entry.label)}</span>
                     <span>${escapeHtml(entry.summary ?? '')}</span>
                   </span>`
                : ''
            }
          </label>`;
          })
          .join('')}
      </div>`;
  }

  function topQuickStartBanner(): string {
    if (current === null) {
      return '';
    }
    return `
      <div class="wizard-hover-instruction-banner" data-testid="character-hover-instruction-banner" role="note">
        <span class="wizard-hover-badge" aria-hidden="true">Hover for Stats</span>
        <span><b>Tip:</b> Hover over any <b>Class</b>, <b>Background</b>, <b>Species</b>, <b>Sub-option</b>, or <b>Spell</b> card to view its full stat bonuses, proficiencies, traits, and mechanics before you select it.</span>
      </div>
      <div class="wizard-side-actions wizard-top-quick-actions" data-testid="wizard-top-quick-actions">
        <button type="button" class="secondary" data-testid="open-quick-start">
          In a hurry? Use a ready-made character
        </button>
        ${
          tutorialDismissed()
            ? `<button type="button" class="secondary" data-testid="open-tutorial">
                 Character Creation Tour (4 steps)
               </button>`
            : ''
        }
      </div>`;
  }

  function renderClassStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const detail = state.options.classDetail;

    return `
      <p class="step-helper">${escapeHtml(STEP_HELPERS.class)}</p>
      ${optionList({
        name: 'class',
        testId: 'class-options',
        entries: state.options.catalog.classes,
        selected: displayChoices().classId,
      })}
      ${
        detail === null
          ? ''
          : `
        <h3>${escapeHtml(detail.label)} skill proficiencies</h3>
        <p data-testid="class-skill-helper">
          Choose ${detail.skillChoiceCount}. Hit Die d${detail.hitDie}. Saving Throws:
          ${detail.savingThrowProficiencies.map((ability) => escapeHtml(ABILITY_LABELS[ability])).join(', ')}.
          ${
            state.options.backgroundDetail === null
              ? 'Pick your Background next — if it grants a skill you chose here, that class pick will free up for another skill.'
              : `Skills your Background (${escapeHtml(state.options.backgroundDetail.label)}) already grants are omitted so you do not lose a class pick.`
          }
        </p>
        ${checkboxList({
          name: 'class-skill',
          testId: 'class-skill-options',
          entries: detail.skillOptions.filter(
            (skill) =>
              !(state.options.backgroundDetail?.skillIds ?? []).includes(skill.id),
          ),
          selected: displayChoices().classSkillIds,
          maxChoose: detail.skillChoiceCount,
        })}`
      }`;
  }

  function renderBackgroundStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const choices = displayChoices();
    const classSkillIds = choices.classSkillIds ?? [];
    const classSkillLabels = classSkillIds.map((skillId) => {
      const fromClass = state.options.classDetail?.skillOptions.find((entry) => entry.id === skillId);
      return fromClass?.label ?? skillId;
    });
    const detail = state.options.backgroundDetail;
    const bonuses = choices.backgroundAbilityBonuses;
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
      <p class="step-helper" data-testid="background-nav-hint">${escapeHtml(STEP_HELPERS.background)}</p>
      ${
        choices.classId !== null && classSkillIds.length > 0
          ? `<p class="wizard-coach" data-testid="skill-overlap-coach">
               You already picked class skills (${escapeHtml(classSkillLabels.join(', '))}).
               Background skills that match are omitted below so you choose replacements yourself —
               nothing is silently dropped after the fact.
             </p>`
          : `<p class="record-meta" data-testid="skill-overlap-coach-wait">
               Choose a class first if you want overlap guidance before background skills appear.
             </p>`
      }
      ${optionList({
        name: 'background',
        testId: 'background-options',
        entries: state.options.catalog.backgrounds,
        selected: choices.backgroundId,
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
          ${
            state.options.classDetail !== null &&
            classSkillIds.length < state.options.classDetail.skillChoiceCount
              ? `
          <div class="replacement-skill-box" data-testid="background-replacement-skills">
            <h3>Replacement ${escapeHtml(state.options.classDetail.label)} Skills (${classSkillIds.length} of ${state.options.classDetail.skillChoiceCount})</h3>
            <p class="wizard-coach">
              ${escapeHtml(detail.label)} grants ${escapeHtml(detail.skillLabels.join(' and '))} automatically.
              Choose ${state.options.classDetail.skillChoiceCount - classSkillIds.length} replacement ${escapeHtml(state.options.classDetail.label)} skill${
                state.options.classDetail.skillChoiceCount - classSkillIds.length === 1 ? '' : 's'
              } below so you keep all ${state.options.classDetail.skillChoiceCount} class skill picks.
            </p>
            ${checkboxList({
              name: 'class-skill',
              testId: 'class-skill-options',
              entries: state.options.classDetail.skillOptions.filter(
                (skill) => !detail.skillIds.includes(skill.id),
              ),
              selected: classSkillIds,
              maxChoose: state.options.classDetail.skillChoiceCount,
            })}
          </div>`
              : ''
          }
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
    const choices = displayChoices();
    const detail = state.options.speciesDetail;

    return `
      <p class="step-helper">${escapeHtml(STEP_HELPERS.species)}</p>
      ${optionList({
        name: 'species',
        testId: 'species-options',
        entries: state.options.catalog.species,
        selected: choices.speciesId,
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
                choices.speciesChoiceIds[choice.id] === option.id ? ' selected' : ''
              }${option.summary !== undefined ? ' has-breakdown option-with-hover' : ''}" ${
                option.summary !== undefined ? 'tabindex="0"' : ''
              }>
                <input type="radio" name="species-choice-${escapeHtml(choice.id)}"
                  value="${escapeHtml(option.id)}"
                  ${choices.speciesChoiceIds[choice.id] === option.id ? 'checked' : ''}
                  data-species-choice="${escapeHtml(choice.id)}"
                  data-testid="species-choice-${escapeHtml(choice.id)}-${escapeHtml(option.id)}" />
                <span class="option-label">${escapeHtml(option.label)}</span>
                ${
                  option.summary === undefined
                    ? ''
                    : `<span class="stat-tooltip option-hover-tooltip" role="tooltip">
                         <span class="stat-tooltip-title">${escapeHtml(option.label)}</span>
                         <span>${escapeHtml(option.summary)}</span>
                       </span>`
                }
              </label>`,
              )
              .join('')}
          </div>`,
          )
          .join('')}${
        choices.speciesId === 'human' && state.options.originFeatOptions !== null
          ? `
        <h3>Versatile — choose an Origin feat</h3>
        <p class="step-helper">Humans gain one additional Origin feat from the SRD roster. Hover over any feat for its full rules.</p>
        ${optionList({
          name: 'origin-feat',
          testId: 'origin-feat-options',
          entries: state.options.originFeatOptions,
          selected: choices.chosenOriginFeatId,
          hoverDetails: true,
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
      <p>Choose ${options.detail.cantripsKnown} cantrips and ${options.detail.spellsKnown} level 1 spell from the ${escapeHtml(options.detail.label)} list. Hover over any spell to read its stats and description.</p>
      <h4>Cantrips</h4>
      ${checkboxList({
        name: options.cantripName,
        testId: `${options.testIdPrefix}-cantrip-options`,
        entries: options.detail.cantripOptions,
        selected: options.cantripIds,
        maxChoose: options.detail.cantripsKnown,
        tooltipSummaries: true,
      })}
      <h4>Level 1 spell</h4>
      ${checkboxList({
        name: options.spellName,
        testId: `${options.testIdPrefix}-spell-options`,
        entries: options.detail.spellOptions,
        selected: options.spellIds,
        maxChoose: options.detail.spellsKnown,
        tooltipSummaries: true,
      })}`;
  }

  function renderAbilitiesStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const choices = displayChoices();
    const method = choices.abilityMethod;
    const scores = choices.baseAbilityScores;
    const pool = choices.rolledScorePool;
    const attempts = choices.abilityRollAttempts;
    const rollsLeft = Math.max(0, MAX_ABILITY_ROLL_ATTEMPTS - attempts);
    const effectivePointBuyScores: Partial<Record<Ability, number>> =
      method === 'point-buy'
        ? {
            strength: scores.strength ?? 8,
            dexterity: scores.dexterity ?? 8,
            constitution: scores.constitution ?? 8,
            intelligence: scores.intelligence ?? 8,
            wisdom: scores.wisdom ?? 8,
            charisma: scores.charisma ?? 8,
          }
        : scores;
    const assignedList = ABILITIES.map((ability) => effectivePointBuyScores[ability]).filter(
      (score): score is number => score !== undefined,
    );
    const pointBuySpent = pointBuyCost(assignedList) ?? 0;
    const pointBuyRemaining = Math.max(0, POINT_BUY_BUDGET - pointBuySpent);

    return `
      <p class="step-helper">${escapeHtml(STEP_HELPERS.abilities)}</p>
      <h3>Ability-generation method</h3>
      <p>
        Point buy gives you ${POINT_BUY_BUDGET} points to customize your six Ability Scores (starting at 8) with live cost calculations.
        Rolled scores use 4d6 drop lowest — you get ${MAX_ABILITY_ROLL_ATTEMPTS} rolls max, and each new roll replaces the previous one.
      </p>
      ${optionList({
        name: 'ability-method',
        testId: 'ability-method-options',
        entries: [
          {
            id: 'point-buy',
            label: 'Point buy',
            summary: `Spend ${POINT_BUY_BUDGET} points on scores from 8 to 15. Every ability starts at 8 (0 pts), and you see live point costs as you adjust.`,
          },
          {
            id: 'rolled',
            label: 'Roll (4d6 drop lowest)',
            summary: `Up to ${MAX_ABILITY_ROLL_ATTEMPTS} rolls. Each roll replaces the last — earlier pools are gone.`,
          },
        ],
        selected: method === 'standard-array' ? 'point-buy' : method,
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
          ? `<div class="panel point-buy-dashboard" data-testid="point-buy-budget">
              <div class="point-buy-summary-row">
                <span><b>Points left to spend:</b> <strong data-testid="point-buy-remaining">${pointBuyRemaining}</strong> / ${POINT_BUY_BUDGET}</span>
                <span><b>Points spent:</b> ${pointBuySpent} of ${POINT_BUY_BUDGET}. Remaining: ${pointBuyRemaining}.</span>
              </div>
              <p class="record-meta">
                <b>Point Buy Cost Table:</b> Score 8 = 0 pts · 9 = 1 pt · 10 = 2 pts · 11 = 3 pts · 12 = 4 pts · 13 = 5 pts · 14 = 7 pts (+2 pts) · 15 = 9 pts (+2 pts).
              </p>
            </div>`
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
              ? pointBuyScoresForAbility(effectivePointBuyScores, ability)
              : method === 'standard-array'
                ? availableScoresFromPool([...STANDARD_ARRAY], scores, ability)
                : availableScoresFromPool(pool ?? [], scores, ability);
          const current = scores[ability];
          const displayScore = method === 'point-buy' ? (current ?? 8) : current;
          const bgBonus = choices.backgroundAbilityBonuses[ability] ?? 0;
          const totalScore = (displayScore ?? 8) + bgBonus;
          const modLabel = formatModifier(abilityModifier(totalScore));
          const currentCost = POINT_BUY_COSTS[displayScore ?? 8] ?? 0;
          const nextScore = (displayScore ?? 8) + 1;
          const nextCostTotal = POINT_BUY_COSTS[nextScore];
          const nextStepCost =
            nextCostTotal !== undefined ? nextCostTotal - currentCost : null;
          const canIncrement =
            method === 'point-buy' &&
            nextStepCost !== null &&
            nextStepCost <= pointBuyRemaining &&
            nextScore <= 15;
          const prevScore = (displayScore ?? 8) - 1;
          const prevCostTotal = POINT_BUY_COSTS[prevScore];
          const prevStepRefund =
            prevCostTotal !== undefined ? currentCost - prevCostTotal : null;
          const canDecrement = method === 'point-buy' && (displayScore ?? 8) > 8;

          return `
          <div class="ability-assign-card" data-testid="ability-card-${ability}">
            <div class="ability-assign-card-header">
              <span class="ability-assign-title">${escapeHtml(ABILITY_LABELS[ability])}</span>
              ${
                method === 'point-buy'
                  ? `<div class="ability-stepper-row point-buy-stepper-only">
                      <button type="button" class="secondary compact point-buy-step-btn"
                        data-point-buy-ability="${ability}" data-point-buy-delta="-1"
                        data-testid="point-buy-dec-${ability}"
                        ${!canDecrement ? 'disabled' : ''}
                        aria-label="Decrease ${escapeHtml(ABILITY_LABELS[ability])}">−</button>
                      <span class="point-buy-score-badge" data-testid="ability-select-${ability}">${displayScore ?? 8}</span>
                      <button type="button" class="secondary compact point-buy-step-btn"
                        data-point-buy-ability="${ability}" data-point-buy-delta="1"
                        data-testid="point-buy-inc-${ability}"
                        ${!canIncrement ? 'disabled' : ''}
                        aria-label="Increase ${escapeHtml(ABILITY_LABELS[ability])}">+</button>
                    </div>`
                  : `<div class="ability-stepper-row">
                      <select id="ability-select-${ability}" class="compact-ability-select" data-ability="${ability}" data-testid="ability-select-${ability}" aria-label="${escapeHtml(ABILITY_LABELS[ability])}">
                        <option value="">—</option>
                        ${values
                          .map(
                            (score) =>
                              `<option value="${score}" ${displayScore === score ? 'selected' : ''}>${score}</option>`,
                          )
                          .join('')}
                      </select>
                    </div>`
              }
            </div>
            ${
              method === 'point-buy'
                ? `<div class="point-buy-stat-math" data-testid="point-buy-math-${ability}">
                    <span class="record-meta">
                      Base <b>${displayScore ?? 8}</b>${bgBonus > 0 ? ` + Bg <b>+${bgBonus}</b>` : ''} = <b>${totalScore}</b> (${modLabel}) · Spent: <b>${currentCost} pt${currentCost === 1 ? '' : 's'}</b>
                    </span>
                    <span class="record-meta">
                      ${
                        nextStepCost !== null
                          ? canIncrement
                            ? `+1 (to ${nextScore}) costs ${nextStepCost} pt${nextStepCost === 1 ? '' : 's'}`
                            : `+1 (to ${nextScore}) needs ${nextStepCost} pt${nextStepCost === 1 ? '' : 's'} (${pointBuyRemaining} left)`
                          : 'Max base score (15)'
                      }
                      ${
                        prevStepRefund !== null
                          ? ` · −1 refunds ${prevStepRefund} pt${prevStepRefund === 1 ? '' : 's'}`
                          : ' · Min base (8)'
                      }
                    </span>
                  </div>`
                : displayScore !== undefined
                  ? `<span class="record-meta">Base <b>${displayScore}</b>${bgBonus > 0 ? ` + Bg <b>+${bgBonus}</b>` : ''} = <b>${totalScore}</b> (${modLabel})</span>`
                  : ''
            }
          </div>`;
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

    const choices = displayChoices();
    const classKit = classDetail.equipmentOptions.find(
      (option) => option.id === choices.classEquipmentOptionId,
    );
    const backgroundKit = backgroundDetail.equipmentOptions.find(
      (option) => option.id === choices.backgroundEquipmentOptionId,
    );
    const overlapNotes = state.options.kitOverlapNotes;
    const overlapNote =
      classKit === undefined || backgroundKit === undefined || overlapNotes.length === 0
        ? classKit !== undefined && backgroundKit !== undefined
          ? `<p class="wizard-coach" data-testid="equipment-overlap-note">
               Kits chosen. Matching tools keep one set; other shared items show Class + Background totals on the sheet.
             </p>`
          : ''
        : `<div class="wizard-coach" data-testid="equipment-overlap-note">
             <p>Before you continue, kit overlap is calculated as:</p>
             <ul class="record-list">
               ${overlapNotes
                 .map(
                   (note) =>
                     `<li data-testid="equipment-overlap-item"><span class="record-note">${escapeHtml(note)}</span></li>`,
                 )
                 .join('')}
             </ul>
           </div>`;

    return `
      <p class="step-helper">${escapeHtml(STEP_HELPERS.equipment)}</p>
      <h3>${escapeHtml(classDetail.label)} starting equipment</h3>
      ${optionList({
        name: 'class-equipment',
        testId: 'class-equipment-options',
        entries: classDetail.equipmentOptions.map((option) => ({ id: option.id, label: option.label })),
        selected: choices.classEquipmentOptionId,
      })}
      <h3>${escapeHtml(backgroundDetail.label)} starting equipment</h3>
      ${optionList({
        name: 'background-equipment',
        testId: 'background-equipment-options',
        entries: backgroundDetail.equipmentOptions.map((option) => ({ id: option.id, label: option.label })),
        selected: choices.backgroundEquipmentOptionId,
      })}
      ${overlapNote}`;
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
                tooltipSummaries: true,
              })
        }
        <h3>Level 1 Spells</h3>
        <p>Choose ${detail.spellcasting.spellsAvailable} to ${
          detail.spellcasting.preparationStyle === 'prepared' ? 'prepare' : 'know'
        }. Extra spells lock at that count.</p>
        ${
          detail.spellcasting.spellbookSize === null
            ? checkboxList({
                name: 'spell',
                testId: 'spell-options',
                entries: detail.spellcasting.spellOptions,
                selected: state.draft.choices.spellIds,
                maxChoose: detail.spellcasting.spellsAvailable,
                tooltipSummaries: true,
              })
            : `
        <h3>Spellbook</h3>
        <p>Choose ${detail.spellcasting.spellbookSize} spells to record in your spellbook. Prepared spells must come from this list.</p>
        ${checkboxList({
          name: 'spellbook',
          testId: 'spellbook-options',
          entries: detail.spellcasting.spellOptions,
          selected: state.draft.choices.spellbookIds,
          maxChoose: detail.spellcasting.spellbookSize,
          tooltipSummaries: true,
        })}
        <h3>Prepared Spells</h3>
        <p>Choose ${detail.spellcasting.spellsAvailable} spells from your spellbook to prepare today.</p>
        ${
          state.draft.choices.spellbookIds.length === 0
            ? '<p class="empty-state" data-testid="prepared-spells-locked">Choose spellbook spells first.</p>'
            : checkboxList({
                name: 'spell',
                testId: 'spell-options',
                entries: detail.spellcasting.spellOptions.filter((option) =>
                  state.draft.choices.spellbookIds.includes(option.id),
                ),
                selected: state.draft.choices.spellIds,
                maxChoose: detail.spellcasting.spellsAvailable,
                tooltipSummaries: true,
              })
        }`
        }`;

    const requiredPicks = `
      ${
        state.options.expertise === null
          ? ''
          : `
      <section class="panel" data-testid="expertise-panel" aria-labelledby="expertise-heading">
      <h3 id="expertise-heading">Expertise (required)</h3>
      <p class="step-helper" data-testid="expertise-helper">
        Choose exactly ${state.options.expertise.slotCount} skills you are proficient in. Expertise doubles
        your Proficiency Bonus on those skills. You cannot finish this character until these are chosen.
      </p>
      ${
        state.options.expertise.options.length === 0
          ? `<p class="message notice" data-testid="expertise-needs-skills">Finish class and Background skill picks before choosing Expertise.</p>`
          : checkboxList({
              name: 'expertise-skill',
              testId: 'expertise-options',
              optionTestIdPrefix: 'expertise-check',
              entries: state.options.expertise.options,
              selected: state.draft.choices.expertiseSkillIds,
              maxChoose: state.options.expertise.slotCount,
            })
      }
      </section>`
      }
      ${
        state.options.weaponMastery === null
          ? ''
          : `
      <section class="panel" data-testid="weapon-mastery-panel" aria-labelledby="weapon-mastery-heading">
      <h3 id="weapon-mastery-heading">Weapon Mastery (required)</h3>
      <p class="step-helper" data-testid="weapon-mastery-helper">
        Choose exactly ${state.options.weaponMastery.slotCount} weapons you are proficient with. Only
        mastery-capable weapons for ${escapeHtml(detail.label)} are listed.
      </p>
      ${checkboxList({
        name: 'weapon-mastery',
        testId: 'weapon-mastery-options',
        optionTestIdPrefix: 'mastery-check',
        entries: state.options.weaponMastery.options,
        selected: state.draft.choices.weaponMasteryWeaponNames,
        maxChoose: state.options.weaponMastery.slotCount,
      })}
      </section>`
      }`;

    return `
      <h3>${escapeHtml(detail.label)} level 1 features</h3>
      <p class="step-helper">${escapeHtml(STEP_HELPERS.features)}</p>
      ${requiredPicks}
      <ul class="record-list" data-testid="class-feature-list">
        ${detail.features
          .filter(
            (feature) =>
              feature.name !== 'Expertise' && feature.name !== 'Weapon Mastery',
          )
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

  function portraitPromptValue(): string {
    return (
      portraitPromptText ??
      current?.draft.appearancePrompt ??
      displayChoices().identity.appearance ??
      ''
    );
  }

  function renderPortraitSection(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const forged = state.draft.avatarUrl ?? null;
    const avatarOptions = state.draft.avatarOptions ?? (forged !== null ? [forged] : []);
    const portraitForged = state.draft.portraitForged === true || avatarOptions.length > 0;
    const portraitConfirmed = portraitForged && avatarOptions.length <= 1 && forged !== null;
    const promptValue = portraitPromptValue();
    return `
      <section class="panel portrait-section" data-testid="portrait-section" aria-labelledby="portrait-heading">
        <h3 id="portrait-heading">Portrait &amp; Physical Appearance</h3>
        <div class="portrait-section-body">
          ${
            forged !== null
              ? `<img class="portrait-preview" data-testid="portrait-preview" src="${escapeHtml(forged)}"
                  alt="Forged character portrait" width="128" height="128" />`
              : `<div class="portrait-preview portrait-preview-placeholder" data-testid="portrait-preview" role="img" aria-label="Portrait not yet forged">?</div>`
          }
          <div class="portrait-section-fields">
            <label for="character-physical-appearance">Physical Appearance (optional, max ${APPEARANCE_PROMPT_MAX_LENGTH} characters)</label>
            <textarea id="character-physical-appearance" data-testid="identity-physical-appearance"
              rows="3" maxlength="${APPEARANCE_PROMPT_MAX_LENGTH}"
              placeholder="Braided auburn beard, soot-stained leather, a notch in the left ear…"
              ${portraitForged ? 'readonly' : ''}>${escapeHtml(promptValue)}</textarea>
            <p class="record-meta" data-testid="portrait-char-count">${promptValue.length}/${APPEARANCE_PROMPT_MAX_LENGTH}</p>
            <p class="message error" data-testid="portrait-error" role="alert" ${portraitError === null ? 'hidden' : ''}>${escapeHtml(portraitError ?? '')}</p>
            <button type="button" class="button" data-testid="forge-portrait" ${portraitBusy || busy || portraitForged ? 'disabled' : ''}>
              ${
                portraitBusy
                  ? 'Forging 3 Portraits…'
                  : portraitConfirmed
                    ? 'Portrait Confirmed (Final)'
                    : portraitForged
                      ? '3 Portraits Forged — Pick & Confirm 1 Below'
                      : 'Forge Portrait (Generates 3 Choices)'
              }
            </button>
            ${
              avatarOptions.length > 1
                ? `<div class="portrait-options-picker" data-testid="portrait-options-picker">
                    <p class="record-meta"><b>Choose &amp; confirm 1 of your 3 forged portraits:</b> Once you confirm your choice, the other two portraits are discarded and your selection is final.</p>
                    <div class="portrait-options-grid">
                      ${avatarOptions
                        .map(
                          (optionUrl, index) => `
                        <button type="button" class="portrait-option-card${forged === optionUrl ? ' selected' : ''}"
                          data-portrait-option="${escapeHtml(optionUrl)}"
                          data-testid="portrait-option-${index}"
                          aria-pressed="${forged === optionUrl ? 'true' : 'false'}">
                          <img src="${escapeHtml(optionUrl)}" alt="Portrait option ${index + 1}" width="88" height="88" />
                          <span>Confirm Option ${index + 1}</span>
                        </button>`,
                        )
                        .join('')}
                    </div>
                  </div>`
                : portraitConfirmed
                  ? `<p class="record-meta" data-testid="portrait-confirmed-notice">Portrait confirmed and locked (unused options discarded). You can evolve your core portrait when you level up.</p>`
                  : ''
            }
          </div>
        </div>
      </section>`;
  }

  function syncPortraitSectionInPlace(): void {
    const portraitSection = container.querySelector<HTMLElement>('[data-testid="portrait-section"]');
    if (portraitSection !== null) {
      portraitSection.outerHTML = renderPortraitSection();
      bindPortraitSectionEvents();
    }
    const tokenPreview = container.querySelector<HTMLElement>('[data-testid="identity-token-preview"]');
    if (tokenPreview !== null) {
      tokenPreview.innerHTML = renderIdentityTokenPreviewInner();
    }
  }

  async function selectPortraitOption(selectedUrl: string): Promise<void> {
    if (candidate === null || current === null || portraitBusy) {
      return;
    }
    portraitBusy = true;
    portraitError = null;
    syncPortraitSectionInPlace();
    try {
      const choices = displayChoices();
      const result = await generatePortrait({
        candidateId: candidate.candidateId,
        request: {
          appearancePrompt: portraitPromptValue(),
          ancestryId: choices.speciesId,
          classId: choices.classId,
          pronouns: choices.identity.pronouns,
          draftId: current.draft.draftId,
          selectedAvatarUrl: selectedUrl,
        },
      });
      current = {
        ...current,
        draft: {
          ...current.draft,
          avatarUrl: result.avatarUrl,
          ...(result.avatarOptions !== undefined ? { avatarOptions: result.avatarOptions } : {}),
          portraitForged: true,
          appearancePrompt: result.appearancePrompt,
        },
      };
      shell.announce('Portrait choice updated.');
    } catch (failure) {
      portraitError =
        failure instanceof ApiFailure ? failure.message : 'That portrait choice could not be saved.';
    } finally {
      portraitBusy = false;
      syncPortraitSectionInPlace();
    }
  }

  async function forgePortrait(): Promise<boolean> {
    if (candidate === null || current === null) {
      return false;
    }
    const validation = validateAppearancePrompt(portraitPromptValue());
    if (!validation.ok) {
      portraitError = validation.message;
      syncPortraitSectionInPlace();
      return false;
    }
    portraitBusy = true;
    portraitError = null;
    syncPortraitSectionInPlace();
    try {
      const choices = displayChoices();
      const result = await generatePortrait({
        candidateId: candidate.candidateId,
        request: {
          appearancePrompt: validation.text,
          ancestryId: choices.speciesId,
          classId: choices.classId,
          pronouns: choices.identity.pronouns,
          draftId: current.draft.draftId,
        },
      });
      current = {
        ...current,
        draft: {
          ...current.draft,
          avatarUrl: result.avatarUrl,
          ...(result.avatarOptions !== undefined ? { avatarOptions: result.avatarOptions } : {}),
          portraitForged: true,
          appearancePrompt: result.appearancePrompt,
        },
      };
      portraitPromptText = result.appearancePrompt;
      shell.announce(
        result.source === 'generated' ? 'Portrait forged.' : 'Portrait set from the curated archetype gallery.',
      );
      return true;
    } catch (failure) {
      portraitError =
        failure instanceof ApiFailure ? failure.message : 'That portrait could not be forged.';
      return false;
    } finally {
      portraitBusy = false;
      syncPortraitSectionInPlace();
    }
  }

  function renderIdentityReadinessSummaryInner(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const readiness = effectiveUnresolved();
    return `
      <h3 id="readiness-heading">What can this character do?</h3>
      ${
        readiness.length === 0
          ? `<p class="message success" data-testid="readiness-ready">Ready to create — class, background, species, skills, and features are complete.</p>`
          : `<ul class="record-list" data-testid="readiness-blockers">
              ${readiness
                .map(
                  (item) =>
                    `<li data-testid="readiness-blocker" class="unresolved-jump-row">
                      <span>${escapeHtml(item.message)}</span>
                      ${
                        item.step !== 'identity'
                          ? `<button type="button" class="secondary compact" data-goto-step="${escapeHtml(item.step)}" data-testid="goto-step-${escapeHtml(item.step)}">
                              Go to ${escapeHtml(WIZARD_STEP_LABELS[item.step])}
                            </button>`
                          : ''
                      }
                    </li>`,
                )
                .join('')}
            </ul>`
      }`;
  }

  function renderIdentityTokenPreviewInner(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const identity = displayChoices().identity;
    const tokenInitial = identity.name.trim().charAt(0).toUpperCase() || '?';
    return `
      ${
        state.draft.avatarUrl
          ? `<img class="hero-mini-avatar hero-mini-avatar-img" data-testid="identity-token-avatar" src="${escapeHtml(state.draft.avatarUrl)}" alt="" />`
          : `<span class="hero-mini-avatar" aria-hidden="true">${escapeHtml(tokenInitial)}</span>`
      }
      <span class="record-meta">Map token preview</span>`;
  }

  function syncIdentityStepDomInPlace(): void {
    if (current === null || activeStep !== 'identity') {
      return;
    }
    const tokenPreview = container.querySelector<HTMLElement>('[data-testid="identity-token-preview"]');
    if (tokenPreview !== null) {
      tokenPreview.innerHTML = renderIdentityTokenPreviewInner();
    }
    const readinessPanel = container.querySelector<HTMLElement>(
      '[data-testid="character-readiness-summary"]',
    );
    if (readinessPanel !== null) {
      readinessPanel.innerHTML = renderIdentityReadinessSummaryInner();
      readinessPanel.querySelectorAll<HTMLButtonElement>('[data-goto-step]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.dataset.gotoStep as WizardStep;
          if (!WIZARD_STEPS.includes(target) || busy) {
            return;
          }
          activeStep = target;
          error = null;
          render();
          scrollToWizardTop();
        });
      });
    }
    const navStatusEl = container.querySelector<HTMLElement>('[data-testid="wizard-nav-status"]');
    if (navStatusEl !== null) {
      navStatusEl.innerHTML = wizardNavStatusMarkup();
    }
    const createBtn = container.querySelector<HTMLButtonElement>('[data-testid="create-character"]');
    if (createBtn !== null) {
      const navBusy = busy && !silentIdentitySaveInFlight;
      createBtn.setAttribute('aria-disabled', String(!effectiveCanCreate() || navBusy));
      createBtn.textContent = navBusy ? 'Working…' : 'Create Character';
    }
    const previewEl = container.querySelector<HTMLElement>('[data-testid="wizard-sheet-preview"]');
    if (previewEl !== null) {
      previewEl.outerHTML = liveSheetPreview();
    }
  }

  function renderIdentityStep(): string {
    const state = current;
    if (state === null) {
      return '';
    }
    const identity = displayChoices().identity;
    const nameMax = CHARACTER_NAME_MAX_LENGTH;

    return `
      <p class="step-helper">${escapeHtml(STEP_HELPERS.identity)}</p>
      <p class="record-meta" data-testid="identity-autosave-notice">
        Identity fields save automatically after you pause typing.
      </p>
      <div class="identity-token-preview" data-testid="identity-token-preview" aria-live="polite">
        ${renderIdentityTokenPreviewInner()}
      </div>
      <label for="character-name">Character name (required, max ${nameMax} characters)</label>
      <input id="character-name" type="text" data-identity="name" data-testid="identity-name"
        maxlength="${nameMax}" aria-label="Character name"
        value="${escapeHtml(identity.name)}" autocomplete="off" placeholder="Something the bard can pronounce" />
      <label for="character-pronouns">Pronouns (optional)</label>
      <input id="character-pronouns" type="text" data-identity="pronouns" data-testid="identity-pronouns"
        maxlength="${CHARACTER_TEXT_MAX_LENGTH}" aria-label="Pronouns"
        value="${escapeHtml(identity.pronouns)}" autocomplete="off" placeholder="Optional" />
      <label for="character-concept">Concept (optional)</label>
      <input id="character-concept" type="text" data-identity="concept" data-testid="identity-concept"
        maxlength="${CHARACTER_TEXT_MAX_LENGTH}" aria-label="Concept"
        value="${escapeHtml(identity.concept)}" autocomplete="off" placeholder="Optional one-liner" />

      ${renderPortraitSection()}

      <section class="panel" data-testid="character-readiness-summary" aria-labelledby="readiness-heading">
        ${renderIdentityReadinessSummaryInner()}
      </section>

      <h3>Final review</h3>
      ${
        state.draft.unresolved.some((item) => item.step !== 'identity')
          ? `<p class="message notice" data-testid="final-review-incomplete">
              Mechanics are still incomplete. Click any button below to jump straight to that step and fix it.
            </p>
            <ul class="record-list" data-testid="final-review-unresolved">
              ${state.draft.unresolved
                .filter((item) => item.step !== 'identity')
                .map(
                  (item) =>
                    `<li data-testid="final-review-unresolved-item" class="unresolved-jump-row">
                      <span>${escapeHtml(item.message)}</span>
                      <button type="button" class="secondary compact" data-goto-step="${escapeHtml(item.step)}">
                        Fix in ${escapeHtml(WIZARD_STEP_LABELS[item.step])}
                      </button>
                    </li>`,
                )
                .join('')}
            </ul>`
          : ''
      }
      ${
        state.draft.sheet === null
          ? '<p class="empty-state">Finish Class, Background, and Species to preview the sheet.</p>'
          : renderCharacterSheet(state.draft.sheet, { interactive: true })
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
    const choices = displayChoices();
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
                  (ability) => choices.baseAbilityScores[ability] !== undefined,
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
    if (tutorialDismissed() || tutorialOpen || current === null || activeStep !== 'class') {
      return '';
    }
    return `
      <div class="message notice" data-testid="tutorial-ask" role="region" aria-label="Character Creation Tour offer">
        <span><b>Character Creation Tour:</b> New to building an adventurer? This 4-step tour walks through Class, Background, Species, and Ability Scores (separate from the Home page platform tour).</span>
        <div class="actions message-actions">
          <button type="button" data-testid="tutorial-ask-yes">Show me the character creation tour</button>
          <button type="button" class="secondary" data-testid="tutorial-ask-no">No thanks</button>
        </div>
      </div>`;
  }

  function bindWizardNavActions(): void {
    container
      .querySelector<HTMLButtonElement>('[data-testid="wizard-back"]')
      ?.addEventListener('click', () => {
        const index = WIZARD_STEPS.indexOf(activeStep);
        if (index <= 0 || busy) {
          return;
        }
        activeStep = WIZARD_STEPS[index - 1]!;
        render();
        scrollToWizardTop();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="wizard-continue"]')
      ?.addEventListener('click', () => {
        const index = WIZARD_STEPS.indexOf(activeStep);
        if (index < 0 || index >= WIZARD_STEPS.length - 1) {
          return;
        }
        if (busy) {
          pendingAdvance = true;
          return;
        }
        if (!stepIsComplete(activeStep)) {
          return;
        }
        activeStep = WIZARD_STEPS[index + 1]!;
        render();
        scrollToWizardTop();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="create-character"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (identityDebounceTimer !== null) {
            window.clearTimeout(identityDebounceTimer);
            identityDebounceTimer = null;
          }
          if (activeSavePromise !== null) {
            await activeSavePromise;
          }
          if (candidate === null || current === null || busy) {
            return;
          }
          // Flush visible identity fields before create so a typed name that has
          // not yet fired `change` still counts (and avoid a blur→save race).
          const foundation = latestChoices();
          const identity: {
            -readonly [K in keyof CharacterChoices['identity']]: CharacterChoices['identity'][K];
          } = {
            ...foundation.identity,
            ...(localIdentityDraft ?? {}),
          };
          container.querySelectorAll<HTMLInputElement>('[data-identity]').forEach((fieldInput) => {
            const field = fieldInput.dataset.identity as keyof CharacterChoices['identity'];
            identity[field] = fieldInput.value;
          });
          const physEl = container.querySelector<HTMLTextAreaElement>(
            '[data-testid="identity-physical-appearance"]',
          );
          if (physEl !== null) {
            identity.appearance = physEl.value.slice(0, CHARACTER_TEXT_MAX_LENGTH);
          }
          if (
            identity.name !== foundation.identity.name ||
            identity.pronouns !== foundation.identity.pronouns ||
            identity.appearance !== foundation.identity.appearance ||
            identity.concept !== foundation.identity.concept
          ) {
            await commitChoices({ ...foundation, identity }, { silentDom: true });
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
          const pendingPrompt = portraitPromptValue().trim();
          if (
            current.draft.avatarUrl === null ||
            current.draft.avatarUrl === undefined
          ) {
            if (pendingPrompt.length > 0 && !(await forgePortrait()) && portraitError !== null) {
              error = portraitError;
              render();
              return;
            }
          }
          if (current === null) {
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
            if (!isPageMountCurrent(container, mountToken)) {
              return;
            }
            shell.announce(`${character.identity.name} created.`);
            const params = new URLSearchParams(window.location.search);
            const returnCampaign = params.get('returnCampaign');
            const returnTo = params.get('returnTo');
            if (
              returnCampaign !== null &&
              /^[A-Za-z0-9-]{1,64}$/.test(returnCampaign) &&
              returnCampaign !== 'new'
            ) {
              const targetPath =
                returnTo === 'join'
                  ? `/campaigns/${returnCampaign}/join?seatCharacter=${encodeURIComponent(character.characterId)}`
                  : `/campaigns/${returnCampaign}?seatCharacter=${encodeURIComponent(character.characterId)}`;
              navigate(targetPath);
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
            if (!isPageMountCurrent(container, mountToken)) {
              return;
            }
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
        scrollToWizardTop();
      });
    });

    bindWizardNavActions();

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
            const template = current.options.quickStartTemplates.find(
              (entry) => entry.id === input.value,
            );
            current = await applyQuickStartTemplate({
              candidateId: candidate.candidateId,
              draftId: current.draft.draftId,
              templateId: input.value,
            });
            localIdentityDraft = null;
            activeStep = 'identity';
            quickStartAppliedNotice = template
              ? `${template.label} prefilled Class, Species, Background, Abilities, Gear, and Features. Rename at Identity — every choice stays editable.`
              : 'Ready-made choices were applied. Rename at Identity — every choice stays editable.';
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
        'origin-feat',
        (value) => ({
          ...latestChoices(),
          chosenOriginFeatId: value,
          originFeatCantripIds: [],
          originFeatSpellIds: [],
        }),
      ],
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

    container.querySelectorAll<HTMLInputElement>('input[name="class"]').forEach((input) => {
      input.addEventListener('change', () => {
        void (async () => {
          const foundation = latestChoices();
          if (
            foundation.classId !== null &&
            foundation.classId !== input.value &&
            hasDownstreamFromClass(foundation)
          ) {
            const accepted = await confirmInApp({
              title: 'Change class?',
              body: 'Changing your class clears later choices such as skills, spells, equipment, and ability scores.',
              confirmLabel: 'Change class',
              cancelLabel: 'Keep class',
              testId: 'confirm-class-change',
            });
            if (!accepted) {
              render();
              return;
            }
          }
          await commitChoices({
            ...foundation,
            classId: input.value,
            classSkillIds: [],
            classChoiceIds: {},
            classEquipmentOptionId: null,
            cantripIds: [],
            spellbookIds: [],
            spellIds: [],
          });
        })();
      });
    });

    container.querySelectorAll<HTMLInputElement>('input[name="background"]').forEach((input) => {
      input.addEventListener('change', () => {
        void (async () => {
          const foundation = latestChoices();
          if (
            foundation.backgroundId !== null &&
            foundation.backgroundId !== input.value &&
            hasDownstreamFromBackground(foundation)
          ) {
            const accepted = await confirmInApp({
              title: 'Change background?',
              body: 'Changing your background clears later choices such as ability bonuses, background equipment, and species.',
              confirmLabel: 'Change background',
              cancelLabel: 'Keep background',
              testId: 'confirm-background-change',
            });
            if (!accepted) {
              render();
              return;
            }
          }
          backgroundBonusPattern = null;
          backgroundPlusTwo = '';
          backgroundPlusOne = '';
          await commitChoices({
            ...foundation,
            backgroundId: input.value,
            backgroundAbilityBonuses: {},
            backgroundEquipmentOptionId: null,
            backgroundFeatCantripIds: [],
            backgroundFeatSpellIds: [],
          });
        })();
      });
    });

    container.querySelectorAll<HTMLInputElement>('input[name="species"]').forEach((input) => {
      input.addEventListener('change', () => {
        void (async () => {
          const foundation = latestChoices();
          if (
            foundation.speciesId !== null &&
            foundation.speciesId !== input.value &&
            hasDownstreamFromSpecies(foundation)
          ) {
            const accepted = await confirmInApp({
              title: 'Change species?',
              body: 'Changing your species clears later choices such as lineage options, origin feats, and ability scores.',
              confirmLabel: 'Change species',
              cancelLabel: 'Keep species',
              testId: 'confirm-species-change',
            });
            if (!accepted) {
              render();
              return;
            }
          }
          await commitChoices({
            ...foundation,
            speciesId: input.value,
            speciesChoiceIds: {},
            chosenOriginFeatId: null,
            originFeatCantripIds: [],
            originFeatSpellIds: [],
          });
        })();
      });
    });

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
        // Drop Expertise picks that are no longer among proficient skills.
        const backgroundSkills = state.options.backgroundDetail?.skillIds ?? [];
        const proficient = new Set([...selected, ...backgroundSkills]);
        const expertiseSkillIds = foundation.expertiseSkillIds.filter((id) => proficient.has(id));
        void commitChoices({ ...foundation, classSkillIds: selected, expertiseSkillIds });
      });
    });

    container.querySelectorAll<HTMLInputElement>('input[name="expertise-skill"]').forEach((input) => {
      input.addEventListener('change', () => {
        const foundation = latestChoices();
        const max = state.options.expertise?.slotCount;
        let selected = [
          ...container.querySelectorAll<HTMLInputElement>('input[name="expertise-skill"]:checked'),
        ].map((checked) => checked.value);
        if (max !== undefined && selected.length > max) {
          selected = selected.slice(0, max);
        }
        void commitChoices({ ...foundation, expertiseSkillIds: selected });
      });
    });

    for (const [name, key, maxOf] of [
      ['cantrip', 'cantripIds', () => state.options.classDetail?.spellcasting?.cantripsKnown],
      ['spellbook', 'spellbookIds', () => state.options.classDetail?.spellcasting?.spellbookSize ?? undefined],
      ['spell', 'spellIds', () => state.options.classDetail?.spellcasting?.spellsAvailable],
      ['background-feat-cantrip', 'backgroundFeatCantripIds', () => state.options.backgroundFeatDetail?.cantripsKnown],
      ['background-feat-spell', 'backgroundFeatSpellIds', () => state.options.backgroundFeatDetail?.spellsKnown],
      ['origin-feat-cantrip', 'originFeatCantripIds', () => state.options.originFeatDetail?.cantripsKnown],
      ['origin-feat-spell', 'originFeatSpellIds', () => state.options.originFeatDetail?.spellsKnown],
      ['weapon-mastery', 'weaponMasteryWeaponNames', () => state.options.weaponMastery?.slotCount],
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
          if (key === 'spellbookIds') {
            const spellbookSet = new Set(selected);
            const prepared = foundation.spellIds.filter((id) => spellbookSet.has(id));
            void commitChoices({ ...foundation, spellbookIds: selected, spellIds: prepared });
            return;
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
      const applyOptimisticIdentityField = (
        field: keyof CharacterChoices['identity'],
        value: string,
      ): void => {
        if (current === null) {
          return;
        }
        const foundation = latestChoices();
        localIdentityDraft = {
          ...foundation.identity,
          ...(localIdentityDraft ?? {}),
          [field]: value,
        };
        syncIdentityStepDomInPlace();
      };
      const persistIdentity = (): void => {
        if (identityDebounceTimer !== null) {
          window.clearTimeout(identityDebounceTimer);
          identityDebounceTimer = null;
        }
        if (current === null || !isPageMountCurrent(container, mountToken)) {
          return;
        }
        const field = input.dataset.identity as keyof CharacterChoices['identity'];
        const foundation = latestChoices();
        const nextIdentity: CharacterChoices['identity'] = {
          ...foundation.identity,
          ...(localIdentityDraft ?? {}),
          [field]: input.value,
        };
        localIdentityDraft = nextIdentity;
        if (
          nextIdentity.name === foundation.identity.name &&
          nextIdentity.pronouns === foundation.identity.pronouns &&
          nextIdentity.appearance === foundation.identity.appearance &&
          nextIdentity.concept === foundation.identity.concept
        ) {
          return;
        }
        void commitChoices(
          {
            ...foundation,
            identity: nextIdentity,
          },
          { silentDom: true },
        );
      };
      input.addEventListener('input', () => {
        const field = input.dataset.identity as keyof CharacterChoices['identity'];
        applyOptimisticIdentityField(field, input.value);
        if (identityDebounceTimer !== null) {
          window.clearTimeout(identityDebounceTimer);
        }
        identityDebounceTimer = window.setTimeout(persistIdentity, 300);
      });
      input.addEventListener('change', persistIdentity);
    });

    const physicalAppearance = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="identity-physical-appearance"]',
    );
    physicalAppearance?.addEventListener('input', () => {
      portraitPromptText = physicalAppearance.value;
      const validation = validateAppearancePrompt(physicalAppearance.value);
      const errorNode = container.querySelector<HTMLElement>('[data-testid="portrait-error"]');
      const countNode = container.querySelector<HTMLElement>('[data-testid="portrait-char-count"]');
      if (countNode !== null) {
        countNode.textContent = `${physicalAppearance.value.length}/${APPEARANCE_PROMPT_MAX_LENGTH}`;
      }
      portraitError = validation.ok ? null : validation.message;
      if (errorNode !== null) {
        errorNode.textContent = portraitError ?? '';
        errorNode.hidden = portraitError === null;
      }
      if (identityDebounceTimer !== null) {
        window.clearTimeout(identityDebounceTimer);
      }
      identityDebounceTimer = window.setTimeout(() => {
        if (current === null || !isPageMountCurrent(container, mountToken)) {
          return;
        }
        const foundation = latestChoices();
        const trimmedAppearance = physicalAppearance.value.slice(0, CHARACTER_TEXT_MAX_LENGTH);
        if (foundation.identity.appearance === trimmedAppearance) {
          return;
        }
        void commitChoices(
          {
            ...foundation,
            identity: { ...foundation.identity, appearance: trimmedAppearance },
          },
          { silentDom: true },
        );
      }, 400);
    });
    container
      .querySelector<HTMLButtonElement>('[data-testid="forge-portrait"]')
      ?.addEventListener('click', () => {
        void forgePortrait();
      });
    container.querySelectorAll<HTMLButtonElement>('[data-portrait-option]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const optionUrl = btn.dataset.portraitOption ?? '';
        if (optionUrl.length > 0) {
          void selectPortraitOption(optionUrl);
        }
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-point-buy-ability]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const foundation = latestChoices();
        const ability = btn.dataset.pointBuyAbility as Ability;
        const delta = Number(btn.dataset.pointBuyDelta ?? '0');
        if (!ABILITIES.includes(ability) || (delta !== 1 && delta !== -1)) {
          return;
        }
        const scores: Partial<Record<Ability, number>> = {};
        for (const ab of ABILITIES) {
          scores[ab] = foundation.baseAbilityScores[ab] ?? 8;
        }
        const currentScore = scores[ability] ?? 8;
        const nextScore = currentScore + delta;
        const legal = pointBuyScoresForAbility(scores, ability);
        if (!legal.includes(nextScore)) {
          return;
        }
        scores[ability] = nextScore;
        void commitChoices({
          ...foundation,
          abilityMethod: 'point-buy',
          baseAbilityScores: scores,
        });
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-goto-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.gotoStep as WizardStep;
        if (!WIZARD_STEPS.includes(target) || busy) {
          return;
        }
        activeStep = target;
        error = null;
        render();
        scrollToWizardTop();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-sheet-equip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemName = btn.dataset.equipItemName ?? '';
        if (itemName.length === 0 || busy) {
          return;
        }
        const foundation = latestChoices();
        const currentUnequipped = new Set(foundation.unequippedItemNames ?? []);
        if (currentUnequipped.has(itemName)) {
          currentUnequipped.delete(itemName);
        } else {
          currentUnequipped.add(itemName);
        }
        void commitChoices({
          ...foundation,
          unequippedItemNames: [...currentUnequipped],
        });
      });
    });
  }

  function bindPortraitSectionEvents(): void {
    const physicalAppearance = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="identity-physical-appearance"]',
    );
    physicalAppearance?.addEventListener('input', () => {
      portraitPromptText = physicalAppearance.value;
      const validation = validateAppearancePrompt(physicalAppearance.value);
      const errorNode = container.querySelector<HTMLElement>('[data-testid="portrait-error"]');
      const countNode = container.querySelector<HTMLElement>('[data-testid="portrait-char-count"]');
      if (countNode !== null) {
        countNode.textContent = `${physicalAppearance.value.length}/${APPEARANCE_PROMPT_MAX_LENGTH}`;
      }
      portraitError = validation.ok ? null : validation.message;
      if (errorNode !== null) {
        errorNode.textContent = portraitError ?? '';
        errorNode.hidden = portraitError === null;
      }
      if (identityDebounceTimer !== null) {
        window.clearTimeout(identityDebounceTimer);
      }
      identityDebounceTimer = window.setTimeout(() => {
        if (current === null || !isPageMountCurrent(container, mountToken)) {
          return;
        }
        const foundation = latestChoices();
        const trimmedAppearance = physicalAppearance.value.slice(0, CHARACTER_TEXT_MAX_LENGTH);
        if (foundation.identity.appearance === trimmedAppearance) {
          return;
        }
        void commitChoices(
          {
            ...foundation,
            identity: { ...foundation.identity, appearance: trimmedAppearance },
          },
          { silentDom: true },
        );
      }, 400);
    });
    container
      .querySelector<HTMLButtonElement>('[data-testid="forge-portrait"]')
      ?.addEventListener('click', () => {
        void forgePortrait();
      });
    container.querySelectorAll<HTMLButtonElement>('[data-portrait-option]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const optionUrl = btn.dataset.portraitOption ?? '';
        if (optionUrl.length > 0) {
          void selectPortraitOption(optionUrl);
        }
      });
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
        if (
          restored instanceof HTMLInputElement &&
          (restored.type === 'radio' || restored.type === 'checkbox')
        ) {
          // Do not re-focus radio/checkbox inputs after click so hover/focus tooltips dismiss cleanly.
          return;
        }
        restored.focus({ preventScroll: true });
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
      if (
        match instanceof HTMLInputElement &&
        (match.type === 'radio' || match.type === 'checkbox')
      ) {
        return;
      }
      match?.focus({ preventScroll: true });
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
          void loadLegalThenDraft();
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

    if (legalGateLoading) {
      container.innerHTML = `
        <div class="page page-wide">
          <h1 data-testid="create-heading">Create a character</h1>
          <p class="tagline">Checking legal acceptance…</p>
        </div>`;
      return;
    }

    if (isLegalPlayBlocked(legalAcceptance)) {
      container.innerHTML = renderLegalPlayGatePage({
        title: 'Create a character',
        body: 'Character creation opens after you accept every current legal document.',
        acceptance: legalAcceptance,
        candidate,
        busy: legalGateBusy,
        error: legalGateError,
      });
      bindLegalPlayGatePage({
        container,
        shell,
        candidate,
        getAcceptance: () => legalAcceptance,
        setAcceptance: (next) => {
          legalAcceptance = next;
        },
        onUnblocked: () => {
          void openOwnedDraft();
        },
        setBusy: (value) => {
          legalGateBusy = value;
        },
        setError: (message) => {
          legalGateError = message;
        },
        render,
      });
      return;
    }

    const state = current;
    const focus = captureFocus();
    const savedScrollY = window.scrollY;

    const errorMarkup =
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
           }`;
    const topBannersMarkup = `
      ${errorMarkup}
      ${tutorialAskBanner()}
      ${topQuickStartBanner()}
      ${state === null && error === null ? '<p class="empty-state">Opening your draft…</p>' : ''}`;
    const stepTrainMarkup = state === null ? '' : stepTrain();
    const stepHeaderMarkup =
      state === null
        ? ''
        : `<p class="carousel-stage-kicker" data-testid="carousel-stage-kicker">${escapeHtml(carouselStageForStep(activeStep).label)} · ${escapeHtml(carouselStageForStep(activeStep).summary)}</p>
           ${
             quickStartAppliedNotice === null
               ? ''
               : `<div class="message success" role="status" data-testid="quick-start-applied-notice">${escapeHtml(quickStartAppliedNotice)}</div>`
           }
           <h2 id="step-heading" data-testid="active-step-heading" tabindex="-1">${escapeHtml(WIZARD_STEP_LABELS[activeStep])}</h2>`;
    const stepBodyMarkup = state === null ? '' : renderStepBody();
    const stepNavMarkup = state === null ? '' : wizardNav();
    const previewMarkup = state === null || activeStep === 'identity' ? '' : liveSheetPreview();
    const layoutMarkup =
      state === null
        ? ''
        : `
        <div class="wizard-layout wizard-carousel-layout${activeStep === 'identity' ? ' wizard-carousel-layout--identity' : ''}" data-slot="wizard-layout-root">
          <section class="panel wizard-step-panel wizard-carousel-panel" aria-labelledby="step-heading" data-testid="wizard-carousel-panel">
            <div data-slot="wizard-step-header">${stepHeaderMarkup}</div>
            <div data-slot="wizard-step-body">${stepBodyMarkup}</div>
            <div data-slot="wizard-nav">${stepNavMarkup}</div>
          </section>
          <div data-slot="wizard-preview">${previewMarkup}</div>
        </div>`;
    const modalsMarkup = `${quickStartModal()}${tutorialModal()}`;

    const existingPage = container.querySelector<HTMLElement>('.create-carousel-page');
    const bannersSlot = existingPage?.querySelector<HTMLElement>('[data-slot="create-top-banners"]') ?? null;
    const stepTrainSlot = existingPage?.querySelector<HTMLElement>('[data-slot="create-step-train"]') ?? null;
    const layoutSlot = existingPage?.querySelector<HTMLElement>('[data-slot="create-layout"]') ?? null;
    const modalsSlot = existingPage?.querySelector<HTMLElement>('[data-slot="create-modals"]') ?? null;

    if (
      existingPage !== null &&
      bannersSlot !== null &&
      stepTrainSlot !== null &&
      layoutSlot !== null &&
      modalsSlot !== null
    ) {
      bannersSlot.innerHTML = topBannersMarkup;
      stepTrainSlot.innerHTML = stepTrainMarkup;
      const existingLayoutRoot = layoutSlot.querySelector<HTMLElement>('[data-slot="wizard-layout-root"]');
      const stepHeaderSlot = existingLayoutRoot?.querySelector<HTMLElement>('[data-slot="wizard-step-header"]') ?? null;
      const stepBodySlot = existingLayoutRoot?.querySelector<HTMLElement>('[data-slot="wizard-step-body"]') ?? null;
      const stepNavSlot = existingLayoutRoot?.querySelector<HTMLElement>('[data-slot="wizard-nav"]') ?? null;
      const previewSlot = existingLayoutRoot?.querySelector<HTMLElement>('[data-slot="wizard-preview"]') ?? null;

      if (
        state !== null &&
        existingLayoutRoot !== null &&
        stepHeaderSlot !== null &&
        stepBodySlot !== null &&
        stepNavSlot !== null &&
        previewSlot !== null
      ) {
        existingLayoutRoot.classList.toggle('wizard-carousel-layout--identity', activeStep === 'identity');
        stepHeaderSlot.innerHTML = stepHeaderMarkup;
        stepBodySlot.innerHTML = stepBodyMarkup;
        stepNavSlot.innerHTML = stepNavMarkup;
        previewSlot.innerHTML = previewMarkup;
      } else {
        layoutSlot.innerHTML = layoutMarkup;
      }
      modalsSlot.innerHTML = modalsMarkup;
    } else {
      container.innerHTML = `
        <div class="page page-wide create-carousel-page">
          <h1 data-testid="create-heading">Create a character</h1>
          <p class="tagline">
            Progress through three stages — Archetype, Foundation, and Identity. Local steps sit under the active stage.
          </p>
          <p class="wizard-coach" data-testid="one-draft-disclosure">
            Alpha keeps one draft at a time. Starting a new character from the Vault discards this draft
            after you confirm.
          </p>
          <div data-slot="create-top-banners">${topBannersMarkup}</div>
          <div data-slot="create-step-train">${stepTrainMarkup}</div>
          <div data-slot="create-layout">${layoutMarkup}</div>
          <div data-slot="create-modals">${modalsMarkup}</div>
        </div>`;
    }

    container
      .querySelector<HTMLButtonElement>('[data-testid="retry-open-draft"]')
      ?.addEventListener('click', () => {
        error = null;
        void openOwnedDraft();
      });

    bindEvents();
    restoreFocus(focus);
    if (Math.abs(window.scrollY - savedScrollY) > 2) {
      window.scrollTo(0, savedScrollY);
    }
  }

  async function loadLegalThenDraft(): Promise<void> {
    if (getAccount() === null) {
      render();
      return;
    }
    legalGateLoading = true;
    render();
    legalAcceptance = await loadLegalPlayAcceptance();
    legalGateLoading = false;
    if (isLegalPlayBlocked(legalAcceptance)) {
      render();
      return;
    }
    await openOwnedDraft();
  }

  render();

  const unsubscribeAccount = subscribeAccount(() => {
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
      void loadLegalThenDraft();
    }
  });
  registerPageCleanup(container, mountToken, unsubscribeAccount);

  void loadLegalThenDraft();
}
