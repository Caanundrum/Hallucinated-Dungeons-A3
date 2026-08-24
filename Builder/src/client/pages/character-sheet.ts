/**
 * A single account-owned character's sheet.
 *
 * Blueprint ownership: Sections 6.5 (derivation and audit) and 7.7 (the
 * server resolves ownership on every sensitive operation — a character
 * belonging to another account is reported exactly as one that does not
 * exist).
 */

import {
  CHARACTER_NAME_MAX_LENGTH,
  CHARACTER_TEXT_MAX_LENGTH,
  type CharacterIdentity,
  type CharacterProjection,
} from '../../shared/character-contract.js';
import { getAccount, subscribeAccount } from '../account-session.js';
import {
  ApiFailure,
  deleteCharacter,
  fetchCharacter,
  updateCharacterIdentity,
} from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { renderCharacterSheet } from '../character-sheet-view.js';
import { confirmInApp } from '../confirm-dialog.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

export function mountCharacterSheetPage(host: PageHost, characterId: string): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Character');

  let character: CharacterProjection | null = null;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  let editingIdentity = false;
  let identityDraft: CharacterIdentity = { name: '', pronouns: '', appearance: '', concept: '' };
  let identityBusy = false;
  let identityError: string | null = null;
  const mountToken = beginPageMount(container);

  function renderSignedIn(): void {
    if (error !== null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="character-sheet-heading">Character unavailable</h1>
          <div class="message error" role="alert" tabindex="-1" data-testid="character-error">${escapeHtml(error)}</div>
          <p><a href="/characters" data-link data-testid="back-to-vault">Back to the Character Vault</a></p>
        </div>`;
      return;
    }

    if (character === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="character-sheet-heading">Loading character…</h1>
        </div>`;
      return;
    }

    shell.setDocumentTitle(character.identity.name);
    container.innerHTML = `
      <div class="page page-wide">
        <h1 data-testid="character-sheet-heading">${escapeHtml(character.identity.name)}</h1>
        <p class="tagline" data-testid="character-summary">
          Level ${character.level} ${escapeHtml(character.speciesLabel)} ${escapeHtml(character.classLabel)}
          · ${escapeHtml(character.backgroundLabel)}
          ${character.identity.pronouns.length > 0 ? `· ${escapeHtml(character.identity.pronouns)}` : ''}
        </p>
        ${
          character.identity.concept.length > 0
            ? `<p>${escapeHtml(character.identity.concept)}</p>`
            : ''
        }
        ${
          character.identity.appearance.length > 0
            ? `<p class="record-meta">${escapeHtml(character.identity.appearance)}</p>`
            : ''
        }
        <section class="panel" aria-labelledby="identity-edit-heading">
          <h2 id="identity-edit-heading">Identity</h2>
          ${
            identityError === null
              ? ''
              : `<div class="message error" role="alert" data-testid="identity-edit-error">${escapeHtml(identityError)}</div>`
          }
          ${
            editingIdentity
              ? `
            <label for="edit-character-name">Name</label>
            <input id="edit-character-name" type="text" data-identity-field="name" data-testid="edit-identity-name"
              maxlength="${CHARACTER_NAME_MAX_LENGTH}" value="${escapeHtml(identityDraft.name)}" />
            <label for="edit-character-pronouns">Pronouns</label>
            <input id="edit-character-pronouns" type="text" data-identity-field="pronouns" data-testid="edit-identity-pronouns"
              maxlength="${CHARACTER_TEXT_MAX_LENGTH}" value="${escapeHtml(identityDraft.pronouns)}" />
            <label for="edit-character-appearance">Appearance</label>
            <input id="edit-character-appearance" type="text" data-identity-field="appearance" data-testid="edit-identity-appearance"
              maxlength="${CHARACTER_TEXT_MAX_LENGTH}" value="${escapeHtml(identityDraft.appearance)}" />
            <label for="edit-character-concept">Concept</label>
            <input id="edit-character-concept" type="text" data-identity-field="concept" data-testid="edit-identity-concept"
              maxlength="${CHARACTER_TEXT_MAX_LENGTH}" value="${escapeHtml(identityDraft.concept)}" />
            <div class="actions">
              <button type="button" data-testid="save-identity" ${identityBusy ? 'disabled' : ''}>Save identity</button>
              <button type="button" data-testid="cancel-identity-edit" ${identityBusy ? 'disabled' : ''}>Cancel</button>
            </div>`
              : `<div class="actions">
              <button type="button" data-testid="edit-identity">Edit identity</button>
            </div>`
          }
        </section>
        ${renderCharacterSheet(character.sheet)}
        <p class="record-meta">Built from the SRD 5.2.1 character creation rules.</p>
        <div class="actions">
          <button type="button" class="danger" data-testid="delete-character">Delete character</button>
          <a href="/characters" data-link data-testid="back-to-vault">Back to the Character Vault</a>
        </div>
      </div>`;

    bindIdentityControls();
    bindSheetTrackers();
  }

  function bindSheetTrackers(): void {
    if (character === null) {
      return;
    }
    container.querySelectorAll<HTMLButtonElement>('[data-sheet-resource]').forEach((button) => {
      button.addEventListener('click', () => {
        if (character === null || button.getAttribute('aria-disabled') === 'true') {
          return;
        }
        const resourceId = button.dataset.sheetResource;
        if (resourceId === undefined || character.sheet.classResources === undefined) {
          return;
        }
        const resources = character.sheet.classResources.map((resource) =>
          resource.id === resourceId && resource.remaining > 0
            ? { ...resource, remaining: resource.remaining - 1 }
            : resource,
        );
        character = {
          ...character,
          sheet: { ...character.sheet, classResources: resources },
        };
        shell.announce(`Spent ${resourceId.replace(/-/g, ' ')}.`);
        renderSignedIn();
      });
    });
    container
      .querySelector<HTMLButtonElement>('[data-testid="spend-spell-slot"]')
      ?.addEventListener('click', () => {
        if (
          character === null ||
          character.sheet.spellcasting === null ||
          character.sheet.spellcasting.level1SlotsRemaining <= 0
        ) {
          return;
        }
        character = {
          ...character,
          sheet: {
            ...character.sheet,
            spellcasting: {
              ...character.sheet.spellcasting,
              level1SlotsRemaining: character.sheet.spellcasting.level1SlotsRemaining - 1,
            },
          },
        };
        shell.announce('Spent a level 1 spell slot.');
        renderSignedIn();
      });
  }

  function bindIdentityControls(): void {
    container.querySelector<HTMLButtonElement>('[data-testid="edit-identity"]')?.addEventListener('click', () => {
      if (character === null) {
        return;
      }
      identityDraft = { ...character.identity };
      identityError = null;
      editingIdentity = true;
      renderSignedIn();
    });

    container.querySelector<HTMLButtonElement>('[data-testid="cancel-identity-edit"]')?.addEventListener('click', () => {
      editingIdentity = false;
      identityError = null;
      renderSignedIn();
    });

    container.querySelectorAll<HTMLInputElement>('[data-identity-field]').forEach((input) => {
      input.addEventListener('input', () => {
        const field = input.dataset.identityField as keyof CharacterIdentity;
        identityDraft = { ...identityDraft, [field]: input.value };
      });
    });

    container.querySelector<HTMLButtonElement>('[data-testid="save-identity"]')?.addEventListener('click', () => {
      void (async () => {
        if (candidate === null || character === null || identityBusy) {
          return;
        }
        identityBusy = true;
        identityError = null;
        renderSignedIn();
        try {
          character = await updateCharacterIdentity({
            candidateId: candidate.candidateId,
            characterId: character.characterId,
            identity: identityDraft,
          });
          editingIdentity = false;
        } catch (failure) {
          identityError =
            failure instanceof ApiFailure ? failure.message : 'Identity could not be saved.';
        } finally {
          identityBusy = false;
          renderSignedIn();
        }
      })();
    });

    container.querySelector<HTMLButtonElement>('[data-testid="delete-character"]')?.addEventListener('click', () => {
      void (async () => {
        if (candidate === null || character === null || identityBusy) {
          return;
        }
        const accepted = await confirmInApp({
          title: 'Delete character?',
          body: `Delete ${character.identity.name || 'this character'} permanently? This cannot be undone.`,
          confirmLabel: 'Delete character',
          cancelLabel: 'Keep character',
          testId: 'confirm-delete-character',
        });
        if (!accepted) {
          return;
        }
        identityBusy = true;
        renderSignedIn();
        try {
          await deleteCharacter({
            candidateId: candidate.candidateId,
            characterId: character.characterId,
          });
          navigate('/characters');
        } catch (failure) {
          identityBusy = false;
          error =
            failure instanceof ApiFailure ? failure.message : 'That character could not be deleted.';
          renderSignedIn();
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
        title: 'Character',
        body: 'Sign in with a Local Arena development account to view characters you own.',
        candidate,
        busy: gateBusy,
        error: gateError,
      });
      bindSignedOutGate({
        container,
        shell,
        candidate,
        onSignedIn: () => {
          void loadCharacter();
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

  async function loadCharacter(): Promise<void> {
    error = null;
    character = null;
    render();
    try {
      character = await fetchCharacter(characterId);
      identityDraft = { ...character.identity };
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'NOT_AUTHENTICATED') {
        render();
        return;
      }
      error =
        failure instanceof ApiFailure
          ? failure.message
          : 'That character could not be loaded.';
    }
    render();
  }

  subscribeAccount(() => {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    if (getAccount() === null) {
      character = null;
      error = null;
      render();
      return;
    }
    void loadCharacter();
  });

  render();
  if (getAccount() !== null) {
    void loadCharacter();
  }
}
