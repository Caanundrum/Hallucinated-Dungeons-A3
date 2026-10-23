/**
 * Campaign creation with explicit Veyra/Garrick and personality selection.
 *
 * Blueprint ownership: Section 1.5.21 / 7.5. Identity is chosen first;
 * personality only after that; Seasoned Host may be recommended but
 * never silently selected. A preview (identity, personality, sample scene,
 * play rhythm) must appear before create. Both Director choices lock after
 * creation.
 */

import {
  CAMPAIGN_NAME_MAX_LENGTH,
  CAMPAIGN_PREMISE_MAX_LENGTH,
  CAMPAIGN_SUMMARY_MAX_LENGTH,
  CAMPAIGN_TONE_LABELS,
  CAMPAIGN_TONES,
  CAMPAIGN_VISIBILITY,
  CAMPAIGN_VISIBILITY_LABELS,
  DIRECTOR_CREATION_PREVIEW,
  DIRECTOR_IDENTITY_LABELS,
  DIRECTOR_PERSONALITY_LABELS,
  directorAvatarKey,
  isCampaignTone,
  isCampaignVisibility,
  isDirectorIdentity,
  isDirectorPersonality,
} from '../../shared/campaign-contract.js';
import type {
  CampaignBlueprint,
  CampaignTone,
  CampaignVisibility,
  DirectorCatalog,
  DirectorIdentity,
  DirectorPersonality,
} from '../../shared/campaign-contract.js';
import { bindDirectorAvatarFallback, directorAvatarMarkup } from '../director-avatars.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import {
  ApiFailure,
  createCampaign,
  draftCampaignBlueprint,
  fetchDirectorCatalog,
} from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent, registerPageCleanup } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

const STOP_PROPER_WORDS = new Set([
  'The',
  'A',
  'An',
  'In',
  'On',
  'At',
  'By',
  'For',
  'With',
  'From',
  'Into',
  'Near',
  'Before',
  'After',
  'Under',
  'Over',
  'Through',
  'When',
  'Where',
  'While',
  'Example',
]);

/** Lightweight premise fact chips for create UX (generalized entity/location/quest extraction). */
function premiseCommittedFactsMarkup(premise: string): string {
  const text = premise.trim();
  if (text.length === 0) {
    return `<p class="record-meta" data-testid="premise-committed-facts-empty">Committed premise facts will appear here as you type.</p>`;
  }
  const facts: string[] = [];
  const lower = text.toLowerCase();
  if (/\b(canal|dock|ferry|waterfront|harbor|harbour|marsh|crypt|keep|sanctum|forest|citadel|archive|ruins)\b/.test(lower)) {
    const locMatch = lower.match(
      /\b(canal|dock|ferry|waterfront|harbor|harbour|marsh|crypt|keep|sanctum|forest|citadel|archive|ruins)\b/,
    );
    if (locMatch?.[1]) {
      facts.push(`Location: ${locMatch[1]}`);
    }
  }
  if (/\b(courier|package|missive|parcel|relic|artifact|missing|stolen|siege|curse|ritual)\b/.test(lower)) {
    const questMatch = lower.match(
      /\b(courier|package|missive|parcel|relic|artifact|missing|stolen|siege|curse|ritual)\b/,
    );
    if (questMatch?.[1]) {
      facts.push(`Quest hook: ${questMatch[1]}`);
    }
  }
  const properMatches = text.matchAll(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2})\b/g);
  const seenProper = new Set<string>();
  for (const match of properMatches) {
    const candidate = match[1]?.trim() ?? '';
    if (
      candidate.length > 2 &&
      !STOP_PROPER_WORDS.has(candidate) &&
      !seenProper.has(candidate.toLowerCase())
    ) {
      seenProper.add(candidate.toLowerCase());
      facts.push(`Named: ${candidate}`);
      if (seenProper.size >= 4) {
        break;
      }
    }
  }
  const propMatches = text.matchAll(
    /\b((?:broken|locked|ancient|silver|iron|red|sealed|gilded|cracked|rusty)\s+(?:[a-z]+\s+)?(?:lantern|door|warehouse|gate|chest|altar|key|satchel|blade|scroll|tome))\b/gi,
  );
  for (const match of propMatches) {
    const prop = match[1]?.trim() ?? '';
    if (prop.length > 0 && !seenProper.has(prop.toLowerCase())) {
      seenProper.add(prop.toLowerCase());
      facts.push(`Notable detail: ${prop}`);
    }
  }
  if (facts.length === 0) {
    return `<p class="record-meta" data-testid="premise-committed-facts-empty">No named location, quest hook, or entities detected yet.</p>`;
  }
  return `<ul class="record-list" data-testid="premise-committed-facts">${facts
    .map((fact) => `<li data-testid="premise-committed-fact">${escapeHtml(fact)}</li>`)
    .join('')}</ul>`;
}

