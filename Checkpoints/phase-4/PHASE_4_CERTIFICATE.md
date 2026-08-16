---
recordType: phase_certificate
phase: phase-4
lifecycleState: PHASE_CERTIFIED
blueprintVersion: ALPHA_3_V1
blueprintSourceHash: 144f178d3cbfbe6572c299d4ad4b841ec3e6fa28ddedf5eddce0223e6250ce1e
certifiedCandidateId: cand-1de6ebed38c8
certifiedSourceTreeHash: 1de6ebed38c802c61ccb718d24dca051f1db2ccca2504df9e8d2f07a46debd87
certifiedCommit: c1fb66a5d3659c7cfad3b41f03831ba49c903bbb
humanGate: none
humanGateBasis: "Section 25 Phase 4 — no Product Owner local visual gate. Certification follows Builder Verification + Independent QA Player Validation only. Invite-Only Alpha / Public Milestone publication requires separate Product Owner authorization of the exact candidate."
builderVerification: PASSED
qaPlayerValidation: PLAYER_VALIDATED
openBlockingFindings: 0
certifiedAt: 2026-08-16T19:56:00Z
supersedesCandidateId: cand-f79b57277ebf
---

# Phase 4 — Realtime presence, identity, AI Director, speech

## Lifecycle

`IMPLEMENTING` → `BUILDER_VERIFYING` → `READY_FOR_QA` → `PLAYER_VALIDATED` → `PHASE_CERTIFIED`.

Phase 4 has **no** local Product Owner visual gate. Agents must not invent Product Owner approval. Publication of Invite-Only Alpha / Public Milestone remains optional and PO-authorized separately.

## Certified candidate

| Field | Value |
| --- | --- |
| Candidate id | `cand-1de6ebed38c8` |
| Source tree hash | `1de6ebed38c802c61ccb718d24dca051f1db2ccca2504df9e8d2f07a46debd87` |
| Certified commit | `c1fb66a5d3659c7cfad3b41f03831ba49c903bbb` |
| Blueprint | `ALPHA_3_V1` |
| Supersedes | `cand-f79b57277ebf` (UX remediation after extended playtest) |

The candidate hash covers tracked Builder Root source, dependency lock, and security rules. QA, Runtime, Evidence, Checkpoint, and archive artifacts are evidence about the candidate and are excluded.

## Gate evidence

| Gate | Outcome | Record |
| --- | --- | --- |
| Builder Verification | PASSED | `Checkpoints/phase-4/PHASE_4_BUILDER_VERIFICATION.md` |
| Independent QA | PLAYER_VALIDATED | `QA/findings/PHASE_4_QA_FINDINGS.md` |
| Product Owner approval | not required (local) | Section 25 Phase 4 `humanGate: none` |

## Scope certified

Realtime campaign presence with reconnect grace, account-grouped multi-device presence, spectator/absence, Active Turn disconnect lock; communication surfaces including Director Address audience routing; Google Sign-In mode via Auth emulator + machine-only QA fixtures alongside Local Arena development identity; Admin `/admin` with bootstrap `nick.donner@gmail.com`, audited AI kill switch, ordinary-user denial; deterministic Local Arena AI Director gateway with Payload Manifests, personality injection (Veyra/Garrick), NL Intent Intercept, mechanics-first narration; player-optional TTS/STT (STT → editable unsent drafts only); Provider Compliance Registry; four-plus simultaneous local player contexts; permanent smoke spine multiplayer/AI segment.

UX remediation included in this candidate: Claim Active Turn authority strip, visible composer gate hints, presence account grouping, presence-heartbeat no longer wiping Director/NL textareas (focus/scroll preserve on full panel renders).

## Honest bounds

- Local Arena AI text path is a **deterministic Director simulator** behind the production gateway boundary — not a claim of live LLM provider quotas.
- Google Sign-In is proven via **emulator/contract** locally; real Google OAuth belongs on hosted Milestone when PO publishes.
- Invite-Only Alpha / Public Milestone **capability** is ready; **publication is not authorized** by this certificate.

## Explicitly not certified here

Starter-campaign depth / final Director portrait art (Phase 5); full cumulative security/a11y/device cert (Phase 6); Gold Master / Launch Production (Phase 7).
