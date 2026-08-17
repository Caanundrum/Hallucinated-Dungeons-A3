---
recordType: rollback_procedure
phase: phase-7
blueprintVersion: ALPHA_3_V1
launchProduction: NOT_DEPLOYED
---

# Rollback procedure (Gold Master)

## What rollback means here

Rollback restores a **previously certified candidate identity** (candidate id + source tree hash + dependency lock). It does not patch hosted files in place.

## Local Arena / Frozen Certification

1. Stop the frozen runtime.
2. Serve the prior certified candidate with `npm run serve:frozen -- <prior-candidate-id>` (or the equivalent arena start against that materialized tree).
3. Confirm `GET /api/candidate` returns the prior `candidateId`.
4. Run the permanent smoke spine against that origin.

This is the rollback proof this host can execute. It does not require Launch Production credentials.

## Launch Production (not executed on this host)

When a Product Owner later authorizes Launch Production for an exact Gold Master:

1. Redeploy the previously authorized Gold Master artifact (same hash) to the Launch Production Firebase environment.
2. Run only reviewed non-destructive hosted smoke.
3. Do not apply untracked cloud hotfixes.
4. Confirm the deployed artifact identity equals the authorized candidate hash.

Until that authorization and those credentials exist, Launch Production rollback remains a documented procedure, not an executed operation.
