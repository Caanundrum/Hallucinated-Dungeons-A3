/**
 * Application entry point.
 *
 * Blueprint ownership: Section 25 Phase 1 build scope ("responsive hosted
 * shell", "stable navigation"). This file wires the shell, the router, and
 * the page modules together; it owns no page-specific rendering itself.
 */

import type { CandidateIdentity } from '../shared/contract.js';
import {
  campaignRouteFromPath,
  characterIdFromPath,
  inviteCodeFromPath,
  isSpaRoute,
} from '../shared/routes.js';
import { hydrateAccount, clearAccountOnAuthFailure, getAccount } from './account-session.js';
import { fetchCandidate, fetchPlayerSettings, onAuthFailure } from './api.js';
import { applyPresentationPreferences, clearPresentationPreferences } from './presentation-preferences.js';
import { mountAccountPage } from './pages/account.js';
import { mountAdminPage } from './pages/admin.js';
import { mountCampaignCreatePage } from './pages/campaign-create.js';
import { mountCampaignDetailPage } from './pages/campaign-detail.js';
import { mountCampaignJoinPage } from './pages/campaign-join.js';
import { mountCampaignSettingsPage } from './pages/campaign-settings.js';
import { mountCampaignTablePage } from './pages/campaign-table.js';
import { mountCampaignsPage } from './pages/campaigns.js';
import { mountCharacterCreatePage } from './pages/character-create.js';
import { mountCharacterSheetPage } from './pages/character-sheet.js';
import { mountCharactersPage } from './pages/characters.js';
import { mountDiagnosticsPage } from './pages/diagnostics.js';
import { mountHomePage, type PageHost } from './pages/home.js';
import { mountInvitePage } from './pages/invite.js';
import { mountNotFoundPage } from './pages/not-found.js';
import { mountWelcomePage } from './pages/welcome.js';
import { isHostedPlayerSurface } from './player-surface.js';
import { pathnameOf, startRouter } from './router.js';
import { mountShell } from './shell.js';
import {
  bindLegalPlayGatePage,
  renderLegalPlayGatePage,
} from './legal-play-gate.js';
import {
  getLegalAcceptance,
  hydrateLegalAcceptance,
  isPlayBlockedByLegal,
  setLegalAcceptance,
} from './legal-play-session.js';

const root = document.querySelector<HTMLDivElement>('#app');
if (root === null) {
  throw new Error('Page shell is missing its #app mount point.');
}

async function start(): Promise<void> {
  onAuthFailure(() => {
    clearAccountOnAuthFailure();
  });

  let candidate: CandidateIdentity | null = null;
  try {
    candidate = await fetchCandidate();
  } catch {
    // Rendered as "Contacting the Local Arena server…" by the shell and each
    // page; there is nothing further to do here before the server responds.
  }

  const shell = mountShell(root as HTMLDivElement, candidate);
  await hydrateAccount();
  await hydrateLegalAcceptance();
  if (getAccount() !== null) {
    try {
      const settings = await fetchPlayerSettings();
      applyPresentationPreferences({
        reducedMotion: settings.reducedMotion,
        lowEffects: settings.lowEffects,
      });
    } catch {
      clearPresentationPreferences();
    }
  } else {
    clearPresentationPreferences();
  }

  // Focus is moved to the new page's heading only on a client-side route
  // change, not on the very first render. Stealing focus on the initial page
  // load would pre-empt the ordinary "Tab reaches the skip link first"
  // sequence a keyboard user expects when a page first opens.
  let isFirstRender = true;
  let legalGateBusy = false;
  let legalGateError: string | null = null;

  function mountLegalGateForPlay(title: string, body: string, onUnblocked: () => void): void {
    shell.mainElement.innerHTML = renderLegalPlayGatePage({
      title,
      body,
      acceptance: getLegalAcceptance(),
      candidate,
      busy: legalGateBusy,
      error: legalGateError,
    });
    bindLegalPlayGatePage({
      container: shell.mainElement,
      shell,
      candidate,
      getAcceptance: getLegalAcceptance,
      setAcceptance: setLegalAcceptance,
      onUnblocked,
      setBusy: (busy) => {
        legalGateBusy = busy;
      },
      setError: (message) => {
        legalGateError = message;
      },
      render: () => {
        onUnblocked();
      },
    });
  }

  function startRouterCallback(locationKey: string): void {
    const path = pathnameOf(locationKey);
    shell.setActiveRoute(path);
    const host: PageHost = { container: shell.mainElement, shell, candidate };
    const hostedPlayerEntry = isHostedPlayerSurface(candidate);

    shell.setPresentationMode(path === '/' && hostedPlayerEntry && getAccount() === null ? 'welcome' : 'app');

    const characterId = characterIdFromPath(path);
    const campaignRoute = campaignRouteFromPath(path);
    const inviteCode = inviteCodeFromPath(path);

    if (path === '/') {
      if (hostedPlayerEntry && getAccount() === null) {
        mountWelcomePage(host);
      } else {
        mountHomePage(host);
      }
    } else if (path === '/account') {
      mountAccountPage(host);
    } else if (path === '/admin') {
      mountAdminPage(host);
    } else if (path === '/diagnostics') {
      mountDiagnosticsPage(host);
    } else if (path === '/characters') {
      mountCharactersPage(host);
    } else if (path === '/characters/new') {
      if (isPlayBlockedByLegal()) {
        mountLegalGateForPlay(
          'Create a character',
          'Accept the current legal documents once before creating characters.',
          () => mountCharacterCreatePage(host),
        );
      } else {
        mountCharacterCreatePage(host);
      }
    } else if (characterId !== null) {
      mountCharacterSheetPage(host, characterId);
    } else if (path === '/campaigns') {
      mountCampaignsPage(host);
    } else if (path === '/campaigns/new') {
      if (isPlayBlockedByLegal()) {
        mountLegalGateForPlay(
          'Create a table',
          'Accept the current legal documents once before creating tables.',
          () => mountCampaignCreatePage(host),
        );
      } else {
        mountCampaignCreatePage(host);
      }
    } else if (campaignRoute !== null && campaignRoute.subroute === 'settings') {
      mountCampaignSettingsPage(host, campaignRoute.campaignId);
    } else if (campaignRoute !== null && campaignRoute.subroute === 'join') {
      if (isPlayBlockedByLegal()) {
        mountLegalGateForPlay('Join table', 'Accept the current legal documents once to join tables.', () => {
          mountCampaignJoinPage(host, campaignRoute.campaignId);
        });
      } else {
        mountCampaignJoinPage(host, campaignRoute.campaignId);
      }
    } else if (campaignRoute !== null && campaignRoute.subroute === 'table') {
      if (isPlayBlockedByLegal()) {
        mountLegalGateForPlay('Table', 'Accept the current legal documents once to play at the table.', () => {
          mountCampaignTablePage(host, campaignRoute.campaignId);
        });
      } else {
        mountCampaignTablePage(host, campaignRoute.campaignId);
      }
    } else if (campaignRoute !== null && campaignRoute.subroute === 'detail') {
      mountCampaignDetailPage(host, campaignRoute.campaignId);
    } else if (inviteCode !== null) {
      mountInvitePage(host, inviteCode);
    } else if (isSpaRoute(path)) {
      // Every declared SPA route must have a mount call above; reaching this
      // branch means one was added to the shared route table without a page.
      throw new Error(`Route "${path}" is declared but has no page mount.`);
    } else {
      mountNotFoundPage(host, path);
    }

    if (isFirstRender) {
      isFirstRender = false;
    } else {
      shell.focusPageHeading();
    }
  }

  startRouter(startRouterCallback);
}

void start();
