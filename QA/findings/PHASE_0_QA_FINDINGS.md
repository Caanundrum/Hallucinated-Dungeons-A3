---
phase: phase-0
candidateId: cand-0f810c6c26d8
localStackManifest: /workspace/Runtime/certification/cand-0f810c6c26d8/local-stack-manifest.json
qaRole: independent-qa
validationStartedAt: 2026-08-12T15:54:16Z
validationCompletedAt: 2026-08-12T16:22:00Z
status: DEFECTS_OPEN
blockingFindingCount: 1
totalFindingCount: 8
---

# Phase 0 — Independent QA Findings

## Candidate confirmation

Before testing anything I confirmed I was pointed at the right thing.

| Source | candidateId | environmentClass | runtimeMode |
| --- | --- | --- | --- |
| `local-stack-manifest.json` | `cand-0f810c6c26d8` | `local` | `frozen_certification` |
| `GET http://127.0.0.1:5274/api/candidate` (live) | `cand-0f810c6c26d8` | `local` | `frozen_certification` |
| Page candidate strip, as rendered in Chromium | `cand-0f810c6c26d8` | `local` | `frozen_certification` |

These agree, so the candidate identity is not a blocking finding. The serving process is
`/workspace/Runtime/candidates/cand-0f810c6c26d8/Builder/dist/server/index.js`, and its frozen
`src` tree is byte-identical to `/workspace/Builder/src` (`diff -rq` reports no differences), so
source I read to explain a result describes the code that actually ran. `GET /api/health` reports
`status: ready` with both the Firestore and Auth emulators reachable.

## What I actually executed

Two suites, both written by me for this validation. I read the Builder's tests in
`/workspace/Builder/tests` only to avoid duplicating them; no Builder test code is reused, and no
verdict below is taken from reading source alone.

**1. Browser suite — 22 scenarios, Chromium, driving the rendered page.**
`/workspace/QA/scripts/phase0-player.qa.spec.ts`, run with
`/workspace/Builder/node_modules/.bin/playwright test --config=/workspace/QA/playwright.qa.config.ts`.
Result: **16 passed, 6 failed.** Console output: `/workspace/QA/evidence/ui/qa-browser-console.log`.
Machine-readable report with per-scenario observations:
`/workspace/QA/results/qa-browser-results.json`. Screenshots: `/workspace/QA/evidence/ui/`.

**2. Raw-HTTP adversarial probe — 37 checks.**
`/workspace/QA/scripts/api-probe.mjs`. This exercises headers a browser refuses to forge (absent
`Origin`, `Origin: null`, look-alike origins), replay, concurrency, traversal, and oversized
bodies. Result: **36 passed, 1 failed.** Output:
`/workspace/QA/evidence/api/api-probe-console.log` and
`/workspace/QA/evidence/api/api-probe-results.json`.

**3. Focused reproduction** of the one raw-HTTP failure:
`/workspace/QA/scripts/keepalive-repro.mjs`, log at `/workspace/QA/evidence/api/keepalive-repro.log`.

Everything I wrote lives under QA Root. I did not install, build, restart, or modify anything, and
I made no change of any kind outside `/workspace/QA`.

## Verdict

**`DEFECTS_OPEN` — one blocking finding.**

The core of Phase 0 is genuinely solid, and I tried hard to break it. The authenticated write/read
path, ownership isolation, idempotency, origin enforcement, candidate pinning, session revocation,
input validation, and output escaping all held up under deliberate attack. I could not create a
duplicate record, read another account's data, write without authenticating, submit from another
origin, execute injected markup, or reach anything through path traversal.

The blocking problem is the fifth Phase 0 claim: *"Failures are explained on the page, and there is
a real retry path."* That is true for validation failures, network failures, and candidate
mismatch. It is **not** true for authentication and session failures. When a session ends while a
page is open, the page silently discards the player's typed submission, empties the record list,
and returns to the signed-out state with **no visible message, no error element, and no retry
control**. The explanatory text the server sent is placed only in a 1×1 pixel clipped
`visually-hidden` region — which is itself destroyed and recreated on every render, so it cannot be
relied on to announce either. A player is told nothing at all.

