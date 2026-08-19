# Publish the player site from your Windows PC

This is the only instruction sheet you need. Do one numbered step at a time.
Do not skip ahead. Do not use Secret Manager. Do not use the JSON key file.

Your Google client ID and API key stay on this PC. They do not go to GitHub.

## Step 0. Get this instruction sheet on your PC

You need the copy of the repo that contains this file. In File Explorer, go to
`C:\chaosstandard\HD-A3\Hallucinated-Dungeons-A3` (the folder that contains
`Builder`, not the Builder folder itself). Click the address bar, type
`powershell`, press Enter.

If you already pasted keys into `deploy.ps1`, copy those two values into
Notepad first (see the section below). Then paste these three lines, pressing
Enter after each:

```
git fetch
git checkout cursor/milestone-cloud-run-adc-96d1
git pull
```

If Git complains about local changes, copy your keys to Notepad, then tell Git
to throw away the old script only:

```
git checkout -- Builder/tools/milestone/deploy.ps1
git checkout cursor/milestone-cloud-run-adc-96d1
git pull
```

You should now see this file at `Checkpoints\phase-7\DEPLOY_ON_WINDOWS.md`.

## What you should already have

- The repo on this PC at `C:\chaosstandard\HD-A3\Hallucinated-Dungeons-A3`
- Firebase project `hd-a3-staging`
- Google sign-in turned on in that project
- Your OAuth client ID (long, ends with `.apps.googleusercontent.com`)
- Your Web API key (starts with `AIza`)
- Google Cloud SDK (`gcloud`) already installed

## If you already pasted keys into `deploy.ps1`

That is fine. Leave that file alone for a moment.

1. Open Notepad.
2. Copy the client ID and the API key out of `deploy.ps1` into Notepad.
3. Save Notepad somewhere easy, like the Desktop, as `hd-keys.txt`.
4. Then continue from Step 1 below.

If a later repo update replaces `deploy.ps1`, your keys in Notepad are safe.
Do not copy `hd-keys.txt` into the repo. Do not commit it.

## Step 1. Put your two keys in a local file Git will ignore

1. Open File Explorer.
2. Go to:

   `C:\chaosstandard\HD-A3\Hallucinated-Dungeons-A3\Builder\tools\milestone`

3. Find `deploy.secrets.example.ps1`.
4. Right-click it → Copy.
5. Right-click empty space in that same folder → Paste.
6. Rename the new copy to exactly:

   `deploy.secrets.ps1`

7. Right-click `deploy.secrets.ps1` → Open with → Notepad.
8. Replace the two placeholder strings with the real values from Notepad.
   Keep the single quotes around each value.
9. File → Save. Close Notepad.

That file stays on your PC. Git is set to ignore it.

## Step 2. Open PowerShell in the Builder folder

1. In File Explorer, go to:

   `C:\chaosstandard\HD-A3\Hallucinated-Dungeons-A3\Builder`

2. Click the address bar once (the box that shows the folder path).
3. Type `powershell` and press Enter.

You should see a window whose last line looks like it ends with `\Builder>`.

If Windows says scripts are disabled, paste this, press Enter, then type `Y` and press Enter:

```
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Step 3. Make sure Google Cloud is signed in

Paste this line and press Enter:

```
gcloud auth login
```

A browser window opens. Sign in with the Google account that owns `hd-a3-staging`.
Come back to PowerShell when it says you are logged in.

Then paste this line and press Enter:

```
gcloud config set project hd-a3-staging
```

## Step 4. Publish the site

Paste this line and press Enter:

```
.\tools\milestone\deploy.ps1
```

Wait. The first publish often takes 5 to 10 minutes. Leave the window open.

When it works, the script prints a player URL that starts with `https://` and
ends with `.run.app`. It also prints STEP A, STEP B, and STEP C.

Leave PowerShell open. Do not close it.

## Step 5. Allow Google sign-in for that URL

The script printed a host name (no `https://`) and the full player URL.
Use those printed values, not these examples.

### STEP A — Firebase allowed domain

1. Open this page:

   https://console.firebase.google.com/project/hd-a3-staging/authentication/settings

