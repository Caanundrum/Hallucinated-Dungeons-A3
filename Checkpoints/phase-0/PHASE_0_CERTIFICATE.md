---
recordType: phase_certificate
phase: phase-0
lifecycleState: PHASE_CERTIFIED
blueprintVersion: ALPHA_3_V1
blueprintSourceHash: 09d91f49c336
certifiedCandidateId: cand-32058f47eda8
certifiedCommit: c39e1f3fa067f76ea0cf2db5681dad7ca85267c7
humanGate: none
humanGateBasis: "Section 25 assigns explicit Product Owner gates to Phases 1, 2, 5, and 7. Phase 0 has no human gate, so PLAYER_VALIDATED advances directly to PHASE_CERTIFIED under Section 1.11.19."
builderVerification: PASSED
qaPlayerValidation: PLAYER_VALIDATED
openBlockingFindings: 0
certifiedAt: 2026-08-12T17:20:00Z
---

# Phase 0 — Minimum greenfield foundation and real local browser smoke

## Lifecycle

`IMPLEMENTING` → `BUILDER_VERIFYING` → `READY_FOR_QA` → `PLAYER_VALIDATED` → `PHASE_CERTIFIED`.

Section 25 names no Product Owner gate for Phase 0, so no human approval was required or
inferred. The Phase 1 visual gate is the first one that applies.

## Certified candidate

| Field | Value |
| --- | --- |
| Candidate id | `cand-32058f47eda8` |
| Certified commit | `c39e1f3fa067f76ea0cf2db5681dad7ca85267c7` |
| Tracked Builder Root files | 44 |
| Dependency lock hash | `f1be8b63847c56378030f5f5d60c1bb388addccb23d4f2e343289075ba58dba2` |
| Firestore rules hash | `d40ba75e207f6e00c2aed9b0d261a386570a650f702537734944685575b85df1` |
| Blueprint | `ALPHA_3_V1`, source hash `09d91f49c336…`, 15,537 lines |

The candidate hash covers exactly the tracked Builder Root source, its dependency lock, and its
security rules. QA, Runtime, Evidence, Checkpoint, and archive artifacts are evidence about the
candidate and are excluded, as Section 1.11.1 requires. Committing this certificate therefore
does not change the certified candidate.

## Builder Verification

Executed in Frozen Local Certification Mode by `npm run certify:phase0`. Every step passed
against the frozen runtime, not against a hot-reloading development server.

| Step | Result |
| --- | --- |
| `pinned_toolchain_verified` | pass — Node 22.14.0, npm 10.9.7, Java 21, Firebase CLI 13.35.1, Firebase Admin 13.10.0, TypeScript 5.9.3, Vite 6.4.3, Playwright 1.62.1 |
| `builder_root_clean` | pass — 44 tracked files, no uncommitted change |
| `code_completeness_scan` | pass — 41 files scanned, 0 findings |
| `greenfield_source_tree_clean` | pass — 44 tracked files, 740 locked packages, no prohibited pattern |
| `blueprint_preflight` | pass |
| `candidate_materialized` | pass — tracked files copied into the `<WORKING_DIRECTORY>/Builder` layout |
| `clean_dependency_install_from_lockfile` | pass — `npm ci` |
| `candidate_build` | pass |
| `frozen_runtime_ready` | pass — fresh emulators, deterministic baseline, isolated ports, 10 readiness checks |
| `focused_unit_suite` | pass — 28 passed, 0 failed, 0 skipped |
| `actual_page_self_play_and_smoke_spine` | pass — 23 passed, 0 failed, 0 skipped |
| `browser_suite_executed_expected_scenarios` | pass — 23 of 23 expected scenarios executed |
| `candidate_unchanged_during_run` | pass — source hash identical before and after |

Run record: `Evidence/phase-0/cand-32058f47eda8-2026-08-12T17-04-15-955Z/certification-run-record.json`.

Builder also operated the rendered page interactively against this frozen runtime: entered with a
development identity, recorded two checks, triggered a validation failure, and refreshed to
confirm the identity and both records returned.

## QA Player Validation

Independent QA worked from QA Root in an isolated context across three passes and closed every
finding it opened.

| Pass | Candidate | Scope | Outcome |
| --- | --- | --- | --- |
| Initial | `cand-0f810c6c26d8` | 22 browser scenarios, 37 raw-HTTP adversarial checks | `DEFECTS_OPEN` — 8 findings, 1 blocking |
| Retest 1 | `cand-882c6c2fe4a3` | 46 browser scenarios, 37 HTTP checks, 15 new-surface checks | 8 closed, 1 new low finding |
| Retest 2 | `cand-32058f47eda8` | 57 browser scenarios, 37 HTTP checks, 15 new-surface checks | all closed, `PLAYER_VALIDATED` |

Findings: `QA/findings/PHASE_0_QA_FINDINGS.md`. Remediation:
`Checkpoints/phase-0/qa-remediation/PHASE_0_REMEDIATION_REPORT.md`.

The blocking finding was real and was found by using the page, not by reading code: any session
or authentication failure signed the player out with no visible explanation, because the message
region was nested inside a panel that disappears when the identity clears.

QA could not create a duplicate record, read another account's data, write unauthenticated,
submit from another origin, execute injected markup, or reach anything through path traversal.

## Exit criteria

Section 25 Phase 0 exit: "The project has a clean local workspace, reproducible startup, working
emulator-backed browser flow, role isolation, and truthful test output."

- Clean local workspace — greenfield evidence over 44 tracked files, no alternate topology,
  compatibility switch, password flow, live credential, or imported database export.
- Reproducible startup — one orchestration entry point, pinned toolchain, clean lockfile install,
  deterministic baseline seed, one Local Stack Manifest and one readiness result.
- Working emulator-backed browser flow — an authenticated browser journey commits through the
  Firestore emulator and renders the result back from a server projection.
- Role isolation — Builder Root, QA Root, Runtime, Evidence, Checkpoints, and Pending-Archive
  resolve beneath the runtime-selected Working Directory with role sentinels; QA authored every
  byte under QA Root and Builder authored none of it.
- Truthful test output — every step records executed counts, and a runner that exits zero without
  executing assertions fails the step.

Archive state is `ARCHIVE_PENDING`: no `ARCHIVE_DIRECTORY` is configured, which Section 1.11.3
permits without blocking certification.

## What Phase 0 deliberately does not contain

No characters, campaigns, seats, maps, grid, dice, rules engine, AI Director, chat surfaces,
settings model, realtime service, Google Sign-In, Admin interface, or hosted environment. Section
25 assigns each to a later phase. None is stubbed, faked, or represented by a decorative control.
The Local Stack Manifest reports the absent WebSocket service as
`NOT_YET_IMPLEMENTED — Phase 2` rather than claiming a socket that does not exist.

## Next phase

Phase 1 — product shell, character creation, campaigns, and settings. It carries the first
explicit Product Owner visual gate.
