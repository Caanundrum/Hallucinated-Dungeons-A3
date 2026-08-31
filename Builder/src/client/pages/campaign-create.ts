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
  CAMPAIGN_SUMMARY_MAX_LENGTH,
  CAMPAIGN_VISIBILITY,
  CAMPAIGN_VISIBILITY_LABELS,
  DIRECTOR_CREATION_PREVIEW,
  DIRECTOR_IDENTITY_LABELS,
  DIRECTOR_PERSONALITY_LABELS,
  directorAvatarKey,
  isCampaignVisibility,
  isDirectorIdentity,
  isDirectorPersonality,
} from '../../shared/campaign-contract.js';
import type {
  CampaignVisibility,
  DirectorCatalog,
  DirectorIdentity,
  DirectorPersonality,
} from '../../shared/campaign-contract.js';
import { bindDirectorAvatarFallback, directorAvatarMarkup } from '../director-avatars.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import { ApiFailure, createCampaign, fetchDirectorCatalog } from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

export function mountCampaignCreatePage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Create a table');

  let catalog: DirectorCatalog | null = null;
  let name = '';
  let summary = '';
  let directorIdentity: DirectorIdentity | null = null;
  let directorPersonality: DirectorPersonality | null = null;
  let visibility: CampaignVisibility = 'private';
  let joinPassword = '';
  let busy = false;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  const mountToken = beginPageMount(container);

  function canSubmit(): boolean {
    return (
      !busy &&
      candidate !== null &&
      name.trim().length > 0 &&
      directorIdentity !== null &&
      directorPersonality !== null
    );
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
          Creating this campaign locks ${escapeHtml(identityLabel)} · ${escapeHtml(personalityLabel)}
          for ordinary users. The Game Director may narrate at your table when live narration is enabled.
        </p>
      </section>`;
  }

  function updateCreateControls(): void {
    const submit = container.querySelector<HTMLButtonElement>(
      '[data-testid="create-campaign-submit"]',
    );
    if (submit !== null) {
      submit.setAttribute('aria-disabled', canSubmit() ? 'false' : 'true');
      submit.textContent = busy ? 'Creating…' : 'Create campaign';
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

    let requirements = container.querySelector<HTMLElement>(
      '[data-testid="create-campaign-requirements"]',
    );
    if (canSubmit()) {
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
                   <a href="/campaigns" data-link data-testid="cancel-create-campaign">Back to campaigns</a>
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
          personality, then create. You join the same way every other player does.
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
            Public tables appear in the open lobby. Private tables are invite-only. Public tables
            may optionally require a password to join.
          </p>
          <ul class="option-list" data-testid="table-visibility-list">
            ${CAMPAIGN_VISIBILITY.map(
              (option) => `
              <li>
                <label class="option${visibility === option ? ' selected' : ''}" data-testid="visibility-${escapeHtml(option)}">
                  <input type="radio" name="table-visibility" value="${escapeHtml(option)}"
                    ${visibility === option ? 'checked' : ''} />
                  <span class="option-label">${escapeHtml(CAMPAIGN_VISIBILITY_LABELS[option])}</span>
                </label>
              </li>`,
            ).join('')}
          </ul>
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
          <h2 id="campaign-basics-heading">2. Table</h2>
          <label class="field">
            <span>Title</span>
            <input type="text" data-testid="campaign-name" maxlength="${CAMPAIGN_NAME_MAX_LENGTH}"
              value="${escapeHtml(name)}" autocomplete="off" />
          </label>
          <label class="field">
            <span>Adventure premise (optional)</span>
            <textarea data-testid="campaign-summary" maxlength="${CAMPAIGN_SUMMARY_MAX_LENGTH}" rows="3" placeholder="Example: a misty marsh inn, a stone crypt, a forest workshop…">${escapeHtml(summary)}</textarea>
            <span class="record-meta">The Game Director uses this to establish your opening scene. Leave blank for a Director-chosen start.</span>
          </label>
        </section>

        <section class="panel" aria-labelledby="director-identity-heading">
          <h2 id="director-identity-heading">3. Game Director identity</h2>
          <p>Choose Veyra or Garrick first. Each has exactly one player-facing name.</p>
          <ul class="option-list director-identity-cards" data-testid="director-identity-list">
            ${catalog.identities
              .map(
                (identity) => `
              <li>
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
                </label>
              </li>`,
              )
              .join('')}
          </ul>
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
          <ul class="option-list" data-testid="director-personality-list">
            ${catalog.personalities
              .map(
                (personality) => `
              <li>
                <label class="option${directorPersonality === personality.id ? ' selected' : ''}${personalityLocked ? ' disabled' : ''}" data-testid="personality-${escapeHtml(personality.id)}">
                  <input type="radio" name="director-personality" value="${escapeHtml(personality.id)}"
                    ${directorPersonality === personality.id ? 'checked' : ''}
                    ${personalityLocked ? 'disabled' : ''} />
                  <span class="option-label">
                    ${escapeHtml(personality.label)}
                    ${personality.recommended ? '<span class="option-badge" data-testid="personality-recommended">Recommended</span>' : ''}
                  </span>
                  <span class="option-summary">${escapeHtml(personality.summary)}</span>
                </label>
              </li>`,
              )
              .join('')}
          </ul>
        </section>

        ${renderPreview()}

        <div class="actions">
          <button type="button" data-testid="create-campaign-submit"
            aria-disabled="${canSubmit() ? 'false' : 'true'}">
            ${busy ? 'Creating…' : 'Create table'}
          </button>
          <a href="/campaigns" data-link data-testid="cancel-create-campaign">Back to campaigns</a>
        </div>
        ${
          canSubmit()
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

    const summaryInput = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="campaign-summary"]',
    );
    summaryInput?.addEventListener('input', () => {
      summary = summaryInput.value;
    });

    container.querySelectorAll<HTMLInputElement>('input[name="director-identity"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!isDirectorIdentity(input.value)) {
          return;
        }
        directorIdentity = input.value;
        // Personality stays chosen when identity changes (independent dimensions),
        // but it cannot be chosen before an identity exists.
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
        void (async () => {
          if (!canSubmit() || candidate === null || directorIdentity === null || directorPersonality === null) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const campaign = await createCampaign({
              candidateId: candidate.candidateId,
              name: name.trim(),
              summary: summary.trim(),
              directorIdentity,
              directorPersonality,
              visibility,
              ...(visibility === 'public' && joinPassword.trim().length > 0
                ? { joinPassword: joinPassword.trim() }
                : {}),
            });
            shell.announce(`Table ${campaign.name} created.`);
            navigate(`/campaigns/${campaign.campaignId}/join`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'The campaign could not be created.';
          } finally {
            busy = false;
            render();
          }
        })();
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
    render();
  }

  let lastAccountId: string | null = getAccount()?.accountId ?? null;

  subscribeAccount(() => {
    const nextAccountId = getAccount()?.accountId ?? null;
    if (nextAccountId !== lastAccountId) {
      lastAccountId = nextAccountId;
      name = '';
      summary = '';
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
  void load();
}
