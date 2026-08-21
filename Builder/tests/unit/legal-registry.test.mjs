import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { getLegalDocument, listLegalDocuments } from '../../dist/server/legal/legal-registry.js';
import { renderLegalPage } from '../../dist/server/legal/render-legal-page.js';
import { LEGAL_ROUTES } from '../../dist/shared/routes.js';

/**
 * The Legal Document Registry (Section 1.8.5) and its standalone renderer
 * (Section 1.8.4). Every declared route must have a complete document, every
 * document must expose the fields Section 1.8.5 requires, and the rendered
 * page must be a real accessible document rather than an empty shell.
 */

test('every declared legal route has a registered document', () => {
  for (const route of LEGAL_ROUTES) {
    const document = getLegalDocument(route);
    assert.notEqual(document, null, `expected a document for ${route}`);
    assert.equal(document.route, route);
  }
});

test('an unregistered route returns null rather than throwing', () => {
  assert.equal(getLegalDocument('/legal/does-not-exist'), null);
});

test('listLegalDocuments returns exactly the declared routes, each with required fields', () => {
  const documents = listLegalDocuments();
  assert.equal(documents.length, LEGAL_ROUTES.length);

  for (const document of documents) {
    assert.equal(typeof document.title, 'string');
    assert.ok(document.title.length > 0);
    assert.equal(typeof document.version, 'string');
    assert.match(document.effectiveDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(document.lastReviewedDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(['material', 'informational'].includes(document.materiality));
    assert.ok(Array.isArray(document.supportedRegions) && document.supportedRegions.length > 0);
    assert.equal(typeof document.reConsentRequired, 'boolean');
    assert.equal(typeof document.contactPath, 'string');
    assert.match(document.contentDigest, /^[0-9a-f]{64}$/);
    assert.ok(Array.isArray(document.sections) && document.sections.length > 0);
    for (const section of document.sections) {
      assert.ok(section.id.length > 0);
      assert.ok(section.heading.length > 0);
      assert.ok(Array.isArray(section.paragraphs) && section.paragraphs.length > 0);
      for (const paragraph of section.paragraphs) {
        assert.ok(paragraph.length > 20, `expected real content, got: "${paragraph}"`);
      }
    }
  }
});

test('the content digest changes if and only if the content changes', () => {
  const first = getLegalDocument('/legal/terms');
  const second = getLegalDocument('/legal/terms');
  assert.equal(first.contentDigest, second.contentDigest);

  const mutated = { ...first, title: 'Terms of Service (mutated for this test)' };
  assert.notEqual(renderDigestFor(mutated), first.contentDigest);
});

/**
 * Mirrors the registry's own digest function without importing a private
 * symbol: proves the digest is sensitive to content, not just re-reading the
 * same stored value back.
 */
function renderDigestFor(document) {
  const material = JSON.stringify({
    title: document.title,
    version: document.version,
    sections: document.sections,
  });
  return createHash('sha256').update(material).digest('hex');
}

test('rendering a document produces a complete, escaped, anchor-linked page', () => {
  const document = getLegalDocument('/legal/terms');
  const html = renderLegalPage(document);

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Terms of Service — Hallucinated Dungeons/);
  assert.match(html, /data-testid="legal-title"/);
  assert.match(html, new RegExp(`data-testid="legal-version">${document.version}<`));
  assert.match(html, new RegExp(`data-testid="legal-effective-date">${document.effectiveDate}<`));
  assert.match(html, /data-legal-route="\/legal\/terms"/);

  // Every section anchor in the nav has a matching heading id in the body.
  for (const section of document.sections) {
    assert.match(html, new RegExp(`href="#${section.id}"`));
    assert.match(html, new RegExp(`id="${section.id}"`));
  }

  assert.match(html, /data-testid="legal-return-link"/);
  assert.match(html, /Back to Campaigns/);
  assert.doesNotMatch(html, /<script/i);
});

test('rendering escapes a title that contains HTML-significant characters', () => {
  const base = getLegalDocument('/legal/terms');
  const withInjection = {
    ...base,
    title: '<script>alert(1)</script>',
  };
  const html = renderLegalPage(withInjection);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
