#Requires -Version 5.1
<#
.SYNOPSIS
  Publish the Invite-Only Alpha player site from your Windows PC.

.DESCRIPTION
  Run from Builder with no arguments after you create deploy.secrets.ps1.
  Do not put keys in this file. Do not pass a service-account JSON.

  Follow Checkpoints/phase-7/DEPLOY_ON_WINDOWS.md.
#>
[CmdletBinding()]
param(
  [string] $ProjectId = 'hd-a3-staging',
  [string] $Region = 'us-central1',
  [string] $Service = 'hd-a3-staging',
  [string] $CandidateId = 'cand-fd5997306889',
  [string] $BlueprintVersion = 'ALPHA_3_V1',
  [string] $SeedVersion = 'phase7-gold-master-v1',
  [string] $OAuthClientId = '',
  [string] $WebApiKey = '',
  [string] $ClientOrigin = 'https://placeholder.invalid'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$builderRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dockerfile = Join-Path $builderRoot 'Dockerfile'
if (-not (Test-Path -LiteralPath $dockerfile)) {
  throw "Could not find Dockerfile at $dockerfile. In File Explorer, open the Builder folder, type powershell in the address bar, and run this script again."
}

Write-Host "Follow Checkpoints\phase-7\DEPLOY_ON_WINDOWS.md if you want click-by-click steps."

$secretsPath = Join-Path $PSScriptRoot 'deploy.secrets.ps1'
if (Test-Path -LiteralPath $secretsPath) {
  . $secretsPath
}
if (-not $OAuthClientId) {
  $fromFile = Get-Variable -Name HD_GOOGLE_OAUTH_CLIENT_ID -ErrorAction SilentlyContinue
  if ($fromFile -and $fromFile.Value) {
    $OAuthClientId = [string] $fromFile.Value
  }
}
if (-not $WebApiKey) {
  $fromFile = Get-Variable -Name HD_FIREBASE_WEB_API_KEY -ErrorAction SilentlyContinue
  if ($fromFile -and $fromFile.Value) {
    $WebApiKey = [string] $fromFile.Value
  }
}

if (-not $OAuthClientId) {
  $OAuthClientId = (Read-Host 'Paste your Google OAuth client ID (ends with .apps.googleusercontent.com)').Trim()
}
if (-not $WebApiKey) {
  $WebApiKey = (Read-Host 'Paste your Firebase Web API key (starts with AIza)').Trim()
}
if (-not $OAuthClientId -or $OAuthClientId -match 'paste-your-client-id') {
  throw "Missing OAuth client ID. Copy deploy.secrets.example.ps1 to deploy.secrets.ps1 and paste your real client ID."
}
if (-not $WebApiKey -or $WebApiKey -match 'paste-your-web-api-key') {
  throw "Missing Web API key. Copy deploy.secrets.example.ps1 to deploy.secrets.ps1 and paste your real API key."
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  throw "gcloud is not installed in this PowerShell window. Install Google Cloud SDK, close PowerShell, open it again, and retry."
}

function Publish-MilestoneCloudRun {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Origin
  )

  $envVars = @(
    "HD_CANDIDATE_ID=$CandidateId",
    "HD_BLUEPRINT_VERSION=$BlueprintVersion",
    "HD_FIREBASE_PROJECT_ID=$ProjectId",
    "HD_CLIENT_ORIGIN=$Origin",
    "HD_SEED_VERSION=$SeedVersion",
    "HD_GOOGLE_OAUTH_CLIENT_ID=$OAuthClientId",
    "HD_FIREBASE_WEB_API_KEY=$WebApiKey"
  ) -join ','

  Write-Host ""
  Write-Host "Publishing the player site. First time can take about 10 minutes. Leave this window open."
  Set-Location -LiteralPath $builderRoot
  & gcloud run deploy $Service `
    --project $ProjectId `
    --source . `
    --region $Region `
    --allow-unauthenticated `
    --set-env-vars $envVars
  if ($LASTEXITCODE -ne 0) {
    throw "Publish failed. Scroll up for the gcloud error. Do not pass a JSON key file."
  }
}

Publish-MilestoneCloudRun -Origin $ClientOrigin

$serviceUrl = (& gcloud run services describe $Service --project $ProjectId --region $Region --format 'value(status.url)').Trim()
$hostName = ([uri] $serviceUrl).Host

Write-Host ""
Write-Host "============================================================"
Write-Host "The site is up. Google sign-in is not finished yet."
Write-Host "============================================================"
Write-Host ""
Write-Host "Copy this player URL:"
Write-Host "  $serviceUrl"
Write-Host ""
Write-Host "STEP A — Firebase allowed domains"
Write-Host "  Open: https://console.firebase.google.com/project/$ProjectId/authentication/settings"
Write-Host "  Find Authorized domains. Click Add domain."
Write-Host "  Paste this host (no https://):"
Write-Host "    $hostName"
Write-Host "  Save."
Write-Host ""
Write-Host "STEP B — Google sign-in origin"
Write-Host "  Open: https://console.cloud.google.com/apis/credentials?project=$ProjectId"
Write-Host "  Open your OAuth 2.0 Client ID (the Web client)."
Write-Host "  Under Authorized JavaScript origins, add this exact URL:"
Write-Host "    $serviceUrl"
Write-Host "  Save."
Write-Host ""
Write-Host "STEP C — Tester Google accounts"
Write-Host "  Open: https://console.cloud.google.com/apis/credentials/consent?project=$ProjectId"
Write-Host "  Add Test users: your Gmail, plus Codex and Antigravity Gmails."
Write-Host "  Save."
Write-Host ""

$finishOrigin = (Read-Host "Come back here. Paste the player URL ($serviceUrl), then press Enter. Or press Enter now to stop").Trim().TrimEnd('/')
if (-not $finishOrigin) {
  Write-Host ""
  Write-Host "Stopped before the Google sign-in update. Run this script again later and paste the player URL when asked."
  Write-Host "Player URL: $serviceUrl"
  return
}

Publish-MilestoneCloudRun -Origin $finishOrigin

Write-Host ""
Write-Host "============================================================"
Write-Host "Done. Open this URL in Chrome and sign in with Google yourself first:"
Write-Host "  $finishOrigin"
Write-Host "============================================================"
Write-Host ""
Write-Host "If the page loads but Google sign-in fails, Steps A/B/C are not saved yet."
Write-Host "If the page itself fails to load, scroll up for the gcloud error."
