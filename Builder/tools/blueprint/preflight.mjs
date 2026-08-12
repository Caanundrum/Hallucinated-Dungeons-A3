/**
 * Lightweight blueprint preflight.
 *
 * Blueprint ownership: Section 1.9 greenfield bootstrap exception — "Phase 0
 * performs a lightweight hash, heading/reference, truncation/merge-marker, and
 * obvious-corruption preflight but does not stop to build the complete
 * automated Document Integrity Gate before creating the application."
 *
 * The full Document Integrity Gate is a Phase 1 capability. This checks only
 * that the authoritative source we are building from is intact.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const REQUIRED_HEADINGS = [
  '# HALLUCINATED DUNGEONS — ALPHA 3 GREENFIELD MASTER BLUEPRINT V1',
  '# 0. EXECUTIVE PRODUCT DEFINITION',
  '# 1. DOCUMENT AUTHORITY, CHANGE CONTROL, AND DEFINITIONS',
  '# 25. EIGHT-PHASE IMPLEMENTATION, BUILDER VERIFICATION, QA PLAYER VALIDATION, AND HUMAN-GATED PUBLICATION',
  '## PHASE 0 — MINIMUM GREENFIELD FOUNDATION AND REAL LOCAL BROWSER SMOKE',
];

const MERGE_MARKER_PATTERN = /^(<{7}|={7}|>{7})[ \t]/m;

/**
 * @typedef {object} BlueprintPreflight
 * @property {string} fileName
 * @property {string} path
 * @property {string} version
 * @property {string} sourceHash
 * @property {number} lineCount
 * @property {boolean} ok
 * @property {string[]} failures
 */

/**
 * Locates and validates the authoritative blueprint at the Working Directory root.
 *
 * @param {string} workingDirectory
 * @returns {Promise<BlueprintPreflight>}
 */
export async function runBlueprintPreflight(workingDirectory) {
  const entries = await readdir(workingDirectory, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^HALLUCINATED_DUNGEONS_.*MASTER_BLUEPRINT.*\.md$/i.test(name))
    .sort();

  /** @type {string[]} */
  const failures = [];

  if (candidates.length === 0) {
    return {
      fileName: '(missing)',
      path: workingDirectory,
      version: 'unknown',
      sourceHash: '',
      lineCount: 0,
      ok: false,
      failures: [
        `No authoritative Master Blueprint markdown file was found in ${workingDirectory}.`,
      ],
    };
  }
  if (candidates.length > 1) {
    failures.push(
      `Multiple Master Blueprint files are present (${candidates.join(', ')}). Exactly one authoritative source is permitted.`,
    );
  }

  const fileName = candidates[0];
  const path = join(workingDirectory, fileName);
  const contents = await readFile(path, 'utf8');
  const sourceHash = createHash('sha256').update(contents).digest('hex');
  const lineCount = contents.split('\n').length;

  for (const heading of REQUIRED_HEADINGS) {
    if (!contents.includes(heading)) {
      failures.push(`Required controlling heading is missing: ${heading}`);
    }
  }

  if (MERGE_MARKER_PATTERN.test(contents)) {
    failures.push('The blueprint contains unresolved merge conflict markers.');
  }

  const trimmedEnd = contents.trimEnd();
  if (!trimmedEnd.endsWith('.') && !trimmedEnd.endsWith('`') && !trimmedEnd.endsWith('-')) {
    failures.push(
      'The blueprint does not end with a complete sentence or block, which suggests truncation.',
    );
  }

  const versionMatch = /MASTER BLUEPRINT (V\d+)/.exec(contents);
  const version = versionMatch === null ? 'unknown' : `ALPHA_3_${versionMatch[1]}`;
  if (version === 'unknown') {
    failures.push('The blueprint version could not be read from its title.');
  }

  return { fileName, path, version, sourceHash, lineCount, ok: failures.length === 0, failures };
}
