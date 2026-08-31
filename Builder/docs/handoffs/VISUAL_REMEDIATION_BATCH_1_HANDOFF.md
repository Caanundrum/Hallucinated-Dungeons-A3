# Cursor DEV Handoff — Visual Remediation Batch 1

**Branch:** `cursor/visual-remediation-batch1-96d1`  
**Governing docs:** `RIGHT_BRAIN_VISUAL_NORTH_STAR.md`, `CURSOR_DEV_VISUAL_REMEDIATION_BATCH_1.md`  
**Status:** Ready for independent right-brain retest — **not** visually approved by Cursor.

## Candidate

- Commit: see branch tip after push.
- Local Arena verification: `http://127.0.0.1:5173` (Rapid Builder).
- Hosted player (Firebase App Hosting / staging): `https://hd-a3-player--hd-a3-staging.us-central1.hosted.app` — updates when this branch is deployed/merged per project App Hosting settings.
- Alternate documented Cloud Run host: `https://hd-a3-staging-in4per6l4a-uc.a.run.app`.

## Files changed by workstream

### A — Responsive tactical table
- `Builder/src/client/styles.css` (≤900px task modes; chat hides play column; height budgets)
- `Builder/src/client/pages/campaign-table.ts` (focus into selected mobile task)

### B — Character-sheet modal
- `Builder/src/client/character-sheet-view.ts` (`tableModalSection` + section render)
- `Builder/src/client/pages/campaign-table.ts` (tabs, sticky chrome)
- `Builder/src/client/styles.css` (modal flex body, phone full-screen)

### C — Dice representation
- `Builder/src/client/pages/campaign-table.ts` (per-die face markup; 1200ms ritual / ~120ms reduced)
- `Builder/src/client/styles.css` (d4–d100 face geometry + tumble)
- **Direction chosen:** recognizable die-family faces (clip-path silhouettes), not claimed 3D mesh physics. Copy no longer says “Polyhedral dice.”

### D — Character-creation navigation
- `Builder/src/client/pages/character-create.ts` (stage-primary progress; local steps; premade notice)
- `Builder/src/client/styles.css` (hide equal-weight 7-step train; compact local pills)

### Tests
- `Builder/tests/e2e/visual-remediation-batch1.spec.ts`

## Automated tests run

| Suite | Result |
|---|---|
| `visual-remediation-batch1.spec.ts` | 4/4 passed |
| `table-overlay-mobile.spec.ts` | 1/1 passed |
| `qa-batch3-layout-playability.spec.ts` | 6/6 passed |
| `phase3-sprint-a-immersion.spec.ts` | 1/1 passed |
| `tsc --project tsconfig.client.json --noEmit` | pass |

## Deliberate deviations

- Phone Play map floor is ~42dvh so the composer stays in the first viewport; tablet (≥768 within task-mode band) keeps ≥55dvh map.
- Dice faces are CSS silhouettes with numbered faces, not physical 3D models.

## Explicitly not claimed

- No production-ready or final-QA approval is self-issued.
- Portrait / campaign-cover / painted battlemap art remain out of scope.
- Phase 3 backlog items beyond this batch are not claimed complete.
