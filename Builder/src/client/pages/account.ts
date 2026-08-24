/**
 * The Account page: Phase 1's product surface for the Development Test Identity.
 *
 * Blueprint ownership: Section 1.5.20 and P1-ACCOUNT-PROJECTION. No second
 * identity provider, password, or Google flow appears here. The page projects
 * the existing Local Arena identity as the account that owns characters and
 * (later) campaigns.
 */

import {
  NARRATION_DENSITIES,
  NARRATION_DENSITY_LABELS,
  NARRATION_DENSITY_SUMMARIES,
  isNarrationDensity,
  type NarrationDensity,
} from '../../shared/settings-contract.js';
import { getAccount, signInAccount, signInGoogleEmulator, signOutAccount, subscribeAccount, updateAccountDisplayLabel } from '../account-session.js';
import {
  ApiFailure,
  acceptLegalDocument,
  fetchAccountDeletionStatus,
  fetchGoldMasterPackage,
  fetchLegalAcceptance,
  fetchPlayerSettings,
  requestAccountDeletion,
  savePlayerSettings,
  type AccountDeletionStatusProjection,
  type GoldMasterPackageProjection,
  type LegalAcceptanceProjection,
} from '../api.js';
import { escapeHtml } from '../dom-utils.js';
import { mountHostedGoogleSignInButton } from '../hosted-google-sign-in.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { isHostedPlayerSurface } from '../player-surface.js';
import {
  applyPresentationPreferences,
  clearPresentationPreferences,
} from '../presentation-preferences.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

const ACCOUNT_GATE_MOTIF = `
  <svg class="account-gate-motif" width="72" height="72" viewBox="0 0 96 96" fill="none" aria-hidden="true" focusable="false">
    <path d="M20 88 V48 A28 28 0 0 1 76 48 V88" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
    <path d="M12 88 H84" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
    <path d="M30 88 V56" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.6" />
    <path d="M66 88 V56" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.6" />
  </svg>`;