## Findings

### P0-QA-001 — Session and authentication failures are never shown to the player

- **Severity:** High — **BLOCKING**
- **Maps to:** Phase 0 player journey claim 5, "Failures are explained on the page, and there is a
  real retry path." Blueprint Section 25 Phase 0 build scope (minimal authenticated browser journey
  with truthful failure behaviour).
- **Evidence:** `/workspace/QA/evidence/ui/s15-00-before-expiry.png` (before),
  `/workspace/QA/evidence/ui/s15-01-session-expiry-outcome.png` (after),
  `/workspace/QA/evidence/ui/s16-01-expired-read-outcome.png`,
  `/workspace/QA/evidence/ui/s20-01-after-re-entering.png`. Scenarios QA-S15, QA-S16, QA-S20 in
  `/workspace/QA/results/qa-browser-results.json`.

**Reproduction (QA-S16, no mocking of any kind — the session is really ended server-side):**

1. Open `http://127.0.0.1:5274` and click **Enter the Local Arena**.
2. Type `note before the read fails` and click **Record foundation check**. One record renders.
3. End the session server-side while the tab stays open, which is what a 4-hour expiry looks like
   to this tab. From the page console:
   `await fetch('/api/session', {method:'DELETE', credentials:'same-origin', headers:{'x-hd-candidate':'cand-0f810c6c26d8'}})` → `204`.
4. Click the page's own **Reload from server** button.

**Observed:** the whole record surface disappears. `main` contains only the generic
"Enter the Local Arena" panel. Measured at the moment of failure: `errorElements: 0`,
`noticeElements: 0`, `retryButtons: 0`, `noteInputs: 0`. Nothing states that the session ended, that
the reload failed, or that the records still exist.

**Reproduction (QA-S15, submission path, `SESSION_EXPIRED`):** enter, record one note, then have the
next `POST /api/foundation-checks` answer `401 {"error":"SESSION_EXPIRED","message":"This
development session expired. Enter the Local Arena again."}` — the server's own contract value.
Type `note the player is about to lose` and submit.

**Observed:** identical outcome. The server's message reaches the browser and is placed only in the
`visually-hidden` live region (measured: `width: 1`, `height: 1`, `clip: rect(0px, 0px, 0px, 0px)`,
`position: absolute`). No visible error, no retry button, and the in-progress note vanishes from the
screen.

**Recovery actually available (QA-S20, measured):** the only remaining control is
**Enter the Local Arena**. Clicking it silently mints a *different* account
(`sameAccount: false`), restores the typed text into the field
(`noteInputRestoredTo: "the note in flight"`), and shows an empty list
(`recordsVisible: 0`). The player is not told that they are now a different identity, or that their
earlier records still belong to the previous one.

**Expected:** a visible, explanatory message on the page — the server already produced suitable
wording — plus either a retry control or a clear instruction to re-enter, and an honest statement of
what happened to the submission in flight.

**Why it happens** (offered to make the report actionable, not as the basis for the verdict): in
`src/client/main.ts`, `messageMarkup()` is only ever composed inside `recordPanel()`, and
`recordPanel()` returns an empty string when `state.identity === null`. `applyFailure()` sets
`state.identity = null` for exactly the `NOT_AUTHENTICATED` and `SESSION_EXPIRED` codes, so the one
code path that clears the identity is also the one whose message can never be rendered.

**Reachability:** ordinary, not contrived. Development sessions expire after four hours
(`DEVELOPMENT_SESSION_TTL_MS`), and the Firestore emulator holds session state in memory, so any
emulator restart puts every open page into this state.

---

### P0-QA-002 — Signing out gives no on-screen confirmation

- **Severity:** Low — non-blocking
- **Maps to:** Phase 0 player journey, "Leave the Local Arena"; failure/state changes explained on
  the page.
- **Evidence:** `/workspace/QA/evidence/ui/s14-01-sign-out-confirmation.png`,
  `/workspace/QA/evidence/ui/s09-01-signed-out.png`. Scenario QA-S14.

**Steps:** enter, record a note, click **Leave the Local Arena**.

