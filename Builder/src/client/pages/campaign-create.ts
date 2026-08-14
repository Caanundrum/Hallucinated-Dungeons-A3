/**
 * Campaign creation with explicit Veyra/Garrick and personality selection.
 *
 * Blueprint ownership: Section 1.5.21 / 7.5. Identity is chosen first;
 * personality only after that; Seasoned Host may be recommended but
 * never silently selected. A preview (identity, personality, sample scene,
 * play rhythm) must appear before create. Both Director choices lock after
 * creation.
 */

import type { DirectorCatalog, DirectorIdentity, DirectorPersonality } from '../../shared/campaign-contract.js';
import {
  CAMPAIGN_NAME_MAX_LENGTH,
  CAMPAIGN_SUMMARY_MAX_LENGTH,
  DIRECTOR_CREATION_PREVIEW,
  DIRECTOR_IDENTITY_LABELS,
  DIRECTOR_PERSONALITY_LABELS,
  directorAvatarKey,
  isDirectorIdentity,
  isDirectorPersonality,
} from '../../shared/campaign-contract.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import { ApiFailure, createCampaign, fetchDirectorCatalog } from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

export function mountCampaignCreatePage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Create a campaign');

  let catalog: DirectorCatalog | null = null;
  let name = '';
  let summary = '';
  let directorIdentity: DirectorIdentity | null = null;
  let directorPersonality: DirectorPersonality | null = null;
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
    const title = name.trim().length > 0 ? name.trim() : 'Untitled campaign';

    return `
      <section class="panel preview-panel" aria-labelledby="campaign-preview-heading" data-testid="campaign-preview">
        <h2 id="campaign-preview-heading">Campaign preview</h2>
        <p class="tagline">
          Review this configuration before you create it. Identity and personality lock for ordinary
          users after creation.
        </p>
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
            <dt>Avatar key</dt>
            <dd><code data-testid="preview-avatar-key">${escapeHtml(avatarKey)}</code></dd>
          </div>
        </dl>
        <h3 class="preview-subheading">Sample scene tone</h3>
        <p data-testid="preview-sample-scene">${escapeHtml(preview.sampleScene)}</p>
        <h3 class="preview-subheading">Expected play rhythm</h3>
        <p data-testid="preview-play-rhythm">${escapeHtml(preview.playRhythm)}</p>
        <p class="message notice" data-testid="preview-lock-reminder">
          Creating this campaign locks ${escapeHtml(identityLabel)} · ${escapeHtml(personalityLabel)}
          for ordinary users. This configures the later AI-enabled table; it does not start AI
          narration in this build.
        </p>
      </section>`;
  }

  function renderForm(): void {
    if (catalog === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="create-campaign-heading">Create a campaign</h1>
          <p class="tagline">Loading Game Director options…</p>
        </div>`;
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
        <h1 data-testid="create-campaign-heading">Create a campaign</h1>
        <p class="tagline">
          Name the table, choose a Game Director identity first, then one personality. Review the
          preview, then create. Both Director choices stay fixed for ordinary users afterward.
        </p>
        <p class="message notice" data-testid="director-config-notice">${escapeHtml(catalog.configurationNotice)}</p>
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="create-campaign-error">${escapeHtml(error)}</div>`
        }

        <section class="panel" aria-labelledby="campaign-basics-heading">
          <h2 id="campaign-basics-heading">1. Campaign</h2>
          <label class="field">
            <span>Title</span>
            <input type="text" data-testid="campaign-name" maxlength="${CAMPAIGN_NAME_MAX_LENGTH}"
              value="${escapeHtml(name)}" autocomplete="off" />
          </label>
          <label class="field">
            <span>Short summary (optional)</span>
            <textarea data-testid="campaign-summary" maxlength="${CAMPAIGN_SUMMARY_MAX_LENGTH}" rows="3">${escapeHtml(summary)}</textarea>
          </label>
        </section>

        <section class="panel" aria-labelledby="director-identity-heading">
          <h2 id="director-identity-heading">2. Game Director identity</h2>
          <p>Choose Veyra or Garrick first. Each has exactly one player-facing name.</p>
          <ul class="option-list" data-testid="director-identity-list">
            ${catalog.identities
              .map(
                (identity) => `
              <li>
                <label class="option${directorIdentity === identity.id ? ' selected' : ''}" data-testid="identity-${escapeHtml(identity.id)}">
                  <input type="radio" name="director-identity" value="${escapeHtml(identity.id)}"
                    ${directorIdentity === identity.id ? 'checked' : ''} />
                  <span class="option-label">${escapeHtml(identity.label)}</span>
                  <span class="option-summary">${escapeHtml(identity.summary)}</span>
                </label>
              </li>`,
              )
              .join('')}
          </ul>
        </section>

        <section class="panel${personalityLocked ? ' panel-gated' : ''}" aria-labelledby="director-personality-heading">
          <h2 id="director-personality-heading">3. Game Director personality</h2>
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
            ${busy ? 'Creating…' : 'Create campaign'}
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
    });
    nameInput?.addEventListener('change', () => {
      name = nameInput.value;
      render();
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
            });
            shell.announce(`Campaign ${campaign.name} created.`);
            navigate(`/campaigns/${campaign.campaignId}`);
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

  subscribeAccount(() => {
    void load();
  });
  void load();
}
