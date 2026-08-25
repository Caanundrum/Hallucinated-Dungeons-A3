/**
 * Tables hub: my tables, open lobby, and jump-in join flow entry points.
 */

import type { TablesHubProjection } from '../../shared/campaign-contract.js';
import { MAX_ACTIVE_PLAYERS } from '../../shared/campaign-contract.js';
import { getAccount, isAccountHydrated, subscribeAccount } from '../account-session.js';
import { ApiFailure, fetchTablesHub } from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

type TablesTab = 'mine' | 'open';
type TablesSort = 'updated-desc' | 'updated-asc' | 'name-asc' | 'seats-desc';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function mountCampaignsPage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Tables');

  let hub: TablesHubProjection | null = null;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  let searchQuery = '';
  let tab: TablesTab = 'mine';
  let sort: TablesSort = 'updated-desc';
  const mountToken = beginPageMount(container);

  function sortTables<T extends { name: string; updatedAt: string; activeSeatCount: number }>(
    tables: readonly T[],
  ): T[] {
    const copy = [...tables];
    copy.sort((left, right) => {
      if (sort === 'name-asc') {
        return left.name.localeCompare(right.name);
      }
      if (sort === 'seats-desc') {
        return right.activeSeatCount - left.activeSeatCount || left.name.localeCompare(right.name);
      }
      if (sort === 'updated-asc') {
        return left.updatedAt.localeCompare(right.updatedAt);
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
    return copy;
  }

  function renderSignedIn(): void {
    const myTables = hub?.myTables ?? [];
    const openTables = hub?.openTables ?? [];
    const needle = searchQuery.trim().toLowerCase();
    const filteredMine = sortTables(
      needle.length === 0
        ? myTables
        : myTables.filter((table) =>
            [table.name, table.director.identityLabel, table.director.personalityLabel]
              .join(' ')
              .toLowerCase()
              .includes(needle),
          ),
    );
    const filteredOpen = sortTables(
      needle.length === 0
        ? openTables
        : openTables.filter((table) =>
            [table.name, table.ownerDisplayLabel, table.directorIdentityLabel]
              .join(' ')
              .toLowerCase()
              .includes(needle),
          ),
    );

    container.innerHTML = `
      <div class="page">
        <h1 data-testid="campaigns-heading">Tables</h1>
        <p class="tagline">
          Jump in: pick a table, choose your character, and play. Four seats are active at once;
          membership history is unlimited.
        </p>
        ${
          hub?.activeSeat
            ? `<p class="message notice" data-testid="return-to-table">
                 You are seated at
                 <a href="/campaigns/${escapeHtml(hub.activeSeat.campaignId)}/table" data-link>
                   ${escapeHtml(hub.activeSeat.campaignName)}
                 </a>
                 as ${escapeHtml(hub.activeSeat.characterName)}.
               </p>`
            : ''
        }
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="campaigns-error">${escapeHtml(error)}</div>`
        }
        <div class="actions">
          <button type="button" data-testid="start-campaign">New table</button>
        </div>
        <div class="campaign-list-tools" data-testid="campaign-list-tools">
          <label class="field">
            <span>Search</span>
            <input type="search" data-testid="campaigns-search" placeholder="Name or Director"
              value="${escapeHtml(searchQuery)}" />
          </label>
          <label class="field">
            <span>Sort</span>
            <select data-testid="campaigns-sort">
              <option value="updated-desc" ${sort === 'updated-desc' ? 'selected' : ''}>Newest updated</option>
              <option value="updated-asc" ${sort === 'updated-asc' ? 'selected' : ''}>Oldest updated</option>
              <option value="name-asc" ${sort === 'name-asc' ? 'selected' : ''}>Name A–Z</option>
              <option value="seats-desc" ${sort === 'seats-desc' ? 'selected' : ''}>Most seats filled</option>
            </select>
          </label>
          <div class="actions" role="tablist" aria-label="Table lists">
            <button type="button" role="tab" data-testid="tables-tab-mine"
              aria-selected="${tab === 'mine' ? 'true' : 'false'}">My tables</button>
            <button type="button" role="tab" data-testid="tables-tab-open"
              aria-selected="${tab === 'open' ? 'true' : 'false'}">Open tables</button>
          </div>
        </div>
        <section class="panel" aria-labelledby="table-list-heading">
          <h2 id="table-list-heading">${tab === 'mine' ? 'My tables' : 'Open tables'}</h2>
          ${
            tab === 'mine'
              ? filteredMine.length === 0
                ? '<p class="empty-state" data-testid="campaigns-empty">You have not created or joined a table yet.</p>'
                : `<ul class="record-list" data-testid="campaign-list">
                    ${filteredMine
                      .map((table) => {
                        const seatedHere = hub?.activeSeat?.campaignId === table.campaignId;
                        const href = seatedHere
                          ? `/campaigns/${escapeHtml(table.campaignId)}/table`
                          : `/campaigns/${escapeHtml(table.campaignId)}/join`;
                        return `
                      <li data-testid="campaign-item">
                        <a class="record-note" href="${href}" data-link
                          data-testid="${seatedHere ? 'my-table-open' : 'my-table-join'}">
                          ${escapeHtml(table.name)}${seatedHere ? ' · Seated' : ''}
                        </a>
                        <span class="record-meta">
                          ${escapeHtml(table.director.identityLabel)} · ${escapeHtml(table.director.personalityLabel)}
                          · ${table.isCampaignOwner ? 'Owner' : 'Member'}
                          · ${table.activeSeatCount}/${MAX_ACTIVE_PLAYERS} seated
                          · ${escapeHtml(table.visibility)}
                          ${table.passwordProtected ? ' · 🔒' : ''}
                          ${seatedHere ? ' · your active seat' : ''}
                          · updated ${escapeHtml(formatTimestamp(table.updatedAt))}
                        </span>
                      </li>`;
                      })
                      .join('')}
                  </ul>`
              : filteredOpen.length === 0
                ? '<p class="empty-state" data-testid="open-tables-empty">No public tables are open right now.</p>'
                : `<ul class="record-list" data-testid="open-table-list">
                    ${filteredOpen
                      .map(
                        (table) => `
                      <li data-testid="open-table-item">
                        <a class="record-note" href="/campaigns/${escapeHtml(table.campaignId)}/join" data-link
                          data-testid="open-table-link">
                          ${escapeHtml(table.name)}${table.passwordProtected ? ' 🔒' : ''}
                        </a>
                        <span class="record-meta">
                          Host ${escapeHtml(table.ownerDisplayLabel)}
                          · ${escapeHtml(table.directorIdentityLabel)} · ${escapeHtml(table.directorPersonalityLabel)}
                          · ${table.activeSeatCount}/${MAX_ACTIVE_PLAYERS} seated
                          · updated ${escapeHtml(formatTimestamp(table.updatedAt))}
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
    container
      .querySelector<HTMLInputElement>('[data-testid="campaigns-search"]')
      ?.addEventListener('input', (event) => {
        if (event.target instanceof HTMLInputElement) {
          searchQuery = event.target.value;
          renderSignedIn();
        }
      });
    container
      .querySelector<HTMLSelectElement>('[data-testid="campaigns-sort"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          sort = event.target.value as TablesSort;
          renderSignedIn();
        }
      });
    container.querySelector<HTMLButtonElement>('[data-testid="tables-tab-mine"]')?.addEventListener('click', () => {
      tab = 'mine';
      renderSignedIn();
    });
    container.querySelector<HTMLButtonElement>('[data-testid="tables-tab-open"]')?.addEventListener('click', () => {
      tab = 'open';
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
          <h1 data-testid="campaigns-heading">Tables</h1>
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
        title: 'Tables',
        body: 'Sign in to browse tables and join a game.',
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
    if (hub === null && error === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="campaigns-heading">Tables</h1>
          <p class="tagline" data-testid="campaigns-loading">Loading tables…</p>
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
      hub = await fetchTablesHub();
    } catch (failure) {
      hub = null;
      error = failure instanceof ApiFailure ? failure.message : 'Tables could not be loaded.';
    }
    render();
  }

  subscribeAccount(() => {
    void load();
  });
  void load();
}
