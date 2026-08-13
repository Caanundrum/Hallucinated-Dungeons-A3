---
recordType: phase_execution_pack
phase: phase-1
packVersion: 1
blueprintVersion: ALPHA_3_V1
blueprintFile: HALLUCINATED_DUNGEONS_ALPHA_3_MASTER_BLUEPRINT_V1.md
blueprintSourceHash: 09d91f49c336
priorPhase: phase-0
priorPhaseState: PHASE_CERTIFIED
priorCertifiedCandidate: cand-32058f47eda8
lifecycleState: IMPLEMENTING
humanGate: required
authoredAt: 2026-08-12T18:30:00Z
---

# Phase 1 execution pack

Compiled from the authoritative blueprint under Section 1.14.5. Its purpose is the Context Diet
(Section 1.12.x): a Builder slice should read this pack plus the one domain section it owns,
rather than loading 15,537 lines for every task.

**This pack cannot narrow scope.** If it disagrees with the blueprint, the blueprint wins and the
pack is corrected. It is an execution aid, not an authority, and creating it satisfies no
requirement (Section 1.14.6).

## Mission

Create the first coherent player product: enter the site, understand it, create or quick-start a
legal character, create or join a campaign, configure the table, and reach a persistent game
shell.

## Invariant kernel

Carry these into every slice:

- Character ownership belongs to the authenticated account. No host, player, AI, client payload,
  display name, or campaign role may seize it.
- Canonical mechanical UI renders only server-produced projections. Local state may preview
  intent but may not become mechanical truth.
- Human conversation, rules questions, Director-addressed questions, and mechanical action
  declarations are separate first-class surfaces with separate records, endpoints, and authority.
  Party Chat never becomes a command by implication.
- Hidden records are omitted from player-facing payloads entirely, not passed with a flag.
- Alpha 3 progression is experience points only, one class, levels 1–20. No milestone advancement,
  no multiclassing.
- A hidden name, route, button, or shared secret is never authorization.
- Local execution only. No live project, public origin, or production credential.
- A feature is complete only when its entry condition, authority boundary, data ownership, visual
  state, empty/loading/blocked/degraded/failure states, keyboard and assistive-technology
  behavior, safety behavior, recovery path, and regression coverage all exist.

The identity, ownership, and persistence rules are fixed separately in
`PHASE_1_IDENTITY_AND_OWNERSHIP_CONTRACT.md` and are partly machine-enforced. Read that record
before writing any slice that touches accounts, characters, campaigns, seats, or settings.

## Inherited Phase 0 contracts

These exist, are certified, and must be extended rather than replaced:

| Contract | Where |
| --- | --- |
| `HD_*` environment schema v1 and fail-closed local guards | `src/server/config/environment.ts` |
| Development Test Identity, hashed opaque sessions, http-only cookie | `src/server/identity/` |
| Collection registry and admin SDK access | `src/server/persistence/` |
| Origin guard, candidate header, security headers, error-code contract | `src/server/http/server.ts` |
| Owner-scoped projection with `projectionVersion` and `totalCount` | `src/server/foundation/foundation-checks.ts` |
| Client render loop: server projections only, persistent live region, focus restoration | `src/client/` |
| Local Arena orchestration, Local Stack Manifest, readiness | `tools/arena/` |
| Frozen Local Certification Mode, run record, scanners | `tools/certification/` |
| Permanent smoke spine | `tests/e2e/smoke-spine.spec.ts` |

The Phase 0 foundation-check surface is scaffolding for the foundation proof, not a product
feature. Phase 1 may retire the player-facing page once a real shell exists, but it must keep the
smoke spine's canonical write/read segment working against whatever replaces it.

## Build scope

1. **Design System Manifest and responsive hosted shell.** Obsidian-blue direction, no hard hue
   bans. Start with the smallest coherent manifest the shell needs and evolve it under version
   control. Every component, asset request, and screenshot baseline names the manifest version it
   follows. This is not a human gate and does not require a finished design system before Phase 1
   can begin.
2. **Opening identity sequence, legal routes, local development access, accessibility
   foundations, stable navigation.** Programmatic-first cinematic: CSS and browser-native layout,
   optional canvas, small local SVG, optional local non-musical sound. No runtime image
   generation, AI call, remote animation service, iframe, third-party script, or WebGL-only
   effect may be required to form the title. Legal routes are `/legal/terms`, `/legal/privacy`,
   `/legal/alpha-participation`, `/legal/content-and-safety`, each reachable without
   authentication and each showing title, version, effective date, anchors, and a contact path.
   Opening a legal link must preserve pending invitation and form state.
3. **Character creation.** Custom and quick-start paths, Character Vault, derived values, drafts,
   validation, ownership. Familiar SRD 5.2.1 terminology is mandatory: Class, Background, Species,
   Hit Points, Armor Class, Speed, Initiative, Proficiency Bonus and the rest keep their SRD
   names. A plain-language subtitle may help a novice; it may not replace or imitate a rules term.
   Identity is **last**: Class → Background → Species → Ability Scores and Proficiencies →
   Equipment → Class Features and Spells → Identity & Final Review.
