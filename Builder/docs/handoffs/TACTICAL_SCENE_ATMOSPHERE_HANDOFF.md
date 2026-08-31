# Cursor DEV Handoff — Tactical Scene Presence and Atmosphere

**Branch:** `cursor/tactical-scene-atmosphere-96d1`  
**Status:** Ready for independent right-brain player review — **not** visually approved by Cursor.

## Candidate

- Hosted player (Firebase App Hosting / staging): `https://hd-a3-player--hd-a3-staging.us-central1.hosted.app`
- Local Arena: `http://127.0.0.1:5173`

## How to reach the updated tactical scene

1. Sign in (Local Arena / hosted account gate).
2. Create or open a blank campaign table (no seeded Emberferry chapters).
3. Open the campaign table — first scene is **Quiet chamber**.
4. Inspect the map stage (desktop three-pane, or Map task mode on ≤900px).

## Visual states ready to inspect

- Explored warm stone floor vs cooler damp / blocked rubble texture overlays
- Deeper fog hatch beyond explored space
- Wall sconce warm glow (torch POI)
- Rubble pile chips + damp stones wash
- Wooden doorway threshold emphasis (`map-edge-door`)
- Party token idle halo, hover, keyboard focus, movement glide
- Selected destination square highlight
- Fit / Center / zoom controls; POI and door focus rings
- Cavern void behind the map (no dotted UI chrome)
- 1440×900 / 768×900 / 375×812 layout preservation
- `hd-low-effects` / reduced motion: static atmosphere without glow animation

## Remaining visual limitations

- Atmosphere is restrained SVG texture/light — not painted battlemap art.
- Difficult terrain on Quiet chamber may be sparse (perimeter blocked + markers carry damp/rubble story).
- Pixi WebGL layer remains a low-opacity fallback mirror; SVG is the primary presentation.

## Safe fixture requirement

- Any **blank table** that boots Quiet chamber (default first scene). No special seed pack required.
- Optional: toggle low-effects in table accessibility controls to verify static atmosphere.
