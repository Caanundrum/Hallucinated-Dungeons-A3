#Requires -Version 5.1
<#
.SYNOPSIS
  Publish Invite-Only Alpha from Builder using Cloud Run in the Firebase project.

.DESCRIPTION
  The game is a Node HTTP server. `firebase deploy` cannot run /api. This script
  is the PowerShell replace for pasting a long gcloud command. It does not pass
  a service-account JSON file. Cloud Run uses the project's default credentials.

  Firebase CLI is still useful for login, Firestore rules, and an optional
  Hosting URL in front of Cloud Run. See MILESTONE_PLAYER_TESTING.md.

.EXAMPLE
  cd Builder
  .\tools\milestone\deploy.ps1 `
    -OAuthClientId '123-abc.apps.googleusercontent.com' `
    -WebApiKey 'AIza...'
#>
[CmdletBinding()]
param(
  [string] $ProjectId = 'hd-a3-staging',
  [string] $Region = 'us-central1',
  [string] $Service = 'hd-a3-staging',
  [string] $CandidateId = 'cand-fd5997306889',
  [string] $BlueprintVersion = 'ALPHA_3_V1',
  [string] $SeedVersion = 'phase7-gold-master-v1',
  [Parameter(Mandatory = $true)]
  [string] $OAuthClientId,
  [Parameter(Mandatory = $true)]
  [string] $WebApiKey,
  [string] $ClientOrigin = 'https://placeholder.invalid',
  [switch] $LinkHosting
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$builderRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dockerfile = Join-Path $builderRoot 'Dockerfile'
if (-not (Test-Path -LiteralPath $dockerfile)) {
  throw "Expected Dockerfile at $dockerfile. Run this script from the cloned repo."
}

foreach ($name in @('gcloud')) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name is not on PATH. Install Google Cloud SDK, then reopen PowerShell."
  }
}

$envVars = @(
  "HD_CANDIDATE_ID=$CandidateId",
  "HD_BLUEPRINT_VERSION=$BlueprintVersion",
  "HD_FIREBASE_PROJECT_ID=$ProjectId",
  "HD_CLIENT_ORIGIN=$ClientOrigin",
  "HD_SEED_VERSION=$SeedVersion",
  "HD_GOOGLE_OAUTH_CLIENT_ID=$OAuthClientId",
  "HD_FIREBASE_WEB_API_KEY=$WebApiKey"
) -join ','

Write-Host "Deploying $Service from $builderRoot (no JSON key file)..."
Set-Location -LiteralPath $builderRoot

& gcloud run deploy $Service `
  --project $ProjectId `
  --source . `
  --region $Region `
  --allow-unauthenticated `
  --set-env-vars $envVars
if ($LASTEXITCODE -ne 0) {
  throw "gcloud run deploy failed with exit code $LASTEXITCODE."
}

$serviceUrl = (& gcloud run services describe $Service --project $ProjectId --region $Region --format 'value(status.url)').Trim()
Write-Host ""
Write-Host "Cloud Run URL: $serviceUrl"
Write-Host "If HD_CLIENT_ORIGIN is still a placeholder, add this hostname to Firebase Auth"
Write-Host "Authorized domains and the OAuth JavaScript origins, then re-run with:"
Write-Host "  -ClientOrigin '$serviceUrl'"

if ($LinkHosting) {
  $hostingConfig = Join-Path $PSScriptRoot 'firebase.hosting.json'
  $firebaseArgs = @(
    'deploy',
    '--only', 'hosting',
    '--project', $ProjectId,
    '--config', $hostingConfig
  )
  Write-Host ""
  Write-Host "Linking Firebase Hosting rewrite to $Service..."
  if (Get-Command firebase -ErrorAction SilentlyContinue) {
    & firebase @firebaseArgs
  } elseif (Get-Command npx -ErrorAction SilentlyContinue) {
    & npx firebase @firebaseArgs
  } else {
    throw "firebase CLI not found. Install it (`npm i -g firebase-tools`) or omit -LinkHosting."
  }
  if ($LASTEXITCODE -ne 0) {
    throw "firebase hosting deploy failed with exit code $LASTEXITCODE."
  }
  Write-Host "Player URL is https://$ProjectId.web.app after Hosting deploy."
  Write-Host "Set -ClientOrigin to that URL on the next Cloud Run deploy."
}

Write-Host ""
Write-Host "Useful Firebase CLI commands from Builder:"
Write-Host "  npx firebase login"
Write-Host "  npx firebase apps:sdkconfig WEB --project $ProjectId"
Write-Host "  npx firebase deploy --only firestore:rules --project $ProjectId"
Write-Host "  .\tools\milestone\deploy.ps1 ... -LinkHosting"
