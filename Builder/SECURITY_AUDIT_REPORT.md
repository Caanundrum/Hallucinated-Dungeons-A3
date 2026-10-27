# Hallucinated Dungeons — Packet 6 Read-Only Application Security Audit (`SECURITY_AUDIT_REPORT.md`)

> [!IMPORTANT]
> **Audit Scope & Read-Only Compliance:** This audit was conducted strictly as a **read-only architectural and code review** in accordance with Guardrail 4 of the Unified Directive. Zero changes were made to authentication middleware, session cookies, or [`firestore.rules`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/firestore.rules) as part of this audit.

---

## Executive Summary

Hallucinated Dungeons implements a **server-authoritative security architecture** where the browser has **zero direct access to Firestore** ([`firestore.rules`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/firestore.rules#L1-L13) denies all client reads and writes) and every mutating or sensitive state transition passes through the Node HTTP server ([`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts)).

Following the implementation of **Packet 5** (delete-proof per-account image quotas in `accountImageUsage`, shared `assetBank`, `accountPortraitHistory`, and lazy Room 2/3 battlemap generation), the highest-cost Vertex AI / Imagen abuse vector (create-delete-recreate character/campaign loops) is now capped per `accountId` with a `$0.00` cached/archetype fallback.

Before transitioning from Invite-Only Alpha to **paid public subscriptions**, five targeted hardening actions are recommended to close multi-instance rate-limit bypasses, tighten Google OAuth CSRF verification when the cookie is absent, enforce campaign membership on `/api/assets/<assetId>`, harden `X-Forwarded-Host` origin derivation, and add `Strict-Transport-Security` (HSTS).

---

## Domain A: Authentication & Session Integrity

### A.1 Session Token Entropy, Hashing, & Storage
- **Implementation:** [`src/server/identity/development-identity.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/identity/development-identity.ts#L50-L61) and [`issueSession`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/identity/development-identity.ts#L89-L109).
- **Strengths (`PASS`):**
  - Session tokens are minted with 256 bits of cryptographic entropy (`randomBytes(32).toString('base64url')`, line 97).
  - Raw tokens are **never persisted** in Firestore; only the SHA-256 hex digest (`hashSessionToken`, lines 50–52) is stored as the document ID and `sessionTokenHash` field in `developmentSessions` (lines 98–107).
  - Session lookup (`resolveSession`, lines 345–401) compares digests using `timingSafeEqual` (`digestsMatch`, lines 54–61) and actively deletes expired session documents on read (lines 374–377).
  - Session TTL (`DEVELOPMENT_SESSION_TTL_MS`, line 27) is bounded to **4 hours** (`4 * 60 * 60 * 1000` ms).

### A.2 Session Cookie Attributes
- **Implementation:** [`sessionCookieFlags`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L619-L622) and [`writeSessionCookie`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L635-L643).
- **Finding (`LOW` — Documentation/Attribute Drift):**
  - Cookies are issued with `Path=/; HttpOnly; SameSite=Lax` and `; Secure` whenever `env.clientOrigin.startsWith('https:')`.
  - Line 569 of [`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L569) comments `"Combined with the SameSite=Strict session cookie"`, whereas line 621 sets `SameSite=Lax` so the cookie survives top-level POST redirects from Google Identity Services (`/auth/google-login`). Because all `/api/*` mutations also enforce both the `Origin` allowlist ([`isAllowedBrowserOrigin`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/origin-guard.ts#L109-L119)) and the custom `x-hd-candidate` header ([`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L885-L892)), cross-site `POST` requests cannot trigger state mutations even under `SameSite=Lax`.

### A.3 Hosted Google OAuth Token Verification & CSRF Double-Submit Check
- **Implementation:**
  - Redirect flow: [`/auth/google-login`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L773-L822)
  - JSON API flow: [`/api/identity/google-session`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L984-L1025)
  - Token verification: [`exchangeGoogleIdToken`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/identity/google-hosted.ts#L29-L70)
- **Strengths (`PASS`):**
  - The server never trusts a client-supplied email or UID on hosted environments; it exchanges the `googleIdToken` directly with Google Identity Toolkit (`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp`, lines 41–50 of `google-hosted.ts`).
- **Findings (`MEDIUM` — Login CSRF & Unthrottled Auth Endpoints):**
  1. **Partial Double-Submit CSRF Check on `/auth/google-login`:** In [`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L789-L796):
     ```ts
     const csrfCookie = parseCookies(request.headers.cookie).get('g_csrf_token') ?? '';
     const csrfBody = form.get('g_csrf_token')?.trim() ?? '';
     if (csrfBody === '' || (csrfCookie !== '' && csrfCookie !== csrfBody)) {
     ```
     If an attacker initiates a cross-site form POST to `/auth/google-login` when the victim has **no** `g_csrf_token` cookie (`csrfCookie === ''`) and supplies a non-empty `csrfBody` plus the attacker's own valid `credential` (Google ID token), the check passes (`csrfCookie !== ''` is false) — allowing **Login CSRF** (signing the victim's browser into the attacker's account). Requiring `csrfCookie === '' || csrfBody === '' || csrfCookie !== csrfBody` closes this completely.
  2. **`X-Forwarded-Host` Trust in `resolveApplicationOrigin`:** In [`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L624-L633), `requestUri` passed to Identity Toolkit is constructed from `x-forwarded-host` or `host` if present, rather than strictly pinning to `env.clientOrigin` / `allowedBrowserOrigins`.
  3. **No Rate Limit on `/auth/google-login` or `/api/identity/google-session`:** Neither endpoint calls `allowUnderRateLimit`, permitting high-frequency token exchange requests against Identity Toolkit.

### A.4 Isolation of Local-Only Development & QA Identity Routes
- **Implementation:** [`isLocalArenaPublicSurface`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/release/public-surface.ts) and [`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L932-L982), [`L1027-L1115`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L1027-L1115).
- **Strengths (`PASS`):**
  - `/api/identity/development-session`, `/api/identity/google-emulator-session`, `/api/identity/qa-fixture-session`, and `/api/qa/harness` are double-gated at both the HTTP router and service layer (`mintDevelopmentIdentity`, `mintGoogleEmulatorIdentity`, `mintQaFixtureSession`). On hosted `milestone` / `gold_master` deployments (`hd-a3-staging`), all four routes fail closed with `403 IDENTITY_ROUTE_UNAVAILABLE`.

---

## Domain B: Authorization & IDOR (Cross-Account Isolation)

### B.1 Character Vault & Draft Isolation
- **Implementation:** [`handleCharacterRequest`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L1520-L1926) and [`src/server/characters/characters.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/characters/characters.ts#L502-L545).
- **Strengths (`PASS`):**
  - Every character/draft route derives `accountId` exclusively from `resolveSession` (line 1531).
  - Drafts are keyed by deterministic account-bound IDs (`draft-${accountId}`) or verified against `draft.accountId === accountId`.
  - Character reads, tracker/loadout/identity `PATCH`, and `DELETE` verify `stored.accountId === accountId` and throw `CharacterNotFoundError` on mismatch, which returns an identical `404 NOT_FOUND` ([`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L1902-L1908)) to prevent cross-account character ID enumeration.

### B.2 Campaign, Table State, & Command Isolation
- **Implementation:** [`handleCampaignRequest`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L1934-L3212), [`src/server/campaigns/campaigns.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/campaigns/campaigns.ts), and [`src/server/table/commands.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/commands.ts).
- **Strengths (`PASS`):**
  - Campaign `DELETE`, `PATCH`, `/settings` `PUT`, and `/invitations` `POST`/`revoke` enforce `campaign.ownerAccountId === accountId`.
  - Table state reads (`/table-snapshot`, `/table-state`, `/rules-state`, `/map`, `/chronicle`, `/memory`, `/recap`, `/party-chat`) verify campaign membership (`memberAccountIds.includes(accountId)`) before returning any data, returning `404 NOT_FOUND` to non-members.
  - `/api/campaigns/<id>/commands` verifies that the caller holds an active seat in the campaign (`NOT_SEATED` if unseated) and holds active `timingAuthorityId` when required.
  - **Viewer-Scoped Fog of War:** [`fetchCampaignMap`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/map-projection.ts) projects the map through `applyViewerFog`, stripping hidden features (`hidden: true`) and masking unexplored rooms behind closed doors (`terrain: 'blocked', known: false`) before sending JSON to the browser.

### B.3 Director Mutation Endpoints (`/director/npc` & `/director/scene`)
- **Implementation:** [`/api/campaigns/<id>/director/npc`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L2331-L2399) and [`/api/campaigns/<id>/director/scene`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L2401-L2496), backed by [`applyDmNpcDirective`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/campaigns/campaign-memory.ts#L533-L618) and [`applyDmSceneDirective`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/campaigns/campaign-memory.ts#L620-L735).
- **Finding (`MEDIUM` — Any Campaign Member Can Invoke Director Scene/NPC Directives):**
  - `applyDmNpcDirective` and `applyDmSceneDirective` call `requireCampaignMember(firestore, campaignId, accountId)`, which verifies that the caller is a member of the campaign, **not** specifically the campaign owner (`ownerAccountId === accountId`). In a multiplayer party where a non-owner player joins via invite link or public lobby, that member could send crafted `POST /api/campaigns/<id>/director/scene` or `/director/npc` payloads to alter room bounds/markers or spawn NPCs.
  - **Recommendation:** Restrict direct HTTP calls to `/director/npc` and `/director/scene` (and `/chapters/close`) to `campaign.ownerAccountId === accountId` (or internal server-side Director execution).

### B.4 Admin Endpoint Protection
- **Implementation:** [`/api/admin` & `/api/admin/ai-kill-switch`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L1164-L1218), [`src/server/admin/admin-auth.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/admin/admin-auth.ts#L13-L16), and [`src/server/admin/admin-service.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/admin/admin-service.ts#L48-L52).
- **Strengths (`PASS`):**
  - Admin access is gated strictly by server-verified email matching `BOOTSTRAP_ADMIN_EMAIL` (`nick.donner@gmail.com`). Non-admin accounts receive `{ isAdmin: false, notice: 'Admin access denied.' }` on `GET /api/admin` and `403` on `POST /api/admin/ai-kill-switch`.

---

## Domain C: AI Cost, Quota, & Abuse Surface

### C.1 Delete-Proof Image Quotas & Lazy Room Generation (Implemented in Packet 5)
- **Implementation:**
  - [`checkAndRecordAccountImageQuota`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/assets/campaign-assets.ts#L98-L169)
  - [`generateCharacterPortrait`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/characters/characters.ts#L406-L499)
  - [`createCampaign`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/campaigns/campaigns.ts#L502-L545)
  - [`acceptTableCommand` (`table.travel_scene`)](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/table/commands.ts#L1408-L1445)
- **Strengths (`PASS`):**
  - Quota tracking lives in ` COLLECTIONS.accountImageUsage` (`account_image_usage`), keyed by `accountId` in a Firestore transaction. Deleting a character (`deleteCharacter`) or campaign (`deleteCampaign`) **never** decrements or deletes `account_image_usage`.
  - Enforces a hard rolling 24-hour cap of **3 live portrait batches** and **3 live battlemaps** per `accountId`, plus a **15-second minimum cooldown** between live image generations.
  - When a user exceeds their 24-hour cap or cooldown, the server **silently serves cached/reused assets** from `accountPortraitHistory`, `assetBank`, or the procedural SVG fallback at **`$0.00` live API cost**.
  - Campaign creation generates **only Room 1's battlemap** upfront (cutting initial battlemap cost by 66%), lazily generating Room 2 and Room 3 battlemaps only when the party actually transitions rooms via `table.travel_scene`.

### C.2 Process-Local Rate Limiting & Unthrottled Text-AI Endpoints
- **Implementation:** [`src/server/security/rate-limit.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/security/rate-limit.ts#L1-L102) and [`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L2037-L2132).
- **Findings (`HIGH` — Unthrottled Blueprint Drafting & Process-Local Rate-Limit Buckets):**
  1. **`POST /api/campaigns/draft-blueprint` and `POST /api/campaigns` Lack Rate Limiting:**
     - While `/director-address`, `/interpret-intent`, and `/narrate` call `allowUnderRateLimit` with `rateLimitKeyForAiGateway(accountId)` (12 requests / 10s window), `POST /api/campaigns/draft-blueprint` ([`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L2037-L2087)) and `POST /api/campaigns` ([`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L2089-L2132)) do **not** call `allowUnderRateLimit`.
     - Both endpoints accept up to **64 KiB** JSON bodies (`readBody(64 * 1024)`) and invoke `draftCampaignBlueprintOptionsWithAi` (Gemini 2.5 Flash) without an upper length check on `payload.premise` beyond the 64 KiB body cap.
  2. **In-Memory Rate Limiter Resets Across Cloud Run Instances:**
     - `buckets = new Map<string, number[]>()` in [`src/server/security/rate-limit.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/security/rate-limit.ts#L23) is process-local. When Cloud Run scales horizontally or recycles instances, rate-limit counters reset per container.
  3. **Global AI Kill Switch Coverage:**
     - [`getAiKillSwitch`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/admin/admin-service.ts#L86-L94) is checked inside `director-gateway.ts` (`/director-address`, `/interpret-intent`, `/narrate`), but is **not** checked before calling Gemini/Imagen in `draftCampaignBlueprintOptionsWithAi`, `generateCharacterPortrait`, `generateAndStoreCampaignAsset`, or `ensureObjectSpriteAsset`.

---

## Domain D: Firestore Rules & Public Asset Exposure

### D.1 Firestore Rules (`firestore.rules`)
- **Implementation:** [`firestore.rules`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/firestore.rules#L1-L13).
- **Strengths (`PASS`):**
  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /{document=**} {
        allow read, write: if false;
      }
    }
  }
  ```
  - **100% Locked Down:** No browser client using the Firebase Web SDK can read or write any document in any collection (`accountImageUsage`, `assetBank`, `accountPortraitHistory`, `developmentSessions`, `campaigns`, `characters`, etc.). All access is mediated exclusively by the Node server via the Firebase Admin SDK.

### D.2 Public Asset Endpoint (`/api/assets/<assetId>`)
- **Implementation:** [`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L1471-L1491).
- **Finding (`LOW` — Unauthenticated Asset Reads by `assetId`):**
  - `GET /api/assets/<assetId>` does not call `resolveSession` and sets `cache-control: public, max-age=86400`.
  - Campaign battlemaps and portraits use `randomUUID()` (122 bits of entropy) in their `assetId`, making them unguessable by brute force, while shared tokens/sprites use deterministic slugs (`token-monster-goblin`, `sprite-container_chest_closed`). However, requiring an authenticated session (`resolveSession`) before serving `/api/assets/<assetId>` will prevent unauthenticated scraping of shared assets.

---

## Domain E: HTTP Security Headers, CORS, CSRF, & Input Sanitization

### E.1 HTTP Security Headers (Node Server vs. Firebase Hosting)
- **Implementation:**
  - Node server: [`applySecurityHeadersFor`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L395-L407) and [`contentSecurityPolicy`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L225-L244).
  - Static hosting config: [`firebase.json`](file:///C:/ChaosStandard/Chaos-Standard-Home/firebase.json#L18-L41).
- **Strengths (`PASS`):**
  - The Node server sets a strict `Content-Security-Policy` (`default-src 'self'`, `base-uri 'none'`, `frame-ancestors 'none'`, `object-src 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`.
- **Finding (`LOW` — Missing `Strict-Transport-Security` Header):**
  - Neither `applySecurityHeadersFor` in `src/server/http/server.ts` nor `firebase.json` emits `Strict-Transport-Security: max-age=31536000; includeSubDomains` on HTTPS responses.

### E.2 Origin Validation, CORS, & Candidate Header CSRF Defense
- **Implementation:** [`src/server/http/origin-guard.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/origin-guard.ts#L36-L144) and [`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L885-L892).
- **Strengths (`PASS`):**
  - Every mutating `/api/*` request (`POST`, `PUT`, `PATCH`, `DELETE`) requires both:
    1. A valid `Origin` header matching `allowedBrowserOrigins` (`403 FORBIDDEN_ORIGIN` if missing or mismatched), and
    2. The custom `x-hd-candidate` header matching `env.candidateId` (`409 CANDIDATE_MISMATCH` if missing), which forces a CORS preflight on any cross-origin attempt.
- **Finding (`MEDIUM` — `forwardedHostHeader` Included in `allowedBrowserOrigins`):**
  - In [`src/server/http/origin-guard.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/origin-guard.ts#L82-L85), `servingOriginFromHost(options.forwardedHostHeader)` adds `https://<x-forwarded-host>` to the allowed Origin set when `hosted === true`. If a reverse proxy or direct Cloud Run invocation allows a caller to spoof `X-Forwarded-Host: evil.example` alongside `Origin: https://evil.example`, `allowedBrowserOrigins` would accept that origin. Relying strictly on `env.clientOrigin` and `appHostingPublicOrigin({ cloudRunService, firebaseProjectId })` (and only trusting `hostHeader` when it ends with `.run.app` or `.hosted.app`) eliminates header-spoofing risk.

### E.3 Static Bundle Path Traversal & Request Body Caps
- **Implementation:** [`serveBundleAssetFor`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L667-L696) and [`readJsonBody`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L518-L546).
- **Strengths (`PASS`):**
  - `serveBundleAssetFor` normalizes `requestedPath` and verifies `absolute.startsWith(resolve(bundleDir) + sep)` before touching `stat` or `createReadStream`, preventing directory traversal (`../`).
  - `readJsonBody` enforces an **8 KiB** default streaming cap (`MAX_REQUEST_BODY_BYTES = 8 * 1024`), immediately destroying the socket and returning `413 PAYLOAD_TOO_LARGE` if exceeded.

---

## Domain F: Ranked Top 5 Security Hardening Actions Before Charging Subscription Fees

| Rank | Severity | Target File(s) & Line(s) | Vulnerability / Risk | Concrete Remediation Before Paid Launch |
| :--- | :---: | :--- | :--- | :--- |
| **1** | **HIGH** | [`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L2037-L2132)<br>[`src/server/admin/admin-service.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/admin/admin-service.ts#L86-L94) | **Unthrottled Blueprint AI Drafting & Partial AI Kill Switch Coverage:** `POST /api/campaigns/draft-blueprint` and `POST /api/campaigns` accept 64 KiB payloads and trigger Gemini calls without rate limiting, `premise` length caps (e.g., 2,000 chars), or checking `getAiKillSwitch(firestore)`. | 1. Gate `/api/campaigns/draft-blueprint`, `/api/campaigns`, and `/api/characters/generate-portrait` with `allowUnderRateLimit` (`rateLimitKeyForAiGateway(accountId)`).<br>2. Cap `premise.length <= 2000` in `/api/campaigns/draft-blueprint`.<br>3. Check `await getAiKillSwitch(firestore)` at the top of `draftCampaignBlueprintOptionsWithAi`, `generateCharacterPortrait`, `generateAndStoreCampaignAsset`, and `ensureObjectSpriteAsset` so the admin kill switch halts **all** paid Vertex AI/Gemini/Imagen calls immediately. |
| **2** | **MEDIUM** | [`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L2331-L2496)<br>[`src/server/campaigns/campaign-memory.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/campaigns/campaign-memory.ts#L533-L735) | **Campaign Member Privilege Escalation on `/director/npc` & `/director/scene`:** Any joined campaign member (not only the campaign owner) can call `/api/campaigns/<id>/director/npc`, `/director/scene`, or `/chapters/close` to inject custom scenes, markers, or NPCs into a shared campaign. | Replace `requireCampaignMember` with an explicit `campaign.ownerAccountId === accountId` check in `applyDmNpcDirective`, `applyDmSceneDirective`, and `closeCurrentChapter` when invoked via the HTTP API. |
| **3** | **MEDIUM** | [`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L789-L796)<br>[`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L984-L1025) | **Login CSRF When `g_csrf_token` Cookie Is Absent & Unthrottled Auth Exchange:** `/auth/google-login` only compares `csrfCookie !== csrfBody` when `csrfCookie !== ''`, allowing cross-site Login CSRF if the victim lacks the cookie. Neither `/auth/google-login` nor `/api/identity/google-session` is rate-limited by IP. | 1. Change line 792 of `src/server/http/server.ts` to `if (csrfCookie === '' || csrfBody === '' || csrfCookie !== csrfBody)` so both the cookie and form field must be present and identical.<br>2. Add IP-keyed rate limiting to `/auth/google-login` and `/api/identity/google-session`. |
| **4** | **MEDIUM** | [`src/server/http/origin-guard.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/origin-guard.ts#L78-L94)<br>[`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L624-L633) | **Unconstrained `X-Forwarded-Host` Trust in Origin Allowlist:** `allowedBrowserOrigins` and `resolveApplicationOrigin` trust any hostname in `X-Forwarded-Host` / `Host`. | Restrict dynamic host-derived origins in `servingOriginFromHost` to known suffixes (`*.hosted.app` and `*.run.app` matching `env.firebaseProjectId`) or `env.clientOrigin`. |
| **5** | **LOW** | [`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L395-L407)<br>[`src/server/http/server.ts`](file:///C:/ChaosStandard/HD-A3/Hallucinated-Dungeons-A3/Builder/src/server/http/server.ts#L1471-L1491) | **Missing HSTS Header & Unauthenticated `/api/assets/<assetId>` Reads:** Hosted HTTPS responses omit `Strict-Transport-Security`, and `/api/assets/<assetId>` serves assets without verifying an active session. | 1. Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` in `applySecurityHeadersFor` when `isHostedEnvironmentClass(env.environmentClass)` is true.<br>2. Require `resolveSession` on `GET /api/assets/<assetId>` and set `cache-control: private, max-age=86400`. |