**Observed:** `main` contains only the "Enter the Local Arena" panel. The page composed the message
`Session ended. The stored records remain owned by that account.` and it is present in the
visually-hidden live region, but zero visible notice elements are rendered
(`visibleNoticeElements: 0`).

**Expected:** the confirmation the page already wrote should be readable.

Same root cause as P0-QA-001. Non-blocking on its own because the state change is self-evident: the
sign-in panel returns and the record surface disappears, so the player can see that they left. It is
listed separately because it has a distinct player impact and because a *failed* sign-out would be
equally invisible.

---

### P0-QA-003 — The polite live region is recreated on every render, so it cannot reliably announce

- **Severity:** Medium — non-blocking
- **Maps to:** Phase 0 accessibility foundations; errors being announced as well as visible.
- **Evidence:** scenario QA-S17 in `/workspace/QA/results/qa-browser-results.json`.

**Steps:** enter the arena, tag the `[data-testid="live-region"]` node with a JavaScript property,
record a note, then check whether the tagged node is still the one on the page.

**Observed:** `{"sameNode": false, "text": "Recorded sequence 1."}`. The region carrying
`role="status" aria-live="polite"` is destroyed and rebuilt with its text already inside it, because
`render()` replaces `#app.innerHTML` wholesale.

**Expected:** a persistent live region whose text content changes in place. Assistive technology
generally does not announce a polite region that did not exist before the change, so the one channel
that currently carries the P0-QA-001 messages is itself unreliable.

The `role="alert"` error element is rebuilt the same way, but insertion is the conventional trigger
for `alert`, so errors that do render are likely announced.

---

### P0-QA-004 — After a failed reload the live region announces the previous success

- **Severity:** Medium — non-blocking
- **Maps to:** truthful output; failures explained rather than masked.
- **Evidence:** scenario QA-S16 observation in `/workspace/QA/results/qa-browser-results.json`.

**Steps:** enter, record a note (live region reads `Recorded sequence 1.`), end the session
server-side, click **Reload from server**.

**Observed:** the reload fails with `NOT_AUTHENTICATED`, and the live region still reads
`Recorded sequence 1.` — a stale success announcement delivered *after* a failure.

**Expected:** the failure should replace the previous success, not be masked by it.

`handleRefresh()` does not clear `state.notice` in its catch, and the live region renders
`state.notice ?? state.error?.message`, so the stale notice wins. This is the only case I found
where the page states something that is not true, which is why I am reporting it separately from
P0-QA-001 despite the related symptom.

---

### P0-QA-005 — Keyboard focus is dropped to `<body>` after every action

- **Severity:** Medium — non-blocking
- **Maps to:** Phase 0 accessibility foundations; "the journey is operable by keyboard alone."
- **Evidence:** scenarios QA-S18 and QA-S10 in `/workspace/QA/results/qa-browser-results.json`,
  `/workspace/QA/evidence/ui/s10-01-keyboard-record.png`.

**Steps:** enter, focus the note field, type a note, press Enter, then read `document.activeElement`.
Repeat for **Reload from server**.

**Observed:** `{"afterSubmit":{"tag":"BODY"},"afterRefresh":{"tag":"BODY"}}`. Because `render()`
replaces the entire subtree, the focused element is detached and focus falls to the document body.

**Expected:** focus retained on or adjacent to the control just used.

Non-blocking: I completed the entire journey using only Tab, typing, and Enter — enter the arena,
record a note, verify it rendered, and sign out (QA-S10 passes). The cost is that a keyboard user
must tab from the top of the document again after each action. The skip link works and is the first
stop; the note field has a real `<label for>` and an `aria-describedby` hint; there is one `h1`.

---

### P0-QA-006 — The stored-records list is silently truncated at 20

- **Severity:** Low — non-blocking
- **Maps to:** rendering the persisted result back in the page; honest presentation.
- **Evidence:** `/workspace/QA/evidence/ui/s19-01-long-history.png`, scenario QA-S19.

**Steps:** enter the arena and record 23 notes (`bulk note 01` … `bulk note 23`), then reload.

