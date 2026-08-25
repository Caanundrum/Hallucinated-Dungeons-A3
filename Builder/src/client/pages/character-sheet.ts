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
  updateCharacterLoadout,
  updateCharacterTrackers,
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
  let editingLoadout = false;
  let identityDraft: CharacterIdentity = { name: '', pronouns: '', appearance: '', concept: '' };
  let loadoutSpellIds: string[] = [];
  let loadoutClassEquipment: string | null = null;
  let loadoutBackgroundEquipment: string | null = null;
  let loadoutMasteries: string[] = [];
  let loadoutOriginFeat: string | null = null;
  let identityBusy = false;
  let identityError: string | null = null;
  let loadoutBusy = false;
  let loadoutError: string | null = null;
  let trackerBusy = false;
  const mountToken = beginPageMount(container);

  function renderLoadoutEditor(): string {
    if (character === null || !editingLoadout) {
      return `
        <section class="panel" aria-labelledby="loadout-edit-heading" data-testid="loadout-panel">
          <h2 id="loadout-edit-heading">Prepared spells and equipment</h2>
          <p class="record-meta">Change prepared spells, starting kits, and weapon masteries without recreating the character.</p>
          <div class="actions">
            <button type="button" data-testid="edit-loadout">Edit loadout</button>
          </div>
        </section>`;
    }
    const options = character.editOptions;
    const spellOptions = options.classDetail?.spellcasting?.spellOptions ?? [];
    const spellLimit = options.classDetail?.spellcasting?.spellsAvailable ?? spellOptions.length;
    const classKits = options.classDetail?.equipmentOptions ?? [];
    const backgroundKits = options.backgroundDetail?.equipmentOptions ?? [];
    const mastery = options.weaponMastery;
    const originFeatOptions = options.originFeatOptions;
    return `
      <section class="panel" aria-labelledby="loadout-edit-heading" data-testid="loadout-panel">
        <h2 id="loadout-edit-heading">Edit loadout</h2>
        ${
          loadoutError === null
            ? ''
            : `<div class="message error" role="alert" data-testid="loadout-edit-error">${escapeHtml(loadoutError)}</div>`
        }
        ${
          originFeatOptions !== null && originFeatOptions.length > 0
            ? `<h3>Human Versatile Origin feat</h3>
          <p class="record-meta">Names the Human Versatile choice on your sheet (PQA-195).</p>
          <ul class="record-list" data-testid="loadout-origin-feat-options">
            ${originFeatOptions
              .map(
                (feat) => `<li><label>
              <input type="radio" name="loadout-origin-feat" value="${escapeHtml(feat.id)}"
                data-testid="loadout-origin-feat-${escapeHtml(feat.id.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}"
                ${loadoutOriginFeat === feat.id ? 'checked' : ''} ${loadoutBusy ? 'disabled' : ''} />
              ${escapeHtml(feat.label)}
            </label></li>`,
              )
              .join('')}
          </ul>`
            : ''
        }
        ${
          spellOptions.length > 0
            ? `<h3>Prepared / known spells</h3>
          <p class="record-meta">Choose up to ${spellLimit}.</p>
          <ul class="record-list" data-testid="loadout-spell-options">
            ${spellOptions
              .map((spell) => {
                const checked = loadoutSpellIds.includes(spell.id);
                const locked = !checked && loadoutSpellIds.length >= spellLimit;
                return `<li><label>
                  <input type="checkbox" data-loadout-spell="${escapeHtml(spell.id)}"
                    data-testid="loadout-spell-${escapeHtml(spell.id)}"
                    ${checked ? 'checked' : ''} ${locked || loadoutBusy ? 'disabled' : ''} />
                  ${escapeHtml(spell.label)}
                </label></li>`;
              })
              .join('')}
          </ul>`
            : '<p class="record-meta" data-testid="loadout-no-spells">This class has no spell preparation list at level 1.</p>'
        }
        ${
          classKits.length > 0
            ? `<h3>Class starting kit</h3>
          <ul class="record-list" data-testid="loadout-class-equipment">
            ${classKits
              .map(
                (kit) => `<li><label>
              <input type="radio" name="loadout-class-equipment" value="${escapeHtml(kit.id)}"
                data-testid="loadout-class-kit-${escapeHtml(kit.id)}"
                ${loadoutClassEquipment === kit.id ? 'checked' : ''} ${loadoutBusy ? 'disabled' : ''} />
              ${escapeHtml(kit.label)}
            </label></li>`,
              )
              .join('')}
          </ul>`
            : ''
        }
        ${
          backgroundKits.length > 0
            ? `<h3>Background starting kit</h3>
          <ul class="record-list" data-testid="loadout-background-equipment">
            ${backgroundKits
              .map(
                (kit) => `<li><label>
              <input type="radio" name="loadout-background-equipment" value="${escapeHtml(kit.id)}"
                data-testid="loadout-background-kit-${escapeHtml(kit.id)}"
                ${loadoutBackgroundEquipment === kit.id ? 'checked' : ''} ${loadoutBusy ? 'disabled' : ''} />
              ${escapeHtml(kit.label)}
            </label></li>`,
              )
              .join('')}
          </ul>`
            : ''
        }
        ${
          mastery === null
            ? ''
            : `<h3>Weapon masteries</h3>
          <p class="record-meta">Choose up to ${mastery.slotCount}. Unassigned slots remain visible on the sheet.</p>
          <ul class="record-list" data-testid="loadout-mastery-options">
            ${mastery.options
              .map((option) => {
                const checked = loadoutMasteries.includes(option.id);
                const locked = !checked && loadoutMasteries.length >= mastery.slotCount;
                return `<li><label>
                  <input type="checkbox" data-loadout-mastery="${escapeHtml(option.id)}"
                    data-testid="loadout-mastery-${escapeHtml(option.id.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}"
                    ${checked ? 'checked' : ''} ${locked || loadoutBusy ? 'disabled' : ''} />
                  ${escapeHtml(option.label)}
                </label></li>`;
              })
              .join('')}
          </ul>`
        }
        <div class="actions">
          <button type="button" data-testid="save-loadout" ${loadoutBusy ? 'disabled' : ''}>Save loadout</button>
          <button type="button" class="secondary" data-testid="cancel-loadout-edit" ${loadoutBusy ? 'disabled' : ''}>Cancel</button>
        </div>
      </section>`;
  }

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
        ${renderLoadoutEditor()}
        ${renderCharacterSheet(character.sheet)}
        <p class="record-meta">Built from the SRD 5.2.1 character creation rules.</p>
        <p class="record-meta" data-testid="character-archive-scope">
          Archive and restore are post-Alpha. Delete removes this character permanently.
        </p>
        <div class="actions">
          <button type="button" class="danger" data-testid="delete-character">Delete character permanently</button>
          <a href="/characters" data-link data-testid="back-to-vault">Back to the Character Vault</a>
        </div>
      </div>`;

    bindIdentityControls();
    bindLoadoutControls();
    bindSheetTrackers();
  }

  async function persistTrackers(
    patch: Parameters<typeof updateCharacterTrackers>[0] extends infer T
      ? Omit<T, 'candidateId' | 'characterId'>
      : never,
    announce: string,
  ): Promise<void> {
    if (candidate === null || character === null || trackerBusy) {
      return;
    }
    trackerBusy = true;
    try {
      character = await updateCharacterTrackers({
        candidateId: candidate.candidateId,
        characterId: character.characterId,
        ...patch,
      });
      shell.announce(announce);
    } catch (failure) {
      shell.announce(
        failure instanceof ApiFailure ? failure.message : 'Could not save character trackers.',
      );
    } finally {
      trackerBusy = false;
      renderSignedIn();
    }
  }

  function currentEquipmentOverrides(): {
    name: string;
    quantity: number;
    equipped?: boolean;
  }[] {
    if (character === null) {
      return [];
    }
    return character.sheet.equipment.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      ...(item.equipped === undefined ? {} : { equipped: item.equipped }),
    }));
  }

  function bindSheetTrackers(): void {
    if (character === null) {
      return;
    }
    container.querySelectorAll<HTMLButtonElement>('[data-sheet-resource]').forEach((button) => {
      button.addEventListener('click', () => {
        void (async () => {
          if (character === null || button.getAttribute('aria-disabled') === 'true') {
            return;
          }
          const resourceId = button.dataset.sheetResource;
          if (resourceId === undefined || character.sheet.classResources === undefined) {
            return;
          }
          const resource = character.sheet.classResources.find((entry) => entry.id === resourceId);
          if (resource === undefined || resource.remaining <= 0) {
            return;
          }
          await persistTrackers(
            { resourceRemaining: { [resourceId]: resource.remaining - 1 } },
            `Spent ${resource.label}.`,
          );
        })();
      });
    });
    container
      .querySelector<HTMLButtonElement>('[data-testid="spend-spell-slot"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (
            character === null ||
            character.sheet.spellcasting === null ||
            character.sheet.spellcasting.level1SlotsRemaining <= 0
          ) {
            return;
          }
          await persistTrackers(
            {
              level1SlotsRemaining: character.sheet.spellcasting.level1SlotsRemaining - 1,
            },
            'Spent a level 1 spell slot.',
          );
        })();
      });

    container.querySelectorAll<HTMLButtonElement>('[data-sheet-hp]').forEach((button) => {
      button.addEventListener('click', () => {
        void (async () => {
          if (character === null || button.getAttribute('aria-disabled') === 'true') {
            return;
          }
          const action = button.dataset.sheetHp;
          const maxHp = character.sheet.hitPoints.value;
          let hitPointsCurrent = character.sheet.hitPointsCurrent;
          let temporaryHitPoints = character.sheet.temporaryHitPoints ?? 0;
          let announce = '';
          if (action === 'damage') {
            if (temporaryHitPoints > 0) {
              temporaryHitPoints -= 1;
              announce = 'Absorbed 1 damage with temporary Hit Points.';
            } else {
              hitPointsCurrent = Math.max(0, hitPointsCurrent - 1);
              announce = 'Took 1 damage.';
            }
          } else if (action === 'heal') {
            hitPointsCurrent = Math.min(maxHp, hitPointsCurrent + 1);
            announce = 'Healed 1 Hit Point.';
          } else if (action === 'temp') {
            temporaryHitPoints += 1;
            announce = 'Gained 1 temporary Hit Point.';
          } else if (action === 'clear-temp') {
            temporaryHitPoints = 0;
            announce = 'Cleared temporary Hit Points.';
          } else {
            return;
          }
          await persistTrackers({ hitPointsCurrent, temporaryHitPoints }, announce);
        })();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-sheet-equip]').forEach((button) => {
      button.addEventListener('click', () => {
        void (async () => {
          if (character === null) {
            return;
          }
          const index = Number(button.dataset.sheetEquip);
          if (!Number.isInteger(index) || index < 0 || index >= character.sheet.equipment.length) {
            return;
          }
          const overrides = currentEquipmentOverrides();
          const item = overrides[index]!;
          overrides[index] = { ...item, equipped: item.equipped !== true };
          await persistTrackers(
            { equipmentOverrides: overrides },
            `${item.name} ${item.equipped === true ? 'unequipped' : 'equipped'}.`,
          );
        })();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-sheet-qty]').forEach((button) => {
      button.addEventListener('click', () => {
        void (async () => {
          if (character === null || button.getAttribute('aria-disabled') === 'true') {
            return;
          }
          const index = Number(button.dataset.sheetQty);
          const delta = Number(button.dataset.delta);
          if (!Number.isInteger(index) || !Number.isFinite(delta)) {
            return;
          }
          const overrides = currentEquipmentOverrides();
          const item = overrides[index];
          if (item === undefined) {
            return;
          }
          overrides[index] = { ...item, quantity: Math.max(0, item.quantity + delta) };
          await persistTrackers(
            { equipmentOverrides: overrides },
            `Updated ${item.name} quantity.`,
          );
        })();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-sheet-consume]').forEach((button) => {
      button.addEventListener('click', () => {
        void (async () => {
          if (character === null) {
            return;
          }
          const index = Number(button.dataset.sheetConsume);
          const overrides = currentEquipmentOverrides();
          const item = overrides[index];
          if (item === undefined || item.quantity <= 0) {
            return;
          }
          overrides[index] = { ...item, quantity: item.quantity - 1 };
          await persistTrackers({ equipmentOverrides: overrides }, `Consumed one ${item.name}.`);
        })();
      });
    });
  }

  function bindLoadoutControls(): void {
    container.querySelector<HTMLButtonElement>('[data-testid="edit-loadout"]')?.addEventListener('click', () => {
      if (character === null) {
        return;
      }
      loadoutSpellIds = [...character.choices.spellIds];
      loadoutClassEquipment = character.choices.classEquipmentOptionId;
      loadoutBackgroundEquipment = character.choices.backgroundEquipmentOptionId;
      loadoutMasteries = [...character.choices.weaponMasteryWeaponNames];
      loadoutOriginFeat = character.choices.chosenOriginFeatId;
      loadoutError = null;
      editingLoadout = true;
      renderSignedIn();
    });

    container
      .querySelector<HTMLButtonElement>('[data-testid="cancel-loadout-edit"]')
      ?.addEventListener('click', () => {
        editingLoadout = false;
        loadoutError = null;
        renderSignedIn();
      });

    container.querySelectorAll<HTMLInputElement>('[data-loadout-spell]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = input.dataset.loadoutSpell;
        if (id === undefined) {
          return;
        }
        if (input.checked) {
          loadoutSpellIds = [...loadoutSpellIds, id];
        } else {
          loadoutSpellIds = loadoutSpellIds.filter((entry) => entry !== id);
        }
        renderSignedIn();
      });
    });

    container.querySelectorAll<HTMLInputElement>('[data-loadout-mastery]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = input.dataset.loadoutMastery;
        if (id === undefined) {
          return;
        }
        if (input.checked) {
          loadoutMasteries = [...loadoutMasteries, id];
        } else {
          loadoutMasteries = loadoutMasteries.filter((entry) => entry !== id);
        }
        renderSignedIn();
      });
    });

    container
      .querySelectorAll<HTMLInputElement>('input[name="loadout-class-equipment"]')
      .forEach((input) => {
        input.addEventListener('change', () => {
          if (input.checked) {
            loadoutClassEquipment = input.value;
          }
        });
      });

    container
      .querySelectorAll<HTMLInputElement>('input[name="loadout-background-equipment"]')
      .forEach((input) => {
        input.addEventListener('change', () => {
          if (input.checked) {
            loadoutBackgroundEquipment = input.value;
          }
        });
      });

    container
      .querySelectorAll<HTMLInputElement>('input[name="loadout-origin-feat"]')
      .forEach((input) => {
        input.addEventListener('change', () => {
          if (input.checked) {
            loadoutOriginFeat = input.value;
          }
        });
      });

    container.querySelector<HTMLButtonElement>('[data-testid="save-loadout"]')?.addEventListener('click', () => {
      void (async () => {
        if (candidate === null || character === null || loadoutBusy) {
          return;
        }
        loadoutBusy = true;
        loadoutError = null;
        renderSignedIn();
        try {
          character = await updateCharacterLoadout({
            candidateId: candidate.candidateId,
            characterId: character.characterId,
            spellIds: loadoutSpellIds,
            classEquipmentOptionId: loadoutClassEquipment,
            backgroundEquipmentOptionId: loadoutBackgroundEquipment,
            weaponMasteryWeaponNames: loadoutMasteries,
            ...(character.editOptions.originFeatOptions !== null
              ? { chosenOriginFeatId: loadoutOriginFeat }
              : {}),
          });
          editingLoadout = false;
          shell.announce('Loadout saved.');
        } catch (failure) {
          loadoutError =
            failure instanceof ApiFailure ? failure.message : 'Loadout could not be saved.';
        } finally {
          loadoutBusy = false;
          renderSignedIn();
        }
      })();
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
          title: 'Delete character permanently?',
          body: `Delete ${character.identity.name || 'this character'} permanently? Archive is post-Alpha — this cannot be undone.`,
          confirmLabel: 'Delete permanently',
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
