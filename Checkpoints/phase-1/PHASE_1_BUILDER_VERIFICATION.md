---
phase: phase-1
candidateId: cand-b5e4a128cef1
sourceTreeHash: b5e4a128cef1e32201306741e0bd81ce3752b64716f011bd06ddfe336c488da8
commit: 513d4079408b53f0c7583e83401cf11c856b573f
blueprintVersion: ALPHA_3_V1
lifecycleAfterVerification: READY_FOR_QA
verifiedAt: 2026-08-14T19:39:20Z
status: PASSED
certificationRunRecord: Evidence/phase-1/cand-b5e4a128cef1-2026-08-14T19-38-07-292Z/certification-run-record.json
localStackManifest: Runtime/certification/cand-b5e4a128cef1/local-stack-manifest.json
---

# Phase 1 — Builder Verification

Frozen Local Certification Mode passed against candidate `cand-b5e4a128cef1`.

## What ran

| Check | Result |
| --- | --- |
| Pinned toolchain | pass |
| Builder root clean | pass (100 tracked files) |
| Code Completeness Scan | pass (0 classified findings) |
| Architecture conformance | pass (0 violations) |
| Greenfield source tree | pass |
| Blueprint preflight | pass (`ALPHA_3_V1`) |
| Candidate materialize + `npm ci` + build | pass |
| Frozen runtime | `http://127.0.0.1:5274` |
| Focused unit suite | 101 pass / 0 fail |
| Actual-page self-play + smoke spine | **57 / 57** browser scenarios pass |
| Browser suite floor | 57 executed (56 expected minimum) |
| Candidate unchanged during run | pass |

Command: `cd Builder && npm run certify:phase1`

## Post-matrix skeptical pass (before human gate)

A second Builder pass hunted playability/UI/authority issues against the prior candidate and fixed:

- Session Zero selects showing raw enum ids (`fade_to_black`, etc.) → human labels
- Foreign/missing campaign stacking generic `No such route.` on honest unavailable copy
- Director "Avatar key" wording → "Look key" with honesty note
- Diagnostics Enter busy-race that could drop keyboard record submits

Replacement candidate `cand-b5e4a128cef1` was re-frozen and re-verified after those corrections.

## Handoff

Candidate `cand-b5e4a128cef1` is `READY_FOR_QA`. Serve with:

```bash
cd Builder && npm run serve:frozen -- cand-b5e4a128cef1
```

Independent QA must use this exact candidate hash. Any later Builder source change voids this verification.