**Observed:** `{"recordsWritten":23,"recordsRendered":20,"oldestRendered":"bulk note 04","newestRendered":"bulk note 23","mentionsTruncation":false}`.
The heading reads "Stored for this account" and "Projection version 23" while showing 20 rows, with
nothing on the page indicating the list is partial.

**Expected:** either render everything, or say the list shows the most recent 20 of 23.

Non-blocking: nothing is lost, the server keeps all records, and `PROJECTION_PAGE_SIZE = 20` is a
deliberate cap. The issue is that the page does not disclose it.

---

### P0-QA-007 — A connection stalls after the server rejects an oversized request body

- **Severity:** Low — non-blocking
- **Maps to:** robustness of the local server; truthful failure behaviour.
- **Evidence:** `/workspace/QA/evidence/api/keepalive-repro.log`, check `A10e` in
  `/workspace/QA/evidence/api/api-probe-results.json`.

**Steps:** on a single keep-alive connection (`new http.Agent({keepAlive: true, maxSockets: 1})`),
mint a session, `POST /api/foundation-checks` with a ~200 KB JSON body, then send any follow-up
request on that same connection.

**Observed:**

```
oversized POST : {"answered":true,"status":400,"elapsedMs":8}
next GET (same connection) : {"outcome":"STALLED (no response)","elapsedMs":8001}
following GET  : {"answered":true,"status":200,"elapsedMs":1}
```

The rejection itself is correct and fast. The next request that reuses that connection receives no
response at all — not an error, just silence — until the client gives up. A control run of two
ordinary requests on one keep-alive connection succeeds (check `A10f`), and a body of 9,000 bytes
(just over the 8 KB limit) does not trigger it, so the trigger is specifically a body still being
uploaded when the server stops reading. This is what made my own first probe run hang, which is how
I found it.

**Expected:** the connection stays usable, or is closed cleanly so the client can retry.

Non-blocking: unreachable from the shipped page, which caps the field at 240 characters and the note
at 120, and it requires an authenticated session (an unauthenticated oversized POST is refused
before the body is read). It needs a crafted client.

---

### P0-QA-008 — No CSP, `X-Frame-Options`, or `Referrer-Policy` on the HTML document

- **Severity:** Low — non-blocking
- **Maps to:** defence in depth for a page that builds HTML from stored values.
- **Evidence:** check `A15` in `/workspace/QA/evidence/api/api-probe-results.json`.

**Observed on `GET /`:** `x-content-type-options: nosniff` is present;
`content-security-policy`, `x-frame-options`, and `referrer-policy` are all absent.

**Expected:** at minimum a restrictive CSP, given that `render()` assembles HTML strings that embed
stored, player-supplied text.

Non-blocking, and I want to be fair about it: escaping is correct everywhere I could reach
(P0-QA-008 is a second layer, not a live hole — see QA-S08, which found no injection). Hardening
headers are also explicitly a Phase 6 concern in the blueprint. Recorded so the decision is
deliberate rather than accidental.

## Per-scenario results

### Browser suite (22 scenarios, Chromium) — 16 passed, 6 failed

