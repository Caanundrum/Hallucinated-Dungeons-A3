---
recordType: phase_execution_pack
phase: phase-4
packVersion: 1
blueprintVersion: ALPHA_3_V1
blueprintFile: HALLUCINATED_DUNGEONS_ALPHA_3_MASTER_BLUEPRINT_V1.md
blueprintSourceHash: 144f178d3cbf
priorPhase: phase-3
priorPhaseState: PHASE_CERTIFIED
priorCertifiedCandidate: cand-cc92bfc17c10
lifecycleState: IMPLEMENTING
humanGate: none
humanGateNote: "Section 25.4 — no Phase 4 local visual PO gate. Invite-Only Alpha / Public Milestone publication still requires explicit Product Owner authorization of the exact candidate."
blindPlayerAccess: "Hosted Milestone HTTPS after local Phase 4 cert + PO publication auth; tunnels only as pre-Milestone bridge."
authoredAt: 2026-08-16T16:56:00Z
---

# Phase 4 execution pack

Compiled from Section 25 Phase 4. This pack cannot narrow scope; the blueprint wins.

## Mission

Make the table feel alive with two-to-six players and a configurable AI Game Director while
preserving deterministic mechanics and hidden-information boundaries. Deliver Google-backed
hosted identity and Invite-Only Alpha *capability* (publication remains optional and PO-gated).

## Invariant kernel (carry forward)

- Only the command gateway mutates mechanics. Party Chat / Rules Desk / Chronicle / Director
  Address never become commands by implication.
- Commands carry `requestId` + `expectedStateVersion` + Timing Authority where required.
- Events immutable; projections server-authored; fog/hidden facts omitted from unauthorized viewers.
- Server randomness only for dice. Client never invents outcomes.
- Role-isolated AI payloads; mechanics-first delivery; campaign AI kill switch.
- Local certification first; Milestone publication is optional and PO-authorized.

## Build scope

1. Realtime presence, reconnect grace, multi-tab/device, join/leave, active-Initiative disconnect
   lock, party sync, spectator/absence rules.
2. Communication surfaces: Chronicle, Party Chat, Rules Desk, Action Composer, Director Address,
   audience routing, moderation hooks, notifications.
3. Hosted Google Sign-In + account-role activation; local development identity remains until
   cutover; machine-only QA fixture sessions for Local Arena automation.
4. Admin panel `/admin` + APIs: bootstrap administrator is exact Google account
   `nick.donner@gmail.com`; admin-as-normal-player proof; ordinary-user denial / spoof / stale /
   privilege-escalation attacks fail closed.
5. AI role isolation, provider boundary, Intent Intercept, bounded Director rulings,
   mechanics-first narration, streaming + fallback narration, AI kill switch.
6. Persistent Veyra/Garrick identity + personality injection across Director/Narrator calls;
   Admin-only override of locked campaign Director.
7. Player-optional TTS/STT: Director voice family TTS; STT → editable unsent drafts only;
   neither speech path bypasses composer / Intent Intercept / Timing Authority.
8. Humor calibration (~30% target, ≥20% QA minimum) without runtime joke quotas.
9. Provider Compliance Registry for selected AI/speech services; provider-policy age/region gate
   only when required.
10. Four-plus simultaneous local player contexts through exploration/social/combat with AI,
    speech diversity, disconnect/reconnect, and adversarial QA matrix.
11. Optional Public Milestone / Invite-Only Alpha readiness (PO publication auth separate).

## Explicitly not Phase 4

Starter-campaign depth, production art packs, final Director portraits as finished art,
campaign memory chapters (Phase 5); full cumulative security/a11y/device cert (Phase 6);
Gold Master release (Phase 7).

## Player journey to certify

≥4 simultaneous local player contexts: exploration/social/combat with AI narration, chat,
Director questions, NL actions → Intent Intercept, rolls, reactions, disconnect/reconnect,
per-player speech settings (including one player with neither), consistent Director
identity/personality/avatar key. Bootstrap admin completes ordinary player play without
Admin privilege leakage. Illegal Admin / spoof / out-of-turn / prompt-injection / hidden-info
attempts fail closed.

## Lifecycle

`IMPLEMENTING` → `BUILDER_VERIFYING` → `READY_FOR_QA` → `PLAYER_VALIDATED` →
`PHASE_CERTIFIED` (no local PO visual gate). Publication of Invite-Only Alpha / Public
Milestone requires separate Product Owner authorization of the exact candidate.

## Local vs hosted identity testing

- Local Arena / BV / Independent QA: development identity + machine-only QA fixtures continue.
- Google Sign-In: emulator/contract proof locally; real Google on hosted Milestone when published.
- Blind Antigravity/Codex players: use hosted Milestone HTTPS after publication — not Cloud Agent localhost.

## Suggested slicing (internal; not gates — execute continuously)

1. Pack, ledger, presence/realtime contracts, multi-device session foundations.
2. Google identity mode + Admin panel/bootstrap + admin-as-player proof.
3. Audience routing / Director Address / communication upgrades.
4. AI gateway, Intent Intercept NL path, narration, kill switch, humor sampling.
5. Speech I/O prefs + TTS/STT draft path.
6. Four-plus-player integrated journey, smoke spine multiplayer/AI segments, freeze, BV, QA, certificate.
