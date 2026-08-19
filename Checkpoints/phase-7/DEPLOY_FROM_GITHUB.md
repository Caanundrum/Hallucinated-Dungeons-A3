# Publish from the Google Cloud website (no PowerShell)

This game is a Node server. The Firebase website cannot run it by itself.
Firebase Hosting and `firebase deploy` do not start `/api`.

The matching click path is **Cloud Run** in the same Google project as
Firebase (`hd-a3-staging`). That is still "the Firebase project." It is not
a different Google account.

Do not connect Codex or Antigravity to GitHub. Only your account.

## Fix the blank "Skip to main" page right now (no Git)

The live site is using a placeholder origin. Change that on the existing
service:

1. Open:

   https://console.cloud.google.com/run/detail/us-central1/hd-a3-staging/yaml?project=hd-a3-staging

   If that looks wrong, open https://console.cloud.google.com/run?project=hd-a3-staging
   and click the service **hd-a3-staging**.

2. Confirm the top bar project is **hd-a3-staging**.
3. Click **Edit & deploy new revision**.
4. Open **Containers**, then **Variables & secrets** (wording may be
   **Environment variables**).
5. Find `HD_CLIENT_ORIGIN`.
6. Change its value to exactly:

   `https://hd-a3-staging-in4per6l4a-uc.a.run.app`

   No trailing slash.
7. Click **Deploy**.
8. Wait until the new revision is ready.
9. Hard-refresh the player URL.

You should see the Hallucinated Dungeons shell, not only Skip to main.

## Later: connect GitHub so pushes deploy themselves

This is the closest thing to "Firebase talks to Git." Cloud Run watches the
repo and rebuilds when you push.

1. Open the same Cloud Run service **hd-a3-staging**.
2. Click **Connect to repo**.
3. Choose **Cloud Build** and **GitHub**.
4. Authenticate with the GitHub account that owns
   `Caanundrum/Hallucinated-Dungeons-A3`.
5. Select that repository. If it is missing, click **Manage connected
   repositories** and grant the Cloud Build GitHub app access to it.
6. Build settings:

   - Branch: `^main$` (only after the Windows/origin fixes are on `main`)
   - Build type: **Dockerfile**
   - Source location / Dockerfile: `Builder/Dockerfile`
   - Build context directory: `Builder`
   - Entrypoint: leave blank
7. Save.

Keep the environment variables already on the service, including
`HD_CLIENT_ORIGIN` set to the `.run.app` URL, plus the OAuth client ID and
Web API key. Git deploys reuse those. Do not put keys in the repository.

After this, a merge to `main` rebuilds the player site. You do not run
PowerShell for ordinary publishes.

## What not to use

- Firebase Console → Hosting → GitHub: static files only. It will not run
  this Node `/api` server.
- Firebase App Hosting: built for Next.js / Angular style apps. This project
  is a custom Node server with a Dockerfile. Cloud Run is the correct
  GitHub connection.