| Scenario | Result | Notes |
| --- | --- | --- |
| QA-S01 ordinary journey: enter, record, server truth, refresh, recover | PASS | Identity and both records survive reload and a new tab; rows carry server-assigned check id and timestamp |
| QA-S02 duplicate: rapid double-click while the write is in flight | PASS | 4 click attempts, 1 record, at most 1 requestId reached the network |
| QA-S02b duplicate: 6 rapid Enter keypresses | PASS | 1 record |
| QA-S02c lost response then retry | PASS | Server committed, response destroyed, retry reported "already recorded", 1 record |
| QA-S02d same text submitted as two separate intents | PASS | 2 records, which is the documented per-attempt contract stated in the page hint |
| QA-S04 stale page submitting a foreign candidate id | PASS | `CANDIDATE_MISMATCH`, banner shown, no retry offered, nothing written |
| QA-S05 direct navigation to unlinked routes while signed in | PASS | No leak, no fake UI, 404 offers a working way back |
| QA-S06 ownership across two browser contexts | PASS | Neither account sees the other, including via direct `fetch` |
| QA-S07 unauthenticated browser read and write | PASS | Both `401 NOT_AUTHENTICATED`; no record surface rendered at all |
| QA-S08 input abuse: empty, whitespace, 200 chars, 120 chars, 5 injection payloads | PASS | All refused or stored correctly; zero injection |
| QA-S09 sign out, cookie replant, replay | PASS | Session dead server-side; replanted cookie yields 401 on read and write; re-entry is a new identity |
| QA-S10 keyboard-only journey | PASS | Completed end to end; focus quality recorded as P0-QA-005 |
| QA-S11 honesty: every rendered control does something real | PASS | Control inventory exact; no fake affordances; server-truth claim verified |
| QA-S12 real cross-origin page (`http://evil.test`) reading and writing | PASS | Both attempts blocked by the browser; victim account untouched |
| QA-S13 network failure explained plus real retry | PASS | Explanatory message, no phantom row, retry succeeds |
| QA-S14 sign-out confirmed on screen | **FAIL** | P0-QA-002 |
| QA-S15 expired session explained with a way forward | **FAIL** | P0-QA-001 |
| QA-S16 expired session on a read | **FAIL** | P0-QA-001, P0-QA-004 |
| QA-S17 live region survives a state change | **FAIL** | P0-QA-003 |
| QA-S18 focus retained after an action | **FAIL** | P0-QA-005 |
| QA-S19 long record history presented honestly | **FAIL** | P0-QA-006 |
| QA-S20 recovery available after the silent sign-out | PASS | Documents measured recovery behaviour feeding P0-QA-001 |

### Raw-HTTP probe (37 checks) — 36 passed, 1 failed

| Check | Result | What it establishes |
| --- | --- | --- |
| A01, A02 | PASS | Candidate identity matches the manifest; both emulators reachable |
| A03a–A03g | PASS | Refused: foreign origin (mint, read, write), preflight, `Origin: null`, **absent** `Origin`, look-alike origin `http://127.0.0.1:5274.evil.example` |
| A04 | PASS | Authenticated submission accepted and persisted |
| A05a–A05d | PASS | Unauthenticated read, write, session lookup, and a forged cookie all refused |
| A06a–A06c | PASS | Wrong and missing candidate header refused with recovery guidance; nothing written |
| A07a, A07b | PASS | Replayed requestId returns the original record; reusing it with different text does not overwrite |
| A08 | PASS | 10 concurrent submissions of one requestId → exactly 1 record, 1 distinct checkId |
| A09 | PASS | 8 concurrent distinct submissions → 8 records, sequences 1–8, no lost update |
| A10a | PASS | 11 malformed payloads each refused with a specific code (empty, whitespace, 121 and 5000 chars, wrong types, missing/non-v4/path-bearing requestId) |
| A10b | PASS | Client-supplied `ownerAccountId`/`sequence`/`__proto__` ignored; server assigns ownership; no prototype pollution |
| A10c | PASS | Malformed JSON → `BAD_REQUEST`, no crash |
| A10d | PASS | 200 KB body rejected in 6 ms; server survives |
| A10e | **FAIL** | P0-QA-007 |
| A10f | PASS | Control: keep-alive reuse is fine for ordinary requests |
| A11 | PASS | `PUT` and `DELETE` on the records route → 405; no hidden mutation verb |
| A12a | PASS | 19 unlinked/traversal paths: all ≥400, no `/etc/passwd`, no source leak |
| A12b | PASS | 404 page does not reflect an attacker-controlled path as live markup |
| A12c | PASS (informational) | Client source map is served; see observations |
| A13a, A13b | PASS | Cross-account read refused; naming another account in the body does not write into it |
| A14a–A14c | PASS | Sign-out deletes the session server-side; replay refused; cookie cleared, `HttpOnly`, `SameSite=Strict` |
| A15 | PASS (informational) | Header inventory feeding P0-QA-008 |

### Coverage of the 11 requested areas

