#!/usr/bin/env node
/**
 * Code Completeness Scan.
 *
 * Blueprint ownership: Sections 1.12.4 (prohibited placeholder and
 * incomplete-code patterns) and 1.12.5 (Code Completeness Scan and changed-file
 * review). The scan reads the bytes on disk, not an agent's description of
 * them, and classifies every finding.
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { BUILDER_ROOT } from '../workspace/working-directory.mjs';
import { listTrackedFiles } from '../candidate/candidate-identity.mjs';

export const SCAN_VERSION = 'completeness-scan-v1';

/**
 * Patterns that indicate an in-scope requirement was represented by something
 * other than working code.
 */
const PATTERNS = [
  { id: 'placeholder_marker', pattern: /\b(TODO|FIXME|HACK|XXX)\b/, severity: 'blocking' },
  { id: 'coming_soon', pattern: /\b(coming soon|not yet wired|placeholder for)\b/i, severity: 'blocking' },
  { id: 'not_implemented_throw', pattern: /throw new Error\(\s*['"`](not implemented|unimplemented)/i, severity: 'blocking' },
  { id: 'empty_catch', pattern: /catch\s*(\([^)]*\))?\s*\{\s*\}/, severity: 'blocking' },
  { id: 'skipped_test', pattern: /\b(test|describe|it)\.(skip|only)\b/, severity: 'blocking' },
  { id: 'debugger_statement', pattern: /^\s*debugger\s*;?\s*$/, severity: 'blocking' },
  { id: 'commented_out_logic', pattern: /^\s*\/\/\s*(await|return|const|function|if)\s/, severity: 'blocking' },
];

/**
 * Declared future-phase isolation. Each entry names an exact string, the file
 * that may contain it, and why it is not a placeholder for current-phase work.
 * The scan fails if one of these becomes unused, so the list cannot rot into a
 * blanket exemption.
 */
const APPROVED_FUTURE_PHASE_STRINGS = [
  {
    text: 'NOT_YET_IMPLEMENTED — Phase 2',
    file: 'tools/arena/local-stack-manifest.mjs',
    justification:
      'Section 25 assigns realtime projection delivery to Phase 2. The manifest states the service is absent rather than reporting a socket that does not exist.',
  },
];

/**
 * This scanner's own rule table necessarily contains the literals it searches
 * for. It is excluded from its own content pass and is instead covered by the
 * greenfield evidence scan, so no file goes unscanned.
 */
const SELF_EXCLUDED_FILE = 'tools/certification/code-completeness-scan.mjs';
const SELF_EXCLUSION_COVERED_BY = 'tools/certification/greenfield-evidence.mjs';

const SCANNED_EXTENSIONS = new Set(['.ts', '.mjs', '.js', '.css', '.html', '.json']);

function hasScannedExtension(path) {
  const dot = path.lastIndexOf('.');
  return dot !== -1 && SCANNED_EXTENSIONS.has(path.slice(dot));
}

/**
 * Runs the scan over every tracked Builder Root file.
 *
 * @returns {Promise<{ ok: boolean, scanVersion: string, filesScanned: number, findings: Array<object>, approvedFuturePhase: Array<object> }>}
 */
export async function runCodeCompletenessScan() {
  const tracked = (await listTrackedFiles()).filter(hasScannedExtension);

  /** @type {Array<object>} */
  const findings = [];
  const approvedSeen = new Map(APPROVED_FUTURE_PHASE_STRINGS.map((entry) => [entry.text, 0]));

  for (const relativePath of tracked) {
    const absolute = join(BUILDER_ROOT, relativePath);
    const contents = await readFile(absolute, 'utf8');
    const lines = contents.split('\n');

    if (relativePath === SELF_EXCLUDED_FILE) {
      continue;
    }

    for (const approved of APPROVED_FUTURE_PHASE_STRINGS) {
      if (relativePath === approved.file && contents.includes(approved.text)) {
        approvedSeen.set(approved.text, (approvedSeen.get(approved.text) ?? 0) + 1);
      }
    }

    lines.forEach((line, index) => {
      for (const rule of PATTERNS) {
        if (!rule.pattern.test(line)) {
          continue;
        }
        // A declared future-phase string is classified, not silently dropped.
        const approved = APPROVED_FUTURE_PHASE_STRINGS.find(
          (entry) => entry.file === relativePath && line.includes(entry.text),
        );
        findings.push({
          file: relativePath,
          line: index + 1,
          rule: rule.id,
          severity: approved === undefined ? rule.severity : 'approved_future_phase_isolation',
          text: line.trim().slice(0, 160),
          justification: approved?.justification ?? null,
        });
      }
    });
  }

  /** @type {Array<object>} */
  const unusedApprovals = [...approvedSeen.entries()]
    .filter(([, count]) => count === 0)
    .map(([text]) => ({
      rule: 'stale_future_phase_approval',
      severity: 'blocking',
      text,
      justification:
        'A declared future-phase exemption no longer appears in its file. Remove the exemption so it cannot silently widen.',
    }));

  const allFindings = [...findings, ...unusedApprovals];
  const blocking = allFindings.filter((finding) => finding.severity === 'blocking');

  return {
    ok: blocking.length === 0,
    scanVersion: SCAN_VERSION,
    filesScanned: tracked.length - 1,
    findings: allFindings,
    approvedFuturePhase: APPROVED_FUTURE_PHASE_STRINGS,
    selfExclusion: {
      file: SELF_EXCLUDED_FILE,
      reason: 'This file defines the detection patterns and would match itself.',
      coveredBy: SELF_EXCLUSION_COVERED_BY,
    },
  };
}

async function main() {
  const result = await runCodeCompletenessScan();
  console.log(`Code Completeness Scan (${result.scanVersion})`);
  console.log(`  files scanned: ${result.filesScanned}`);

  if (result.findings.length === 0) {
    console.log('  findings: none');
  }
  for (const finding of result.findings) {
    const location = finding.file ? `${finding.file}:${finding.line}` : '(declaration)';
    console.log(`  [${finding.severity}] ${finding.rule} ${location}`);
    console.log(`      ${finding.text}`);
    if (finding.justification !== null) {
      console.log(`      justification: ${finding.justification}`);
    }
  }

  if (!result.ok) {
    console.error('\nCode Completeness Scan FAILED: blocking findings must be resolved.');
    process.exit(1);
  }
  console.log('\nCode Completeness Scan PASSED.');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