2. Find **Authorized domains**.
3. Click **Add domain**.
4. Paste only the host name from the script (it looks like `something.run.app`).
   Do not paste `https://`.
5. Save.

### STEP B — Google sign-in origin

1. Open this page:

   https://console.cloud.google.com/apis/credentials?project=hd-a3-staging

2. Click your **OAuth 2.0 Client ID** (Web client).
3. Under **Authorized JavaScript origins**, click **Add URI**.
4. Paste the full player URL from the script (it starts with `https://`).
5. Save.

### STEP C — Who is allowed to sign in

Google moved this page. It is no longer under Credentials.

1. Open this page:

   https://console.cloud.google.com/auth/audience?project=hd-a3-staging

2. Look at the top bar. The project must say `hd-a3-staging`. If it shows a
   different project, click the project name and switch.
3. On the left, open **Google Auth platform**, then click **Audience**.
   Do not stay on Credentials. That page is STEP B only.
4. Look at **Publishing status**.

   **If it says Testing**

   1. Scroll to **Test users**.
   2. Click **Add users**.
   3. Paste your Gmail. Click Add.
   4. Repeat for the Codex Gmail and the Antigravity Gmail.
   5. Save.

   **If it says In production**

   There is no Test users list. Skip this step. Any Google account can be
   asked to sign in. You still send Codex and Antigravity their own Gmails.

   **If it says Get started / not configured**

   Click **Get started**, choose **External**, finish the short form, then
   come back to Audience and add Test users as above. Do not click Publish
   app unless you already know you want In production.

## Step 6. Finish in the same PowerShell window

Go back to the PowerShell window that is still waiting.

Paste the same full player URL (`https://…run.app`) and press Enter.

Wait for the second publish to finish. It is usually faster than the first.

## Step 7. You try it first

1. Open Chrome.
2. Paste the player URL.
3. Open **Account**.
4. Click **Sign in with Google**.
5. Use your Gmail from Step C.

If you get in, the site is ready for testers.

If Google sign-in fails, Steps A, B, or C are incomplete. Fix those, wait a
minute, and try again. You do not need to republish for A/B/C unless you
skipped Step 6.

## Step 8. Send testers a URL, not the repo

Send Codex and Antigravity only:

1. The player URL.
2. The Google account they should use.
3. The text in `Checkpoints/phase-7/PLAYER_TEST_BRIEF.md`, with `{{PLAYER_ORIGIN}}`
   replaced by the player URL.

Do not send GitHub access. Do not send this folder. Do not send your keys.

## If it fails

**`gcloud` is not recognized**
Close PowerShell. Install Google Cloud SDK. Open a new PowerShell from the
Builder folder and start again at Step 3.

**running scripts is disabled**
Use the `Set-ExecutionPolicy` line in Step 2, then run Step 4 again.

**It asks for a client ID or API key**
`deploy.secrets.ps1` is missing, in the wrong folder, or still has the
placeholder text. Fix Step 1, then run Step 4 again.

**failed to start and listen on PORT=8080**
Pull the latest repo, then from the `Builder` folder run `.\tools\milestone\deploy.ps1` again. The container now starts Node directly so a Windows line-ending in a shell script cannot block the port.

**The string is missing the terminator**
You still have the old `deploy.ps1`. From the folder that contains `Builder`, run:

```
git pull
```

If Git says your local `deploy.ps1` has changes, run this first (your keys stay in `deploy.secrets.ps1`):

```
git checkout -- Builder/tools/milestone/deploy.ps1
git pull
```

Then go back to the `Builder` folder and run `.\tools\milestone\deploy.ps1` again.

**JSON / comma / dict error**
You are not using this script, or an old command is still in the window.
Run only `.\tools\milestone\deploy.ps1`. Do not paste a JSON key.

**Site loads, Google sign-in does not**
Repeat Step 5. The Firebase domain has no `https://`. The Google origin does.

**Firestore / permission error after you sign in**
In Google Cloud IAM, grant the Cloud Run default compute service account the
**Firebase Admin** role on project `hd-a3-staging`. Still no JSON key file.

Skip Firebase Hosting for now. The `.run.app` URL is enough for testers.
