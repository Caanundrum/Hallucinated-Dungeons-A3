# Invite-Only Alpha — Milestone player testing

This is **not** Launch Production. Codex and Antigravity receive a URL and Google
test accounts. They do not receive the repository.

## PowerShell from `Builder`

You already created the Firebase project (`hd-a3-staging`), Auth, the OAuth
client, and the Web API key. You do not need Secret Manager or a JSON key in
the deploy command.

`firebase deploy` by itself cannot run this app. The game is a Node server
(`Builder/src/server`). Firebase CLI still does the Firebase-native pieces:

| Command | What it does |
| --- | --- |
| `npx firebase login` | Sign in to Firebase in this PowerShell |
| `npx firebase apps:sdkconfig WEB --project hd-a3-staging` | Print the Web API key / app ids |
| `npx firebase deploy --only firestore:rules --project hd-a3-staging` | Publish the deny-client Firestore rules |
| `.\tools\milestone\deploy.ps1 ... -LinkHosting` | Put `https://hd-a3-staging.web.app` in front of Cloud Run |

Cloud Run is the process that actually serves `/api` and the client. Use the
script (or the equivalent `gcloud run deploy --source .`).

In PowerShell, `ls Dockerfile package.json src` fails because `ls` is
`Get-ChildItem` and takes one path. Use `dir` or `Get-ChildItem`.

### 1. Deploy the server (no JSON)

```powershell
cd C:\chaosstandard\HD-A3\Hallucinated-Dungeons-A3\Builder

.\tools\milestone\deploy.ps1 `
  -OAuthClientId 'YOUR_CLIENT_ID.apps.googleusercontent.com' `
  -WebApiKey 'YOUR_WEB_API_KEY'
```

That runs `gcloud run deploy` from `Builder` (where `Dockerfile` lives) and
uses the Cloud Run default service account. Do not pass
`FIREBASE_SERVICE_ACCOUNT`.

### 2. Point Google Auth at the URL

Copy the Cloud Run URL the script prints.

1. Firebase Console → Authentication → Settings → **Authorized domains** →
   add the hostname only (`….run.app`).
2. Google Cloud Console → APIs & Services → Credentials → your OAuth **Web**
   client → **Authorized JavaScript origins** → add the full `https://…` origin.
3. OAuth consent screen → **Test users** → the Codex / Antigravity Gmail
   addresses.

Re-run the script with the real origin:

```powershell
.\tools\milestone\deploy.ps1 `
  -OAuthClientId 'YOUR_CLIENT_ID.apps.googleusercontent.com' `
  -WebApiKey 'YOUR_WEB_API_KEY' `
  -ClientOrigin 'https://YOUR-SERVICE.run.app'
```

### 3. Optional: Firebase Hosting URL

If you want `https://hd-a3-staging.web.app` instead of the `run.app` URL,
open Firebase Console → Hosting → Get started once, then:

```powershell
npx firebase login
.\tools\milestone\deploy.ps1 `
  -OAuthClientId 'YOUR_CLIENT_ID.apps.googleusercontent.com' `
  -WebApiKey 'YOUR_WEB_API_KEY' `
  -ClientOrigin 'https://hd-a3-staging.web.app' `
  -LinkHosting
```

Add `hd-a3-staging.web.app` and `hd-a3-staging.firebaseapp.com` to Authorized
domains and the OAuth JavaScript origins as well.

### 4. Firestore rules (Firebase CLI)

```powershell
npx firebase deploy --only firestore:rules --project hd-a3-staging
```

Those rules deny browser clients. The Node server writes with Admin credentials.

If Firestore/Auth calls fail after deploy, grant the Cloud Run **default compute
service account** the **Firebase Admin** role in IAM (same project). You still
do not need a downloaded JSON key.

## What players get

1. The HTTPS origin (Cloud Run or `https://hd-a3-staging.web.app`).
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
