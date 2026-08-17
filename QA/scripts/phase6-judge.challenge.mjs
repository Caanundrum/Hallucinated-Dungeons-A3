/**
 * Independent QA Judge — evidence integrity challenge (Phase 6).
 * Reads only filesystem evidence + live frozen candidate; no Builder chat.
 *
 *   node QA/scripts/phase6-judge.challenge.mjs \
 *     --candidate cand-… \
 *     --cert-record Evidence/phase-6/…/certification-run-record.json \
 *     --qa-findings QA/findings/PHASE_6_QA_FINDINGS.md \
 *     --out QA/findings/PHASE_6_JUDGE_CHALLENGE.md
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

async function main() {
  const candidate = arg('candidate');
  const certPath = arg('cert-record');
  const qaFindings = arg('qa-findings');
  const arena = arg('arena', 'http://127.0.0.1:5274');
  const out = arg('out', 'QA/findings/PHASE_6_JUDGE_CHALLENGE.md');
  const floor = Number(arg('floor', '84'));

  const failures = [];
  const notes = [];

  if (!candidate || !certPath || !qaFindings) {
    console.error('Usage: --candidate --cert-record --qa-findings [--arena] [--out] [--floor]');
    process.exit(2);
  }

  const cert = JSON.parse(await readFile(resolve(certPath), 'utf8'));
  const certCandidate = cert.candidate?.candidateId ?? cert.candidateId;
  if (certCandidate !== candidate) {
    failures.push(`Certification record candidate ${certCandidate} ≠ claimed ${candidate}`);
  } else {
    notes.push(`Certification record binds candidate ${candidate}`);
  }

  const browserSuite = cert.browserSuite ?? {};
  const executed = browserSuite.executed ?? browserSuite.passed ?? browserSuite.scenarioCount;
  if (typeof executed === 'number' && executed < floor) {
    failures.push(`Browser suite executed ${executed} < floor ${floor} (fake-success attack)`);
  } else if (cert.status === 'PASSED' || cert.status === 'passed' || !cert.failures?.length) {
    notes.push(`Certification status appears passed; executed scenarios field=${executed}`);
  }

  const live = await fetch(`${arena}/api/candidate`).then((r) => r.json());
  if (live.candidateId !== candidate) {
    failures.push(`Live /api/candidate ${live.candidateId} ≠ claimed ${candidate}`);
  } else {
    notes.push(`Live frozen origin serves ${candidate} (${live.runtimeMode})`);
  }

  const findings = await readFile(resolve(qaFindings), 'utf8');
  if (!findings.includes(candidate)) {
    failures.push('QA findings do not mention the claimed candidate id');
  }
  if (!/PLAYER_VALIDATED/i.test(findings)) {
    failures.push('QA findings lack PLAYER_VALIDATED status');
  }
  if (/cand-bf752b208fb6|cand-1de6ebed38c8/.test(findings) && !findings.includes(candidate)) {
    failures.push('QA findings appear to reuse a superseded candidate without current id');
  }
  notes.push('QA findings file present and scanned for candidate binding');

  const verdict = failures.length === 0 ? 'CHALLENGE_PASSED' : 'CHALLENGE_FAILED';
  const body = `---
recordType: independent_qa_judge_challenge
phase: phase-6
candidateId: ${candidate}
verdict: ${verdict}
challengedAt: ${new Date().toISOString()}
---

# Phase 6 — Independent QA Judge Challenge

## Verdict

**${verdict}**

## Notes

${notes.map((n) => `- ${n}`).join('\n')}

## Failures

${failures.length === 0 ? 'None.' : failures.map((f) => `- ${f}`).join('\n')}
`;

  await writeFile(resolve(out), body, 'utf8');
  console.log(verdict);
  console.log(`Wrote ${out}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
