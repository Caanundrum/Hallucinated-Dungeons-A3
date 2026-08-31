# Cursor DEV Handoff — Tactical Viewport Fit & Terrain Identity

**Branch:** `cursor/tactical-viewport-fit-96d1`  
**Status:** Ready for independent right-brain player review — **not** visually approved by Cursor.

## Candidate

- Hosted player: `https://hd-a3-player--hd-a3-staging.us-central1.hosted.app` (updates when deployed/merged)
- Local Arena: Vite `5173` / API `5174`

## Authority rule (read first)

The **Director owns the next scene**. Players express travel/return intent or engage exits already presented on the map. They cannot invent destinations by naming them (“wolf thicket”, “crystal palace”, “watchtower”) unless that destination is already offered as a Director exit/destination hint.

Campaign **premise** (set at table creation) may bias the first exterior. Mid-play scene families come from premise + seed + presented exits — not freeform player scene-naming.

## What this correction changes

1. **Fit framing** — default Fit uses contain (whole Director scene) instead of cover-biased crop, so wide maps should not force horizontal scrolling at Fit.
2. **Action controls** — at ≤900px Play task, Roll/Attack/Pass and the dice FAB dock **under** the map chrome instead of floating over labels/tokens. Map task still hides them for a clean scan.
3. **Wooded terrain identity** — `forest_path` / `wooded_path` uses a **`canopy`** terrain bias (green fills + canopy leaf texture), distinct from warm-inn **`timber`** floorboards. Open bias gets scrub texture. Wash for wooded is mottled canopy, not a flat green tint.
4. **Discovery transition demo** — Map help → **Preview discovery cue**. Motion: brief brightness cue + `data-scene-cue="motion"`. Reduced motion / `hd-reduced-motion`: static outline + `data-scene-cue="static"` + “Scene discovered” badge (no animation).
5. **Director travel authority** — encounter families are seed-owned; composition hints resolve from presented exits or premise/seed; travel seed keys no longer hash player freeform text.

## Ordinary player path

1. Sign in → character → New table with premise `Rain-soaked inn beside a misty marsh` → Director → seat → Open table.
2. Begin the adventure → Confirm → interior (`enclosed_warm`, **timber**).
3. Optional: extinguish lamp / smash bench (interact **within** the scene).
4. `leave the room` → Confirm → Director exterior from premise (marsh / wet_fog / damp).
5. `travel onward` → Confirm → Director encounter (threat frame + inhabitant). Terrain bias follows atmosphere (canopy when wooded).
6. Return if needed, then engage a **presented** exit such as `take the trail toward higher ground` → Director landmark (not player-invented).

### Responsive checks

- **Desktop 1440×900:** Fit shows full scene; no unnecessary H-scrollbar on the map viewport.
- **Tablet 768×900 Play:** action cluster is below the map; labels on the stage remain visible.
- **Phone 375×812 Play:** same docking; Map task for full-height scenery scan; composer still reachable in Play.
- **Transition:** Map help → Preview discovery cue (with and without reduced motion).

## Limitations

- Procedural SVG/CSS families only — no portraits or painted battlemaps.
- Docking applies in the ≤900px task-mode shell; desktop wide layouts still use a bottom floating action cluster (off the primary label plane when Fit is used).
- Canopy identity is schematic vegetation texture + green bias, not photographic forest.
- Landmark variety is seed-rotated among Director families when taking the ridge-trail exit.

## Account hygiene

- Leave Shadows over Emberferry and retained QA tables untouched.
- Use a disposable private campaign for evidence.
