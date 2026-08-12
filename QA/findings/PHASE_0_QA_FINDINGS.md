---
phase: phase-0
candidateId: cand-32058f47eda8
previousCandidateId: cand-882c6c2fe4a3
originalCandidateId: cand-0f810c6c26d8
localStackManifest: /workspace/Runtime/certification/cand-32058f47eda8/local-stack-manifest.json
qaRole: independent-qa
validationStartedAt: 2026-08-12T15:54:16Z
validationCompletedAt: 2026-08-12T17:15:00Z
retestPass: 2
retestStartedAt: 2026-08-12T17:06:00Z
retestCompletedAt: 2026-08-12T17:15:00Z
status: PLAYER_VALIDATED
blockingFindingCount: 0
totalFindingCount: 9
findingsClosed: 9
openFindingCount: 0
findingsNewThisRetest: 0
---

# Phase 0 — Independent QA Findings

> **Document status.** This file is append-only. The original validation of
> `cand-0f810c6c26d8` is preserved below exactly as first reported. Retest
> results are recorded as a **Retest disposition** block appended to each
> finding, plus one section per pass:
> [retest pass 1](#retest-pass-1--candidate-cand-882c6c2fe4a3) against
> `cand-882c6c2fe4a3` and
> [retest pass 2](#retest-pass-2--candidate-cand-32058f47eda8) against
> `cand-32058f47eda8`. Nothing originally reported has been removed or softened.

## Current disposition at a glance

Current candidate: `cand-32058f47eda8`. All nine findings are closed and none are open.

| Finding | Original severity | Disposition | Closed in |
| --- | --- | --- | --- |
| P0-QA-001 session/auth failures never shown | High (blocking) | **CLOSED** | Retest 1 |
| P0-QA-002 no sign-out confirmation | Low | **CLOSED** | Retest 1 |
| P0-QA-003 live region recreated every render | Medium | **CLOSED** | Retest 1 |
| P0-QA-004 stale success announced after failure | Medium | **CLOSED** | Retest 1 |
| P0-QA-005 focus dropped to `<body>` | Medium | **CLOSED** | Retest 1 |
| P0-QA-006 list truncated at 20 silently | Low | **CLOSED** | Retest 1 |
| P0-QA-007 connection stalls after oversized body | Low | **CLOSED** | Retest 1 |
| P0-QA-008 missing CSP and hardening headers | Low | **CLOSED** | Retest 1 |
| P0-QA-009 focus lost when the focused control is removed | Low | **CLOSED** | Retest 2 |

---

# Original validation pass — candidate `cand-0f810c6c26d8`

*Everything from here to the retest section is the first pass as originally
written.*

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

> *Superseded by retest pass 1.* This verdict was correct for `cand-0f810c6c26d8` and is preserved
> as first written. The current verdict for the replacement candidate `cand-882c6c2fe4a3` is
> `PLAYER_VALIDATED` — see
> [Retest pass 1](#retest-pass-1--candidate-cand-882c6c2fe4a3).

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

#### Retest disposition — `cand-882c6c2fe4a3`, pass 1: **CLOSED**

Re-verified by the same method that found it: the session is ended server-side through the
product's own `DELETE /api/session` while the tab still shows a signed-in page, then the page is
operated as a player would. No mocking, no stubbing.

| Retest scenario | What it does | Result |
| --- | --- | --- |
| RT-001a | Kill the session, then submit a note | Visible error rendered |
| RT-001b | Kill the session, then click **Reload from server** | Visible error rendered |
| RT-001c | Kill the session, submit, re-enter, resubmit | Typed note preserved and recorded |
| QA-S15 / QA-S16 | Original failing scenarios, re-run unchanged | Both now pass |

The error is now a real, measured element rather than hidden text. Measured on the rendered page:

```json
{"text":"Enter the Local Arena before recording a foundation check.",
 "width":699,"height":49,"opacity":"1","visibility":"visible","display":"block",
 "className":"message error","clip":"auto","insideVisuallyHidden":false}
```

`insideVisuallyHidden: false` is the decisive measurement — the message is in the normal document
flow, not in the 1×1 clipped region where the explanation used to be stranded. The element carries
`role="alert"` and `data-error-code="NOT_AUTHENTICATED"`, the sign-in control is present as the way
forward, and the stale record list is cleared rather than left on screen implying it is still true.

One behaviour I did not originally ask for but checked because the fix claims it: the note the
player typed survives the failure. It is restored into the field after re-entering and commits
normally (`RT-001c`, observed `{"restored":"text the player typed"}`).

**Evidence:** `/workspace/QA/evidence/retest-cand-882c6c2fe4a3/ui/rt001-01-expiry-explained.png`
(compare against the original `/workspace/QA/evidence/ui/s15-01-session-expiry-outcome.png`),
`rt001-02-dead-read-explained.png`, `rt001-03-note-preserved.png`.

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

#### Retest disposition — `cand-882c6c2fe4a3`, pass 1: **CLOSED**

Clicking **Leave the Local Arena** now renders a visible confirmation:

```json
{"text":"Session ended. The stored records remain owned by that account.",
 "width":699,"height":49,"visibility":"visible","className":"message success",
 "insideVisuallyHidden":false}
```

I also checked the half of this finding that mattered more than the confirmation itself — that a
*failed* sign-out would no longer be invisible. It is now covered by the same independent message
region, and `RT-106` confirms a hammered sign-out produces exactly one `DELETE` and no error state.

Because a sign-out that reports success but leaves a live session would be worse than no message at
all, I verified the confirmation is truthful rather than cosmetic (`SA-01`): after the confirmation
appears, the captured cookie value is refused for both read and write, and the browser cookie is
gone.

```json
{"replayReadStatus":401,"replayWriteStatus":401,"cookieAfterSignOut":null}
```

**Evidence:** `/workspace/QA/evidence/retest-cand-882c6c2fe4a3/ui/rt002-01-sign-out-confirmed.png`,
`sa01-01-sign-out-state.png`. Scenarios RT-002, SA-01, SA-02, QA-S09, QA-S14.

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

#### Retest disposition — `cand-882c6c2fe4a3`, pass 1: **CLOSED**

The page shell is now built once, and the live region is a sibling of the re-rendered layout rather
than a child of it. Re-verified with the same node-identity method, but pushed harder: the original
scenario tagged the node and performed one action, whereas `RT-003` tags it and then puts the page
through four distinct renders (a record, a reload, a second record, and an error).

```json
{"sameNode":true,"regionCount":1,"ariaLive":"polite","role":"status",
 "text":"Enter a short note before recording a foundation check."}
```

The tagged node survives every render, there is exactly one live region (no duplicate accumulating
across renders), and the announcement text updates in place. `QA-S17`, which previously failed, now
passes unchanged.

I also checked a risk this fix could plausibly have introduced: the new `announce()` only writes
when the text differs from the last announcement, which could silently swallow the confirmation of a
repeated action. `RT-109` performs the same reload three times and reads the region after each:

```json
{"announcements":["Reloaded the stored projection from the server.",
                  "Reloaded the stored projection from the server.",
                  "Reloaded the stored projection from the server."]}
```

The message is present every time, because the intermediate busy render clears the region first.

**Evidence:** scenarios RT-003, RT-109, QA-S17 in
`/workspace/QA/results/retest-cand-882c6c2fe4a3/qa-browser-results.json`.

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

#### Retest disposition — `cand-882c6c2fe4a3`, pass 1: **CLOSED**

`RT-004` reproduces the original sequence exactly: record a note, confirm the region reads the
success, end the session server-side, then reload from the server.

```json
{"afterSuccess":"Recorded sequence 1.",
 "afterFailure":"Enter the Local Arena before recording a foundation check."}
```

The stale success no longer survives the failure, and the announcement is now the failure itself.
This was the one case where the page said something untrue, so I checked the visible surface as well
as the announcement: the visible region shows the error and no success notice
(`QA-S16`, `noticeElements: 0` alongside `errorElements: 1`).

**Evidence:** scenarios RT-004 and QA-S16 in
`/workspace/QA/results/retest-cand-882c6c2fe4a3/qa-browser-results.json`,
`/workspace/QA/evidence/retest-cand-882c6c2fe4a3/ui/rt001-02-dead-read-explained.png`.

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

#### Retest disposition — `cand-882c6c2fe4a3`, pass 1: **CLOSED**

Focus is now retained on the control the player just used, for both a keyboard submit from the text
field and a button activated with Enter:

```json
{"afterSubmit":{"tag":"INPUT","testId":"note-input"},
 "afterRefresh":{"tag":"BUTTON","testId":"refresh-projection"}}
```

The fix also claims caret preservation, so I verified that rather than accepting it. My first
attempt was a bad measurement — it clicked a button, which legitimately moves focus away from the
field — so I re-measured with a re-render that happens *while the field still holds focus*: type a
200-character note, place the caret at offset 37, press Enter, and let the over-length rejection
re-render the page. The caret comes back at offset 37 with the field still focused.

This finding was reported alongside the swap from the `disabled` attribute to `aria-disabled`, which
is a security-relevant change in its own right, so the closure rests on more than the focus
measurement:

- `RT-104` confirms a busy control advertises `aria-disabled="true"`, carries no `disabled`
  attribute, remains focusable, and is labelled "Recording…".
- `RT-103`, `RT-105` and `RT-106` confirm the now-clickable busy controls cannot be hammered into
  duplicate work (see the [new-defect hunt](#new-defect-hunt)).
- `QA-S10`, the keyboard-only journey, still passes end to end.

**Evidence:** scenarios RT-005, RT-104, QA-S10, QA-S18 in
`/workspace/QA/results/retest-cand-882c6c2fe4a3/qa-browser-results.json`.

**Residual, tracked separately:** focus is still lost to `<body>` in the narrower case where the
focused control is *removed* by the action (sign-out, or a failure that signs the player out). That
is recorded as the new finding P0-QA-009 rather than left inside this one, because it is a different
situation with a different fix and it does not affect any ordinary action.

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

#### Retest disposition — `cand-882c6c2fe4a3`, pass 1: **CLOSED**

`RT-006` repeats the original scenario — 23 notes recorded through the page, then a reload — and the
cap is now disclosed in visible text:

```json
{"notice":"Showing the 20 most recent of 23 stored checks.","rendered":20,
 "visibility":{"visibility":"visible","insideVisuallyHidden":false}}
```

The disclosure depends on a new `totalCount` field produced by a Firestore count aggregation, which
is new code on the read path, so I tested the number itself rather than only its presence:

- `RT-007` (boundary): at exactly 20 records no truncation notice is rendered at all; recording a
  21st flips it on and it reads "20 most recent of 21". An off-by-one here would have made the page
  lie in the opposite direction.
- `R09` (HTTP): `totalCount` matches the true stored count at 0, 1, 19, 20, 21 and 23 records, and
  `checks` is capped at 20 throughout.
- `R10` (HTTP): the count is owner-scoped. A fresh account holding 2 records reports
  `totalCount: 2` while another account in the same emulator holds 23, so the aggregation does not
  leak a global total across the ownership boundary.
- `R11` (HTTP): the projection carrying the new field is still refused with `NOT_AUTHENTICATED` to
  an unauthenticated caller.

**Evidence:** `/workspace/QA/evidence/retest-cand-882c6c2fe4a3/ui/rt006-01-truncation-disclosed.png`,
checks `R09`–`R11` in
`/workspace/QA/evidence/retest-cand-882c6c2fe4a3/api/new-surface-results.json`.

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

#### Retest disposition — `cand-882c6c2fe4a3`, pass 1: **CLOSED**

`A10e` — the check that originally failed — now passes unchanged, on the same single keep-alive
connection with `maxSockets: 1`:

```json
{"oversizedResponse":{"answered":true,"status":413,"elapsedMs":8},
 "nextRequestOnSameConnection":{"answered":true,"status":200,"elapsedMs":1}}
```

The follow-up is answered in 1 ms instead of stalling for the full 8-second client timeout. The
rejection is now a `413` with a distinct `PAYLOAD_TOO_LARGE` code and `Connection: close`.

Because the fix added a `Content-Length` pre-check on top of the streaming guard, I probed for ways
around it and for over-eagerness in the other direction:

- `R05`: bodies of 8 KB + 200 bytes, 200 KB and 5 MB are all answered `413`, and a legitimate
  100-character note still commits `201`. A valid-size body carrying a 7,854-character note is still
  judged as `NOTE_TOO_LONG` (400) rather than being misreported as oversized.
- `R05b`: every 413 is returned in under 12 ms, so the refusal genuinely happens before the upload
  is read rather than after 8 KB.
- `R06`: a chunked upload that declares no `Content-Length` at all — which bypasses the pre-check
  entirely — is still refused `413` in 9 ms by the streaming guard, not stalled.
- `R14`: an unauthenticated 200 KB body cannot stall a connection either.
- `R08`: ordinary submissions still work afterwards and no oversized note reached storage.

**Evidence:** check `A10e` in
`/workspace/QA/evidence/retest-cand-882c6c2fe4a3/api/api-probe-results.json`; checks `R05`–`R08` and
`R14` in `/workspace/QA/evidence/retest-cand-882c6c2fe4a3/api/new-surface-results.json`.

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

#### Retest disposition — `cand-882c6c2fe4a3`, pass 1: **CLOSED**

All four headers are present, and `R02` confirms they are on every class of response rather than
only the document — HTML page, 404 page, JSON success, JSON error, JS bundle and CSS bundle:

```
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none';
  form-action 'none'; frame-ancestors 'none'; object-src 'none'
x-frame-options: DENY
referrer-policy: no-referrer
x-content-type-options: nosniff
```

A restrictive CSP is the single most likely thing in this remediation to break a page silently, so
this closure rests mainly on evidence that the page still works rather than on the header being
present. See [the new-defect hunt](#new-defect-hunt) for `RT-101` (zero CSP violations and zero
uncaught errors across the whole journey) and `RT-102` (the stylesheet genuinely loaded and applied).

**Evidence:** check `A15` in
`/workspace/QA/evidence/retest-cand-882c6c2fe4a3/api/api-probe-results.json`, check `R02` in
`new-surface-results.json`, scenarios RT-008, RT-101 and RT-102.

---

### P0-QA-009 — Focus is lost to `<body>` when the action removes the focused control

- **Severity:** Low — non-blocking
- **Status:** OPEN (new in retest pass 1 against `cand-882c6c2fe4a3`)
- **Maps to:** Phase 0 accessibility foundations; "the journey is operable by keyboard alone."
- **Evidence:** scenarios FR-01 and FR-02 in
  `/workspace/QA/results/retest-cand-882c6c2fe4a3/qa-browser-results.json`,
  `/workspace/QA/evidence/retest-cand-882c6c2fe4a3/ui/fr02-01-focus-after-auth-failure.png`.

**Steps (FR-01):** enter the arena, Tab to **Leave the Local Arena**, press Enter, then read
`document.activeElement`.

**Steps (FR-02):** enter the arena, end the session server-side, focus the note field, type a note,
press Enter to submit into the dead session, then read `document.activeElement`.

**Observed:** `{"tag":"BODY","testId":null}` in both cases.

**Expected:** focus moved to a sensible destination — conventionally the message explaining what
happened, or the control that now represents the way forward.

This is the residual case of P0-QA-005. The fix restores focus by looking the control back up by its
`data-testid` after the re-render, which works whenever the control still exists, but sign-out and
an authentication failure both *remove* the control that had focus, so there is nothing to restore
and focus falls to the document body.

I am recording it separately rather than reopening P0-QA-005 because it is a different situation
with a different fix, and because P0-QA-005 as reported — focus dropped after *every* action — is
genuinely fixed.

**Why Low and non-blocking, measured rather than assumed:**

- The player is not stranded. After sign-out, the very first Tab lands on **Enter the Local Arena**
  (`{"tag":"BUTTON","testId":"enter-arena"}`), which is the only thing left to do.
- After an authentication failure the recovery control is reachable by tabbing (`FR-02`,
  `{"reachedEnterByTabbing":true}`).
- The explanation is not missed: the message carries `role="alert"`, which is announced on
  insertion regardless of where focus sits, and the live region is now persistent (P0-QA-003).
- The keyboard-only journey still completes end to end (`QA-S10`).

No Phase 0 requirement fails on this, no security or ownership invariant is touched, and the journey
remains completable, so it does not block.

#### Retest disposition — `cand-32058f47eda8`, pass 2: **CLOSED**

Verified directly on the page for both cases I originally reported. Focus no longer reaches
`<body>`; it lands on the message explaining what happened.

| Case | Scenario | Focus destination |
| --- | --- | --- |
| Sign out with the keyboard | RT2-001 | `notice-message`, text "Session ended. The stored records remain owned by that account." |
| Authentication failure while the note field is focused | RT2-002 | `error-message`, `role="alert"`, text "Enter the Local Arena before recording a foundation check." |
| Failure while a *stale success notice* exists | RT2-003 | `error-message` — the error wins, and the stale notice is gone rather than merely out-prioritised |

Both destinations report `tabIndex: -1` and `isBody: false`. The explanation is announced as well as
focused: the persistent live region carries the same text in both cases, and the error keeps
`role="alert"`.

I also checked the case the fix does not name. The retry button is a third control that is deleted
by using it, and it sits on the Phase 0 "real retry path", so dropping focus there would matter
(`RT2-108`). Focus lands on `record-submit`, not `<body>`. That is the fallback chain behaving
correctly rather than a gap: the busy re-render that removes the retry button has no message to
offer yet, so the chain falls through to the primary action, which is the control of the form the
player was using. The success confirmation still reaches a screen reader through the live region.

**Evidence:** `/workspace/QA/evidence/retest2-cand-32058f47eda8/ui/rt2-001-focus-on-signout-notice.png`,
`rt2-002-focus-on-error-panel.png`, `rt2-105-focused-message-indicator.png`,
`rt2-108-focus-after-retry.png`; scenarios RT2-001, RT2-002, RT2-003, RT2-108 in
`/workspace/QA/results/retest2-cand-32058f47eda8/qa-browser-results.json`.

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

---

# Retest pass 1 — candidate `cand-882c6c2fe4a3`

## Candidate confirmation

Confirmed before anything else was concluded. The running server reports the replacement candidate,
and the frozen tree matches the manifest:

```
GET http://127.0.0.1:5274/api/candidate
{"candidateId":"cand-882c6c2fe4a3","blueprintVersion":"ALPHA_3_V1",
 "environmentClass":"local","runtimeMode":"frozen_certification",
 "firebaseProjectId":"hallucinated-dungeons-local","environmentSchemaVersion":"1"}
```

`/workspace/Runtime/certification/cand-882c6c2fe4a3/local-stack-manifest.json` declares the same id,
`environmentClass: local`, `runtimeMode: frozen_certification`, and a clean tree
(`clean: true`, `dirtyPaths: []`, commit `e921a8a1`). The serving process is running from
`/workspace/Runtime/candidates/cand-882c6c2fe4a3/Builder/dist/server/index.js`. The candidate strip
rendered in the browser also reads `cand-882c6c2fe4a3`, so the page a player sees is the candidate
under test, not a cached older bundle.

## What I actually executed

Three suites, all against the running page and server, all output under `/workspace/QA`:

| Suite | Count | Result | Command |
| --- | --- | --- | --- |
| Browser scenarios (Chromium) | 46 | 46 passed | `playwright test --config=/workspace/QA/playwright.retest.config.ts` |
| Original raw-HTTP probe, re-run unchanged | 37 | 37 passed | `QA_EXPECTED_CANDIDATE=cand-882c6c2fe4a3 node scripts/api-probe.mjs` |
| New-surface HTTP probe (written for this retest) | 15 | 15 passed | `node scripts/retest-new-surface.mjs` |

The 46 browser scenarios are my original 22 re-run unchanged as the regression guard, plus 20 new
`RT-*` retest scenarios, plus 4 focused probes (`SA-*`, `FR-*`) written to answer questions the
retest raised. The only edit to the original 22 was to make the candidate id a parameter
(`QA_CANDIDATE_ID`) instead of a hard-coded string, so the identical assertions run against the new
candidate.

Scripts: `/workspace/QA/scripts/phase0-player.qa.spec.ts` (original 22),
`phase0-remediation-retest.qa.spec.ts`, `signout-abort-probe.qa.spec.ts`,
`focus-residual-probe.qa.spec.ts`, `api-probe.mjs`, `retest-new-surface.mjs`.
Config: `/workspace/QA/playwright.retest.config.ts`.
Evidence: `/workspace/QA/evidence/retest-cand-882c6c2fe4a3/`.
Results JSON and HTML report: `/workspace/QA/results/retest-cand-882c6c2fe4a3/`.

I read the Builder's remediation report at
`/workspace/Checkpoints/phase-0/qa-remediation/PHASE_0_REMEDIATION_REPORT.md` and treated each
claim in it as a hypothesis to test on the running page, not as evidence. Every closure below is
based on operating the page or the HTTP surface.

**Boundaries.** I created and edited files only under `/workspace/QA`. I did not restart, rebuild,
reconfigure or modify the candidate, did not run any install or build, and committed nothing. The
only files outside QA Root whose contents changed during this pass are
`/workspace/Runtime/certification/cand-882c6c2fe4a3/logs/server.log`,
`/workspace/Builder/firestore-debug.log` and `/workspace/Builder/firebase-debug.log` — all written
by the running server and the emulators themselves in response to my test traffic, not by me. The
frozen `src` tree of the running candidate is byte-identical to `/workspace/Builder/src`
(`diff -rq` reports no differences), so source I read to explain a result describes the code that
actually ran.

## Retest verdict

**`PLAYER_VALIDATED`.** All eight findings are closed, including the blocking one. One new
non-blocking finding (P0-QA-009) was raised. No blocking finding remains, so the Phase 0 player
journey is validated:

1. Open the page — served, styled, no console errors, no CSP violations.
2. Enter the Local Arena — one identity minted even under hammering, no password anywhere.
3. Record a note — server authorises, writes to the emulator, page renders the server projection.
4. Refresh — identity and records survive, in the same tab and in a new one.
5. Failures are explained on the page and there is a real retry path — this is the part that failed
   the first pass and now passes.

## Regression check on what previously passed

The areas called out as most at risk, re-verified rather than assumed:

| Area | Re-verified by | Result |
| --- | --- | --- |
| Duplicate prevention under `aria-disabled` | QA-S02, QA-S02b, QA-S02c, RT-103, RT-105, RT-106; A07a, A07b, A08 | One record per intent, every time |
| Ownership isolation | QA-S06; A13a, A13b, R10 | No cross-account read or write, and no count leak |
| Unauthenticated access | QA-S07; A05a–A05d, R11 | All refused `401` |
| Cross-origin rejection | QA-S12; A03a–A03g | All refused, including stripped and `null` Origin |
| Injection and escaping | QA-S08, RT-108 | Zero injection through the rebuilt render path |
| Path traversal and unlinked routes | QA-S05; A12a, A12b | Nothing exposed, no fake page |
| Stale candidate | QA-S04; A06a–A06c | Refused with recovery guidance, nothing written |
| Keyboard-only journey | QA-S10, RT-005, RT-104 | Completes end to end; focus now retained |

The `disabled` → `aria-disabled` swap deserved the most attention, because an `aria-disabled` button
is still clickable and focusable — the browser no longer blocks anything, so the entire guard is now
application state. I attacked it directly in `RT-103`: three synthetic `.click()` calls, four forced
Playwright clicks and four Enter presses, all delivered while a 1.5-second write was deliberately
held open.

```json
{"postRequests":1,"distinctRequestIds":1,"storedCopies":1}
```

Exactly one POST left the browser. `RT-105` and `RT-106` apply the same treatment to the sign-in and
sign-out controls: one mint response, one delete response. `RT-104` confirms the busy control
advertises `aria-disabled="true"`, carries no `disabled` attribute, and stays focusable, which is
what the change was for.

## New-defect hunt

The remediation touched the whole client render path, the projection shape, request body handling
and response headers, so I probed each for damage.

| Probe | Question | Observed |
| --- | --- | --- |
| RT-101 | Does the CSP break the page silently? | 0 CSP violations, 0 uncaught page errors across the full journey including failure paths |
| RT-102 | Did the stylesheet actually load and apply? | 1 stylesheet, 33 rules, body `rgb(11, 16, 32)`, button `rgb(110, 168, 255)` — genuinely styled, not a bare fallback |
| R02 | Are the headers on every response class? | Present on HTML, 404, JSON success, JSON error, JS bundle, CSS bundle |
| R03 / R04 | Do the assets load, and is there anything the CSP would block? | JS and CSS both 200; no inline script, no inline `<style>`, no `style=` attribute |
| RT-103/105/106 | Can `aria-disabled` be hammered into duplicate work? | No — one POST, one mint, one delete |
| RT-107 | Did narrowing the retry button remove a needed retry? | Correct both ways: no retry offered for `NOTE_TOO_LONG`, retry offered and successful after a connection failure |
| RT-108 | Does escaping still hold through the rebuilt render path? | 5 payloads stored and re-rendered as text; zero injected nodes, zero dialogs, sentinel never fired |
| RT-109 | Does the new announcement dedupe swallow repeated confirmations? | No — the same action announced all three times |
| RT-110 | Does focus restoration steal focus from outside the app? | No — focus stays on the skip link, which still works |
| R09/R10/R11 | Is the new `totalCount` correct, owner-scoped and still authenticated? | Correct at 0/1/19/20/21/23, owner-scoped, refused when unauthenticated |
| R05/R05b/R06/R07/R14 | Can the new size guard be bypassed or made over-eager? | No bypass via chunked encoding; valid notes still commit; every 413 under 12 ms |

Two things looked like defects and turned out not to be. I chased both to ground rather than
assuming, and I am recording them so the next reader does not re-chase them:

- **`net::ERR_ABORTED` on the sign-out request.** This looked like a failed sign-out. It is
  Chromium's normal reporting for a `204 No Content`, which has no body to load. `SA-02` observed
  from inside the page shows the `fetch` resolving with status `204` and not throwing, and `SA-01`
  proves the outcome that actually matters: the captured cookie is refused `401` for both read and
  write afterwards and the browser cookie is cleared. Not a defect.
- **Two console `error` lines during the journey.** Both are Chromium logging the deliberately
  triggered `401` (first-visit session probe) and `400` (empty-note rejection) responses. No
  uncaught JavaScript error and no CSP violation occurred. Not a defect.

The one genuine new issue is P0-QA-009 (focus lost to `<body>` when the action removes the focused
control), recorded above as Low and non-blocking.

## Retest per-scenario results

### Browser suite — 46 of 46 passed

The six scenarios that failed the first pass, re-run unchanged:

| Scenario | First pass | Retest |
| --- | --- | --- |
| QA-S14 sign-out confirmed on screen | FAIL | **PASS** |
| QA-S15 expired session explained with a way forward | FAIL | **PASS** |
| QA-S16 expired session on a read | FAIL | **PASS** |
| QA-S17 live region survives a state change | FAIL | **PASS** |
| QA-S18 focus retained after an action | FAIL | **PASS** |
| QA-S19 long record history presented honestly | FAIL | **PASS** |

The other 16 original scenarios (QA-S01, S02, S02b, S02c, S02d, S04–S13, S20) all still pass, so
nothing that previously worked regressed.

New retest scenarios, all passing:

| Scenario | What it establishes |
| --- | --- |
| RT-001a/b/c | P0-QA-001: a dead session is explained on screen for a write and a read, and the typed note survives |
| RT-002 | P0-QA-002: sign-out confirmed in visible text |
| RT-003 | P0-QA-003: the live region node survives four renders, exactly one exists |
| RT-004 | P0-QA-004: a failure replaces the earlier success announcement |
| RT-005 | P0-QA-005: focus and caret preserved across actions |
| RT-006 | P0-QA-006: "Showing the 20 most recent of 23 stored checks" |
| RT-007 | P0-QA-006 boundary: no notice at exactly 20; correct at 21 |
| RT-008 | P0-QA-008: hardening headers live in a real browser |
| RT-101 | No CSP violation and no uncaught error across the whole journey |
| RT-102 | The stylesheet loaded and the page is genuinely styled |
| RT-103 | Hammered `aria-disabled` submit yields one POST and one record |
| RT-104 | Busy controls use `aria-disabled`, stay focusable, carry no `disabled` |
| RT-105 | Hammered sign-in mints exactly one identity |
| RT-106 | Hammered sign-out sends exactly one delete and shows no error |
| RT-107 | The retry control appears only where retrying is honest |
| RT-108 | Escaping holds through the rebuilt render path |
| RT-109 | Repeated actions are still announced each time |
| RT-110 | Focus restoration does not steal focus from the skip link |
| SA-01, SA-02 | Sign-out is truthful: 204, cookie cleared, token dead server-side |
| FR-01, FR-02 | Measures the focus residual recorded as P0-QA-009 |

### Raw-HTTP probes — 37 of 37 and 15 of 15 passed

`A10e`, the only check that failed the first pass, now passes. All other 36 checks stayed green.
The 15 new-surface checks (`R01`–`R15`) all pass; `R15` is informational and records that the
source map is still served for the new bundle, which remains expected for a local-only environment.

Two of my own new checks failed on first execution and were corrected in the test, not excused in
the product: `R05` initially expected a legitimate 100-character note to be rejected, and `R08`
initially treated that same valid note as an oversized leak. Both were my expectation bugs; the
product behaviour was correct, and the corrected checks assert the honest thing (no note longer than
120 characters ever reached storage).

---

# Retest pass 2 — candidate `cand-32058f47eda8`

## Candidate confirmation

```
GET http://127.0.0.1:5274/api/candidate
{"candidateId":"cand-32058f47eda8","blueprintVersion":"ALPHA_3_V1",
 "environmentClass":"local","runtimeMode":"frozen_certification",
 "firebaseProjectId":"hallucinated-dungeons-local","environmentSchemaVersion":"1"}
```

`/workspace/Runtime/certification/cand-32058f47eda8/local-stack-manifest.json` declares the same id,
`environmentClass: local`, `runtimeMode: frozen_certification`, and a clean tree (`clean: true`,
`dirtyPaths: []`, commit `c39e1f3f`). The serving process runs from
`/workspace/Runtime/candidates/cand-32058f47eda8/Builder/dist/server/index.js`, its frozen `src`
tree is byte-identical to `/workspace/Builder/src`, and the candidate strip rendered in the browser
reads `cand-32058f47eda8`.

## What I actually executed

| Suite | Count | Result |
| --- | --- | --- |
| Browser scenarios (Chromium) | 57 | 57 passed |
| Original raw-HTTP probe, re-run unchanged | 37 | 37 passed |
| New-surface HTTP probe | 15 | 15 passed |

The 57 browser scenarios are everything from passes 0 and 1 re-run against the new candidate (the
full regression guard), plus 11 new `RT2-*` scenarios written for this pass. New script:
`/workspace/QA/scripts/phase0-retest2.qa.spec.ts`; config
`/workspace/QA/playwright.retest2.config.ts`; evidence
`/workspace/QA/evidence/retest2-cand-32058f47eda8/`; results
`/workspace/QA/results/retest2-cand-32058f47eda8/`.

`FR-01` and `FR-02` — the two probes that originally measured P0-QA-009 — were strengthened from
recording where focus lands to asserting it is not the document body, so they now guard the fixed
behaviour rather than merely describing it. They corroborate the new scenarios independently,
recording `notice-message` and `error-message` where they previously recorded `BODY`.

I read the Builder's claim appended to
`/workspace/Checkpoints/phase-0/qa-remediation/PHASE_0_REMEDIATION_REPORT.md` and treated it as a
hypothesis to test on the running page, not as evidence.

**Boundaries.** I created and edited files only under `/workspace/QA`. I did not restart, rebuild or
modify the candidate, and committed nothing. The only files outside QA Root whose contents changed
are `/workspace/Runtime/certification/cand-32058f47eda8/logs/server.log`,
`/workspace/Builder/firestore-debug.log` and `/workspace/Builder/firebase-debug.log`, all written by
the running server and emulators in response to my test traffic.

## Verdict

**`PLAYER_VALIDATED`.** P0-QA-009 is closed, nothing regressed, and no new finding was raised. All
nine findings across the three passes are now closed and none are open.

## Did the focusable messages leak into the tab order?

No. This was the main risk of the fix, so I answered it two independent ways.

**A real Tab walk** from the top of the document in three page states. The messages sit between the
sign-in/sign-out panel and the record form in the DOM, so a leak would show up as an extra stop:

```
signed out, notice showing : skip-link → enter-arena → (left the page)
signed out, error showing  : skip-link → enter-arena → (left the page)
signed in, notice showing  : skip-link → leave-arena → note-input → record-submit
                             → refresh-projection → (left the page)
```

Tab steps straight over the message in every case. The signed-in walk traverses the whole form,
which is what makes it a real enumeration rather than a walk that stopped early — my first version
of this helper did stop early, because Chromium keeps a sequential focus navigation starting point
that survives a `blur()`, so the walk resumed mid-document. Fixed by focusing the first focusable
element explicitly, and the corrected walk is the one above.

**An inventory of every natively tabbable node** (`tabIndex >= 0`) in the signed-in state:
`skip-link, leave-arena, note-input, record-submit, refresh-projection`. Neither message appears,
and the notice reports `tabIndex: -1`.

## Keyboard journey and recovery

`RT2-103` completes the whole journey using only Tab, Shift+Tab, typing and Enter — reach sign-in,
enter, reach the note field, type, submit, reload from the server, then sign out — with no mouse at
any point.

`RT2-104` covers the case the fix actually changes: an expired session. The player types a note,
submits into the dead session, lands on the error panel, and recovers with **one Shift+Tab** to
reach **Enter the Local Arena**, re-enters, finds the typed note still in the field, and commits it.

The messages sit after the sign-in control in the DOM, so landing on one puts the player just past
the way forward. Measured cost: one Shift+Tab backwards, or two Tabs forwards (Tab wraps to the skip
link, then to the sign-in button). Before the fix, focus sat on `<body>` and the recovery control
was one Tab away. So the fix trades one keystroke in one direction for landing the player on the
explanation, which is the better trade and not a regression worth raising.

## Focus indication

`RT2-105` checked whether a sighted keyboard user can see where focus went, since the app's own
`:focus-visible` outline rule only targets `input`, `button` and `a` — not the message divs. The
computed `outline-color` is `rgb(16, 16, 16)`, which looked like a problem on a dark panel, but the
computed value is misleading: `outline-style` is `auto`, and Chromium paints its adaptive focus
ring for `auto`, which renders as a clear white ring on this dark surface. Confirmed visually in
`rt2-105-focused-message-indicator.png` rather than inferred from the computed style. The element
also matches `:focus-visible`. No finding.

## Regression check

Nothing regressed. The areas most worth re-checking:

| Area | Re-verified by | Result |
| --- | --- | --- |
| P0-QA-001, the previously blocking behaviour | RT-001a, RT-001b, RT-001c, QA-S15, QA-S16 | Dead sessions still explained on screen, typed note still preserved |
| Duplicate prevention | QA-S02, QA-S02b, QA-S02c, RT-103, RT-105, RT-106; A07a, A07b, A08 | One record per intent |
| Ownership isolation | QA-S06; A13a, A13b, R10 | No cross-account read, write or count leak |
| Unauthenticated access | QA-S07; A05a–A05d, R11 | All refused `401` |
| Cross-origin rejection | QA-S12; A03a–A03g | All refused |
| CSP and console cleanliness | RT-101, RT2-107 | 0 CSP violations, 0 uncaught page errors |
| Injection and escaping | QA-S08, RT-108 | Zero injection |
| Focus not stolen from outside the app | RT-110, RT2-106 | Skip link keeps focus through a render |

`RT2-106` deserves a note because the new fallback chain could plausibly have caused it: a render
that removes the sign-in button while focus sits on the skip link must not drag focus into the
layout. It does not — the fallback only runs when the previously focused element carried a
`data-testid`, and the skip link does not.

One of my own new checks failed on first execution (`RT2-108`, which expected focus to land on the
success notice after a retry). The product was right and my expectation was wrong; corrected in the
test, as described in the P0-QA-009 disposition.

## Retest history

| Pass | Date | Candidate | Scope | Result |
| --- | --- | --- | --- | --- |
| 0 (initial) | 2026-08-12 | `cand-0f810c6c26d8` | First independent validation: 22 browser scenarios plus 37 raw-HTTP checks | `DEFECTS_OPEN` — 1 blocking (P0-QA-001), 7 non-blocking |
| 1 (retest) | 2026-08-12 | `cand-882c6c2fe4a3` | Retest of all 8 findings, plus the original 22 scenarios and 37 checks re-run as a regression guard, plus 20 new retest scenarios, 4 focused probes and 15 new-surface HTTP checks | `PLAYER_VALIDATED` — 8 closed, 0 blocking, 1 new non-blocking finding (P0-QA-009) |
| 2 (retest) | 2026-08-12 | `cand-32058f47eda8` | Retest of P0-QA-009, plus all 46 earlier browser scenarios, 37 HTTP checks and 15 new-surface checks re-run as a regression guard, plus 11 new focus and tab-order scenarios | `PLAYER_VALIDATED` — P0-QA-009 closed, 0 open findings, no regression, no new finding |

**Pass 1 detail.** Candidate id confirmed as `cand-882c6c2fe4a3` from both the manifest and the
running `/api/candidate`, and from the candidate strip rendered in the browser. The blocking finding
P0-QA-001 was re-verified by the method that found it — ending the session server-side through
`DELETE /api/session` and then operating the page — for both a write (`RT-001a`) and a read
(`RT-001b`). Totals: 46 of 46 browser scenarios, 37 of 37 original HTTP checks, 15 of 15
new-surface HTTP checks.

**Reproducing pass 1:**

```
QA_EXPECTED_CANDIDATE=cand-882c6c2fe4a3 \
  QA_OUT_DIR=/workspace/QA/evidence/retest-cand-882c6c2fe4a3/api \
  node /workspace/QA/scripts/api-probe.mjs

QA_EXPECTED_CANDIDATE=cand-882c6c2fe4a3 \
  QA_OUT_DIR=/workspace/QA/evidence/retest-cand-882c6c2fe4a3/api \
  node /workspace/QA/scripts/retest-new-surface.mjs

QA_CANDIDATE_ID=cand-882c6c2fe4a3 \
  QA_EVIDENCE_DIR=/workspace/QA/evidence/retest-cand-882c6c2fe4a3/ui \
  /workspace/Builder/node_modules/.bin/playwright test \
  --config=/workspace/QA/playwright.retest.config.ts
```

**Pass 2 detail.** Candidate id confirmed as `cand-32058f47eda8` from the manifest, the running
`/api/candidate`, and the candidate strip rendered in the browser. P0-QA-009 was re-verified for
both cases originally reported — sign-out with the keyboard and an authentication failure while a
control held focus — and closed. The specific risk of the fix, the two newly focusable message
elements leaking into the tab order, was disproved by a full Tab walk in three page states and by an
inventory of every tabbable node. Totals: 57 of 57 browser scenarios, 37 of 37 original HTTP checks,
15 of 15 new-surface HTTP checks.

**Reproducing pass 2:**

```
QA_EXPECTED_CANDIDATE=cand-32058f47eda8 \
  QA_OUT_DIR=/workspace/QA/evidence/retest2-cand-32058f47eda8/api \
  node /workspace/QA/scripts/api-probe.mjs

QA_EXPECTED_CANDIDATE=cand-32058f47eda8 \
  QA_OUT_DIR=/workspace/QA/evidence/retest2-cand-32058f47eda8/api \
  node /workspace/QA/scripts/retest-new-surface.mjs

QA_CANDIDATE_ID=cand-32058f47eda8 \
  QA_EVIDENCE_DIR=/workspace/QA/evidence/retest2-cand-32058f47eda8/ui \
  /workspace/Builder/node_modules/.bin/playwright test \
  --config=/workspace/QA/playwright.retest2.config.ts
```

**For a future pass.** No finding is open. The full guard is 57 browser scenarios plus 52 HTTP
checks, and all of them must stay green. `FR-01` and `FR-02` still record where focus lands when a
control is removed, and now expect a real destination rather than `<body>`; `RT2-101` is the
tab-order guard and will catch any future element that becomes focusable by accident.
