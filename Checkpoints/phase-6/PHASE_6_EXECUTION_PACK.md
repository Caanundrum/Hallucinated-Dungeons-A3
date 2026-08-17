---
recordType: phase_execution_pack
phase: phase-6
packVersion: 1
blueprintVersion: ALPHA_3_V1
blueprintFile: HALLUCINATED_DUNGEONS_ALPHA_3_MASTER_BLUEPRINT_V1.md
blueprintSourceHash: 144f178d3cbf
priorPhase: phase-5
priorPhaseState: PHASE_CERTIFIED
priorCertifiedCandidate: cand-77e0e060e3b4
lifecycleState: PHASE_CERTIFIED
humanGate: none
humanGateNote: "Section 25.4 — Phase 6 has no Product Owner local phase-approval gate. Deep Independent QA Judge challenge is required. Optional human Alpha cohorts are supplemental."
authoredAt: 2026-08-17T02:26:00Z
---

# Phase 6 execution pack

Compiled from Section 25 Phase 6. This pack cannot narrow scope; the blueprint wins.

## Mission

Attack the complete product and prove it stays coherent over real multi-session use.

## Invariant kernel (carry forward)

- Command gateway remains the only mechanical mutator.
- Secrets never collapse into public projections.
- Origin-bound mutating requests; no foreign-origin writes.
- Local Arena development identity and deterministic Director simulator stay honest — not production Google OAuth or live LLM claims.
- Real Safari / certified-tablet hardware evidence may be `BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION` on this host; engine coverage must not be mislabeled as Safari.

## Build scope

1. Security, privacy, moderation hooks, abuse/rate/cost controls, secret handling, recovery incidents, provider-failure paths.
2. WCAG 2.2 AA core-loop certification (automated + keyboard/high-zoom/reduced-motion/low-effects); supported browser matrix with honest Safari/tablet bounds.
3. Chaos and interruption testing: reconnect, duplicate commands, AI kill switch, speech/asset fallbacks, evidence integrity.
4. Longitudinal multi-session QA through Emberferry and beyond planned climax.
5. Deep Independent QA Judge challenge of Builder evidence and QA findings (fake-success / omission attacks).
6. **Full cumulative regression** of the complete applicable catalog.

## Explicitly not Phase 6

Gold Master / Launch Production cutover (Phase 7); inventing Open Alpha; claiming real Safari/tablet AT passes without hardware evidence.

## Lifecycle

`IMPLEMENTING` → `BUILDER_VERIFYING` → `READY_FOR_QA` → `PLAYER_VALIDATED` →
(Independent QA Judge challenge) → `PHASE_CERTIFIED` (no PO gate).

## Suggested slicing

1. Pack, ledger, Judge role contract, `certify:phase6` floor.
2. Command/AI/chat rate limits + account deletion-request path + security e2e.
3. WCAG core-loop / keyboard / high-zoom / reduced-motion certify suite.
4. Chaos/recovery/provider-failure e2e.
5. Longitudinal Emberferry multi-session QA.
6. Independent QA Judge scripts + full cumulative certify.
