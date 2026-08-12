---
phase: phase-0
role: Builder
respondsToFindings: /workspace/QA/findings/PHASE_0_QA_FINDINGS.md
qaValidatedCandidate: cand-0f810c6c26d8
remediationAuthoredAt: 2026-08-12T16:40:00Z
findingsReceived: 8
findingsFixed: 8
findingsNotReproduced: 0
findingsBlocked: 0
findingsRequiringProductDecision: 0
---

# Phase 0 — Builder remediation report

Independent QA validated candidate `cand-0f810c6c26d8` and opened eight findings, one of
them blocking. Every finding was reproduced locally, accepted, fixed, and covered by a new
regression test. Builder does not close QA findings; QA closes them after page-level retest.

The new regression file is `Builder/tests/e2e/qa-regressions.spec.ts`, and each test names the
finding it locks down. The browser suite grew from 13 to 22 scenarios, and the certification
runner now requires all 22 to execute.

## Dispositions

### P0-QA-001 — Session and authentication failures are never shown to the player — FIXED

**Root cause.** `messageMarkup()` was rendered inside `recordPanel()`, and `recordPanel()`
returns an empty string when `state.identity === null`. Any failure that clears the identity —
which is exactly what a `NOT_AUTHENTICATED` or `SESSION_EXPIRED` response does — therefore
deleted the element that was supposed to explain it. The player saw a signed-out page with no
message, no error element, and no retry control. The server's explanation reached only the
visually hidden live region, which had its own defect (P0-QA-003).

**Fix.** The message region is now rendered in `<main>` independently of the record form, so a
failure is explained whatever state it leaves the page in. `applyFailure` also clears any stale
success notice and drops the pending request id when the session is gone, and it deliberately
keeps the typed note so the player does not lose their text.

**Files.** `Builder/src/client/main.ts`.

**Tests.** `P0-QA-001: a session that ends mid-use is explained on the page`;
`P0-QA-001: reloading with a dead session explains itself rather than emptying quietly`. Both
end the session server-side through the product's own `DELETE /api/session`, with no mocking.

### P0-QA-002 — Signing out gives no on-screen confirmation — FIXED

**Root cause.** Same as P0-QA-001: sign-out sets `state.identity = null`, which removed the
panel that rendered the notice the handler had just composed.

**Fix.** Covered by the message-region change above.

**Files.** `Builder/src/client/main.ts`.

**Tests.** `P0-QA-002: signing out is confirmed on screen`.

### P0-QA-003 — The polite live region is recreated on every render — FIXED

**Root cause.** `render()` replaced the entire contents of `#app`, including the live region.
A live region that is destroyed and recreated in the same frame as its new text is not reliably
announced, because the assistive technology never observes a change within a persistent node.

**Fix.** The page shell is now built once and holds two children: a `#hd-layout` container that
re-renders, and the live region, which is created once and never replaced. Announcements are
written imperatively through `announce()`.

**Files.** `Builder/src/client/main.ts`.

**Tests.** `P0-QA-003: the live region survives re-rendering` marks the original node and
asserts the same node is still present after several renders.

### P0-QA-004 — After a failed reload the live region announces the previous success — FIXED

**Root cause.** `handleRefresh` and `handleLeave` did not clear `state.notice` before their
request, and `applyFailure` did not clear it either, so a failure rendered with the previous
success message still in state.

**Fix.** Both handlers clear the notice before starting, `applyFailure` clears it on every
failure, and `announce()` writes the error message in preference to any notice and only when
the text actually changes.

**Files.** `Builder/src/client/main.ts`.

**Tests.** `P0-QA-004: a failure replaces the previous success announcement`.

### P0-QA-005 — Keyboard focus is dropped to `<body>` after every action — FIXED

**Root cause.** Two causes. `render()` replaced the DOM without preserving focus, and controls
were marked busy with the `disabled` attribute, which removes focus from the element being
disabled — so even a focus-restoring render had nothing left to restore.

