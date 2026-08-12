/**
 * The client-rendered not-found view.
 *
 * This exists for one specific case: Vite's dev server applies a single-page
 * fallback to any unmatched path in Rapid Builder Mode, so an unlinked route
 * still loads the application shell rather than a server 404. When that
 * happens, this page renders instead of silently showing Home, so an
 * unlinked path never displays application content. In Frozen Local
 * Certification Mode the server itself answers unknown paths with its own
 * honest 404 document; this page is what a person sees if they somehow reach
 * an unknown path from inside the running application instead.
 */

import { escapeHtml } from '../dom-utils.js';
import type { PageHost } from './home.js';

export function mountNotFoundPage(host: PageHost, path: string): void {
  host.shell.setDocumentTitle('Page not found');
  host.container.innerHTML = `
    <div class="page not-found-page">
      <h1 data-testid="not-found-heading">No page exists at <code>${escapeHtml(path)}</code></h1>
      <p>
        Hallucinated Dungeons is at the site root. Legal documents and the Local Arena diagnostics
        page are linked from there.
      </p>
      <p><a href="/" data-link data-testid="not-found-home-link">Return to Hallucinated Dungeons</a></p>
    </div>`;
}
