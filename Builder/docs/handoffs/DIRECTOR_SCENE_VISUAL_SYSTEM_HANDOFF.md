# Cursor DEV Handoff — Director Scene Visual System

**Branch:** `cursor/director-scene-visual-system-96d1`  
**Status:** Ready for independent right-brain player review — **not** visually approved by Cursor.

## Candidate

- Hosted player: `https://hd-a3-player--hd-a3-staging.us-central1.hosted.app` (updates when deployed/merged)

## Ordinary player path (four visually distinct Director scenes)

1. Sign in → character → New table with premise `Rain-soaked inn beside a misty marsh` → Director → seat → Open table.
2. **Begin the adventure** → Confirm → interior (`enclosed_warm`, timber, torchlit).
3. `extinguish the lamp` → Confirm → light marker unlit; scene wash darkens.
4. `smash the overturned bench` → Confirm → cover marker broken variant.
5. `leave toward the misty marsh` → Confirm → marsh (`wet_fog`, damp terrain bias).
6. `travel onward into danger` → Confirm → encounter (`threat_encounter`, inhabitant family distinct from scenery).
7. Return as needed, then `climb to the ruined watchtower on the ridge` → Confirm → elevated (`elevated_exposed`, raised elevation cue, exit families).

Optional: resize to phone width and confirm labels/atmosphere remain readable. Toggle reduced motion — transition animation should not run.

## What changes between scenes

- Atmosphere wash family (warm enclosed / wet fog / **wooded canopy** / elevated / threat frame).
- Terrain fill bias (**timber** interiors vs **canopy** wooded paths vs damp vs stone) and texture overlays.
- Light wash (torchlit vs darkened when lights are extinguished).
- Threat inset frame on encounter purpose.
- Elevation frame on elevated environments.
- Brief discover transition on Director scene change (Map help → Preview discovery cue; respects reduced motion).

## Reusable families demonstrated

- Terrain: floor / difficult / blocked with damp|timber|**canopy**|stone|open bias.
- Objects: light (lit/unlit), cover (intact/broken), hazard, exit passage/vertical, creature/npc, party token.
- Atmosphere / light wash / threat frame from contract fields only — not fixture titles.

## Limitations

- Procedural SVG/CSS families, not painted battlemaps or portraits.
- Emberferry starter-pack provenance still uses its own tint path when that art provenance is active.
- Transition is a short brightness/opacity cue, not a cinematic wipe.

## Fixture

Ordinary signed-in account; disposable blank campaign. Leave retained QA tables and Shadows over Emberferry alone unless needed.
