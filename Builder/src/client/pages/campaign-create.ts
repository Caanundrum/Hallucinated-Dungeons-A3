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
  shell.setDocumentTitle('Create a Campaign');

  let catalog: DirectorCatalog | null = null;
  let name = '';
  let summary = '';
  let premise = '';
  let startLevel = 1;
  let targetEndLevel = 3;
  let campaignTone: CampaignTone = 'heroic_fantasy';
  let outlineOptions: readonly CampaignBlueprint[] = [];
  let selectedOutlineIndex = 0;
  let outlineDraftsUsed = 0;
  let outlineApproved = false;
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
    const text = (summary.trim() || premise.trim() || name.trim()).trim();
    return text.slice(0, CAMPAIGN_PREMISE_MAX_LENGTH);
  }

  function canSubmit(): boolean {
    return (
      !busy &&
      !draftingSkeleton &&
      candidate !== null &&
      name.trim().length > 0 &&
      directorIdentity !== null &&
      directorPersonality !== null &&
      (draftedBlueprint === null || outlineApproved)
    );
  }

  function renderSkeletonPreview(): string {
    if (draftedBlueprint === null) {
      return `
        <p class="message notice" data-testid="campaign-outline-required-notice" style="margin-top:0.75rem;">
          Drafting and approving a <strong>Rough Campaign Outline</strong> is required before creating the campaign. Click <strong>Draft Rough Campaign Outline</strong> above to generate 3 options and pick 1.
        </p>`;
    }
    const acts = draftedBlueprint.acts ?? [];
    const ARCHETYPE_BADGES = [
      'Unfolding Conspiracy & Intrigue',
      'Faction Rivalry & Covert Strikes',
      'Wilderness Expedition & Ancient Lore',
    ];
    return `
      <div class="panel" data-testid="campaign-skeleton-preview" style="margin-top:1rem;">
        <h3>Choose 1 of 3 Rough Campaign Outlines</h3>
        <p class="record-meta" style="margin-bottom:0.75rem;">
          Compare the three campaign arcs side-by-side below. Click any card to inspect its full multi-act story outline and DM guardrails, then approve your favorite.
        </p>
        ${
          outlineOptions.length > 1
            ? `<div class="option-list outline-options-grid-3col" role="radiogroup" aria-label="Rough Campaign Outline choices" data-testid="outline-options-list">
                 ${outlineOptions
                   .map((opt, idx) => {
                     const selected = idx === selectedOutlineIndex;
                     const badgeLabel = ARCHETYPE_BADGES[idx] ?? `Arc ${idx + 1}`;
                     return `
                       <button type="button"
                         class="option outline-choice-card${selected ? ' selected' : ''}"
                         data-testid="outline-option-${idx}"
                         data-outline-index="${idx}"
                         aria-pressed="${selected ? 'true' : 'false'}">
                         <span class="option-badge">${escapeHtml(badgeLabel)}</span>
                         <span class="option-label">Outline Option ${idx + 1}</span>
                         <span class="option-summary">${escapeHtml(opt.centralTension ?? opt.premiseDigest)}</span>
                       </button>`;
                   })
                   .join('')}
               </div>`
            : ''
        }
        <dl class="account-details" style="margin-top:1rem;">
          <div>
            <dt>Premise Digest</dt>
            <dd>${escapeHtml(draftedBlueprint.premiseDigest)}</dd>
          </div>
          <div>
            <dt>Tone &amp; Level Span</dt>
            <dd>${escapeHtml(CAMPAIGN_TONE_LABELS[draftedBlueprint.campaignTone ?? campaignTone])} · Levels ${draftedBlueprint.startLevel ?? startLevel}–${draftedBlueprint.targetEndLevel ?? targetEndLevel}</dd>
          </div>
          <div>
            <dt>Central Tension</dt>
            <dd>${escapeHtml(draftedBlueprint.centralTension ?? '')}</dd>
          </div>
          <div>
            <dt>Quest Hook</dt>
            <dd>${escapeHtml(draftedBlueprint.questHook ?? draftedBlueprint.centralTension ?? draftedBlueprint.premiseDigest)}</dd>
          </div>
        </dl>
        <div class="stack" style="margin-top:1rem;">
          <h4 class="preview-subheading">Selected Story Arc — Option #${selectedOutlineIndex + 1} (Loose DM Guardrails)</h4>
          <ul class="record-list" data-testid="rough-outline-acts">
            ${acts
              .map(
                (beat) => `
                <li data-testid="rough-outline-act-${beat.act}">
                  <span class="record-note">${escapeHtml(beat.title)}</span>
                  <span class="record-meta">${escapeHtml(beat.currentActGoal)}</span>
                </li>`,
              )
              .join('')}
          </ul>
        </div>
        ${
          outlineApproved
            ? `<p class="message success" data-testid="outline-approved-badge" style="margin-top:0.75rem;">
                 Rough Campaign Outline #${selectedOutlineIndex + 1} approved ✓ — click <strong>Create Campaign &amp; Forge World</strong> below when ready.
               </p>`
            : ''
        }
        ${
          forgingStatus !== null
            ? `<div class="message notice world-forge-theater" role="status" data-testid="campaign-forge-progress" style="margin-top:0.75rem;">
                 <div class="world-forge-theater-header">
                   <span class="world-forge-spinner" aria-hidden="true">✦</span>
                   <strong>Forging Your Campaign World…</strong>
                 </div>
                 <p class="world-forge-stage-text">${escapeHtml(forgingStatus)}</p>
                 <div class="world-forge-progress-bar" aria-hidden="true"><div class="world-forge-progress-fill"></div></div>
               </div>`
            : ''
        }
        <div class="actions" style="margin-top:0.85rem;">
          <button type="button" class="${outlineApproved ? 'secondary' : ''}" data-testid="approve-rough-outline"
            ${busy ? 'disabled' : ''}>
            ${outlineApproved ? `Outline #${selectedOutlineIndex + 1} Approved ✓` : `Approve Outline #${selectedOutlineIndex + 1}`}
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
      submit.textContent = busy ? 'Creating…' : 'Create Campaign';
    }
    const forgeBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="approve-and-forge-campaign"]',
    );
    if (forgeBtn !== null) {
      const canForge =
        !busy &&
        !draftingSkeleton &&
        candidate !== null &&
        name.trim().length > 0 &&
        directorIdentity !== null &&
        directorPersonality !== null &&
        draftedBlueprint !== null;
      forgeBtn.setAttribute('aria-disabled', canForge ? 'false' : 'true');
    }

    const previewName = container.querySelector<HTMLElement>('[data-testid="preview-campaign-name"]');
    if (previewName !== null) {
      previewName.textContent = name.trim().length > 0 ? name.trim() : 'Untitled campaign';
    }

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
    if (draftedBlueprint !== null && !outlineApproved) {
      missing.push('approval of your Rough Campaign Outline');
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

  const FORGE_THEATER_MESSAGES = [
    'Rolling cosmic fate dice and charting overland trails across the realm…',
    'Painting overhead tactical battlemaps and lighting tavern lanterns…',
    'Briefing local contacts, faction informants, and dungeon wardens…',
    'Stocking secret vaults, rumors, and preparing the Campaign Lobby…',
  ];

  async function submitCreateCampaign(options: { readonly useForgedBlueprint: boolean }): Promise<void> {
    if (options.useForgedBlueprint && draftedBlueprint !== null) {
      outlineApproved = true;
    }
    if (!canSubmit() || candidate === null || directorIdentity === null || directorPersonality === null) {
      return;
    }
    busy = true;
    error = null;
    let forgeStageIdx = 0;
    let forgeTimer: ReturnType<typeof setInterval> | null = null;
    if (options.useForgedBlueprint) {
      forgingStatus = FORGE_THEATER_MESSAGES[0]!;
      forgeTimer = setInterval(() => {
        forgeStageIdx = (forgeStageIdx + 1) % FORGE_THEATER_MESSAGES.length;
        forgingStatus = FORGE_THEATER_MESSAGES[forgeStageIdx]!;
        const stageEl = container.querySelector<HTMLElement>('.world-forge-stage-text');
        if (stageEl !== null) {
          stageEl.textContent = forgingStatus;
        }
      }, 1600);
    }
    render();
    try {
      const summaryValue = (summary.trim() || premise.trim()).slice(0, CAMPAIGN_SUMMARY_MAX_LENGTH);
      const premiseValue = options.useForgedBlueprint
        ? effectivePremise()
        : (summary.trim() || premise.trim()).slice(0, CAMPAIGN_PREMISE_MAX_LENGTH);
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
        premise: premiseValue,
        startLevel,
        targetEndLevel,
        campaignTone,
        ...(options.useForgedBlueprint && draftedBlueprint !== null
          ? { approvedBlueprint: draftedBlueprint, forgeWorldAssets: true }
          : {}),
      });
      shell.announce(
        visibility === 'private'
          ? `Private campaign ${campaign.name} created — take a seat, then copy an invite from the campaign page.`
          : `Campaign ${campaign.name} created — now take a seat.`,
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
          : 'The campaign could not be created.';
    } finally {
      if (forgeTimer !== null) {
        clearInterval(forgeTimer);
      }
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
    if (draftedBlueprint !== null && !outlineApproved) {
      missing.push('approval of your Rough Campaign Outline');
    }

    container.innerHTML = `
      <div class="page">
        <h1 data-testid="create-campaign-heading">Create a Campaign</h1>
        <p class="tagline">
          Name the campaign, choose public or private visibility, pick a Game Director identity and
          personality, and draft &amp; approve a Rough Campaign Outline before creating the campaign.
        </p>
        <p class="message notice" data-testid="director-config-notice">${escapeHtml(catalog.configurationNotice)}</p>
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="create-campaign-error">${escapeHtml(error)}</div>`
        }

        <section class="panel" aria-labelledby="table-visibility-heading">
          <h2 id="table-visibility-heading">1. Campaign visibility</h2>
          <p>
            Public campaigns appear in the open lobby. Private campaigns are invite-only — after you
            create one, you can copy an invite link from the campaign page (and refresh or revoke it
            later). Public campaigns may optionally require a password to join.
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
          <h2 id="campaign-basics-heading">2. Campaign details &amp; premise</h2>
          <label class="field">
            <span>Title</span>
            <input type="text" data-testid="campaign-name" maxlength="${CAMPAIGN_NAME_MAX_LENGTH}"
              value="${escapeHtml(name)}" autocomplete="off" />
          </label>
          <label class="field">
            <span>Adventure premise (optional)</span>
            <textarea data-testid="campaign-summary" maxlength="${CAMPAIGN_PREMISE_MAX_LENGTH}" rows="4" placeholder="Example: a canal town missing courier, a misty marsh inn, a stone crypt, factions, or campaign arc notes…">${escapeHtml(summary)}</textarea>
            <span class="record-meta" data-testid="premise-continuity-hint">
              The opening scene keeps your core location, quest hook, and named entities when you
              write them here. The Game Director inspires the rest — the premise is not quoted word-for-word.
            </span>
            ${premiseCommittedFactsMarkup(summary)}
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

        <section class="panel" aria-labelledby="world-forge-heading">
          <h2 id="world-forge-heading">5. Rough Campaign Outline &amp; World Forge (Required)</h2>
          <p class="record-meta" style="margin:0.35rem 0 0.85rem 0; line-height:1.5;">
            Generate 3 Rough Campaign Outlines from your premise, pick the one you like best, and approve it before creating the campaign. Battle maps, NPCs, and reusable monster tokens are forged upon creation.
          </p>
          <div class="actions" style="margin-bottom:0.5rem;">
            <button type="button" class="secondary" data-testid="draft-campaign-skeleton"
              ${draftingSkeleton || busy || outlineDraftsUsed >= 1 ? 'disabled' : ''}>
              ${
                draftingSkeleton
                  ? 'Drafting 3 Rough Campaign Outlines…'
                  : outlineDraftsUsed >= 1
                    ? '3 Rough Campaign Outlines Generated (Pick 1 Below)'
                    : 'Draft Rough Campaign Outline (Generates 3 Choices)'
              }
            </button>
          </div>
          ${renderSkeletonPreview()}
        </section>

        <div class="actions">
          <button type="button" data-testid="create-campaign-submit"
            aria-disabled="${canSubmit() ? 'false' : 'true'}">
            ${busy ? 'Forging Campaign World…' : 'Create Campaign & Forge World'}
          </button>
          <a href="/campaigns" data-link data-testid="cancel-create-campaign">Back to Campaigns</a>
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
      premise = summaryInput.value;
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
          if (candidate === null || draftingSkeleton || busy || outlineDraftsUsed >= 1) {
            return;
          }
          const seedPremise = effectivePremise();
          if (seedPremise.length === 0) {
            error = 'Enter a campaign title or premise before drafting a Rough Campaign Outline.';
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
            outlineOptions =
              Array.isArray(response.outlines) && response.outlines.length > 0
                ? response.outlines.slice(0, 3)
                : [response.blueprint];
            selectedOutlineIndex = 0;
            draftedBlueprint = outlineOptions[0] ?? response.blueprint;
            outlineDraftsUsed = 1;
            outlineApproved = false;
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Could not draft the Rough Campaign Outline.';
          } finally {
            draftingSkeleton = false;
            render();
          }
        })();
      });

    container.querySelectorAll<HTMLButtonElement>('[data-outline-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number.parseInt(btn.dataset.outlineIndex ?? '0', 10);
        if (Number.isFinite(idx) && outlineOptions[idx] !== undefined) {
          if (selectedOutlineIndex !== idx) {
            outlineApproved = false;
          }
          selectedOutlineIndex = idx;
          draftedBlueprint = outlineOptions[idx]!;
          render();
        }
      });
    });

    container
      .querySelector<HTMLButtonElement>('[data-testid="approve-rough-outline"]')
      ?.addEventListener('click', () => {
        if (draftedBlueprint === null) {
          return;
        }
        outlineApproved = true;
        render();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="approve-and-forge-campaign"]')
      ?.addEventListener('click', () => {
        if (draftedBlueprint !== null) {
          outlineApproved = true;
        }
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
      outlineOptions = [];
      selectedOutlineIndex = 0;
      outlineDraftsUsed = 0;
      outlineApproved = false;
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