export function mountCampaignCreatePage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Create a table');

  let catalog: DirectorCatalog | null = null;
  let name = '';
  let summary = '';
  let premise = '';
  let startLevel = 1;
  let targetEndLevel = 3;
  let campaignTone: CampaignTone = 'heroic_fantasy';
  let draftedBlueprint: CampaignBlueprint | null = null;
  let draftingSkeleton = false;
  let forgingStatus: string | null = null;
  let directorIdentity: DirectorIdentity | null = null;
  let directorPersonality: DirectorPersonality | null = null;
  let visibility: CampaignVisibility = 'private';
  let joinPassword = '';
  let busy = false;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  const mountToken = beginPageMount(container);

  function effectivePremise(): string {
    const parts = [summary.trim(), premise.trim()].filter((part) => part.length > 0);
    if (parts.length > 0) {
      return parts.join('\n\n').slice(0, CAMPAIGN_PREMISE_MAX_LENGTH);
    }
    return name.trim().slice(0, CAMPAIGN_PREMISE_MAX_LENGTH);
  }

  function canSubmit(): boolean {
    return (
      !busy &&
      !draftingSkeleton &&
      candidate !== null &&
      name.trim().length > 0 &&
      directorIdentity !== null &&
      directorPersonality !== null
    );
  }

  function renderSkeletonPreview(): string {
    if (draftedBlueprint === null) {
      return '';
    }
    const milestones = draftedBlueprint.milestones ?? [];
    return `
      <div class="panel" data-testid="campaign-skeleton-preview">
        <h3>Campaign Skeleton &amp; Leveling Curve (Levels ${draftedBlueprint.startLevel ?? startLevel} → ${draftedBlueprint.targetEndLevel ?? targetEndLevel})</h3>
        <p class="record-meta">
          Review or edit the milestone graph below before forging world assets. Each milestone unlocks its sanctum climax once the party reaches its SRD 5.2.1 XP threshold.
        </p>
        <dl class="account-details">
          <div>
            <dt>Premise Digest</dt>
            <dd>${escapeHtml(draftedBlueprint.premiseDigest)}</dd>
          </div>
          <div>
            <dt>Tone</dt>
            <dd>${escapeHtml(CAMPAIGN_TONE_LABELS[draftedBlueprint.campaignTone ?? campaignTone])}</dd>
          </div>
          <div>
            <dt>Central Tension</dt>
            <dd>${escapeHtml(draftedBlueprint.centralTension ?? '')}</dd>
          </div>
          <div>
            <dt>Quest Hook</dt>
            <dd>${escapeHtml(draftedBlueprint.questHook ?? draftedBlueprint.premiseDigest)}</dd>
          </div>
        </dl>
        <div class="stack">
          ${milestones
            .map(
              (milestone, mIdx) => `
              <section class="panel" data-testid="skeleton-milestone-${milestone.milestoneIndex}">
                <label class="field">
                  <span>Milestone ${milestone.milestoneIndex} (Level ${milestone.targetLevelAfterCompletion} · ${milestone.requiredXpThreshold} XP threshold)</span>
                  <input type="text" data-milestone-title="${mIdx}" value="${escapeHtml(milestone.title)}" />
                </label>
                <label class="field">
                  <span>Milestone Objective</span>
                  <input type="text" data-milestone-objective="${mIdx}" value="${escapeHtml(milestone.climaxObjective)}" />
                </label>
                <ul class="record-list">
                  ${milestone.rooms
                    .map(
                      (room, rIdx) => `
                      <li data-testid="skeleton-room-${escapeHtml(room.sceneId)}">
                        <label class="field">
                          <span>Room ${rIdx + 1}${room.isMilestoneClimax ? ' (Milestone Climax)' : ''} · ${room.xpAwardOnDiscovery} XP on discovery</span>
                          <input type="text" data-room-title="${mIdx}:${rIdx}" value="${escapeHtml(room.title)}" />
                        </label>
                        <p class="record-meta">${escapeHtml(room.summary)}</p>
                      </li>`,
                    )
                    .join('')}
                </ul>
              </section>`,
            )
            .join('')}
        </div>
        ${
          forgingStatus !== null
            ? `<p class="message notice" role="status" data-testid="campaign-forge-progress">${escapeHtml(forgingStatus)}</p>`
            : ''
        }
        <div class="actions">
          <button type="button" data-testid="approve-and-forge-campaign"
            aria-disabled="${canSubmit() ? 'false' : 'true'}">
            ${busy ? 'Forging World Assets…' : 'Approve & Forge Campaign World'}
          </button>
        </div>
      </div>`;
  }

  function renderPreview(): string {
    if (directorIdentity === null || directorPersonality === null) {
      return `
        <section class="panel preview-panel preview-panel-pending" aria-labelledby="campaign-preview-heading">
          <h2 id="campaign-preview-heading">Campaign preview</h2>
          <p data-testid="campaign-preview-pending">
            Choose a Game Director identity, then a personality, to see the preview. Creation stays
            locked until both are selected and the title is filled in.
          </p>
        </section>`;
    }

    const preview = DIRECTOR_CREATION_PREVIEW[directorPersonality];
    const identityLabel = DIRECTOR_IDENTITY_LABELS[directorIdentity];
    const personalityLabel = DIRECTOR_PERSONALITY_LABELS[directorPersonality];
    const avatarKey = directorAvatarKey(directorIdentity, directorPersonality);
    const avatarLabel = `${identityLabel} — ${personalityLabel}`;
    const title = name.trim().length > 0 ? name.trim() : 'Untitled campaign';

    return `
      <section class="panel preview-panel" aria-labelledby="campaign-preview-heading" data-testid="campaign-preview">
        <h2 id="campaign-preview-heading">Campaign preview</h2>
        <p class="tagline">
          Review this configuration before you create it. Identity and personality lock for ordinary
          users after creation.
        </p>
        ${directorAvatarMarkup({
          avatarKey,
          label: avatarLabel,
          testId: 'preview-director-avatar',
          className: 'director-avatar director-avatar-preview',
        })}
        <dl class="account-details" data-testid="campaign-preview-details">
          <div>
            <dt>Title</dt>
            <dd data-testid="preview-campaign-name">${escapeHtml(title)}</dd>
          </div>
          <div>
            <dt>Game Director identity</dt>
            <dd data-testid="preview-director-identity">${escapeHtml(identityLabel)}</dd>
          </div>
          <div>
            <dt>Personality</dt>
            <dd data-testid="preview-director-personality">${escapeHtml(personalityLabel)}</dd>
          </div>
          <div>
            <dt>Visibility</dt>
            <dd data-testid="preview-table-visibility">${escapeHtml(CAMPAIGN_VISIBILITY_LABELS[visibility])}</dd>
          </div>
        </dl>
        <h3 class="preview-subheading">Sample scene tone</h3>
        <p data-testid="preview-sample-scene">${escapeHtml(preview.sampleScene)}</p>
        <h3 class="preview-subheading">Expected play rhythm</h3>
        <p data-testid="preview-play-rhythm">${escapeHtml(preview.playRhythm)}</p>
        <p class="message notice" data-testid="preview-lock-reminder">
          Creating this table locks ${escapeHtml(identityLabel)} · ${escapeHtml(personalityLabel)}
          for ordinary users. Permanence keeps the voice consistent for every seated player. The
          Game Director may narrate at your table when live narration is enabled.
        </p>
      </section>`;
  }

  function updateCreateControls(): void {
    const submit = container.querySelector<HTMLButtonElement>(
      '[data-testid="create-campaign-submit"]',
    );
    if (submit !== null) {
      submit.setAttribute('aria-disabled', canSubmit() ? 'false' : 'true');
      submit.textContent = busy ? 'Creating…' : 'Create table';
    }
    const forgeBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="approve-and-forge-campaign"]',
    );
    if (forgeBtn !== null) {
      forgeBtn.setAttribute('aria-disabled', canSubmit() ? 'false' : 'true');
    }

    const previewName = container.querySelector<HTMLElement>('[data-testid="preview-campaign-name"]');
    if (previewName !== null) {
      previewName.textContent = name.trim().length > 0 ? name.trim() : 'Untitled table';
    }

    const missing: string[] = [];
    if (name.trim().length === 0) {
      missing.push('a table title');
    }
    if (directorIdentity === null) {
      missing.push('a Game Director identity');
    }
    if (directorPersonality === null) {
      missing.push('a Game Director personality');
    }

    let requirements = container.querySelector<HTMLElement>(
      '[data-testid="create-campaign-requirements"]',
    );
    if (missing.length === 0) {
      requirements?.remove();
      return;
    }
    const text = `Still needed: ${missing.join(', ')}.`;
    if (requirements === null) {
      const actions = container.querySelector('.actions');
      requirements = document.createElement('p');
      requirements.className = 'record-meta';
      requirements.dataset.testid = 'create-campaign-requirements';
      actions?.insertAdjacentElement('afterend', requirements);
    }
    requirements.textContent = text;
  }

  async function submitCreateCampaign(options: { readonly useForgedBlueprint: boolean }): Promise<void> {
    if (!canSubmit() || candidate === null || directorIdentity === null || directorPersonality === null) {
      return;
    }
    busy = true;
    error = null;
    if (options.useForgedBlueprint) {
      forgingStatus =
        'Forging campaign world: generating starting room battlemap, seeding multi-room graph, and locking leveling curve…';
    }
    render();
    try {
      const summaryValue = (summary.trim() || premise.trim()).slice(0, CAMPAIGN_SUMMARY_MAX_LENGTH);
      const campaign = await createCampaign({
        candidateId: candidate.candidateId,
        name: name.trim(),
        summary: summaryValue,
        directorIdentity,
        directorPersonality,
        visibility,
        ...(visibility === 'public' && joinPassword.trim().length > 0
          ? { joinPassword: joinPassword.trim() }
          : {}),
        premise: effectivePremise(),
        startLevel,
        targetEndLevel,
        campaignTone,
        ...(options.useForgedBlueprint && draftedBlueprint !== null
          ? { approvedBlueprint: draftedBlueprint, forgeWorldAssets: true }
          : {}),
      });
      shell.announce(
        visibility === 'private'
          ? `Private table ${campaign.name} created — take a seat, then copy an invite from the table page.`
          : `Table ${campaign.name} created — now take a seat.`,
      );
      navigate(
        `/campaigns/${campaign.campaignId}/join?created=1${
          visibility === 'private' ? '&private=1' : ''
        }`,
      );
    } catch (failure) {
      error =
        failure instanceof ApiFailure
          ? failure.message
          : 'The table could not be created.';
    } finally {
      busy = false;
      forgingStatus = null;
      render();
    }
  }

  function renderForm(): void {
    if (catalog === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="create-campaign-heading">Create a campaign</h1>
          ${
            error === null
              ? `<p class="tagline">Loading Game Director options…</p>`
              : `<div class="message error" role="alert" tabindex="-1" data-testid="create-campaign-error">${escapeHtml(error)}</div>
                 <div class="actions">
                   <button type="button" data-testid="retry-director-catalog">Retry</button>
                   <a href="/campaigns" data-link data-testid="cancel-create-campaign">Back to Tables</a>
                 </div>`
          }
        </div>`;
      container
        .querySelector<HTMLButtonElement>('[data-testid="retry-director-catalog"]')
        ?.addEventListener('click', () => {
          void load();
        });
      return;
    }

    const personalityLocked = directorIdentity === null;
    const missing: string[] = [];
    if (name.trim().length === 0) {
      missing.push('a campaign title');
    }
    if (directorIdentity === null) {
      missing.push('a Game Director identity');
    }
    if (directorPersonality === null) {
      missing.push('a Game Director personality');
    }

    container.innerHTML = `
      <div class="page">
        <h1 data-testid="create-campaign-heading">Create a table</h1>
        <p class="tagline">
          Name the table, choose public or private visibility, pick a Game Director identity and
          personality, and optionally forge a full multi-room campaign skeleton before play.
        </p>
        <p class="message notice" data-testid="director-config-notice">${escapeHtml(catalog.configurationNotice)}</p>
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="create-campaign-error">${escapeHtml(error)}</div>`
        }

        <section class="panel" aria-labelledby="table-visibility-heading">
          <h2 id="table-visibility-heading">1. Visibility</h2>
          <p>
            Public tables appear in the open lobby. Private tables are invite-only — after you
            create one, you can copy an invite link from the table page (and refresh or revoke it
            later). Public tables may optionally require a password to join.
          </p>
          <div class="option-list" role="radiogroup" aria-labelledby="table-visibility-heading" data-testid="table-visibility-list">
            ${CAMPAIGN_VISIBILITY.map(
              (option) => `
                <label class="option${visibility === option ? ' selected' : ''}" data-testid="visibility-${escapeHtml(option)}">
                  <input type="radio" name="table-visibility" value="${escapeHtml(option)}"
                    ${visibility === option ? 'checked' : ''} />
                  <span class="option-label">${escapeHtml(CAMPAIGN_VISIBILITY_LABELS[option])}</span>
                </label>`,
            ).join('')}
          </div>
          ${
            visibility === 'public'
              ? `<label class="field">
                   <span>Optional join password</span>
                   <input type="password" data-testid="join-password" autocomplete="new-password"
                     value="${escapeHtml(joinPassword)}" />
                 </label>`
              : ''
          }
        </section>

        <section class="panel" aria-labelledby="campaign-basics-heading">
          <h2 id="campaign-basics-heading">2. Table &amp; Campaign World Forge</h2>
          <label class="field">
            <span>Title</span>
            <input type="text" data-testid="campaign-name" maxlength="${CAMPAIGN_NAME_MAX_LENGTH}"
              value="${escapeHtml(name)}" autocomplete="off" />
          </label>
          <label class="field">
            <span>Adventure premise (optional)</span>
            <textarea data-testid="campaign-summary" maxlength="${CAMPAIGN_SUMMARY_MAX_LENGTH}" rows="3" placeholder="Example: a canal town missing courier, a misty marsh inn, a stone crypt…">${escapeHtml(summary)}</textarea>
            <span class="record-meta" data-testid="premise-continuity-hint">
              The opening scene keeps your core location, quest hook, and named entities when you
              write them here. The Game Director inspires the rest — the premise is not quoted word-for-word.
            </span>
            ${premiseCommittedFactsMarkup(summary || premise)}
          </label>
          <label class="field">
            <span>World Forge Premise &amp; Campaign Arc Notes (up to ${CAMPAIGN_PREMISE_MAX_LENGTH} chars)</span>
            <textarea data-testid="campaign-premise-input" maxlength="${CAMPAIGN_PREMISE_MAX_LENGTH}" rows="4" placeholder="Describe the world setting, central conflict, factions, or mysteries for the Campaign World Forge…">${escapeHtml(premise)}</textarea>
          </label>
          <div class="actions">
            <label class="field">
              <span>Starting Level (1–20)</span>
              <input type="number" min="1" max="20" data-testid="campaign-start-level" value="${startLevel}" />
            </label>
            <label class="field">
              <span>Target Ending Level (1–20)</span>
              <input type="number" min="1" max="20" data-testid="campaign-end-level" value="${targetEndLevel}" />
            </label>
            <label class="field">
              <span>Campaign Tone</span>
              <select data-testid="campaign-tone-select">
                ${CAMPAIGN_TONES.map(
                  (tone) =>
                    `<option value="${escapeHtml(tone)}"${campaignTone === tone ? ' selected' : ''}>${escapeHtml(CAMPAIGN_TONE_LABELS[tone])}</option>`,
                ).join('')}
              </select>
            </label>
          </div>
          <div class="actions">
            <button type="button" class="secondary" data-testid="draft-campaign-skeleton"
              ${draftingSkeleton || busy ? 'disabled' : ''}>
              ${draftingSkeleton ? 'Drafting Campaign Skeleton…' : draftedBlueprint !== null ? 'Regenerate Campaign Skeleton' : 'Draft Campaign Skeleton'}
            </button>
          </div>
          ${renderSkeletonPreview()}
        </section>

        <section class="panel" aria-labelledby="director-identity-heading">
          <h2 id="director-identity-heading">3. Game Director identity</h2>
          <p>Choose Veyra or Garrick first. Each has exactly one player-facing name.</p>
          <div class="option-list director-identity-cards" role="radiogroup" aria-labelledby="director-identity-heading" data-testid="director-identity-list">
            ${catalog.identities
              .map(
                (identity) => `
                <label class="option director-identity-option${directorIdentity === identity.id ? ' selected' : ''}" data-testid="identity-${escapeHtml(identity.id)}">
                  <input type="radio" name="director-identity" value="${escapeHtml(identity.id)}"
                    ${directorIdentity === identity.id ? 'checked' : ''} />
                  ${directorAvatarMarkup({
                    avatarKey: identity.id,
                    label: identity.label,
                    testId: `identity-avatar-${identity.id}`,
                    className: 'director-avatar director-avatar-choice',
                  })}
                  <span class="option-label">${escapeHtml(identity.label)}</span>
                  <span class="option-summary">${escapeHtml(identity.summary)}</span>
                </label>`,
              )
              .join('')}
          </div>
        </section>

        <section class="panel${personalityLocked ? ' panel-gated' : ''}" aria-labelledby="director-personality-heading">
          <h2 id="director-personality-heading">4. Game Director personality</h2>
          ${
            personalityLocked
              ? `<p class="message notice" data-testid="personality-gated">
                   Choose Veyra or Garrick above before selecting a personality.
                 </p>`
              : `<p>
                   Now choose one approved personality. Seasoned Host may be recommended;
                   nothing is selected until you choose.
                 </p>`
          }
          <div class="option-list" role="radiogroup" aria-labelledby="director-personality-heading" data-testid="director-personality-list">
            ${catalog.personalities
              .map(
                (personality) => `
                <label class="option${directorPersonality === personality.id ? ' selected' : ''}${personalityLocked ? ' disabled' : ''}" data-testid="personality-${escapeHtml(personality.id)}">
                  <input type="radio" name="director-personality" value="${escapeHtml(personality.id)}"
                    ${directorPersonality === personality.id ? 'checked' : ''}
                    ${personalityLocked ? 'disabled' : ''} />
                  <span class="option-label">
                    ${escapeHtml(personality.label)}
                    ${personality.recommended ? '<span class="option-badge" data-testid="personality-recommended">Recommended</span>' : ''}
                  </span>
                  <span class="option-summary">${escapeHtml(personality.summary)}</span>
                </label>`,
              )
              .join('')}
          </div>
        </section>

        ${renderPreview()}

        <div class="actions">
          <button type="button" data-testid="create-campaign-submit"
            aria-disabled="${canSubmit() ? 'false' : 'true'}">
            ${busy ? 'Creating…' : 'Create table'}
          </button>
          <a href="/campaigns" data-link data-testid="cancel-create-campaign">Back to Tables</a>
        </div>
        ${
          canSubmit() || missing.length === 0
            ? ''
            : `<p class="record-meta" data-testid="create-campaign-requirements">
                 Still needed: ${escapeHtml(missing.join(', '))}.
               </p>`
        }
      </div>`;

    const nameInput = container.querySelector<HTMLInputElement>('[data-testid="campaign-name"]');
    nameInput?.addEventListener('input', () => {
      name = nameInput.value;
      updateCreateControls();
    });

    const updateFactsDom = () => {
      const factsHost = container.querySelector<HTMLElement>(
        '[data-testid="premise-committed-facts"], [data-testid="premise-committed-facts-empty"]',
      );
      if (factsHost !== null) {
        const wrap = document.createElement('div');
        wrap.innerHTML = premiseCommittedFactsMarkup(summary || premise);
        const next = wrap.firstElementChild;
        if (next !== null) {
          factsHost.replaceWith(next);
        }
      }
    };

    const summaryInput = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="campaign-summary"]',
    );
    summaryInput?.addEventListener('input', () => {
      summary = summaryInput.value;
      updateFactsDom();
    });

    const premiseInput = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="campaign-premise-input"]',
    );
    premiseInput?.addEventListener('input', () => {
      premise = premiseInput.value;
      if (summary.trim().length === 0) {
        summary = premise.slice(0, CAMPAIGN_SUMMARY_MAX_LENGTH);
        if (summaryInput !== null) {
          summaryInput.value = summary;
        }
      }
      updateFactsDom();
    });

    const startLevelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="campaign-start-level"]',
    );
    const endLevelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="campaign-end-level"]',
    );
    startLevelInput?.addEventListener('change', () => {
      const parsed = Number.parseInt(startLevelInput.value, 10);
      if (Number.isFinite(parsed)) {
        startLevel = Math.max(1, Math.min(20, parsed));
        if (targetEndLevel < startLevel) {
          targetEndLevel = startLevel;
        }
        startLevelInput.value = String(startLevel);
        if (endLevelInput !== null) {
          endLevelInput.min = String(startLevel);
          endLevelInput.value = String(targetEndLevel);
        }
        if (draftedBlueprint !== null) {
          draftedBlueprint = null;
          render();
        }
      }
    });

    endLevelInput?.addEventListener('change', () => {
      const parsed = Number.parseInt(endLevelInput.value, 10);
      if (Number.isFinite(parsed)) {
        targetEndLevel = Math.max(startLevel, Math.min(20, parsed));
        endLevelInput.value = String(targetEndLevel);
        if (draftedBlueprint !== null) {
          draftedBlueprint = null;
          render();
        }
      }
    });

    const toneSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="campaign-tone-select"]',
    );
    toneSelect?.addEventListener('change', () => {
      if (isCampaignTone(toneSelect.value)) {
        campaignTone = toneSelect.value;
        if (draftedBlueprint !== null) {
          draftedBlueprint = null;
          render();
        }
      }
    });

    container
      .querySelector<HTMLButtonElement>('[data-testid="draft-campaign-skeleton"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || draftingSkeleton || busy) {
            return;
          }
          const seedPremise = effectivePremise();
          if (seedPremise.length === 0) {
            error = 'Enter a campaign title or premise before drafting a skeleton.';
            render();
            return;
          }
          draftingSkeleton = true;
          error = null;
          render();
          try {
            const response = await draftCampaignBlueprint({
              candidateId: candidate.candidateId,
              premise: seedPremise,
              startLevel,
              targetEndLevel,
              campaignTone,
            });
            draftedBlueprint = response.blueprint;
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Could not draft the campaign skeleton.';
          } finally {
            draftingSkeleton = false;
            render();
          }
        })();
      });

    container.querySelectorAll<HTMLInputElement>('[data-milestone-title]').forEach((input) => {
      input.addEventListener('input', () => {
        if (draftedBlueprint?.milestones === undefined) {
          return;
        }
        const mIdx = Number.parseInt(input.dataset.milestoneTitle ?? '', 10);
        if (!Number.isFinite(mIdx) || draftedBlueprint.milestones[mIdx] === undefined) {
          return;
        }
        const milestones = draftedBlueprint.milestones.map((m, idx) =>
          idx === mIdx ? { ...m, title: input.value } : m,
        );
        draftedBlueprint = { ...draftedBlueprint, milestones };
      });
    });

    container.querySelectorAll<HTMLInputElement>('[data-milestone-objective]').forEach((input) => {
      input.addEventListener('input', () => {
        if (draftedBlueprint?.milestones === undefined) {
          return;
        }
        const mIdx = Number.parseInt(input.dataset.milestoneObjective ?? '', 10);
        if (!Number.isFinite(mIdx) || draftedBlueprint.milestones[mIdx] === undefined) {
          return;
        }
        const milestones = draftedBlueprint.milestones.map((m, idx) =>
          idx === mIdx ? { ...m, climaxObjective: input.value } : m,
        );
        draftedBlueprint = { ...draftedBlueprint, milestones };
      });
    });

    container.querySelectorAll<HTMLInputElement>('[data-room-title]').forEach((input) => {
      input.addEventListener('input', () => {
        if (draftedBlueprint?.milestones === undefined) {
          return;
        }
        const parts = (input.dataset.roomTitle ?? '').split(':');
        const mIdx = Number.parseInt(parts[0] ?? '', 10);
        const rIdx = Number.parseInt(parts[1] ?? '', 10);
        const milestone = draftedBlueprint.milestones[mIdx];
        if (milestone === undefined || milestone.rooms[rIdx] === undefined) {
          return;
        }
        const nextRooms = milestone.rooms.map((r, idx) =>
          idx === rIdx ? { ...r, title: input.value } : r,
        );
        const milestones = draftedBlueprint.milestones.map((m, idx) =>
          idx === mIdx ? { ...m, rooms: nextRooms } : m,
        );
        draftedBlueprint = { ...draftedBlueprint, milestones };
      });
    });

    container
      .querySelector<HTMLButtonElement>('[data-testid="approve-and-forge-campaign"]')
      ?.addEventListener('click', () => {
        void submitCreateCampaign({ useForgedBlueprint: true });
      });

    container.querySelectorAll<HTMLInputElement>('input[name="director-identity"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!isDirectorIdentity(input.value)) {
          return;
        }
        directorIdentity = input.value;
        render();
      });
    });

    container
      .querySelectorAll<HTMLInputElement>('input[name="director-personality"]')
      .forEach((input) => {
        input.addEventListener('change', () => {
          if (directorIdentity === null || !isDirectorPersonality(input.value)) {
            return;
          }
          directorPersonality = input.value;
          render();
        });
      });

    container.querySelectorAll<HTMLInputElement>('input[name="table-visibility"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!isCampaignVisibility(input.value)) {
          return;
        }
        visibility = input.value;
        if (visibility !== 'public') {
          joinPassword = '';
        }
        render();
      });
    });

    container
      .querySelector<HTMLInputElement>('[data-testid="join-password"]')
      ?.addEventListener('input', (event) => {
        if (event.target instanceof HTMLInputElement) {
          joinPassword = event.target.value;
        }
      });

    if (directorIdentity !== null && directorPersonality !== null) {
      bindDirectorAvatarFallback(
        container,
        'preview-director-avatar',
        `${DIRECTOR_IDENTITY_LABELS[directorIdentity]} — ${DIRECTOR_PERSONALITY_LABELS[directorPersonality]}`,
      );
    }
    for (const identity of catalog.identities) {
      bindDirectorAvatarFallback(container, `identity-avatar-${identity.id}`, identity.label);
    }

    container
      .querySelector<HTMLButtonElement>('[data-testid="create-campaign-submit"]')
      ?.addEventListener('click', () => {
        void submitCreateCampaign({ useForgedBlueprint: draftedBlueprint !== null });
      });
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
        title: 'Create a campaign',
        body: 'Sign in with a Local Arena development account before creating a campaign.',
        candidate,
        busy: gateBusy,
        error: gateError,
      });
      bindSignedOutGate({
        container,
        shell,
        candidate,
        onSignedIn: () => {
          void load();
        },
        setBusy: (busyState) => {
          gateBusy = busyState;
        },
        setError: (message) => {
          gateError = message;
        },
        render,
      });
      return;
    }
    renderForm();
  }

  async function load(): Promise<void> {
    if (getAccount() === null) {
      render();
      return;
    }
    error = null;
    render();
    try {
      catalog = await fetchDirectorCatalog();
    } catch (failure) {
      catalog = null;
      error =
        failure instanceof ApiFailure
          ? failure.message
          : 'Director options could not be loaded.';
    }
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    render();
  }

  let lastAccountId: string | null = getAccount()?.accountId ?? null;

  const unsubscribeAccount = subscribeAccount(() => {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    const nextAccountId = getAccount()?.accountId ?? null;
    if (nextAccountId !== lastAccountId) {
      lastAccountId = nextAccountId;
      name = '';
      summary = '';
      premise = '';
      startLevel = 1;
      targetEndLevel = 3;
      campaignTone = 'heroic_fantasy';
      draftedBlueprint = null;
      draftingSkeleton = false;
      forgingStatus = null;
      directorIdentity = null;
      directorPersonality = null;
      visibility = 'private';
      joinPassword = '';
      catalog = null;
      error = null;
      busy = false;
    }
    void load();
  });
  registerPageCleanup(container, mountToken, unsubscribeAccount);
  void load();
}
