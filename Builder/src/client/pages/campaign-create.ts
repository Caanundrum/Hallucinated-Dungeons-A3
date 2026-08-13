/**
 * Campaign creation with explicit Veyra/Garrick and personality selection.
 *
 * Blueprint ownership: Section 1.5.21. Friendly Adventurer may be recommended;
 * nothing is silently selected. The choice locks after create.
 */

import type { DirectorCatalog } from '../../shared/campaign-contract.js';
import {
  CAMPAIGN_NAME_MAX_LENGTH,
  CAMPAIGN_SUMMARY_MAX_LENGTH,
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
  let directorIdentity: string | null = null;
  let directorPersonality: string | null = null;
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

  function renderForm(): void {
    if (catalog === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="create-campaign-heading">Create a campaign</h1>
          <p class="tagline">Loading Game Director options…</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="page">
        <h1 data-testid="create-campaign-heading">Create a campaign</h1>
        <p class="tagline">
          Choose the campaign title, then choose a Game Director identity and one personality.
          Both lock after creation. This is configuration for the later AI-enabled table — it does
          not activate AI narration here.
        </p>
        <p class="message notice" data-testid="director-config-notice">${escapeHtml(catalog.configurationNotice)}</p>
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="create-campaign-error">${escapeHtml(error)}</div>`
        }

        <section class="panel" aria-labelledby="campaign-basics-heading">
          <h2 id="campaign-basics-heading">Campaign</h2>
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
          <h2 id="director-identity-heading">Game Director identity</h2>
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

        <section class="panel" aria-labelledby="director-personality-heading">
          <h2 id="director-personality-heading">Game Director personality</h2>
          <p>
            Choose one approved personality after the identity. Friendly Adventurer may be
            recommended; nothing is selected until you choose.
          </p>
          <ul class="option-list" data-testid="director-personality-list">
            ${catalog.personalities
              .map(
                (personality) => `
              <li>
                <label class="option${directorPersonality === personality.id ? ' selected' : ''}" data-testid="personality-${escapeHtml(personality.id)}">
                  <input type="radio" name="director-personality" value="${escapeHtml(personality.id)}"
                    ${directorPersonality === personality.id ? 'checked' : ''} />
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

        <div class="actions">
          <button type="button" data-testid="create-campaign-submit"
            aria-disabled="${canSubmit() ? 'false' : 'true'}">
            ${busy ? 'Creating…' : 'Create campaign'}
          </button>
          <a href="/campaigns" data-link data-testid="cancel-create-campaign">Back to campaigns</a>
        </div>
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
        directorIdentity = input.value;
        render();
      });
    });

    container
      .querySelectorAll<HTMLInputElement>('input[name="director-personality"]')
      .forEach((input) => {
        input.addEventListener('change', () => {
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
