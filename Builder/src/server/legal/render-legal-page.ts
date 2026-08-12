/**
 * Renders one Legal Document Registry entry as a standalone, accessible HTML
 * document.
 *
 * Blueprint ownership: Section 1.8.4 — each legal route displays its title,
 * version, effective date, last-reviewed date, stable section anchors, and a
 * contact path, and remains "accessibility-compliant content without
 * required script execution." This function returns a complete document with
 * an inlined, self-contained stylesheet, so the page is fully readable with
 * JavaScript disabled.
 *
 * The inline stylesheet intentionally duplicates a small, named subset of the
 * Design System Manifest v1 tokens (see
 * Checkpoints/phase-1/design/DESIGN_SYSTEM_MANIFEST.md) rather than sharing a
 * bundled asset with the single-page application, because these documents
 * must not depend on the client bundle or its build tool to render.
 */

import type { LegalDocument } from './legal-registry.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Design System Manifest v1 — legal-page derived tokens.
 * Subset: abyss background, obsidian surface, structural border, primary
 * text, muted text, accent. See the manifest for the complete token set used
 * by the single-page application.
 */
const INLINE_STYLE = `
  :root {
    color-scheme: dark;
    --abyss-background: #07080d;
    --obsidian-surface: #0d111b;
    --structural-border: #2c3a4f;
    --primary-text: #f4eedf;
    --muted-text: #a5b0cc;
    --accent: #6ea8ff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: var(--abyss-background);
    color: var(--primary-text);
    font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.6;
  }
  .doc { max-width: 42rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
  .doc-meta {
    color: var(--muted-text);
    font-size: 0.85rem;
    border-bottom: 1px solid var(--structural-border);
    padding-bottom: 1rem;
    margin-bottom: 1.5rem;
  }
  .doc-meta dl { display: flex; flex-wrap: wrap; gap: 0.35rem 1.5rem; margin: 0.5rem 0 0; }
  .doc-meta dt { font-weight: 600; }
  .doc-meta dd { margin: 0; display: inline; }
  h1 { font-size: 1.6rem; margin: 0; }
  section { margin-top: 1.75rem; }
  section h2 { font-size: 1.1rem; border-top: 1px solid var(--structural-border); padding-top: 1.25rem; }
  a { color: var(--accent); }
  a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .doc-nav { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--structural-border); }
`;

/** Builds the complete standalone HTML document for one legal record. */
export function renderLegalPage(document: LegalDocument & { readonly contentDigest: string }): string {
  const anchorList = document.sections
    .map((section) => `<li><a href="#${escapeHtml(section.id)}">${escapeHtml(section.heading)}</a></li>`)
    .join('');

  const sectionsHtml = document.sections
    .map(
      (section) => `
    <section id="${escapeHtml(section.id)}" aria-labelledby="${escapeHtml(section.id)}-heading">
      <h2 id="${escapeHtml(section.id)}-heading">${escapeHtml(section.heading)}</h2>
      ${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n      ')}
    </section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(document.title)} — Hallucinated Dungeons</title>
    <link rel="icon" href="data:," />
    <style>${INLINE_STYLE}</style>
  </head>
  <body>
    <main class="doc" data-testid="legal-document" data-legal-route="${escapeHtml(document.route)}">
      <h1 data-testid="legal-title">${escapeHtml(document.title)}</h1>
      <div class="doc-meta">
        <dl>
          <div><dt>Version</dt> <dd data-testid="legal-version">${escapeHtml(document.version)}</dd></div>
          <div><dt>Effective</dt> <dd data-testid="legal-effective-date">${escapeHtml(document.effectiveDate)}</dd></div>
          <div><dt>Last reviewed</dt> <dd data-testid="legal-last-reviewed">${escapeHtml(document.lastReviewedDate)}</dd></div>
        </dl>
      </div>
      <nav aria-label="Sections in this document" data-testid="legal-anchor-nav">
        <ul>${anchorList}</ul>
      </nav>
      ${sectionsHtml}
      <div class="doc-nav">
        <p><a href="${escapeHtml(document.contactPath)}" data-testid="legal-contact-link">Contact about this document</a></p>
        <p><a href="/" data-testid="legal-return-link">Return to Hallucinated Dungeons</a></p>
      </div>
    </main>
  </body>
</html>
`;
}