4. **Campaigns.** Creation, invitations, membership, seats, Session Zero, safety and content
   settings, group-decision policy, ownership. Creation requires choosing Veyra or Garrick, then
   one approved personality; both persist, are locked against ordinary editing, and carry a
   deterministic derived avatar key so later art attaches without a schema change.
5. **Settings.** The data model, plus only the controls that have real Phase 1 behavior. Reserve
   stable defaults for later speech input/output and AI presentation settings without exposing a
   control that does nothing.
6. **Communication Dock and Action Composer structural contracts.** Chronicle, Party Chat, and
   Rules Desk are peer destinations; the Action Composer is visually and behaviorally separate.
   Any visible Phase 1 control must do a real Phase 1 thing. Future controls stay absent rather
   than decorative.
7. **Minimum stable identifiers** for later maps, seats, command/event references, rules versions,
   settings, and campaign continuity — and nothing speculative beyond them.

## Explicitly not Phase 1

Absent, not stubbed: the tactical map and grid (Phase 2), command/event/projection core and
Timing Authority (Phase 2), rules engine, dice, combat, XP and progression (Phase 3), realtime
presence and multi-device behavior (Phase 4), AI Director narration and any Address-the-Director
response (Phase 4), Google Sign-In and account-role activation (Phase 4), Admin authorization and
panel (Phase 4), speech input and output (Phase 4), campaign memory and starter-campaign content
(Phase 5), production art and audio (Phase 5), and any hosted deployment.

A fake version of any of these fails certification under Section 1.12.4.

## Player journey to certify

From a fresh browser: enter, create a character, create a campaign, choose Veyra or Garrick and
one concrete personality, invite and join a second local development identity into campaign
membership and a seat, confirm an ordinary user cannot alter the locked Director configuration,
configure current Phase 1 settings, leave, return, and recover the same character and campaign
state.

This proves membership and ownership persistence. It is not the realtime multiplayer table, and
no Admin-panel or Google-login journey is required.

## Required evidence

- Focused unit and integration coverage for changed scope.
- Builder actual-page self-play on the running page before freeze.
- The permanent smoke spine, extended with the Phase 1 character/campaign continuity segment
  required by Section 25.3.
- Impact-selected prior regression. Full cumulative regression is **not** required in Phase 1
  unless a change crosses a core authority boundary such as identity or canonical state.
- A published, executed Phase 1 coverage model: enumerated finite dimensions, invalid constraints
  removing only impossible combinations, exhaustive numeric boundaries, reproducible pairwise
  selection, explicit high-risk interactions, a complete legal journey for every supported class,
  independently recalculated derived values, and restart, resume, ownership, stale-state, and
  duplicate-submission cases.
- Certification Run Record binding results to the frozen candidate.
- Architecture conformance, Code Completeness Scan, and greenfield evidence all clean.

QA then plays a smaller representative set as novice, expert, impatient, keyboard-only, high-zoom,
non-Chromium, tablet, and adversarial players, to the extent host and device evidence is
available. Real Safari and real-tablet certification may be recorded as
`BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION` before Phase 6/7 without failing Phase 1; emulated
engines must never be labelled real-device certification. QA passes only when the experience is
understandable and coherent, not merely because the matrix is green.

## Human gate

Phase 1 **has** an explicit Product Owner gate, unlike Phase 0. After Builder and QA have already
used and corrected the page, the Product Owner reviews the primary visual direction, opening
identity, character and campaign flow, and settings presentation.

Lifecycle: `PLAYER_VALIDATED` → `AWAITING_HUMAN_REVIEW` → `PHASE_CERTIFIED` on approval of that
exact candidate. Approval binds to the candidate hash; any later source or configuration change
voids it. Approval is never inferred from silence.

## Exit criteria

A player can enter the site, understand it, create a legal character, create or join a campaign
with a locked Director identity and personality, configure real settings, leave, return, and find
the same state — with one design language, one authority model, and one persistence contract, and
with the Product Owner's visual approval recorded against the certified candidate.

## Suggested slicing

Internal workstream checkpoints, not gates. QA handoff happens once, at the phase candidate.

1. Execution pack, ledger, ownership contract, architecture enforcement. **(done)**
2. Design System Manifest, hosted shell, navigation, legal routes, accessibility foundations,
   and the opening identity sequence with its skip control and fallbacks. **(done)**
3. ~~Opening identity sequence with its skip control and fallbacks.~~ Folded into step 2 above.
4. Account projection surface over the existing development identity. **(done — chunk 1d)**
5. Character creation: mechanical steps, validation, derived values, drafts. **(done — chunk 1c)**
6. Identity & Final Review, Create Character, Character Vault, ownership. **(done — chunk 1c)**
7. Campaign creation with Veyra/Garrick and personality lock, invitations, membership, seats. **(done — chunk 1e)**
8. Settings model and the controls with real behavior; Dock and Action Composer structure.
9. Reentry journey, coverage model, freeze, Builder Verification, QA, human gate.