| Requested area | Covered by | Outcome |
| --- | --- | --- |
| 1. Ordinary journey | QA-S01 | Pass |
| 2. Duplicate submission | QA-S02, S02b, S02c, S02d; A07a, A07b, A08 | Pass — no duplicate could be created |
| 3. Wrong origin | A03a–A03g; QA-S12 | Pass — refused at server and blocked by the browser |
| 4. Stale page | QA-S04; A06a, A06b | Pass |
| 5. Direct navigation and traversal | QA-S05; A12a, A12b | Pass |
| 6. Ownership | QA-S06; A13a, A13b | Pass |
| 7. Authentication | QA-S07, QA-S09; A05a–A05d, A14a | Pass |
| 8. Input abuse and injection | QA-S08; A10a–A10d | Pass |
| 9. Session behaviour | QA-S09; A14a–A14c | Pass on security; see P0-QA-002 for confirmation |
| 10. Accessibility and understandability | QA-S10, QA-S17, QA-S18 | Journey keyboard-completable; see P0-QA-003, P0-QA-005 |
| 11. Honesty | QA-S11, QA-S19 | Pass; see P0-QA-004, P0-QA-006 |

## Notable things that held up under attack

Recorded because a report that only lists defects is not an honest picture.

- **Duplicate prevention is real, not cosmetic.** The disabled-button guard is only the outer layer.
  Ten genuinely concurrent POSTs carrying one requestId produced exactly one record and one checkId
  (A08). Eight concurrent distinct submissions produced sequences 1–8 with no collision and no lost
  update (A09). Replaying a committed requestId with different text returns the original note rather
  than overwriting it (A07b).
- **The retry path is honest where it exists.** I let the server commit and then destroyed the
  response so the page could not know whether the write happened (QA-S02c). The page offered a
  retry, the retry reused the same requestId, and the result was "already recorded" with one record
  stored.
- **Escaping holds.** Five payloads, including attribute-breakout attempts, were stored and
  re-rendered as literal text after a reload. Measured afterwards: zero injected `img`, `svg`,
  `script`, `javascript:` anchors, or `onerror`/`onload` attributes, zero dialogs, and the sentinel
  never fired (QA-S08).
- **Origin enforcement has no soft edge.** Stripping the `Origin` header entirely is refused rather
  than treated as same-origin — the usual bypass, and it fails (A03f).
- **Ownership is enforced by the server, not the page.** Naming another account in the request body
  writes into the caller's own account (A13b).
- **The page is honest about what it is.** The header states it is a Phase 0 foundation and "not the
  game", the control inventory matches exactly what has behaviour, and I found no control that
  renders but does nothing. Deleting a rendered row from the DOM and pressing "Reload from server"
  brings it back, which substantiates the page's claim that the list is server truth.

## Observations that are not findings

- **Client source map served** (`/assets/index-Bo_IIb6o.js.map`, 200). Expected and useful for a
  local-only development environment; no credential or server source is exposed. Not raised.
- **`/api/candidate/../session` returns 401.** The URL normalises to `/api/session`, and the
  unauthenticated answer is correct. Not a traversal bypass.
- **Firestore rules deny all direct client access** (`allow read, write: if false`), so the emulator
  is not a side door for browser JavaScript. Canonical writes go through admin trust on the server,
  which matches the server-authoritative model.
- **Two deliberate submissions of identical text create two records.** This is correct: idempotency
  is scoped to an attempt, not to the text, and the page says so in the field hint. Verified rather
  than assumed (QA-S02d).

## Retest history

| Pass | Date | Scope | Result |
| --- | --- | --- | --- |
| 1 | 2026-08-12 | First independent validation of `cand-0f810c6c26d8`: 22 browser scenarios plus 37 raw-HTTP checks | `DEFECTS_OPEN` — 1 blocking (P0-QA-001), 7 non-blocking |

This is the first validation pass. No finding has been retested, because none has been fixed yet.

**For the next pass**, once P0-QA-001 is addressed, re-run both suites unchanged:

```
node /workspace/QA/scripts/api-probe.mjs
/workspace/Builder/node_modules/.bin/playwright test --config=/workspace/QA/playwright.qa.config.ts
```

QA-S14, QA-S15, QA-S16, QA-S17, QA-S18, QA-S19 and check A10e are the scenarios that must flip to
passing; the other 16 scenarios and 36 checks are the regression guard and must stay green. QA-S20
documents current recovery behaviour and will need its expectations revisited if the recovery flow
changes.
