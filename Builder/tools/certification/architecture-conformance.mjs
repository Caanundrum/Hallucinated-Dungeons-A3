#!/usr/bin/env node
/**
 * Architecture conformance scan.
 *
 * Blueprint ownership: Sections 0 (character ownership belongs to the
 * authenticated account), 1.2 (Canonical Projection Binding), 7.7
 * (account-bound character ownership and seating gate), 8.x local-storage
 * boundary, and 25 Phase 1 ("Establish only the minimum stable identifiers and
 * interface boundaries Phase 1 genuinely needs... future phases extend these
 * stable identifiers rather than replacing current ownership/persistence
 * contracts").
 *
 * Phase 1 adds character creation, campaigns, seats, and settings across many
 * work slices. The failure this scan exists to prevent is a second account or
 * ownership model appearing in one of those slices — a client-held identity, a
 * parallel session store, an alternative owner key, or an ad-hoc collection.
 * The rules are deliberately narrow and mechanical so they catch that class of
 * drift without arguing about style.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BUILDER_ROOT } from '../workspace/working-directory.mjs';
import { listTrackedFiles } from '../candidate/candidate-identity.mjs';

export const CONFORMANCE_VERSION = 'architecture-conformance-v1';

/**
 * This module's own rule table contains the literals it searches for. It is
 * excluded from its own pass and remains covered by the Code Completeness
 * Scan, matching the mutual-coverage arrangement already used by the other
 * scanners.
 */
const SELF_EXCLUDED_FILE = 'tools/certification/architecture-conformance.mjs';
const SELF_EXCLUSION_COVERED_BY = 'tools/certification/code-completeness-scan.mjs';

/**
 * @typedef {object} ConformanceRule
 * @property {string} id
 * @property {RegExp} pattern
 * @property {(path: string) => boolean} appliesTo
 * @property {string} rationale
 * @property {string} instead
 */

/** @type {readonly string[]} */
const BROWSER_PREFERENCE_MARKERS = [
  'readTableNotesPreference',
  'writeTableNotesPreference',
  'isCreatorTutorialDismissed',
  'setCreatorTutorialDismissed',
  'Non-authoritative',
  'non-authoritative',
  'UI preference',
  'hd-a3-table-notes-',
  'hd-a3-creator-tutorial-dismissed',
];

function isAllowedBrowserPreferenceUse(line, previousLine = '') {
  const context = `${previousLine}\n${line}`;
  return BROWSER_PREFERENCE_MARKERS.some((marker) => context.includes(marker));
}

const CLIENT_BROWSER_PREFERENCE_FILES = new Set([
  'src/client/browser-preferences.ts',
  // Transient join handoff only — seat authority remains server-side.
  'src/client/pending-join.ts',
]);

