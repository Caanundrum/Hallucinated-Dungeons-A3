# Cursor DEV Handoff — Batch 3 Scene Abstraction & Coherence

**Branch:** `cursor/batch3-scene-abstraction-96d1`  
**Governing requirement:** `DIRECTOR_SCENE_SYSTEM_REQUIREMENT.md`  
**Prior review:** Right-Brain Player Review Batch 2 (2026-08-31) — Partial  
**Status:** Ready for independent right-brain player review — **not** visually/experientially approved by Cursor.

## Candidate

- Hosted player: `https://hd-a3-player--hd-a3-staging.us-central1.hosted.app` (updates when this branch is deployed/merged)
- Local Arena: `http://127.0.0.1:5173`

## Ordinary player start

1. Sign in.
2. Create a character (quick start is fine).
3. **New table** — fill title; optionally set **Adventure premise**.
4. Choose Director → create → seat → **Open table**.
5. Press **Begin the adventure** → a confirmable draft appears → **Confirm** (Cancel leaves the blank table unchanged).

## Safe journey (coherence batch)

1. Interior opens from premise (not Quiet chamber).
2. Declare `extinguish the lamp` → Confirm → lamp unlit.
3. Declare `smash the overturned bench` (or other non-light cover/container) → Confirm → object broken.
4. Declare leave toward marsh/forest/village → Confirm → exterior/travel.
5. Declare travel onward into danger → Confirm → encounter; **inhabitant marker must appear on the tactical map** (e.g. Cloaked stranger / bandit / wolf).
6. Declare `return to the earlier scene` (twice if needed) → Confirm → interior restored with lamp unlit **and** bench broken.
7. Reload — both consequences remain.

## Open-ended reusability (required)

From an interior (or any established scene), declare a destination **outside** the prepared marsh/danger wording, e.g.:

`climb to the ruined watchtower on the ridge`

Confirm → a landmark scene with a **materially different layout and exit set** (tall tower footprint, parapet/ladder exits, arrow-loop shutter). Alternate phrases: foggy docks, limestone cavern, stone bridge, courtyard ruins.

## Confirmations that change campaign state

- **Begin the adventure** draft → Confirm
- Object interact drafts (`table.interact_object`)
- Travel / landmark / return drafts (`table.travel_scene`)
- Cancel leaves the scene unchanged

## Known player-visible limitations

- Geometry remains deterministic reusable composition (not freeform Gemini-authored maps).
- Encounter/landmark inhabitants are tactical markers in this slice (not full combat spawn automation).
- Return walks the scene stack one hop at a time.
- Director narration expands from scene-contract beats; live Gemini density still depends on narration settings.

## Fixture

Any ordinary signed-in account; disposable blank campaigns. No admin seed. Do not disturb `Shadows over Emberferry` or the retained Batch 2 QA campaigns unless needed.
