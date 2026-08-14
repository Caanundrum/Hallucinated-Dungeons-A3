/**
 * Invitation landing page with bounded preview and accept flow.
 *
 * Blueprint ownership: Sections 7.6 and 8.8 — before authentication, only the
 * bounded preview is shown. Membership requires a signed-in development
 * account, and the joining account must be named clearly before accept.
 */

import type { InvitationPreview } from '../../shared/campaign-contract.js';
import { getAccount, signInAccount, subscribeAccount } from '../account-session.js';
import {
  ApiFailure,
  acceptCampaignInvitation,
  fetchInvitationPreview,
} from '../api.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import { navigate } from '../router.js';
import type { PageHost } from './home.js';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function mountInvitePage(host: PageHost, inviteCode: string): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Campaign invitation');

  let preview: InvitationPreview | null = null;
  let error: string | null = null;
  let unavailable = false;
  let busy = false;
  const mountToken = beginPageMount(container);

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }

    if (unavailable || preview === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="invite-heading">Invitation unavailable</h1>
          <p class="tagline">
            That invite link is not available. It may have expired or been revoked. Ask the
            campaign owner for a current link.
          </p>
          ${
            error === null
              ? ''
              : `<div class="message error" role="alert" tabindex="-1" data-testid="invite-error">${escapeHtml(error)}</div>`
          }
          <p><a href="/campaigns" data-link data-testid="invite-campaigns-link">Open campaigns</a></p>
        </div>`;
      return;
    }

    const account = getAccount();
    container.innerHTML = `
      <div class="page">
        <h1 data-testid="invite-heading">Campaign invitation</h1>
        <p class="tagline">
          Bounded preview before membership. Sign in with a Local Arena development account to
          join.
        </p>
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" tabindex="-1" data-testid="invite-error">${escapeHtml(error)}</div>`
        }
        <section class="panel" aria-labelledby="invite-preview-heading">
          <h2 id="invite-preview-heading">Invitation preview</h2>
          <dl class="account-details" data-testid="invite-preview">
            <div>
              <dt>Campaign</dt>
              <dd data-testid="invite-campaign-name">${escapeHtml(preview.campaignName)}</dd>
            </div>
            <div>
              <dt>Host</dt>
              <dd data-testid="invite-host-label">${escapeHtml(preview.hostDisplayLabel)}</dd>
            </div>
            <div>
              <dt>Content profile</dt>
              <dd data-testid="invite-content-profile">${escapeHtml(preview.contentProfileSummary)}</dd>
            </div>
            <div>
              <dt>Session state</dt>
              <dd data-testid="invite-session-state">${escapeHtml(preview.sessionStateLabel)}</dd>
            </div>
            <div>
              <dt>Game Director</dt>
              <dd data-testid="invite-director">
                ${escapeHtml(preview.directorIdentityLabel)} · ${escapeHtml(preview.directorPersonalityLabel)}
              </dd>
            </div>
            <div>
              <dt>Invite expires</dt>
              <dd data-testid="invite-expires-at">${escapeHtml(formatTimestamp(preview.expiresAt))}</dd>
            </div>
          </dl>
          <p class="message notice" data-testid="invite-config-notice">${escapeHtml(preview.configurationNotice)}</p>
        </section>
        ${
          account === null
            ? ''
            : `<p class="message notice" data-testid="invite-joining-as">
                 You will join as <strong>${escapeHtml(account.displayLabel)}</strong>
                 (<code>${escapeHtml(account.accountId)}</code>).
               </p>`
        }
        <div class="actions">
          ${
            account === null
              ? `<button type="button" data-testid="invite-sign-in"
                   aria-disabled="${busy || candidate === null}">
                   ${busy ? 'Signing in…' : 'Sign in to join'}
                 </button>`
              : `<button type="button" data-testid="invite-accept"
                   aria-disabled="${busy || candidate === null}">
                   ${busy ? 'Joining…' : `Accept as ${escapeHtml(account.displayLabel)}`}
                 </button>`
          }
          ${
            account === null
              ? ''
              : `<a href="/campaigns/${escapeHtml(preview.campaignId)}" data-link data-testid="invite-open-campaign">
                   Open campaign
                 </a>`
          }
          <a href="/campaigns" data-link data-testid="invite-campaigns-link">Open campaigns</a>
        </div>
      </div>`;

    container
      .querySelector<HTMLButtonElement>('[data-testid="invite-sign-in"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const accountNext = await signInAccount(candidate);
            shell.announce(`Signed in as ${accountNext.displayLabel}.`);
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
      .querySelector<HTMLButtonElement>('[data-testid="invite-accept"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || getAccount() === null) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            const campaign = await acceptCampaignInvitation({
              candidateId: candidate.candidateId,
              inviteCode,
            });
            shell.announce(`Joined ${campaign.name}.`);
            navigate(`/campaigns/${campaign.campaignId}`);
          } catch (failure) {
            if (
              failure instanceof ApiFailure &&
              (failure.code === 'INVITATION_UNAVAILABLE' || failure.code === 'NOT_FOUND')
            ) {
              preview = null;
              unavailable = true;
              error = failure.message;
              busy = false;
              render();
              return;
            }
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'The invitation could not be accepted.';
            busy = false;
            render();
          }
        })();
      });
  }

  async function load(): Promise<void> {
    unavailable = false;
    error = null;
    render();
    try {
      preview = await fetchInvitationPreview(inviteCode);
      shell.setDocumentTitle(`Invite · ${preview.campaignName}`);
    } catch (failure) {
      preview = null;
      unavailable = true;
      error =
        failure instanceof ApiFailure
          ? failure.message
          : 'That invitation could not be loaded.';
    }
    render();
  }

  subscribeAccount(() => {
    render();
  });
  void load();
}
