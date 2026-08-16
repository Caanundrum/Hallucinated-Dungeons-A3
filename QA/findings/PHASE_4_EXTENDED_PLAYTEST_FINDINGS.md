---
phase: phase-4
candidateId: cand-1de6ebed38c8
sourceTreeHash: 1de6ebed38c802c61ccb718d24dca051f1db2ccca2504df9e8d2f07a46debd87
commit: c1fb66a5d3659c7cfad3b41f03831ba49c903bbb
recordType: extended_playtest_findings
status: COMPLETED_FINDINGS_ADDRESSED
blockingForPhaseCertificate: false
executedAt: 2026-08-16T19:56:00Z
priorPlaytestCandidateId: cand-f79b57277ebf
---

# Phase 4 — Extended playtest & usability findings (remediated)

Initial extended playtest on `cand-f79b57277ebf` found High UX issues. Those were **fixed** in `cand-1de6ebed38c8` and re-verified. This record supersedes the parking recommendation from the first pass.

Frozen origin (remediation): `http://127.0.0.1:5274` · candidate `cand-1de6ebed38c8`.  
Rapid verification also ran at `http://127.0.0.1:5173` during fix iteration.

## What ran (remediation candidate)

| Check | Method | Outcome |
| --- | --- | --- |
| Extended playtest suite | Playwright × desktop/tablet/phone | **30/30 PASS** (`phase4_ux_playtest_all.log`) |
| Scroll thrash regression | `PT4-UX-01` (11s heartbeat dwell) | **PASS** × 3 viewports |
| Claim placement + gate hint | `PT4-COMP-01` geometry + copy asserts | **PASS** |
| Confused / live GUI | Computer-use on Rapid Arena | **PASS** — Claim visible, gate hint, Director send+reply, presence clean |
| Independent QA | `phase4-player.qa.spec.ts` on frozen | **5/5 PASS** |
| Builder Verification | `npm run certify:phase4` | **PASSED** (73/73 browser, 129 unit) |

## Findings status after fix

| Finding | Severity (was) | Status |
| --- | --- | --- |
| Claim Active Turn buried below fold | HIGH | **Fixed** — authority strip above training encounter |
| Weak disabled feedback | HIGH | **Fixed** — live `composer-gate-hint` + `aria-describedby` |
| Director/NL scroll thrash on presence heartbeat | HIGH | **Fixed** — presence patches only; focus/scroll preserve on full renders |
| Presence dual-row / raw tab ids | MEDIUM | **Fixed** — account-grouped rows (“Online · N devices/tabs”) |
| Scroll-heavy table overall | MEDIUM | **Open (residual)** — layout density remains; Claim is no longer the buried control |
| Dense authority wording | LOW | **Open (residual)** — non-blocking |

## Verdict for Nick

- Issues found in the extended playtest were **fixed and re-certified**, not parked.
- New certified candidate: `cand-1de6ebed38c8` (supersedes `cand-f79b57277ebf`).
- Residual Medium/Low layout density remains optional polish — not a phase reopen.

## Evidence

- Demo: `/opt/cursor/artifacts/phase4_ux_fixes_demo_compact.mp4`
- Screenshots: `/opt/cursor/artifacts/phase4_ux_fix/`
- Suite log: `/opt/cursor/artifacts/phase4_ux_playtest_all.log`
