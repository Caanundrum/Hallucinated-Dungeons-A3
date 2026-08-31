# Cursor DEV Handoff — Contract-to-map exit projection

**Branch:** `cursor/scene-exit-projection-96d1`  
**Prior review:** Director Scene System Player Retest (2026-08-31) — Partial (exit coherence gap)  
**Status:** Ready for focused right-brain retest — **not** visually approved by Cursor.

## Candidate

- Hosted player: `https://hd-a3-player--hd-a3-staging.us-central1.hosted.app` (updates when deployed/merged)
- Local Arena: `http://127.0.0.1:5173`

## Narrow fix

Every scene-contract exit now projects as a visible tactical primitive (labeled exit marker + nearby door edge) inside spawn vision, for **all** scene kinds — including already-stored landmark scenes. Fog cannot hide contract exits.

## Focused retest path

1. Ordinary new table with a marsh inn premise → Begin → Confirm.
2. Declare `climb to the ruined watchtower on the ridge` → Confirm.
3. Verify banner/narration name parapet/ladder exits **and** the map shows those exit labels, exit markers, and a non-zero exit count (not `0 doors` / empty exits).
4. Optional: return and confirm exits still agree across Story so far.

## Fixture

Disposable blank campaign. Leave `Shadows over Emberferry` and retained QA tables alone unless needed.
