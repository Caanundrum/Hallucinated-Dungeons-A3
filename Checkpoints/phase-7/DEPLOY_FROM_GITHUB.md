# Connect Firebase to GitHub (automatic player publishes)

This is the Firebase product that watches GitHub: **App Hosting**, not
Firebase Hosting. Hosting is static files. App Hosting builds the Node
server and puts it on a `*.hosted.app` URL whenever `main` changes.

Do this in the Firebase website. Do not give Codex or Antigravity GitHub
access. Only your GitHub account.

The current player URL
`https://hd-a3-staging-in4per6l4a-uc.a.run.app` stays up until you point
testers at the new App Hosting URL.

## Step 1. Open App Hosting

1. Open https://console.firebase.google.com/project/hd-a3-staging/apphosting
2. Top bar must say **hd-a3-staging**.
3. If Firebase asks to upgrade to **Blaze**, accept it. App Hosting needs
   Blaze. You already used Cloud Run, so this project is likely already Blaze.

## Step 2. Create the backend and connect GitHub

1. Click **Get started** or **Create backend**.
2. Region: **us-central1**.
3. Connect GitHub with the account that owns
   `Caanundrum/Hallucinated-Dungeons-A3`.
4. Install the Firebase GitHub app if asked. Grant it that repository.
5. Repository: `Caanundrum/Hallucinated-Dungeons-A3`.
6. App root directory: `Builder`
7. Live branch: `main`
8. Automatic rollouts: **On**
9. Backend name: `hd-a3-player`
10. Runtime: **Node.js 22** (not 20, not 18).
11. Create a web app if asked, or reuse the existing Web app.
12. Finish. The first build may take several minutes.

If GitHub does not list the repo, click the link to manage repository access
and enable `Hallucinated-Dungeons-A3`.

## Step 3. Add the two Google Sign-In values

Do not put these in GitHub. Add them in Firebase:

1. App Hosting → **hd-a3-player** → **Settings** → **Environment**
2. Add:

   - `HD_GOOGLE_OAUTH_CLIENT_ID` = your Web client ID
     (ends with `.apps.googleusercontent.com`)
   - `HD_FIREBASE_WEB_API_KEY` = your Web API key (starts with `AIza`)

3. Save. Trigger a new rollout if Firebase does not start one itself
   (**Rollout** / **Create rollout**).

## Step 4. Point Google Auth at the new URL

When the rollout succeeds, Firebase shows a URL like:

`https://hd-a3-player--hd-a3-staging.us-central1.hosted.app`

Copy that exact URL.

1. Firebase Auth → Settings → Authorized domains → add the host only
   (`hd-a3-player--hd-a3-staging.us-central1.hosted.app`).
2. Google Cloud → Credentials → your OAuth Web client → Authorized
   JavaScript origins → add the full `https://…hosted.app` URL.
3. Optional, in App Hosting Environment, set `HD_CLIENT_ORIGIN` to that
   same `https://…` URL. If you skip this, the server still accepts the
   live host.

Hard-refresh the new URL. Sign in with Google yourself first.

## After that

A merge to `main` starts a new App Hosting rollout. You do not use
PowerShell for ordinary publishes.

Keep testers on the current `.run.app` URL until the `.hosted.app` URL
signs in cleanly.

## If you see "failed to start and listen on PORT=8080"

That screenshot means App Hosting built the **old `main` commit** (`#26`,
PowerShell deploy). That commit has no `apphosting.yaml` and no `npm start`,
so the container never opens port 8080.

Do not click **Create rollout** again until the live branch has the App
Hosting files.

1. App Hosting → **hd-a3-player** → **Settings** (gear) → deployment /
   GitHub.
2. Set **Live branch** to `cursor/milestone-windows-deploy-sheet-96d1`
   (or merge that work into `main` first, then keep live branch `main`).
3. Settings → **Environment**: add `HD_GOOGLE_OAUTH_CLIENT_ID` and
   `HD_FIREBASE_WEB_API_KEY` if they are not already there.
4. Go back to the backend page and click **Create rollout**.
5. Wait. Success shows a green rollout and the
   `*.hosted.app` link works.

Keep testers on
`https://hd-a3-staging-in4per6l4a-uc.a.run.app` until the hosted.app URL
loads the real shell.

## If the first GitHub build fails for another reason

Open App Hosting → the failed rollout → logs.

Common causes:

- App root was left as `/` instead of `Builder`
- Runtime is not Node 22
- The two Google Sign-In variables are missing
- The Firebase GitHub app cannot read the repo
