---
recordType: phase_coverage_model
phase: phase-1
modelVersion: 1
blueprintVersion: ALPHA_3_V1
coverageAlgorithm: pairwise_plus_boundaries_plus_risk
authoredAt: 2026-08-14T18:00:00Z
---

# Phase 1 coverage model

Blueprint ownership: C.AUTONOMY.10 and Section 1.12.9. This model is published **before** final
Builder Verification and is executed by the named suites below. A green matrix that does not
reconcile to these case IDs is not evidence.

## 1. Finite dimensions

| Dimension | Values |
| --- | --- |
| D1 Identity path | `signed_out`, `development_sign_in` |
| D2 Character path | `none`, `quick_start`, `custom_draft_resume` |
| D3 Campaign role | `none`, `owner`, `invited_member` |
| D4 Director identity | `veyra`, `garrick` |
| D5 Director personality | six catalog personalities |
| D6 Settings profile | `adventure`, `tense`, `custom_restricted` |
| D7 Group decision | `majority_vote`, `unanimous_consent`, `designated_caller` |
| D8 Dock surface | `chronicle`, `party_chat`, `rules_desk`, `action_composer_structure` |
| D9 Continuity | `fresh`, `reload_same_session`, `soft_nav_return` |
| D10 Authority probe | `own`, `foreign_looks_missing`, `director_lock`, `duplicate_submit` |

## 2. Invalid constraints (impossible combinations removed)

- C1: `signed_out` cannot create character, campaign, seat, or settings write.
- C2: `none` character path cannot take a seat.
- C3: `invited_member` cannot edit Director identity/personality or campaign settings writes.
- C4: `designated_caller` without a member account id is refused by validation.
- C5: `action_composer_structure` never accepts a mechanical commit in Phase 1.
- C6: Party Chat modes are only `table_talk` and `speak_as_character` (no Address-the-Director).
- C7: Foreign account × own resource → indistinguishable from missing (no ownership leak).

## 3. Exhaustive numeric boundaries

| Boundary | Min | Default | Max | Covered by |
| --- | --- | --- | --- | --- |
| Campaign name length | 1 | — | 80 | unit `campaign-contract`; create e2e |
| Reaction window (seconds) | 8 | 12 | 30 | settings contract unit; settings e2e |
| Party Chat message length | 1 | — | 500 | party-chat server validation; dock e2e |
| Ability roll attempts | 1 | — | 3 | characters e2e |
| Foundation note / payload size | — | — | server limit | qa-regressions oversized body |

## 4. Pairwise selection (reproducible)

Seed: `phase-1-coverage-v1`. Selected cross-dimension pairs (not full Cartesian):

| Case ID | Pair | Executable evidence |
| --- | --- | --- |
| P1-PW-01 | quick_start × owner × veyra | `phase1-campaigns`, `phase1-reentry` |
| P1-PW-02 | quick_start × invited_member × seat | `phase1-campaigns`, `phase1-reentry` |
| P1-PW-03 | custom_draft_resume × own vault | `phase1-characters` custom resume |
| P1-PW-04 | tense profile × session zero × dock | `phase1-settings-dock` |
| P1-PW-05 | garrick × personality catalog lock | `phase1-campaigns` / contract unit |
| P1-PW-06 | reload_same_session × campaign+settings | `phase1-reentry` |
| P1-PW-07 | foreign_looks_missing × character+campaign | `phase1-characters`, `phase1-campaigns` |
| P1-PW-08 | party_chat × action_composer_structure | `phase1-settings-dock` |
| P1-PW-09 | reduced_motion × account presentation | `phase1-settings-dock` |
| P1-PW-10 | smoke spine continuity × character | `smoke-spine` character segment |
| P1-PW-11 | smoke spine continuity × campaign | `smoke-spine` campaign segment |

## 5. High-risk interactions

| Risk ID | Interaction | Evidence |
| --- | --- | --- |
| P1-RK-01 | Ordinary user alters locked Director config | campaigns e2e PATCH 409 |
| P1-RK-02 | Seat foreign characterId | campaigns e2e 404 |
| P1-RK-03 | Chat text must not become a command | dock e2e Action Composer unavailable + send clarity |
| P1-RK-04 | Duplicate foundation requestId | Phase 0 foundation path / unit continuity |
| P1-RK-05 | Session death mid-use explained | `qa-regressions` P0-QA-001 |
| P1-RK-06 | Cross-origin identity refused | arena readiness + Phase 0 QA HTTP probes |

## 6. Legal journey per supported quick-start / class path

Phase 1 supports quick-start archetypes and custom class selection validated against the SRD
manifest. Complete journeys:

| Journey ID | Path | Evidence |
| --- | --- | --- |
| P1-CL-01 | Stalwart Defender quick-start | characters + campaigns + reentry e2e |
| P1-CL-02 | Devoted Healer quick-start | smoke-spine character continuity |
| P1-CL-03 | Custom identity-last creation | characters e2e custom path |
| P1-CL-04 | Derived values independently checked | `character-rules` unit suite |

## 7. Restart, resume, ownership, stale-state, duplicate-submission

| Case ID | Behavior | Evidence |
| --- | --- | --- |
| P1-RS-01 | Draft resume after leaving wizard | characters e2e |
| P1-RS-02 | Reload recovers character + campaign + settings | `phase1-reentry` |
| P1-RS-03 | Soft-nav return keeps campaign query/seat UI | campaigns e2e return soft-nav |
| P1-RS-04 | Ownership: foreign vault empty / foreign id 404 | characters + campaigns e2e |
| P1-RS-05 | Stale/dead session explained on page | qa-regressions |
| P1-RS-06 | Duplicate submission / idempotent foundation write | foundation unit + Phase 0 spine |

## 8. Residual gaps (honest)

- Real Safari and real-tablet certification: `BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION` until Phase 6/7 device evidence (emulation must not be labelled real-device).
- Full custom journey for every SRD class beyond representative quick-starts and rules-unit coverage remains impact-selected; Phase 1 does not require exhaustive UI play of all classes when derived-value unit coverage and one custom path exist.
- Non-Chromium browser matrix deferred with the same device-cert note.

## 9. Execution binding

Final Builder Verification runs the permanent smoke spine, Phase 1 e2e suites, unit suites, and
architecture/completeness/greenfield scans against one frozen candidate. Case IDs above must
appear in the Certification Run Record’s referenced suites (`browserSuite` totals + named files).

Machine check: `tests/unit/phase1-coverage-model.test.mjs`.
