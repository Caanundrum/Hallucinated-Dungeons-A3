/**
 * Join a table: optional password, character pick, then route to /table.
 */

import { CAMPAIGN_VISIBILITY_LABELS } from '../../shared/campaign-contract.js';
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
import type { PageHost } from './home.js';

export function mountCampaignJoinPage(host: PageHost, campaignId: string): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Join table');

  let hub: TablesHubProjection | null = null;
  let tableName = 'Table';
  let passwordProtected = false;
  let password = '';
  let characterId = '';
  let busy = false;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  const mountToken = beginPageMount(container);

  function renderForm(): void {
    const characters = hub === null ? [] : [];
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
          <select data-testid="join-character-select" ${busy ? 'disabled' : ''}>
            <option value="">Choose a character…</option>
          </select>
        </label>
        <div class="actions">
          <button type="button" data-testid="join-table-submit" aria-disabled="${busy ? 'true' : 'false'}">
            ${busy ? 'Joining…' : 'Join table'}
          </button>
          <a href="/campaigns" data-link data-testid="join-table-back">Back to tables</a>
          <a href="/characters/new" data-link data-testid="join-new-character">New character</a>
        </div>
      </div>`;

    const select = container.querySelector<HTMLSelectElement>('[data-testid="join-character-select"]');
    void (async () => {
      try {
        const vault = await fetchVault();
        for (const character of vault.characters) {
          const option = document.createElement('option');
          option.value = character.characterId;
          option.textContent = `${character.name} — Level ${character.level} ${character.speciesLabel} ${character.classLabel}`;
          select?.append(option);
        }
        if (characterId.length > 0) {
          select!.value = characterId;
        }
      } catch {
        // Vault load failure surfaces on submit.
      }
    })();

    select?.addEventListener('change', () => {
      characterId = select.value;
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
      shell.announce(`Joined ${tableName}.`);
      navigate(`/campaigns/${campaignId}/table`);
    } catch (failure) {
      if (
        failure instanceof ApiFailure &&
        failure.code === ERROR_CODES.ALREADY_AT_ANOTHER_TABLE &&
        !confirmSwitch
      ) {
        const ok = await confirmInApp(
          'Switch tables?',
          'You are seated at another table. Leave that seat and join this one?',
        );
        if (ok) {
          await submitJoin(true);
          return;
        }
      }
      error =
        failure instanceof ApiFailure ? failure.message : 'Could not join this table.';
    } finally {
      busy = false;
      render();
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

  async function load(): Promise<void> {
    if (getAccount() === null) {
      render();
      return;
    }
    error = null;
    render();
    try {
      const [hubPayload, detail] = await Promise.all([
        fetchTablesHub(),
        fetchCampaignDetail(campaignId),
      ]);
      hub = hubPayload;
      tableName = detail.campaign.name;
      passwordProtected = detail.campaign.passwordProtected;
    } catch (failure) {
      hub = null;
      error =
        failure instanceof ApiFailure ? failure.message : 'This table could not be loaded.';
    }
    render();
  }

  subscribeAccount(() => {
    void load();
  });
  void load();
}
