---
phase: phase-2
candidateId: cand-e1c5d41b583b
sourceTreeHash: e1c5d41b583bc16fba0a83544b013280474e7c485fe1987d234a79e09d163a48
commit: e6da5508a4015a1e4e7dac9b24c643ff3fcafaaa
localStackManifest: /workspace/Runtime/certification/cand-e1c5d41b583b/local-stack-manifest.json
qaRole: independent-qa
validationStartedAt: 2026-08-15T03:27:00Z
validationCompletedAt: 2026-08-15T04:31:00Z
status: PLAYER_VALIDATED
blockingFindingCount: 0
totalFindingCount: 0
openFindingCount: 0
---

# Phase 2 — Independent QA Findings

## Candidate confirmation

| Source | candidateId | environmentClass | runtimeMode |
| --- | --- | --- | --- |
| Builder Verification | `cand-e1c5d41b583b` | local | frozen_certification |
| `GET http://127.0.0.1:5274/api/candidate` | `cand-e1c5d41b583b` | local | frozen_certification |
| Footer build strip (rendered) | `cand-e1c5d41b583b` | — | — |

Live health: `GET /api/health` → `status: ready` with Firestore and Auth emulators reachable.

**Port discipline:** Rapid Builder on `5173`/`5174` serves a different candidate (`cand-83126e840537`). Independent QA used frozen origin `5274` only for disposition.

## What executed

**Browser suite — 8 scenarios, Chromium, frozen origin `http://127.0.0.1:5274`.**

- Spec: `QA/scripts/phase2-player.qa.spec.ts`
- Config: `QA/playwright.phase2.config.ts`
- Result: **8 passed, 0 failed** (confirmed on two consecutive full runs after harness stabilizations)
- Screenshots: `QA/evidence/phase-2/ui/p2-0*.png`
- Machine results: `QA/evidence/phase-2/ui/results.json`
- Console: `/opt/cursor/artifacts/phase2_player_qa_console.log` (agent workspace)

| ID | Persona / intent | Outcome |
| --- | --- | --- |
| QA-P2-01 | Novice: seat, open table, semantic map stage | PASS |
| QA-P2-02 | Impatient: Party Chat ≠ command; claim + sync | PASS |
| QA-P2-03 | Mover: legal one-step UI move; illegal path API `ILLEGAL_PATH` | PASS |
| QA-P2-04 | A11y: reduced motion / low effects; no voice UI | PASS |
| QA-P2-05 | Adversarial: `TIMING_AUTHORITY_REQUIRED` without authority | PASS |
| QA-P2-06 | Reentry: reload recovers table state after sync | PASS |
| QA-P2-07 | Keyboard: Characters then Campaigns without mouse nav | PASS |
| QA-P2-08 | Intent Intercept confirms sync; chat stays separate | PASS |

**Manual player walkthrough (frozen `5274`):** character → campaign → seat → table → Party Chat → Claim Active Turn → Commit table sync → reduced motion / low effects. Candidate footer matched `cand-e1c5d41b583b`. Demo video: `/opt/cursor/artifacts/phase2_independent_qa_frozen_player_table_demo.mp4`.

Builder's frozen certification suite (65 browser scenarios) already exercised movement legality, Timing Authority gates, two-client sync, smoke spine, and CSP SVG fallback against the same candidate.

## Device / browser coverage note

Real Safari and real-tablet certification remain `BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION` until Phase 6/7 host evidence is available.

## Findings

No blocking or non-blocking findings opened against `cand-e1c5d41b583b`.

Harness note (not a product defect): early QA runs used Playwright `check()` against presentation checkboxes while the table re-renders mid-save; assertions were stabilized to `click()` + presentation-meta / `data-*` waits. Product BV a11y e2e already passed on this candidate.

## Disposition

**PLAYER_VALIDATED.** Lifecycle advances to Product Owner review (`AWAITING_HUMAN_REVIEW`); approval is not inferred from this validation.
