/**
 * Campaign list: every campaign this account owns or has joined.
 *
 * Blueprint ownership: Section 25 Phase 1 (campaigns) and Section 1.5.4
 * (campaign ownership grants no character ownership).
 */

import type { CampaignListProjection } from '../../shared/campaign-contract.js';
import { getAccount, isAccountHydrated, subscribeAccount } from '../account-session.js';
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

type CampaignSort = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc';

export function mountCampaignsPage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Campaigns');

  let list: CampaignListProjection | null = null;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  let searchQuery = '';
  let sortMode: CampaignSort = 'updated_desc';
  const mountToken = beginPageMount(container);

  function filteredCampaigns(): CampaignListProjection['campaigns'] {
    const campaigns = list?.campaigns ?? [];
    const needle = searchQuery.trim().toLowerCase();
    const filtered =
      needle.length === 0
        ? [...campaigns]
        : campaigns.filter((campaign) => {
            const haystack = [
              campaign.name,
              campaign.director.identityLabel,
              campaign.director.personalityLabel,
              campaign.sessionStatusLabel ?? '',
              campaign.isCampaignOwner ? 'owner' : 'member',
            ]
              .join(' ')
              .toLowerCase();
            return haystack.includes(needle);
          });
    filtered.sort((left, right) => {
      if (sortMode === 'name_asc' || sortMode === 'name_desc') {
        const cmp = left.name.localeCompare(right.name);
        return sortMode === 'name_asc' ? cmp : -cmp;
      }
      const leftTime = Date.parse(left.updatedAt) || 0;
      const rightTime = Date.parse(right.updatedAt) || 0;
      return sortMode === 'updated_asc' ? leftTime - rightTime : rightTime - leftTime;
    });
    return filtered;
  }

  function renderSignedIn(): void {
    const campaigns = filteredCampaigns();
    const total = list?.campaigns.length ?? 0;
    container.innerHTML = `
      <div class="page">
        <h1 data-testid="campaigns-heading">Campaigns</h1>
        <p class="tagline">
          ${
            candidate?.environmentClass === 'milestone'
              ? 'Start a table, invite friends, choose who narrates your world, and bring your hero to the session.'
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
            total === 0
              ? '<p class="empty-state" data-testid="campaigns-empty">You have not created or joined a campaign yet.</p>'
              : `
          <div class="campaign-list-tools" data-testid="campaign-list-tools">
            <label class="field">
              <span>Search</span>
              <input type="search" data-testid="campaigns-search" placeholder="Name, Director, owner, or session"
                value="${escapeHtml(searchQuery)}" />
            </label>
            <label class="field">
              <span>Sort</span>
              <select data-testid="campaigns-sort">
                <option value="updated_desc" ${sortMode === 'updated_desc' ? 'selected' : ''}>Updated (newest)</option>
                <option value="updated_asc" ${sortMode === 'updated_asc' ? 'selected' : ''}>Updated (oldest)</option>
                <option value="name_asc" ${sortMode === 'name_asc' ? 'selected' : ''}>Name (A–Z)</option>
                <option value="name_desc" ${sortMode === 'name_desc' ? 'selected' : ''}>Name (Z–A)</option>
              </select>
            </label>
            <p class="record-meta" data-testid="campaigns-filter-meta">
              Showing ${campaigns.length} of ${total}
            </p>
          </div>
          ${
            campaigns.length === 0
              ? '<p class="empty-state" data-testid="campaigns-filter-empty">No campaigns match this search.</p>'
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
                        · Session ${escapeHtml(campaign.sessionStatusLabel ?? 'Not started')}
                        · updated ${escapeHtml(formatTimestamp(campaign.updatedAt))}
                      </span>
                    </li>`,
                    )
                    .join('')}
                </ul>`
          }`
          }
        </section>
      </div>`;

    container
      .querySelector<HTMLButtonElement>('[data-testid="start-campaign"]')
      ?.addEventListener('click', () => navigate('/campaigns/new'));
    container
      .querySelector<HTMLInputElement>('[data-testid="campaigns-search"]')
      ?.addEventListener('input', (event) => {
        if (!(event.target instanceof HTMLInputElement)) {
          return;
        }
        searchQuery = event.target.value;
        renderSignedIn();
        const search = container.querySelector<HTMLInputElement>('[data-testid="campaigns-search"]');
        search?.focus();
        search?.setSelectionRange(search.value.length, search.value.length);
      });
    container
      .querySelector<HTMLSelectElement>('[data-testid="campaigns-sort"]')
      ?.addEventListener('change', (event) => {
        if (!(event.target instanceof HTMLSelectElement)) {
          return;
        }
        sortMode = event.target.value as CampaignSort;
        renderSignedIn();
      });
  }

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    if (!isAccountHydrated()) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="campaigns-heading">Campaigns</h1>
          <p class="tagline" data-testid="campaigns-loading">Checking your session…</p>
        </div>`;
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
    if (list === null && error === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="campaigns-heading">Campaigns</h1>
          <p class="tagline" data-testid="campaigns-loading">Loading your campaigns…</p>
        </div>`;
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
