---
recordType: phase_execution_pack
phase: phase-7
packVersion: 1
blueprintVersion: ALPHA_3_V1
blueprintFile: HALLUCINATED_DUNGEONS_ALPHA_3_MASTER_BLUEPRINT_V1.md
blueprintSourceHash: 144f178d3cbf
priorPhase: phase-6
priorPhaseState: PHASE_CERTIFIED
priorCertifiedCandidate: cand-ba96785c84c8
lifecycleState: PHASE_CERTIFIED
humanGate: product_owner_release
humanGateNote: "Section 25 Phase 7 — Product Owner approves the final hosted presentation, legal/provider experience, exact release candidate, and production publication. This is a release decision, not another implementation-plan approval. Launch Production deploy is a separate authorized operation and is not performed from the Local Arena."
authoredAt: 2026-08-17T11:40:00Z
---

# Phase 7 execution pack

Compiled from Section 25 Phase 7. This pack cannot narrow scope; the blueprint wins.

## Mission

Certify and release the exact production candidate without changing architecture at the finish line.

## Invariant kernel (carry forward)

- Command gateway remains the only mechanical mutator.
- Secrets never collapse into public projections.
- Origin-bound mutating requests; no foreign-origin writes.
- Hosted player identity is Google Sign-In only. Development identities, QA fixture minting, and QA harness endpoints are Local Arena capabilities and are stripped from Gold Master / hosted artifacts.
- Local Arena certification still uses emulators. This pack does not start Launch Production, mint production credentials, or treat a local rehearsal as a hosted deploy.
- Real Safari / certified-tablet hardware / VoiceOver AT may remain `BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION` on this host; engine coverage must not be mislabeled as Safari.

## Build scope

1. Final public identity, provider-policy age/region handling, legal documents/acceptance, privacy, provider/service registry, quotas, monitoring, incident runbooks, rollback, backups, cost controls, and support paths.
2. Remove local development identities, QA capabilities, fixture minting, reset controls, and QA harness endpoints from Gold Master / hosted artifacts. Production may retain only operational health/smoke that cannot mint fixture authority, impersonate players, bypass identity, or mutate gameplay outside ordinary authorized paths.
3. Full supported-browser/device, accessibility, security, rules, multiplayer, AI, voice/persona, visual, performance, recovery, and **complete cumulative regression** against the exact release candidate.
4. Verify packaged Gold Master identity equals the certified candidate; remote hosted smoke is narrow, non-destructive, and **not claimed** until Product Owner authorizes a real Launch Production target.

## Explicitly not Phase 7 (until PO authorization + credentials exist)

- Deploying to Launch Production Firebase.
- Claiming live Google OAuth against a public project from this Local Arena.
- Claiming real Safari / tablet / VoiceOver certification without hardware evidence.
- Inventing Open Alpha.
- Inventing external legal/brand counsel sign-off that has not occurred.

## Honest bounds this host can prove

- Gold Master **artifact profile** (`publicSurface=gold_master`) fails closed on stripped capabilities while still running against local emulators.
- Frozen Local Certification of this phase remains `publicSurface=local_arena` so the cumulative catalog (which uses development identity) still executes.
- Launch Production: `NOT_DEPLOYED`. Product Owner authorization: `NOT_GRANTED` until the release checkpoint is approved.

## Lifecycle

`IMPLEMENTING` → `BUILDER_VERIFYING` → `READY_FOR_QA` → `PLAYER_VALIDATED` →
(Independent QA Judge challenge) → `AWAITING_HUMAN_APPROVAL` → `PHASE_CERTIFIED`
(only after Product Owner release approval of the exact candidate).

Launch Production (`PRODUCTION_AUTHORIZED` / `PRODUCTION_DEPLOYED`) is a further
Product Owner-gated operation against that exact Gold Master and is not implied
by local `PHASE_CERTIFIED`.

## Suggested slicing

1. Pack, ledger, PO release checkpoint, Judge contract, `certify:phase7` floor.
2. Public surface / Gold Master fail-closed identity + QA harness stripping.
3. Legal V2 + acceptance history; provider/eligibility/ops registry.
4. Home browser matrix, Account Google rehearsal + legal acceptance UI.
5. Full cumulative certify + Independent QA + Judge → present PO gate.