**Fix.** `render()` captures the focused control's `data-testid` and caret position before
replacing the layout and restores both afterwards. Busy state is now expressed with
`aria-disabled` and a style rule instead of the `disabled` attribute; every handler already
guards on `state.busy`, so a click during a request still does nothing.

**Files.** `Builder/src/client/main.ts`, `Builder/src/client/styles.css`.

**Tests.** `P0-QA-005: keyboard focus is preserved across an action`, covering both a submit
from the text input and a button activated by keyboard. The shared `recordCheck` helper now
waits on `aria-disabled="false"` rather than on the removed `disabled` attribute.

### P0-QA-006 — The stored-records list is silently truncated at 20 — FIXED

**Root cause.** `PROJECTION_PAGE_SIZE` capped the projection at 20 records, and the page said
nothing about the cap while displaying a much higher projection version.

**Fix.** The projection now carries a real `totalCount` from a Firestore count aggregation over
the owner-scoped query, and the page renders "Showing the N most recent of M stored checks"
whenever the list is partial. `PROJECTION_PAGE_SIZE` moved into the shared contract so the
client, server, and tests all read one value.

**Files.** `Builder/src/shared/contract.ts`, `Builder/src/server/foundation/foundation-checks.ts`,
`Builder/src/client/main.ts`.

**Tests.** `P0-QA-006: a partial list says how many records exist`.

### P0-QA-007 — A connection stalls after the server rejects an oversized request body — FIXED

**Root cause.** `readJsonBody` threw as soon as the accumulated body passed the 8 KB limit and
the handler answered 400, but the remainder of the upload was never read. The unread bytes sat
in the socket buffer and were then parsed as the start of the next request on that keep-alive
connection, so the following request received no response until the client timed out.

**Fix.** Oversize is now a distinct `PayloadTooLargeError`, answered with `413` and
`Connection: close`, after which the request stream is destroyed. The declared
`Content-Length` is also checked before any body is read, so an over-large upload is refused
immediately rather than after 8 KB. The client contract gained a `PAYLOAD_TOO_LARGE` code with
a player-readable message.

**Files.** `Builder/src/server/http/server.ts`, `Builder/src/shared/contract.ts`.

**Tests.** `P0-QA-007: an oversized body is refused without stalling the connection` reproduces
QA's exact setup — one keep-alive agent with `maxSockets: 1`, a ~200 KB body, then a follow-up
request on the same connection — and asserts the follow-up is answered rather than timing out.

### P0-QA-008 — No CSP, `X-Frame-Options`, or `Referrer-Policy` on the HTML document — FIXED

**Root cause.** Only `X-Content-Type-Options` was set. QA is right that this is defence in
depth rather than a live hole: no injection was found, and escaping is applied to every
interpolated value. It is still cheap to close, and the page does assemble HTML strings around
stored player-supplied text.

**Fix.** Every server response now carries a restrictive `Content-Security-Policy`
(`default-src 'self'`, no inline script or style, `frame-ancestors 'none'`, `object-src 'none'`,
`base-uri 'none'`, `form-action 'none'`), plus `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, and the existing `nosniff`. The one inline `style` attribute in
the client was replaced with a class so the policy needs no `unsafe-inline`.

**Files.** `Builder/src/server/http/server.ts`, `Builder/src/client/main.ts`,
`Builder/src/client/styles.css`.

**Tests.** `P0-QA-008: server responses carry their hardening headers`.

## Test-suite corrections

Two of the new regression tests initially failed for reasons in the tests rather than the
product, and both were corrected rather than weakened:

- The truncation test read the record list immediately after `page.reload()`, before the
  projection request completed. It now waits on the truncation notice first. The underlying
  behavior was correct on the first run, as the captured page snapshot shows.
- The focus test exposed the `disabled`-attribute half of P0-QA-005, which was then fixed in the
  product rather than worked around in the test.

## Status

All eight findings are `FIXED` with passing evidence against a newly frozen candidate. None are
`NOT_REPRODUCED`, `BLOCKED`, or `REQUIRES_PRODUCT_DECISION`. The replacement candidate is
returned to QA for retest; QA alone decides whether these findings close.
