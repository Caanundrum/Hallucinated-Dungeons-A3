# Cursor DEV Handoff — Tactical Viewport Fit & Terrain Identity

**Branch:** `cursor/tactical-viewport-fit-96d1`  
**Status:** Ready for independent right-brain player review — **not** visually approved by Cursor.

## Candidate

- Hosted player: `https://hd-a3-player--hd-a3-staging.us-central1.hosted.app` (updates when deployed/merged)
- Local Arena: Vite `5173` / API `5174`

## What this correction changes

1. **Fit framing** — default Fit uses contain (whole Director scene) instead of cover-biased crop, so wide maps should not force horizontal scrolling at Fit.
2. **Action controls** — at ≤900px Play task, Roll/Attack/Pass and the dice FAB dock **under** the map chrome instead of floating over labels/tokens. Map task still hides them for a clean scan.
3. **Wooded terrain identity** — `forest_path` / `wooded_path` uses a **`canopy`** terrain bias (green fills + canopy leaf texture), distinct from warm-inn **`timber`** floorboards. Open bias gets scrub texture. Wash for wooded is mottled canopy, not a flat green tint.
4. **Discovery transition demo** — Map help → **Preview discovery cue**. Motion: brief brightness cue + `data-scene-cue="motion"`. Reduced motion / `hd-reduced-motion`: static outline + `data-scene-cue="static"` + “Scene discovered” badge (no animation).

## Ordinary player path

1. Sign in → character → New table with premise `Rain-soaked inn beside a misty marsh` → Director → seat → Open table.
2. Begin the adventure → Confirm → interior (`enclosed_warm`, **timber**).
3. Optional: extinguish lamp / smash bench as before.
4. `leave toward the misty marsh` → marsh (`wet_fog`, damp).
5. `travel onward into danger` → encounter (`wooded_path` / **canopy**, threat frame, hostile marker). Confirm thicket floor reads green/vegetated, not brown inn boards.
6. Climb watchtower as needed for vertical layout.

### Responsive checks

- **Desktop 1440×900:** Fit shows full scene; no unnecessary H-scrollbar on the map viewport.
- **Tablet 768×900 Play:** action cluster is below the map; labels on the stage remain visible.
- **Phone 375×812 Play:** same docking; Map task for full-height scenery scan; composer still reachable in Play.
- **Transition:** Map help → Preview discovery cue (with and without reduced motion).

## Limitations

- Procedural SVG/CSS families only — no portraits or painted battlemaps.
- Docking applies in the ≤900px task-mode shell; desktop wide layouts still use a bottom floating action cluster (off the primary label plane when Fit is used).
- Canopy identity is schematic vegetation texture + green bias, not photographic forest.

## Account hygiene

- Leave Shadows over Emberferry and retained QA tables untouched.
- Use a disposable private campaign for evidence.