/** @type {ConformanceRule[]} */
export const RULES = [
  {
    id: 'client_must_not_import_server_or_admin_sdk',
    pattern: /from\s+['"](?:[./]*\/)?(?:\.\.\/)*server\/|from\s+['"]firebase-admin/,
    appliesTo: (path) => path.startsWith('src/client/'),
    rationale:
      'The browser is not an authority. Importing server modules or the admin SDK into the client is how database and ownership decisions leak into a place the player controls.',
    instead: 'Call the server over HTTP and render the projection it returns.',
  },
  {
    id: 'client_must_not_hold_identity_or_canonical_state',
    pattern: /\b(document\.cookie|localStorage|sessionStorage|indexedDB)\b/,
    appliesTo: (path) =>
      path.startsWith('src/client/') && !CLIENT_BROWSER_PREFERENCE_FILES.has(path),
    rationale:
      'Character ownership, campaign membership, and seat authorization may never depend on browser storage, and the session cookie is http-only precisely so client script cannot read or forge it.',
    instead:
      'Keep canonical state server-side. Only non-authoritative preferences may ever use browser storage, and they must be named as preferences.',
  },
  {
    id: 'session_primitives_confined_to_identity_module',
    pattern: /\b(createUser|randomBytes|timingSafeEqual)\s*\(/,
    appliesTo: (path) =>
      path.startsWith('src/server/') && !path.startsWith('src/server/identity/'),
    rationale:
      'Minting an account, generating a session secret, and comparing session material are the account model. Spreading them across modules is how a second, weaker identity path appears.',
    instead: 'Extend src/server/identity/ and call it.',
  },
  {
    id: 'session_store_confined_to_identity_module',
    pattern: /COLLECTIONS\.developmentSessions/,
    appliesTo: (path) =>
      path.startsWith('src/server/') && !path.startsWith('src/server/identity/'),
    rationale: 'One module owns session records so a session cannot be created or trusted elsewhere.',
    instead: 'Resolve the session through the identity module and pass the resolved account.',
  },
  {
    id: 'single_ownership_key',
    pattern: /\b(userId|ownerId|playerId|ownerUid|accountID|user_id|owner_id)\b/,
    appliesTo: (path) => path.startsWith('src/'),
    rationale:
      'Ownership follows one stable account identifier. A parallel owner field is how ownership silently forks between features.',
    instead:
      'Use accountId for the authenticated account and ownerAccountId for the owner of a stored record.',
  },
  {
    id: 'collections_come_from_the_registry',
    pattern: /\.collection\(\s*['"`]/,
    appliesTo: (path) => path.startsWith('src/server/'),
    rationale:
      'An inline collection name creates storage no other module knows about, including the rules and the ownership queries that are supposed to guard it.',
    instead: 'Add the collection to COLLECTIONS in src/server/persistence/ and reference it there.',
  },
];

/**
 * Evaluates the rules against one file's contents. Exported so tests can prove
 * each rule actually fires, rather than trusting a scan that reports zero
 * findings because it never matched anything.
 *
 * @param {{ relativePath: string, contents: string }} file
 * @returns {Array<{ rule: string, file: string, line: number, text: string, rationale: string, instead: string }>}
 */
export function evaluateRules(file) {
  const { relativePath, contents } = file;
  if (relativePath === SELF_EXCLUDED_FILE) {
    return [];
  }

  const findings = [];
  const lines = contents.split('\n');

  for (const rule of RULES) {
    if (!rule.appliesTo(relativePath)) {
      continue;
    }
    lines.forEach((line, index) => {
      if (!rule.pattern.test(line)) {
        return;
      }
      if (
        rule.id === 'client_must_not_hold_identity_or_canonical_state' &&
        (line.trim().startsWith('//') ||
          line.trim().startsWith('*') ||
          isAllowedBrowserPreferenceUse(line, lines[index - 1] ?? ''))
      ) {
        return;
      }
      findings.push({
          rule: rule.id,
          file: relativePath,
          line: index + 1,
          text: line.trim().slice(0, 160),
          rationale: rule.rationale,
          instead: rule.instead,
      });
    });
  }

  return findings;
}

const SCANNED_EXTENSIONS = new Set(['.ts', '.mjs', '.js']);

function isScannable(path) {
  const dot = path.lastIndexOf('.');
  return dot !== -1 && SCANNED_EXTENSIONS.has(path.slice(dot));
}

/**
 * Runs the scan across the tracked Builder Root source tree.
 *
 * @returns {Promise<{ ok: boolean, conformanceVersion: string, filesScanned: number, ruleCount: number, findings: Array<object>, selfExclusion: object }>}
 */
export async function runArchitectureConformance() {
  const tracked = (await listTrackedFiles()).filter(isScannable);

  const findings = [];
  let filesScanned = 0;

  for (const relativePath of tracked) {
    if (relativePath === SELF_EXCLUDED_FILE) {
      continue;
    }
    filesScanned += 1;
    const contents = await readFile(join(BUILDER_ROOT, relativePath), 'utf8');
    findings.push(...evaluateRules({ relativePath, contents }));
  }

  return {
    ok: findings.length === 0,
    conformanceVersion: CONFORMANCE_VERSION,
    filesScanned,
    ruleCount: RULES.length,
    findings,
    selfExclusion: {
      file: SELF_EXCLUDED_FILE,
      reason: 'This file defines the detection patterns and would match itself.',
      coveredBy: SELF_EXCLUSION_COVERED_BY,
    },
  };
}

async function main() {
  const result = await runArchitectureConformance();
  console.log(`Architecture conformance (${result.conformanceVersion})`);
  console.log(`  files scanned: ${result.filesScanned}`);
  console.log(`  rules applied: ${result.ruleCount}`);

  if (result.findings.length === 0) {
    console.log('  findings: none');
    console.log('\nArchitecture conformance PASSED.');
    return;
  }

  for (const finding of result.findings) {
    console.log(`\n  [violation] ${finding.rule}  ${finding.file}:${finding.line}`);
    console.log(`      ${finding.text}`);
    console.log(`      why: ${finding.rationale}`);
    console.log(`      do:  ${finding.instead}`);
  }
  console.error('\nArchitecture conformance FAILED.');
  process.exit(1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
