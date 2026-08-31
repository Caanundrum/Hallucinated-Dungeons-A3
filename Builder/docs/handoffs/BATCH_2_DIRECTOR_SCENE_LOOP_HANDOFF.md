# Cursor DEV Handoff — Batch 2 Minimum Director Scene Loop

**Branch:** `cursor/batch2-director-scene-loop-96d1`  
**Governing requirement:** `DIRECTOR_SCENE_SYSTEM_REQUIREMENT.md`  
**Status:** Ready for independent right-brain player review — **not** visually/experientially approved by Cursor.

## Candidate

- Hosted player: `https://hd-a3-player--hd-a3-staging.us-central1.hosted.app`
- Local Arena: `http://127.0.0.1:5173`

## Ordinary player start

1. Sign in.
2. Create a character (quick start is fine).
3. **New table** — fill title; optionally set **Adventure premise** (e.g. misty marsh inn, sealed stone crypt).
4. Choose Director → create → seat → **Open table**.
5. In the play column, confirm **Begin the adventure**.

## Safe journey

1. Interior opens (not Quiet chamber) with light, cover, POI, exit.
2. Declare `extinguish the lamp` → Confirm → lamp shows unlit.
3. Declare leave toward marsh/forest/village → Confirm → exterior/travel scene.
4. Declare travel onward into danger → Confirm → encounter scene.
5. Declare `return to the earlier scene` (twice if needed) → Confirm → interior restored with lamp still unlit.
6. Reload — consequence remains.

## Confirmations that change state

- **Begin the adventure**
- Object interact drafts (`table.interact_object`)
- Travel / return drafts (`table.travel_scene`)
- Cancel leaves the scene unchanged

## Reusability

Create a second table with a different premise (e.g. sealed stone crypt) and Begin again — opening scene should differ while using the same loop.

## Limitations

- Scene geometry is deterministic reusable templates, not freeform Gemini maps.
- Encounter creatures are scene markers in this slice (not full combat spawn automation).
- Return walks the scene stack one hop at a time.
- Legacy Quiet chamber tables may still appear until a new adventure is begun.

## Fixture

Any ordinary signed-in account; disposable blank campaigns. No admin seed.
