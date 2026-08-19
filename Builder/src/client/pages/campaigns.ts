/**
 * Campaign list: every campaign this account owns or has joined.
 *
 * Blueprint ownership: Section 25 Phase 1 (campaigns) and Section 1.5.4
 * (campaign ownership grants no character ownership).
 */

import type { CampaignListProjection } from '../../shared/campaign-contract.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import { ApiFailure, fetchCampaigns } from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function mountCampaignsPage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Campaigns');

  let list: CampaignListProjection | null = null;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  const mountToken = beginPageMount(container);

  function renderSignedIn(): void {
    const campaigns = list?.campaigns ?? [];
    container.innerHTML = `
      <div class="page">
        <h1 data-testid="campaigns-heading">Campaigns</h1>
        <p class="tagline">
          ${
            candidate?.environmentClass === 'milestone'
              ? 'Create a table, lock its Game Director configuration, invite other players, and seat a character you own.'
              : 'Create a table, lock its Game Director configuration, invite another Local Arena account, and seat a character you own. Hosting a campaign never grants ownership of another player\'s character.'
          }
        </p>
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="campaigns-error">${escapeHtml(error)}</div>`
        }
        <div class="actions">
          <button type="button" data-testid="start-campaign">Create a campaign</button>
        </div>
        <section class="panel" aria-labelledby="campaign-list-heading">
          <h2 id="campaign-list-heading">Your campaigns</h2>
          ${
            campaigns.length === 0
              ? '<p class="empty-state" data-testid="campaigns-empty">You have not created or joined a campaign yet.</p>'
              : `<ul class="record-list" data-testid="campaign-list">
                  ${campaigns
                    .map(
                      (campaign) => `
                    <li data-testid="campaign-item">
                      <a class="record-note" href="/campaigns/${escapeHtml(campaign.campaignId)}" data-link data-testid="campaign-link">
                        ${escapeHtml(campaign.name)}
                      </a>
                      <span class="record-meta">
                        ${escapeHtml(campaign.director.identityLabel)} · ${escapeHtml(campaign.director.personalityLabel)}
                        · ${campaign.isCampaignOwner ? 'Owner' : 'Member'}
                        · ${campaign.memberCount} member${campaign.memberCount === 1 ? '' : 's'}
                        · updated ${escapeHtml(formatTimestamp(campaign.updatedAt))}
                      </span>
                    </li>`,
                    )
                    .join('')}
                </ul>`
          }
        </section>
      </div>`;

    container
      .querySelector<HTMLButtonElement>('[data-testid="start-campaign"]')
      ?.addEventListener('click', () => navigate('/campaigns/new'));
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
        title: 'Campaigns',
        body: 'Sign in with a Local Arena development account to create or join campaigns.',
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
        setBusy: (busy) => {
          gateBusy = busy;
        },
        setError: (message) => {
          gateError = message;
        },
        render,
      });
      return;
    }
    renderSignedIn();
  }

  async function load(): Promise<void> {
    if (getAccount() === null) {
      render();
      return;
    }
    error = null;
    render();
    try {
      list = await fetchCampaigns();
    } catch (failure) {
      list = null;
      error =
        failure instanceof ApiFailure
          ? failure.message
          : 'Campaigns could not be loaded.';
    }
    render();
  }

  subscribeAccount(() => {
    void load();
  });
  void load();
}