export function mountAccountPage(host: PageHost): void {
  const { container, shell, candidate } = host;

  if (isHostedPlayerSurface(candidate) && getAccount() === null) {
    navigate('/', { replace: true });
    return;
  }

  shell.setPresentationMode('app');
  shell.setDocumentTitle('Account');

  let busy = false;
  let error: string | null = null;
  let reducedMotion = false;
  let lowEffects = false;
  let textToSpeechEnabled = false;
  let speechToTextEnabled = false;
  let narrationDensity: NarrationDensity = 'balanced';
  let deletionStatus: AccountDeletionStatusProjection | null = null;
  let googleEmail = 'phase7-player@example.com';
  let legalAcceptance: LegalAcceptanceProjection | null = null;
  let goldMaster: GoldMasterPackageProjection | null = null;
  let displayNameDraft = '';
  let displayNameSavedMessage: string | null = null;
  let presentationSavedMessage: string | null = null;
  const goldMasterSurface = candidate?.publicSurface === 'gold_master';
  const hostedSurface =
    candidate?.environmentClass === 'milestone' || candidate?.publicSurface === 'gold_master';
  const hostedGoogleClientId = candidate?.hostedGoogleClientId ?? null;
  const mountToken = beginPageMount(container);
  const searchParams = new URLSearchParams(window.location.search);
  if (error === null && searchParams.get('auth_error') === 'google_signin_failed') {
    error = 'We couldn\u2019t finish signing you in. Please try again.';
  }

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    const account = getAccount();

    if (account !== null && displayNameDraft.length === 0) {
      displayNameDraft = account.displayLabel;
    }

    if (account === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="account-heading">Account</h1>
          <p class="tagline">
            ${
              hostedSurface || goldMasterSurface
                ? 'Your Google account is your doorway into character creation, campaigns, and the table.'
                : 'Local Arena testing can mint a development account. Hosted Gold Master artifacts use Google Sign-In only.'
            }
          </p>
          ${
            error === null
              ? ''
              : `<div class="message error" role="alert" tabindex="-1" data-testid="account-error">${escapeHtml(error)}</div>`
          }
          ${
            hostedSurface || goldMasterSurface
              ? ''
              : `<section class="panel" aria-labelledby="sign-in-heading">
            <h2 id="sign-in-heading">Development account</h2>
            <p>
              The server mints a temporary development identity for local testing.
              There is no password to create or store. This path is stripped from Gold Master artifacts.
            </p>
            <div class="actions">
              ${
                candidate === null
                  ? `<button type="button" data-testid="account-retry-candidate">Retry connection</button>`
                  : `<button type="button" data-testid="account-enter"
                       aria-disabled="${busy}">
                       ${busy ? 'Signing in…' : 'Sign in for local testing'}
                     </button>`
              }
            </div>
          </section>`
          }
          <section class="panel" aria-labelledby="google-sign-in-heading">
            <h2 id="google-sign-in-heading">Google Sign-In</h2>
            <p>
              ${
                hostedSurface || hostedGoogleClientId !== null
                  ? 'Hosted players enter with Google. One account carries your heroes and your place at the table.'
                  : 'Hosted player identity is Google-only. On this Local Arena host the control talks to the Auth emulator — it is not a live OAuth popup against a public Google Cloud project.'
              }
            </p>
            ${
              hostedSurface || hostedGoogleClientId !== null
                ? `<p class="record-meta">
              Use the official Google button below to continue.
            </p>`
                : `<label class="field">
              <span>Emulator email</span>
              <input type="email" data-testid="account-google-email" value="${escapeHtml(googleEmail)}" />
            </label>
            <div class="actions">
              ${
                candidate === null
                  ? `<button type="button" data-testid="account-retry-candidate">Retry connection</button>`
                  : `<button type="button" data-testid="account-google-emulator-enter"
                       aria-disabled="${busy}">
                       ${busy ? 'Signing in…' : 'Sign in with Google emulator'}
                     </button>`
              }
            </div>`
            }
          </section>
          ${
            hostedSurface || hostedGoogleClientId !== null
              ? `<section class="account-gate panel" aria-labelledby="hosted-account-gate-heading">
            <div class="account-gate-copy">
              <div class="account-gate-mark">${ACCOUNT_GATE_MOTIF}</div>
              <p class="account-gate-eyebrow">Invite-only alpha</p>
              <h2 id="hosted-account-gate-heading">Step through</h2>
              <p class="account-gate-body">
                One Google account for your heroes, your campaigns, and your seat at the table.
              </p>
            </div>
            <div class="account-gate-actions">
              ${
                candidate === null
                  ? `<button type="button" data-testid="account-retry-candidate">Retry connection</button>`
                  : hostedGoogleClientId !== null
                    ? `<div class="hosted-google-sign-in" data-testid="account-google-hosted-button"></div>`
                    : `<p class="record-meta">Google Sign-In is configured for this hosted surface.</p>`
              }
            </div>
            <p class="account-gate-note record-meta">
              Signing in with Google shares your account with Hallucinated Dungeons as described in our
              <a href="/legal/privacy" target="_blank" rel="noopener noreferrer">Privacy Notice</a>.
            </p>
          </section>`
              : ''
          }
        </div>`;
    } else {
      const isBootstrapAdmin = account.isBootstrapAdmin === true;
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="account-heading">Account</h1>
          <p class="tagline">
            ${
              hostedSurface || hostedGoogleClientId !== null
                ? 'Signed in with Google. Characters you create are owned by this account.'
                : 'Signed in for local testing. Characters you create are owned by this account.'
            }
          </p>
          ${
            error === null
              ? ''
              : `<div class="message error" role="alert" tabindex="-1" data-testid="account-error">${escapeHtml(error)}</div>`
          }
          <section class="panel" aria-labelledby="account-details-heading">
            <h2 id="account-details-heading">${hostedSurface || hostedGoogleClientId !== null ? 'Your account' : 'Your development account'}</h2>
            <dl class="account-details" data-testid="account-details">
              <div>
                <dt>Display name</dt>
                <dd>
                  <label class="field">
                    <span class="visually-hidden">Display name</span>
                    <input type="text" data-testid="account-display-name-input" maxlength="64"
                      value="${escapeHtml(displayNameDraft)}" autocomplete="name" />
                  </label>
                  <div class="actions">
                    <button type="button" data-testid="account-save-display-name"
                      aria-disabled="${busy}">
                      ${busy ? 'Saving…' : 'Save display name'}
                    </button>
                  </div>
                  ${
                    displayNameSavedMessage === null
                      ? ''
                      : `<p class="message success" role="status" data-testid="display-name-saved">${escapeHtml(displayNameSavedMessage)}</p>`
                  }
                </dd>
              </div>
              ${
                hostedSurface || hostedGoogleClientId !== null
                  ? ''
                  : `<code class="visually-hidden" data-testid="account-page-id">${escapeHtml(account.accountId)}</code>`
              }
              ${
                !hostedSurface && isBootstrapAdmin
                  ? `<div>
                <dt>Account id</dt>
                <dd><code data-testid="account-page-id-visible">${escapeHtml(account.accountId)}</code></dd>
              </div>
              <div>
                <dt>Identity mode</dt>
                <dd data-testid="account-identity-mode">${escapeHtml(account.identityMode)}</dd>
              </div>
              <div>
                <dt>Bootstrap admin</dt>
                <dd data-testid="account-is-bootstrap-admin">yes</dd>
              </div>`
                  : isBootstrapAdmin
                    ? `<div>
                <dt>Admin</dt>
                <dd data-testid="account-is-bootstrap-admin">yes</dd>
              </div>`
                    : ''
              }
              <div>
                <dt>Email</dt>
                <dd data-testid="account-email">${escapeHtml(account.email ?? 'none')}</dd>
              </div>
              <div>
                <dt>Session expires</dt>
                <dd data-testid="account-expires">${escapeHtml(formatTimestamp(account.expiresAt))}</dd>
              </div>
            </dl>
            <p class="record-meta" data-testid="account-session-renewal-note">
              Your browser session expires at the time above. Sign in again to renew it. If the session
              ends while you are playing, unsent draft text in the Communication Dock may be lost, but
              characters, campaigns, and table state already saved on the server stay on your account.
            </p>
            <div class="actions">
              <button type="button" class="secondary" data-testid="account-leave"
                aria-disabled="${busy}">
                ${busy ? 'Signing out…' : 'Sign out'}
              </button>
              <a href="/characters" data-link data-testid="account-characters-link">Open Character Vault</a>
              <a href="/campaigns" data-link data-testid="account-campaigns-link">Open Campaigns</a>
              ${
                isBootstrapAdmin
                  ? '<a href="/admin" data-link data-testid="account-admin-link">Admin panel</a>'
                  : ''
              }
            </div>
          </section>
          <section class="panel" aria-labelledby="presentation-heading">
            <h2 id="presentation-heading">Presentation</h2>
            <p class="record-meta">
              Speech is player-optional. Text-to-speech only reads already-visible text.
              Speech-to-text only fills editable unsent drafts — never auto-submits.
              Adjust the controls, then press Save presentation to persist them.
            </p>
            <label class="option">
              <input type="checkbox" data-testid="account-reduced-motion" ${reducedMotion ? 'checked' : ''} />
              <span class="option-label">Prefer reduced motion</span>
            </label>
            <label class="option">
              <input type="checkbox" data-testid="account-low-effects" ${lowEffects ? 'checked' : ''} />
              <span class="option-label">Prefer low effects on the tactical table</span>
            </label>
            <label class="option">
              <input type="checkbox" data-testid="account-tts" ${textToSpeechEnabled ? 'checked' : ''} />
              <span class="option-label">Enable text-to-speech for visible Director text</span>
            </label>
            <label class="option">
              <input type="checkbox" data-testid="account-stt" ${speechToTextEnabled ? 'checked' : ''} />
              <span class="option-label">Enable speech-to-text draft dictation</span>
            </label>
            <label class="field">
              <span>Narration density</span>
              <select data-testid="account-narration-density">
                ${NARRATION_DENSITIES.map(
                  (density) => `
                  <option value="${escapeHtml(density)}" ${narrationDensity === density ? 'selected' : ''}>
                    ${escapeHtml(NARRATION_DENSITY_LABELS[density])}
                  </option>`,
                ).join('')}
              </select>
            </label>
            <p class="record-meta" data-testid="narration-density-summary">
              ${escapeHtml(NARRATION_DENSITY_SUMMARIES[narrationDensity])}
            </p>
            <div class="actions">
              <button type="button" data-testid="save-presentation" ${busy ? 'disabled' : ''}>
                ${busy ? 'Saving…' : 'Save presentation'}
              </button>
            </div>
            ${
              presentationSavedMessage === null
                ? ''
                : `<p class="message success" role="status" data-testid="presentation-settings-saved">${escapeHtml(presentationSavedMessage)}</p>`
            }
          </section>
          <p class="record-meta">
            Signing out ends this browser session. It does not delete characters or other
            records already stored for this account.
          </p>
          <section class="panel" aria-labelledby="account-deletion-heading">
            <h2 id="account-deletion-heading">${
              hostedSurface
                ? 'Account data deletion request'
                : 'Local data deletion request'
            }</h2>
            <p class="record-meta">
              ${
                hostedSurface
                  ? 'Request deletion of hosted account data associated with this Google sign-in. The server records the request; fulfillment follows the Privacy Notice process.'
                  : 'Local Arena clears local development data in the emulator when you request it. This is not a hosted production deletion claim.'
              }
            </p>
            <p class="record-meta" data-testid="account-deletion-status">
              ${
                deletionStatus === null
                  ? 'Deletion status has not been loaded yet.'
                  : deletionStatus.requested
                    ? `Deletion requested${
                        deletionStatus.requestedAt
                          ? ` at ${escapeHtml(formatTimestamp(deletionStatus.requestedAt))}`
                          : ''
                      }. ${escapeHtml(deletionStatus.notice)}`
                    : `No deletion request on file. ${escapeHtml(deletionStatus.notice)}`
              }
            </p>
            <div class="actions">
              <button type="button" class="secondary" data-testid="request-account-deletion"
                aria-disabled="${busy || (deletionStatus?.requested ?? false)}">
                ${
                  deletionStatus?.requested
                    ? 'Deletion already requested'
                    : busy
                      ? 'Requesting…'
                      : hostedSurface
                        ? 'Request account data deletion'
                        : 'Request local data deletion'
                }
              </button>
            </div>
          </section>
          <section class="panel" aria-labelledby="legal-acceptance-heading">
            <h2 id="legal-acceptance-heading">Legal acceptance</h2>
            <p class="record-meta">
              Accept every current legal document before creating characters, campaigns, or playing at
              the table. When you record acceptance, the server stores the current route, version, and
              content digest.
            </p>
            <ul data-testid="legal-acceptance-list">
              ${
                legalAcceptance === null
                  ? '<li>Acceptance status has not been loaded yet.</li>'
                  : legalAcceptance.documents
                      .map(
                        (document) => `
                  <li data-testid="legal-acceptance-${escapeHtml(document.route.replace(/\//g, '-'))}">
                    <a href="${escapeHtml(document.route)}" target="_blank" rel="noopener noreferrer">${escapeHtml(document.title)}</a>
                    — ${escapeHtml(document.version)}
                    ${document.accepted ? 'accepted' : 'not yet accepted'}
                    <button type="button" class="secondary" data-legal-route="${escapeHtml(document.route)}"
                      data-testid="accept-legal-${escapeHtml(document.route.replace(/\//g, '-'))}"
                      aria-label="${document.accepted ? `Accepted ${escapeHtml(document.title)}` : `Record acceptance of ${escapeHtml(document.title)}`}"
                      aria-disabled="${busy || document.accepted}">
                      ${document.accepted ? 'Accepted' : 'Record acceptance'}
                    </button>
                  </li>`,
                      )
                      .join('')
              }
            </ul>
            <p class="record-meta" data-testid="legal-acceptance-summary">
              ${
                legalAcceptance === null
                  ? ''
                  : legalAcceptance.allCurrentAccepted
                    ? 'All current legal documents are accepted.'
                    : 'One or more current legal documents still need acceptance.'
              }
            </p>
          </section>
          ${
            isBootstrapAdmin
              ? `<section class="panel" aria-labelledby="gold-master-heading">
            <h2 id="gold-master-heading">Gold Master package</h2>
            <p class="record-meta" data-testid="gold-master-status">
              ${
                goldMaster === null
                  ? 'Gold Master package has not been loaded yet.'
                  : `Launch Production ${escapeHtml(goldMaster.launchProduction)}. Product Owner authorization ${escapeHtml(goldMaster.productOwnerAuthorization)}. Eligibility ${escapeHtml(goldMaster.eligibilityPolicy.status)}.`
              }
            </p>
            <p class="record-meta">
              Support: use the invitation channel named in the legal documents. Hosted on-call is
              not standing until Launch Production is authorized.
            </p>
          </section>`
              : ''
          }
        </div>`;
    }

    container
      .querySelector<HTMLButtonElement>('[data-testid="account-retry-candidate"]')
      ?.addEventListener('click', () => {
        window.location.reload();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="account-enter"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const next = await signInAccount(candidate);
            shell.announce(`Signed in as ${next.displayLabel}.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Could not mint a development account.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLInputElement>('[data-testid="account-google-email"]')
      ?.addEventListener('change', (event) => {
        if (event.target instanceof HTMLInputElement) {
          googleEmail = event.target.value;
        }
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="account-google-emulator-enter"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          const emailInput = container.querySelector<HTMLInputElement>(
            '[data-testid="account-google-email"]',
          );
          googleEmail = emailInput?.value.trim() || googleEmail;
          busy = true;
          error = null;
          render();
          try {
            const next = await signInGoogleEmulator(candidate, googleEmail);
            shell.announce(`Signed in as ${next.displayLabel}.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Google emulator sign-in failed.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    const hostedButtonHost = container.querySelector<HTMLElement>(
      '[data-testid="account-google-hosted-button"]',
    );
    if (hostedButtonHost !== null && candidate !== null && hostedGoogleClientId !== null) {
      void mountHostedGoogleSignInButton({ candidate, buttonHost: hostedButtonHost }).catch(() => {
        error = 'Sign-in isn\u2019t available right now. Refresh and try again.';
        render();
      });
    }

    container
      .querySelector<HTMLInputElement>('[data-testid="account-display-name-input"]')
      ?.addEventListener('input', (event) => {
        if (event.target instanceof HTMLInputElement) {
          displayNameDraft = event.target.value;
          displayNameSavedMessage = null;
        }
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="account-save-display-name"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          const trimmed = displayNameDraft.trim();
          if (trimmed.length === 0) {
            displayNameSavedMessage = null;
            error = 'Enter a display name before saving.';
            render();
            return;
          }
          busy = true;
          error = null;
          displayNameSavedMessage = null;
          render();
          try {
            const next = await updateAccountDisplayLabel(candidate, trimmed);
            displayNameDraft = next.displayLabel;
            displayNameSavedMessage = 'Display name saved.';
            shell.announce(`Display name saved as ${next.displayLabel}.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Display name could not be saved.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container.querySelectorAll<HTMLButtonElement>('[data-legal-route]').forEach((button) => {
      button.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || button.getAttribute('aria-disabled') === 'true') {
            return;
          }
          const route = button.dataset.legalRoute;
          if (route === undefined || route.length === 0) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            legalAcceptance = await acceptLegalDocument(candidate.candidateId, route);
            shell.announce(`Recorded acceptance of ${route}.`);
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Legal acceptance could not be recorded.';
          } finally {
            busy = false;
            render();
          }
        })();
      });
    });

    container
      .querySelector<HTMLInputElement>('[data-testid="account-reduced-motion"]')
      ?.addEventListener('change', (event) => {
        if (!(event.target instanceof HTMLInputElement)) {
          return;
        }
        reducedMotion = event.target.checked;
        presentationSavedMessage = null;
      });

    container
      .querySelector<HTMLInputElement>('[data-testid="account-low-effects"]')
      ?.addEventListener('change', (event) => {
        if (!(event.target instanceof HTMLInputElement)) {
          return;
        }
        lowEffects = event.target.checked;
        presentationSavedMessage = null;
      });

    container
      .querySelector<HTMLInputElement>('[data-testid="account-tts"]')
      ?.addEventListener('change', (event) => {
        if (!(event.target instanceof HTMLInputElement)) {
          return;
        }
        textToSpeechEnabled = event.target.checked;
        presentationSavedMessage = null;
      });

    container
      .querySelector<HTMLInputElement>('[data-testid="account-stt"]')
      ?.addEventListener('change', (event) => {
        if (!(event.target instanceof HTMLInputElement)) {
          return;
        }
        speechToTextEnabled = event.target.checked;
        presentationSavedMessage = null;
      });

    container
      .querySelector<HTMLSelectElement>('[data-testid="account-narration-density"]')
      ?.addEventListener('change', (event) => {
        if (!(event.target instanceof HTMLSelectElement)) {
          return;
        }
        const nextDensity = event.target.value;
        if (!isNarrationDensity(nextDensity)) {
          return;
        }
        narrationDensity = nextDensity;
        presentationSavedMessage = null;
        const summary = container.querySelector<HTMLElement>('[data-testid="narration-density-summary"]');
        if (summary !== null) {
          summary.textContent = NARRATION_DENSITY_SUMMARIES[narrationDensity];
        }
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="save-presentation"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          busy = true;
          error = null;
          presentationSavedMessage = null;
          render();
          try {
            const settings = await savePlayerSettings({
              candidateId: candidate.candidateId,
              reducedMotion,
              lowEffects,
              speech: { textToSpeechEnabled, speechToTextEnabled },
              narrationDensity,
            });
            reducedMotion = settings.reducedMotion;
            lowEffects = settings.lowEffects;
            textToSpeechEnabled = settings.reserved.textToSpeechEnabled;
            speechToTextEnabled = settings.reserved.speechToTextEnabled;
            narrationDensity = settings.reserved.narrationDensity;
            applyPresentationPreferences({ reducedMotion, lowEffects });
            presentationSavedMessage = 'Presentation preferences saved.';
            shell.announce('Presentation preferences saved.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Presentation settings could not be saved.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="account-leave"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            await signOutAccount(candidate);
            clearPresentationPreferences();
            deletionStatus = null;
            legalAcceptance = null;
            if (candidate.environmentClass === 'milestone') {
              navigate('/', { replace: true });
            }
            shell.announce('Signed out.');
          } catch (failure) {
            error =
              failure instanceof ApiFailure ? failure.message : 'Could not sign out.';
          } finally {
            busy = false;
            render();
          }
        })();
      });

    container
      .querySelector<HTMLButtonElement>('[data-testid="request-account-deletion"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || deletionStatus?.requested) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            deletionStatus = await requestAccountDeletion(candidate.candidateId);
            shell.announce(
              hostedSurface
                ? 'Account data deletion request recorded.'
                : 'Local Arena deletion request recorded.',
            );
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'Could not record a deletion request.';
          } finally {
            busy = false;
            render();
          }
        })();
      });
  }

  async function loadDeletionStatus(): Promise<void> {
    try {
      deletionStatus = await fetchAccountDeletionStatus();
      render();
    } catch {
      // Status is optional on first paint; the button still works.
    }
  }

  async function loadLegalAndGoldMaster(): Promise<void> {
    try {
      goldMaster = await fetchGoldMasterPackage();
      render();
    } catch {
      // Package is optional on first paint.
    }
    if (getAccount() === null) {
      return;
    }
    try {
      legalAcceptance = await fetchLegalAcceptance();
      render();
    } catch {
      // Acceptance is optional on first paint.
    }
  }

  subscribeAccount(() => {
    if (!isPageMountCurrent(container, mountToken) || busy) {
      return;
    }
    const nextAccount = getAccount();
    if (nextAccount !== null) {
      displayNameDraft = nextAccount.displayLabel;
    } else {
      displayNameDraft = '';
      displayNameSavedMessage = null;
      presentationSavedMessage = null;
    }
    render();
    if (getAccount() !== null) {
      void (async () => {
        try {
          const settings = await fetchPlayerSettings();
          reducedMotion = settings.reducedMotion;
          lowEffects = settings.lowEffects;
          textToSpeechEnabled = settings.reserved.textToSpeechEnabled;
          speechToTextEnabled = settings.reserved.speechToTextEnabled;
          narrationDensity = settings.reserved.narrationDensity;
          applyPresentationPreferences({ reducedMotion, lowEffects });
          render();
        } catch {
          // Presentation settings are optional on first paint.
        }
      })();
      void loadDeletionStatus();
      void loadLegalAndGoldMaster();
    } else {
      deletionStatus = null;
      legalAcceptance = null;
    }
  });

  render();
  void loadLegalAndGoldMaster();
  if (getAccount() !== null) {
    void (async () => {
      try {
        const settings = await fetchPlayerSettings();
        reducedMotion = settings.reducedMotion;
        lowEffects = settings.lowEffects;
        textToSpeechEnabled = settings.reserved.textToSpeechEnabled;
        speechToTextEnabled = settings.reserved.speechToTextEnabled;
        narrationDensity = settings.reserved.narrationDensity;
        applyPresentationPreferences({ reducedMotion, lowEffects });
        render();
      } catch {
        // ignore
      }
    })();
    void loadDeletionStatus();
  }
}
