# Invite-Only Alpha — Milestone player testing

This is **not** Launch Production. Codex and Antigravity receive a URL and Google
test accounts. They do not receive the repository.

## What players get

1. HTTPS origin of the Cloud Run / Firebase Hosting service.
2. A Google account you created for that tester.
3. The player brief in `PLAYER_TEST_BRIEF.md` (paste into the agent).
4. Optional campaign invite link after you (or the first tester) create a table.

They sign in with **Google Sign-In** on `/account`. There is no development
identity, QA fixture mint, QA harness, or emulator login on this surface.

## Firebase project (you create this once)

Create a **separate** Firebase project from Launch Production, for example
`hd-alpha3-milestone`.

In that project:

1. Enable **Google** as an Authentication sign-in provider.
2. Add the Cloud Run / Hosting origin to **Authorized domains**.
3. Create a Web app and copy the Web API key.
4. Create an OAuth 2.0 Web client (Google Cloud Console → APIs & Services →
   Credentials) whose authorized JavaScript origins include the player URL.
5. Cloud Run in the **same Google Cloud project** uses the default runtime
   service account (no JSON key file in the deploy command). Grant that
   account **Firebase Admin** in IAM if Firestore/Auth calls fail after deploy.
6. Create two or three Google accounts for Codex / Antigravity testers.

## Cloud Run environment

| Variable | Value |
| --- | --- |
| `HD_CANDIDATE_ID` | frozen candidate id being published |
| `HD_BLUEPRINT_VERSION` | `ALPHA_3_V1` |
| `HD_FIREBASE_PROJECT_ID` | milestone project id |
| `HD_CLIENT_ORIGIN` | `https://<player-host>` |
| `HD_SEED_VERSION` | seed label |
| `HD_GOOGLE_OAUTH_CLIENT_ID` | Web client id (`…apps.googleusercontent.com`) |
| `HD_FIREBASE_WEB_API_KEY` | Firebase Web API key |

Do **not** pass a service-account JSON through `--set-env-vars`. Cloud Run
authenticates to Firestore/Auth with the project's default service account.

`HD_ENVIRONMENT_CLASS` is forced to `milestone` and `HD_PUBLIC_SURFACE` to
`gold_master` by the container entrypoint. Launch Production (`launch`) remains
refused.

## Deploy (PowerShell, from `Builder`)

`firebase deploy` cannot host this app (it is a Node server, not static
Hosting or Cloud Functions). Use Cloud Run in the same Firebase/Google project:

```powershell
gcloud run deploy hd-a3-staging `
  --source . `
  --region us-central1 `
  --allow-unauthenticated `
  --set-env-vars "HD_CANDIDATE_ID=cand-fd5997306889,HD_BLUEPRINT_VERSION=ALPHA_3_V1,HD_FIREBASE_PROJECT_ID=hd-a3-staging,HD_CLIENT_ORIGIN=https://placeholder.invalid,HD_SEED_VERSION=phase7-gold-master-v1,HD_GOOGLE_OAUTH_CLIENT_ID=YOUR_CLIENT_ID,HD_FIREBASE_WEB_API_KEY=YOUR_API_KEY"
```

Copy the Service URL, add it to Firebase authorized domains and the OAuth
JavaScript origin, then redeploy with `HD_CLIENT_ORIGIN` set to that URL.

## Honest bounds

- The Game Director on this candidate is still the deterministic simulator.
- Claim Active Turn remains a construction control until a later candidate.
- Safari / tablet / VoiceOver are not certified on this host.
- Launch Production is not authorized by Phase 7 certification.
