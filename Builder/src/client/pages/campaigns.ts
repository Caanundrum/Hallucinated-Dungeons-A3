/**
 * Tables hub: my tables, open lobby, and jump-in join flow entry points.
 */

import type { TablesHubProjection } from '../../shared/campaign-contract.js';
import { MAX_ACTIVE_PLAYERS } from '../../shared/campaign-contract.js';
import {
  filterMyTables,
  filterOpenTables,
  type TablesJoinFilter,
  type TablesSeatsFilter,
  type TablesSessionFilter,
  type TablesVisibilityFilter,
} from '../../shared/tables-hub-filters.js';
import { getAccount, isAccountHydrated, subscribeAccount } from '../account-session.js';
import { ApiFailure, fetchTablesHub } from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import {
  bindDirectorAvatarFallback,
  directorIdentityFromLabelOrKey,
  directorPortraitChipMarkup,
} from '../director-avatars.js';
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
  let visibilityFilter: TablesVisibilityFilter = 'all';
  let sessionFilter: TablesSessionFilter = 'all';
  let seatsFilter: TablesSeatsFilter = 'all';
  let joinFilter: TablesJoinFilter = 'all';
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
    const filteredMine = sortTables(
      filterMyTables(myTables, {
        searchNeedle: searchQuery,
        visibility: visibilityFilter,
        session: sessionFilter,
        seats: seatsFilter,
      }),
    );
    const filteredOpen = sortTables(
      filterOpenTables(openTables, {
        searchNeedle: searchQuery,
        seats: seatsFilter,
        join: joinFilter,
      }),
    );
    const sourceCount = tab === 'mine' ? myTables.length : openTables.length;
    const filteredCount = tab === 'mine' ? filteredMine.length : filteredOpen.length;
    const filtersActive =
      searchQuery.trim().length > 0 ||
      (tab === 'mine' && (visibilityFilter !== 'all' || sessionFilter !== 'all')) ||
      seatsFilter !== 'all' ||
      (tab === 'open' && joinFilter !== 'all');

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
            <input type="search" data-testid="campaigns-search" placeholder="Name, Director, or status"
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
          ${
            tab === 'mine'
              ? `<label class="field">
                   <span>Visibility</span>
                   <select data-testid="tables-filter-visibility">
                     <option value="all" ${visibilityFilter === 'all' ? 'selected' : ''}>All visibility</option>
                     <option value="public" ${visibilityFilter === 'public' ? 'selected' : ''}>Public</option>
                     <option value="private" ${visibilityFilter === 'private' ? 'selected' : ''}>Private</option>
                   </select>
                 </label>
                 <label class="field">
                   <span>Session</span>
                   <select data-testid="tables-filter-session">
                     <option value="all" ${sessionFilter === 'all' ? 'selected' : ''}>All sessions</option>
                     <option value="active" ${sessionFilter === 'active' ? 'selected' : ''}>Active</option>
                     <option value="suspended" ${sessionFilter === 'suspended' ? 'selected' : ''}>Suspended</option>
                     <option value="not_started" ${sessionFilter === 'not_started' ? 'selected' : ''}>Not started</option>
                   </select>
                 </label>`
              : `<label class="field">
                   <span>Join</span>
                   <select data-testid="tables-filter-join">
                     <option value="all" ${joinFilter === 'all' ? 'selected' : ''}>All join rules</option>
                     <option value="open_join" ${joinFilter === 'open_join' ? 'selected' : ''}>Open join</option>
                     <option value="password" ${joinFilter === 'password' ? 'selected' : ''}>Password protected</option>
                   </select>
                 </label>`
          }
          <label class="field">
            <span>Seats</span>
            <select data-testid="tables-filter-seats">
              <option value="all" ${seatsFilter === 'all' ? 'selected' : ''}>Any seat count</option>
              <option value="open_seats" ${seatsFilter === 'open_seats' ? 'selected' : ''}>Has open seats</option>
              <option value="full" ${seatsFilter === 'full' ? 'selected' : ''}>Full (${MAX_ACTIVE_PLAYERS}/${MAX_ACTIVE_PLAYERS})</option>
            </select>
          </label>
          <div class="actions" role="tablist" aria-label="Table lists">
            <button type="button" role="tab" data-testid="tables-tab-mine"
              aria-selected="${tab === 'mine' ? 'true' : 'false'}">My tables</button>
            <button type="button" role="tab" data-testid="tables-tab-open"
              aria-selected="${tab === 'open' ? 'true' : 'false'}">Open tables</button>
          </div>
        </div>
        <p class="record-meta" data-testid="tables-filter-summary">
          Showing ${filteredCount} of ${sourceCount} ${tab === 'mine' ? 'joined tables' : 'open tables'}.
          ${filtersActive ? 'Filters are applied client-side.' : 'Use filters to narrow the list.'}
          Archive remains post-Alpha.
        </p>
        <section class="panel" aria-labelledby="table-list-heading">
          <h2 id="table-list-heading">${tab === 'mine' ? 'My tables' : 'Open tables'}</h2>
          ${
            tab === 'mine'
              ? filteredMine.length === 0
                ? `<p class="empty-state" data-testid="campaigns-empty">${
                    myTables.length === 0
                      ? 'You have not created or joined a table yet.'
                      : 'No tables match the current search and filters.'
                  }</p>`
                : `<ul class="record-list" data-testid="campaign-list">
                    ${filteredMine
                      .map((table) => {
                        const seatedHere = hub?.activeSeat?.campaignId === table.campaignId;
                        const href = seatedHere
                          ? `/campaigns/${escapeHtml(table.campaignId)}/table`
                          : `/campaigns/${escapeHtml(table.campaignId)}/join`;
                        const sessionLabel = table.sessionStatusLabel ?? 'Not started';
                        return `
                      <li data-testid="campaign-item" class="table-lobby-row">
                        ${(() => {
                          const identity = table.director.identity;
                          return directorPortraitChipMarkup({
                            identity,
                            label: table.director.identityLabel,
                            testId: `lobby-avatar-${table.campaignId}`,
                          });
                        })()}
                        <div class="table-lobby-copy">
                          <a class="record-note" href="${href}" data-link
                            data-testid="${seatedHere ? 'my-table-open' : 'my-table-join'}">
                            ${escapeHtml(table.name)}${seatedHere ? ' · Seated' : ''}
                          </a>
                          <span class="record-meta">
                            ${escapeHtml(table.director.identityLabel)} · ${escapeHtml(table.director.personalityLabel)}
                            · ${table.isCampaignOwner ? 'Owner' : 'Member'}
                            · ${escapeHtml(sessionLabel)}
                            · ${table.activeSeatCount}/${MAX_ACTIVE_PLAYERS} seated
                            · ${escapeHtml(table.visibility)}
                            ${table.passwordProtected ? ' · 🔒' : ''}
                            ${seatedHere ? ' · your active seat' : ''}
                            · updated ${escapeHtml(formatTimestamp(table.updatedAt))}
                          </span>
                        </div>
                      </li>`;
                      })
                      .join('')}
                  </ul>`
              : filteredOpen.length === 0
                ? `<p class="empty-state" data-testid="open-tables-empty">${
                    openTables.length === 0
                      ? 'No public tables are open right now.'
                      : 'No open tables match the current search and filters.'
                  }</p>`
                : `<ul class="record-list" data-testid="open-table-list">
                    ${filteredOpen
                      .map((table) => {
                        const identity = directorIdentityFromLabelOrKey(table.directorIdentityLabel);
                        return `
                      <li data-testid="open-table-item" class="table-lobby-row">
                        ${
                          identity === null
                            ? ''
                            : directorPortraitChipMarkup({
                                identity,
                                label: table.directorIdentityLabel,
                                testId: `open-lobby-avatar-${table.campaignId}`,
                              })
                        }
                        <div class="table-lobby-copy">
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
                        </div>
                      </li>`;
                      })
                      .join('')}
                  </ul>`
          }
        </section>
      </div>`;

    for (const table of filteredMine) {
      bindDirectorAvatarFallback(
        container,
        `lobby-avatar-${table.campaignId}`,
        table.director.identityLabel,
      );
    }
    for (const table of filteredOpen) {
      bindDirectorAvatarFallback(
        container,
        `open-lobby-avatar-${table.campaignId}`,
        table.directorIdentityLabel,
      );
    }
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
    container
      .querySelector<HTMLSelectElement>('[data-testid="tables-filter-visibility"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          visibilityFilter = event.target.value as TablesVisibilityFilter;
          renderSignedIn();
        }
      });
    container
      .querySelector<HTMLSelectElement>('[data-testid="tables-filter-session"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          sessionFilter = event.target.value as TablesSessionFilter;
          renderSignedIn();
        }
      });
    container
      .querySelector<HTMLSelectElement>('[data-testid="tables-filter-seats"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          seatsFilter = event.target.value as TablesSeatsFilter;
          renderSignedIn();
        }
      });
    container
      .querySelector<HTMLSelectElement>('[data-testid="tables-filter-join"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          joinFilter = event.target.value as TablesJoinFilter;
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
