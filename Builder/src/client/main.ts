/**
 * Application entry point.
 *
 * Blueprint ownership: Section 25 Phase 1 build scope ("responsive hosted
 * shell", "stable navigation"). This file wires the shell, the router, and
 * the page modules together; it owns no page-specific rendering itself.
 */

import type { CandidateIdentity } from '../shared/contract.js';
import {
  campaignIdFromPath,
  characterIdFromPath,
  inviteCodeFromPath,
  isSpaRoute,
} from '../shared/routes.js';
import { hydrateAccount, clearAccountOnAuthFailure } from './account-session.js';
import { fetchCandidate, onAuthFailure } from './api.js';
import { mountAccountPage } from './pages/account.js';
import { mountCampaignCreatePage } from './pages/campaign-create.js';
import { mountCampaignDetailPage } from './pages/campaign-detail.js';
import { mountCampaignsPage } from './pages/campaigns.js';
import { mountCharacterCreatePage } from './pages/character-create.js';
import { mountCharacterSheetPage } from './pages/character-sheet.js';
import { mountCharactersPage } from './pages/characters.js';
import { mountDiagnosticsPage } from './pages/diagnostics.js';
import { mountHomePage, type PageHost } from './pages/home.js';
import { mountInvitePage } from './pages/invite.js';
import { mountNotFoundPage } from './pages/not-found.js';
import { pathnameOf, startRouter } from './router.js';
import { mountShell } from './shell.js';

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

  // Focus is moved to the new page's heading only on a client-side route
  // change, not on the very first render. Stealing focus on the initial page
  // load would pre-empt the ordinary "Tab reaches the skip link first"
  // sequence a keyboard user expects when a page first opens.
  let isFirstRender = true;

  startRouter((locationKey) => {
    const path = pathnameOf(locationKey);
    shell.setActiveRoute(path);
    const host: PageHost = { container: shell.mainElement, shell, candidate };

    const characterId = characterIdFromPath(path);
    const campaignId = campaignIdFromPath(path);
    const inviteCode = inviteCodeFromPath(path);

    if (path === '/') {
      mountHomePage(host);
    } else if (path === '/account') {
      mountAccountPage(host);
    } else if (path === '/diagnostics') {
      mountDiagnosticsPage(host);
    } else if (path === '/characters') {
      mountCharactersPage(host);
    } else if (path === '/characters/new') {
      mountCharacterCreatePage(host);
    } else if (characterId !== null) {
      mountCharacterSheetPage(host, characterId);
    } else if (path === '/campaigns') {
      mountCampaignsPage(host);
    } else if (path === '/campaigns/new') {
      mountCampaignCreatePage(host);
    } else if (campaignId !== null) {
      mountCampaignDetailPage(host, campaignId);
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
  });
}

void start();
