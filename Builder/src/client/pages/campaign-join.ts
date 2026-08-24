/**
 * Join a table: optional password, character pick, then route to /table.
 */

import type { TablesHubProjection } from '../../shared/campaign-contract.js';
import { ERROR_CODES } from '../../shared/contract.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import {
  ApiFailure,
  fetchCampaignDetail,
  fetchTablesHub,
  fetchVault,
  joinCampaignTable,
} from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import { confirmInApp } from '../confirm-dialog.js';
import { navigate } from '../router.js';
import { rememberPendingJoin } from '../pending-join.js';
import type { PageHost } from './home.js';

type VaultCharacterOption = {
  readonly characterId: string;
  readonly label: string;
};

export function mountCampaignJoinPage(host: PageHost, campaignId: string): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Join table');

  let hub: TablesHubProjection | null = null;
  let tableName = 'Table';
  let passwordProtected = false;
  let password = '';
  let characterId = '';
  let characters: VaultCharacterOption[] = [];
  let charactersLoading = false;
  let alreadySeatedHere = false;
  let seatedCharacterName: string | null = null;
  let busy = false;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  const mountToken = beginPageMount(container);

  function renderAlreadySeated(): void {
    container.innerHTML = `
      <div class="page">
        <h1 data-testid="join-table-heading">Join ${escapeHtml(tableName)}</h1>
        <p class="message success" data-testid="join-already-seated">
          You are already seated here${
            seatedCharacterName === null ? '' : ` as ${escapeHtml(seatedCharacterName)}`
          }.
        </p>
        <div class="actions">
          <a href="/campaigns/${escapeHtml(campaignId)}/table" data-link data-testid="join-open-table">
            Open table
          </a>
          <a href="/campaigns" data-link data-testid="join-table-back">Back to tables</a>
        </div>
      </div>`;
  }

  function renderForm(): void {
    if (alreadySeatedHere) {
      renderAlreadySeated();
      return;
    }
    container.innerHTML = `
      <div class="page">
        <h1 data-testid="join-table-heading">Join ${escapeHtml(tableName)}</h1>
        <p class="tagline">Pick a character you own, then join the table.</p>
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="join-table-error">${escapeHtml(error)}</div>`
        }
        ${
          passwordProtected
            ? `<label class="field">
                 <span>Table password</span>
                 <input type="password" data-testid="join-table-password" autocomplete="current-password"
                   value="${escapeHtml(password)}" />
               </label>`
            : ''
        }
        <label class="field">
          <span>Character</span>
          <select data-testid="join-character-select" ${busy || charactersLoading ? 'disabled' : ''}>
            <option value="">${charactersLoading ? 'Loading characters…' : 'Choose a character…'}</option>
            ${characters
              .map(
                (character) =>
                  `<option value="${escapeHtml(character.characterId)}" ${
                    character.characterId === characterId ? 'selected' : ''
                  }>${escapeHtml(character.label)}</option>`,
              )
              .join('')}
          </select>
        </label>
        ${
          charactersLoading
            ? '<p class="record-meta" data-testid="join-characters-loading">Loading your characters…</p>'
            : ''
        }
        <div class="actions">
          <button type="button" data-testid="join-table-submit"
            aria-disabled="${busy || charactersLoading || characterId.length === 0 ? 'true' : 'false'}">
            ${busy ? 'Joining…' : 'Join table'}
          </button>
          <a href="/campaigns" data-link data-testid="join-table-back">Back to tables</a>
          <a href="/characters/new" data-link data-testid="join-new-character">New character</a>
        </div>
      </div>`;

    container
      .querySelector<HTMLSelectElement>('[data-testid="join-character-select"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) {
          characterId = event.target.value;
          renderForm();
        }
      });

    container
      .querySelector<HTMLInputElement>('[data-testid="join-table-password"]')
      ?.addEventListener('input', (event) => {
        if (event.target instanceof HTMLInputElement) {
          password = event.target.value;
        }
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="join-table-submit"]')
      ?.addEventListener('click', () => {
        void submitJoin(false);
      });
  }

  async function submitJoin(confirmSwitch: boolean): Promise<void> {
    if (candidate === null || characterId.length === 0) {
      error = 'Choose a character before joining.';
      render();
      return;
    }
    busy = true;
    error = null;
    render();
    try {
      await joinCampaignTable({
        candidateId: candidate.candidateId,
        campaignId,
        characterId,
        ...(passwordProtected && password.length > 0 ? { password } : {}),
        ...(confirmSwitch ? { confirmSwitch: true } : {}),
      });
      rememberPendingJoin(campaignId, characterId);
      shell.announce(`Joined ${tableName}.`);
      navigate(`/campaigns/${campaignId}/table`);
    } catch (failure) {
      if (
        failure instanceof ApiFailure &&
        failure.code === ERROR_CODES.ALREADY_AT_ANOTHER_TABLE &&
        !confirmSwitch
      ) {
        const ok = await confirmInApp({
          title: 'Switch tables?',
          body: 'You are seated at another table. Leave that seat and join this one?',
          confirmLabel: 'Switch tables',
          testId: 'confirm-switch-table',
        });
        if (ok) {
          await submitJoin(true);
          return;
        }
        error = null;
        return;
      }
      if (
        failure instanceof ApiFailure &&
        failure.code === ERROR_CODES.ALREADY_SEATED
      ) {
        alreadySeatedHere = true;
        error = null;
        render();
        return;
      }
      error =
        failure instanceof ApiFailure ? failure.message : 'Could not join this table.';
    } finally {
      busy = false;
      if (!alreadySeatedHere) {
        render();
      }
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
        title: 'Join table',
        body: 'Sign in before joining a table.',
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
        setBusy: (value) => {
          gateBusy = value;
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
          <h1 data-testid="join-table-heading">Join table</h1>
          <p class="tagline">Loading table…</p>
        </div>`;
      return;
    }
    renderForm();
  }

  async function loadCharacters(): Promise<void> {
    charactersLoading = true;
    renderForm();
    try {
      const vault = await fetchVault();
      characters = vault.characters.map((character) => ({
        characterId: character.characterId,
        label: `${character.name} — Level ${character.level} ${character.speciesLabel} ${character.classLabel}`,
      }));
    } catch {
      characters = [];
    } finally {
      charactersLoading = false;
      if (isPageMountCurrent(container, mountToken)) {
        renderForm();
      }
    }
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
      alreadySeatedHere = hub.activeSeat?.campaignId === campaignId;
      seatedCharacterName = alreadySeatedHere ? (hub.activeSeat?.characterName ?? null) : null;
      try {
        const detail = await fetchCampaignDetail(campaignId);
        tableName = detail.campaign.name;
        passwordProtected = detail.campaign.passwordProtected;
        if (detail.ownSeat !== null) {
          alreadySeatedHere = true;
          seatedCharacterName = detail.ownSeat.characterName;
        }
      } catch (detailFailure) {
        const fromHub =
          hub.myTables.find((table) => table.campaignId === campaignId) ??
          hub.openTables.find((table) => table.campaignId === campaignId);
        if (fromHub === undefined) {
          throw detailFailure;
        }
        tableName = fromHub.name;
        passwordProtected = fromHub.passwordProtected;
      }
    } catch (failure) {
      hub = null;
      error =
        failure instanceof ApiFailure ? failure.message : 'This table could not be loaded.';
    }
    render();
    if (!alreadySeatedHere && getAccount() !== null) {
      void loadCharacters();
    }
  }

  subscribeAccount(() => {
    void load();
  });
  void load();
}
