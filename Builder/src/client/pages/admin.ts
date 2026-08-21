/**
 * Admin panel — Phase 4.
 *
 * Server-authorized only. Bootstrap administrator is nick.donner@gmail.com.
 * Ordinary accounts receive an honest denial projection; client email cannot
 * grant access.
 */

import { getAccount, subscribeAccount } from '../account-session.js';
import { ApiFailure, fetchAdminPanel, setAdminAiKillSwitch } from '../api.js';
import { bindSignedOutGate, renderSignedOutGate } from '../auth-gate.js';
import { escapeHtml } from '../dom-utils.js';
import { beginPageMount, isPageMountCurrent } from '../page-mount.js';
import type { PageHost } from './home.js';

type AdminSnapshot = Awaited<ReturnType<typeof fetchAdminPanel>>;

export function mountAdminPage(host: PageHost): void {
  const { container, shell, candidate } = host;
  shell.setDocumentTitle('Admin');

  let snapshot: AdminSnapshot | null = null;
  let busy = false;
  let error: string | null = null;
  let gateBusy = false;
  let gateError: string | null = null;
  const mountToken = beginPageMount(container);

  function render(): void {
    if (!isPageMountCurrent(container, mountToken)) {
      return;
    }
    if (getAccount() === null) {
      container.innerHTML = renderSignedOutGate({
        title: 'Admin',
        body: 'Sign in to request the Admin panel. Authorization is decided only by the server.',
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
        setBusy: (next) => {
          gateBusy = next;
        },
        setError: (next) => {
          gateError = next;
        },
        render,
      });
      return;
    }

    if (snapshot === null) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="admin-heading">Admin</h1>
          <p class="tagline">${busy ? 'Loading Admin panel…' : 'Preparing Admin panel…'}</p>
          ${
            error === null
              ? ''
              : `<div class="message error" role="alert" data-testid="admin-error">${escapeHtml(error)}</div>`
          }
        </div>`;
      return;
    }

    if (!snapshot.isAdmin) {
      container.innerHTML = `
        <div class="page">
          <h1 data-testid="admin-heading">Admin</h1>
          <p class="tagline" data-testid="admin-notice">${escapeHtml(snapshot.notice)}</p>
          ${
            error === null
              ? ''
              : `<div class="message error" role="alert" data-testid="admin-error">${escapeHtml(error)}</div>`
          }
          <p class="record-meta" data-testid="admin-is-admin">Admin authorized: No</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="page">
        <h1 data-testid="admin-heading">Admin</h1>
        <p class="tagline" data-testid="admin-notice">${escapeHtml(snapshot.notice)}</p>
        ${
          error === null
            ? ''
            : `<div class="message error" role="alert" data-testid="admin-error">${escapeHtml(error)}</div>`
        }
        <section class="panel" aria-labelledby="admin-status-heading">
          <h2 id="admin-status-heading">Authorization</h2>
          <dl class="detail-list">
            <div><dt>Admin authorized</dt><dd data-testid="admin-is-admin">Yes</dd></div>
            <div><dt>Actor account</dt><dd data-testid="admin-actor-account">${escapeHtml(snapshot.actorAccountId)}</dd></div>
            <div><dt>Actor email</dt><dd data-testid="admin-actor-email">${escapeHtml(snapshot.actorEmail ?? 'none')}</dd></div>
            <div><dt>Bootstrap email</dt><dd data-testid="admin-bootstrap-email">${escapeHtml(snapshot.bootstrapEmail)}</dd></div>
            <div><dt>Identity mode</dt><dd data-testid="admin-provider-mode">${escapeHtml(snapshot.providerMode)}</dd></div>
            <div><dt>AI kill switch</dt><dd data-testid="admin-ai-kill-switch">${snapshot.aiKillSwitch ? 'enabled' : 'disabled'}</dd></div>
          </dl>
          <div class="actions">
            <button type="button" data-testid="admin-toggle-kill-switch" aria-disabled="${busy}">
              ${snapshot.aiKillSwitch ? 'Disable AI kill switch' : 'Enable AI kill switch'}
            </button>
          </div>
        </section>
        <section class="panel" aria-labelledby="admin-audit-heading">
          <h2 id="admin-audit-heading">Audit history</h2>
          ${
            snapshot.auditEvents.length === 0
              ? '<p class="empty-state" data-testid="admin-audit-empty">No Admin audit events yet.</p>'
              : `<ul class="record-list" data-testid="admin-audit-list">
                  ${snapshot.auditEvents
                    .map(
                      (event) => `<li data-testid="admin-audit-event">
                        <strong>${escapeHtml(event.action)}</strong>
                        — ${escapeHtml(event.detail)}
                        <span class="record-meta">${escapeHtml(event.actorEmail)} · ${new Date(event.atMs).toISOString()}</span>
                      </li>`,
                    )
                    .join('')}
                </ul>`
          }
        </section>
      </div>`;

    container
      .querySelector<HTMLButtonElement>('[data-testid="admin-toggle-kill-switch"]')
      ?.addEventListener('click', () => {
        void (async () => {
          if (candidate === null || busy || snapshot === null || !snapshot.isAdmin) {
            return;
          }
          busy = true;
          error = null;
          render();
          try {
            await setAdminAiKillSwitch({
              candidateId: candidate.candidateId,
              enabled: !snapshot.aiKillSwitch,
            });
            await load();
          } catch (failure) {
            error =
              failure instanceof ApiFailure
                ? failure.message
                : 'The Admin kill-switch update failed.';
            busy = false;
            render();
          }
        })();
      });
  }

  async function load(): Promise<void> {
    if (getAccount() === null) {
      render();
      return;
    }
    busy = true;
    error = null;
    render();
    try {
      snapshot = await fetchAdminPanel();
    } catch (failure) {
      error =
        failure instanceof ApiFailure ? failure.message : 'The Admin panel could not be loaded.';
      snapshot = null;
    } finally {
      busy = false;
      render();
    }
  }

  subscribeAccount(() => {
    void load();
  });
  void load();
}
