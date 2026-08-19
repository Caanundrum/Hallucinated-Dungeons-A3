# Invite-Only Alpha — Milestone player testing

This is **not** Launch Production. Codex and Antigravity receive a URL and Google
test accounts. They do not receive the repository.

**If you are publishing from a Windows PC, stop here and open**
`DEPLOY_ON_WINDOWS.md` **in this same folder.** That sheet is the click-by-click
version. Your client ID and API key stay in a local `deploy.secrets.ps1` file
that Git ignores.

## What players get

1. The HTTPS player URL the Windows sheet prints (ends in `.run.app`).
2. A Google account you created for that tester.
3. The player brief in `PLAYER_TEST_BRIEF.md`.
4. Optional campaign invite link after you create a table.

They sign in with **Google Sign-In** on `/account`. There is no development
identity, QA fixture mint, QA harness, or emulator login on this surface.

`HD_ENVIRONMENT_CLASS` is forced to `milestone` and `HD_PUBLIC_SURFACE` to
`gold_master` by the container entrypoint. Launch Production (`launch`) remains
refused.

## Honest bounds

- The Game Director on this candidate is still the deterministic simulator.
- Claim Active Turn remains a construction control until a later candidate.
- Safari / tablet / VoiceOver are not certified on this host.
- Launch Production is not authorized by Phase 7 certification.
