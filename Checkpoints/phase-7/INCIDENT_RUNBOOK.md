---
recordType: incident_runbook
phase: phase-7
blueprintVersion: ALPHA_3_V1
status: local_arena_ready
launchProductionOnCall: NOT_STANDING
---

# Incident runbook (Gold Master)

This is the operational incident path for the certified candidate. It is not a claim that a hosted on-call rotation is standing.

## Detection

- Local / frozen: `GET /api/health` (`ready` vs `degraded`).
- Hosted (when authorized later): the same health path is the only operational smoke permitted on Gold Master artifacts. It cannot mint identities, impersonate players, or mutate gameplay.

## Severity

- **Critical:** data loss, unauthorized access, duplicated canonical state, identity bypass.
- **High:** players cannot complete the core loop, rules wrong, safety failure.
- **Medium / Low:** workaround exists; does not violate a hard invariant.

## Response (local)

1. Reproduce on the Local Arena against the frozen candidate — never hotfix a hosted environment directly (Section 25.6).
2. Fix in source, freeze a replacement candidate, rerun affected suites plus the permanent smoke spine.
3. Independent QA retests player-facing defects.
4. If the Product Owner had approved a prior candidate, that approval is void; only the replacement hash may return to the release gate.

## Response (hosted, after future authorization)

1. Disable new writes via the existing Admin AI kill switch and ordinary operational controls — not a second hidden backdoor.
2. Do not mint fixtures or impersonate players in Launch Production.
3. Roll back to the previous Gold Master using `ROLLBACK_PROCEDURE.md`.
4. Remediate locally, recertify, obtain a new Product Owner authorization bound to the new hash.

## Support path

Alpha testers contact the project through the invitation channel that issued access. There is no public ticket portal in this candidate.
