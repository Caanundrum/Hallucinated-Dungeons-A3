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

## Step 5. Deploy Firestore indexes (one time)

The Character Vault and other server queries need composite indexes on live
Firestore. Local certification uses the emulator, which auto-creates them;
hosted staging does not.

From the `Builder` folder on a machine with Firebase CLI logged into
`hd-a3-staging`:

```
firebase deploy --only firestore:indexes --project hd-a3-staging
```

Wait until Firebase Console → Firestore → Indexes shows the new indexes as
**Enabled** (can take several minutes). Until then, Character Vault may show
a storage error after sign-in even though Google login succeeded.

If the page is a black screen with only **Skip to main content**, the HTML
loaded and the CSS/JS did not. That happens when the browser sends
`Origin: https://…hosted.app` and the server still thinks the only allowed
origin is the Cloud Run `Host`. Merge the origin-guard fix to `main` and wait
for the next green App Hosting rollout, then hard-refresh. Do not switch the
live branch.

## After that

A merge to `main` starts a new App Hosting rollout. You do not use
PowerShell for ordinary publishes.

Keep testers on the current `.run.app` URL until the `.hosted.app` URL
signs in cleanly.

## If you see "failed to start and listen on PORT=8080"

That was the old `main` commit (`#26`). Current `main` includes App Hosting
start (`npm start`, `apphosting.yaml`, and Cloud Run `PORT`).

1. App Hosting → **hd-a3-player** → Settings → **Environment**: add
   `HD_GOOGLE_OAUTH_CLIENT_ID` and `HD_FIREBASE_WEB_API_KEY` if missing.
2. Click **Create rollout** (or wait; a push to `main` starts one).
3. Wait for a green rollout. Keep testers on
   `https://hd-a3-staging-in4per6l4a-uc.a.run.app` until `*.hosted.app`
   shows the real shell.

## If the first GitHub build fails for another reason

Open App Hosting → the failed rollout → logs.

Common causes:

- App root was left as `/` instead of `Builder`
- Runtime is not Node 22
- The two Google Sign-In variables are missing
- The Firebase GitHub app cannot read the repo

## Step 6. Google Sign-In policy checklist (required)

Google can restrict or disable OAuth clients that break branding or consent
rules. Before inviting testers, confirm all of the following in Google Cloud
Console and Firebase:

1. **OAuth consent screen**
   - App name matches the player-facing product name (Hallucinated Dungeons).
   - User support email and developer contact are current.
   - Privacy policy URL points to your hosted
     `https://…hosted.app/legal/privacy` (must be publicly reachable).
   - Scopes are limited to sign-in only (openid, email, profile). Do not add
     extra scopes unless the product truly needs them.

2. **Credentials → OAuth Web client**
   - Authorized JavaScript origins include the full `https://…hosted.app` URL.
   - Authorized redirect URIs include
     `https://…hosted.app/auth/google-login` (exact path, HTTPS).
   - If the welcome page shows a **giant Google “G”** instead of a white
     “Continue with Google” button, open DevTools → Console. A
     `[GSI_LOGGER]: The given origin is not allowed for the given client ID`
     message means this origin is missing from **Authorized JavaScript origins**.
     Add the exact `https://…hosted.app` URL (no trailing slash) and wait a few
     minutes for Google to propagate the change.

3. **Firebase Auth → Settings → Authorized domains**
   - The `*.hosted.app` host is listed (host only, no path).

4. **Player UI uses the official button**
   - The welcome screen renders Google Identity Services `renderButton` visibly.
   - Players click that button directly. Do not hide it behind a custom CTA or
     programmatically trigger `.click()` on it — Google prohibits that pattern.

5. **Disclosure near sign-in**
   - The welcome screen links to `/legal/privacy` beside the Google button so
     players know their Google account is shared with the app.

6. **Brand assets**
   - Do not alter the Google “G” logo colors or use it alone without the
     approved “Continue with Google” / “Sign in with Google” treatment.
   - Use GIS button theming (`theme`, `size`, `text`, `shape`) rather than a
     fully custom button.

Reference: [Sign in with Google branding guidelines](https://developers.google.com/identity/branding-guidelines)
and [Google Identity Services web guide](https://developers.google.com/identity/gsi/web/guides/overview).

## Step 7. OAuth brand verification (when Google rejects hosted.app)

Google Auth Platform **Branding** verification requires a homepage and privacy
policy on a **domain you can verify in Google Search Console**. The default App
Hosting URL (`*.hosted.app`) is Firebase's domain — you cannot register it as
yours, so verification fails with:

- "The website of your home page URL is not registered to you"
- "Your home page does not explain the purpose of your app"
- App name mismatch (e.g. `HD-A3-Staging` vs `Hallucinated Dungeons`)

### Fix A — Console-only (do this first)

1. Open **Google Auth Platform → Branding**:
   `https://console.cloud.google.com/auth/branding?project=hd-a3-staging`
2. Set **App name** to `Hallucinated Dungeons` (not the Firebase project id).
3. Set **User support email** to an address you monitor.
4. Under **App domain**, use the same host for all three links once you have a
   verified domain (see Fix B). Until then, keep hosted URLs for alpha testing
   but expect brand verification to stay blocked.

### Fix B — Custom domain (required to pass verification)

1. Firebase Console → **App Hosting** → **hd-a3-player** → **Domains** → add a
   custom domain you own (for example `play.yourdomain.com`).
2. Add the DNS records Firebase shows (TXT for ownership, then A/AAAA or CNAME).
3. **Google Search Console** → add a property for that domain → verify ownership
   using the same Google account that owns the Cloud project.
4. Back in **Google Auth Platform → Branding → Authorized domains**, add your
   top-level domain (e.g. `yourdomain.com`).
5. Update **App domain** URLs to the custom domain:
   - Home: `https://play.yourdomain.com/`
   - Privacy: `https://play.yourdomain.com/legal/privacy`
   - Terms: `https://play.yourdomain.com/legal/terms`
6. Update **OAuth Web client** (Credentials): JavaScript origins and redirect
   URI (`/auth/google-login`) to the custom domain.
7. Firebase **Authentication → Settings → Authorized domains**: add the custom
   host.
8. App Hosting **Environment**: set `HD_CLIENT_ORIGIN` to the custom `https://…`
   URL if used.
9. Click **Verify branding** / **Publish branding**, then resubmit.

The welcome page includes an **About Hallucinated Dungeons** section so the
homepage explains the app's purpose (Google requires more than a sign-in gate).

### Fix C — Alpha without full verification

If the app stays in **Testing** mode with **External** audience and only
**Test users** you list, basic sign-in scopes (`openid`, `email`, `profile`)
often work without passing brand verification. Verification is still required
before publishing to production or showing a custom app name/logo on the consent
screen.
