---
recordType: architecture_contract
phase: phase-1
owner: Builder
status: BINDING
blueprintVersion: ALPHA_3_V1
blueprintSourceHash: 09d91f49c336
enforcedBy: Builder/tools/certification/architecture-conformance.mjs
authoredAt: 2026-08-12T18:30:00Z
---

# Phase 1 identity, ownership, and persistence contract

Phase 1 is built in slices. This record fixes the account model **before** those slices start, so
character creation, campaigns, seats, and settings all extend one contract instead of each
inventing an account concept that later has to be unpicked.

Six of these rules are enforced mechanically by `npm run scan:architecture`, which runs inside the
certification suite. The rest are stated here because they govern design decisions a scanner
cannot see. Where a rule is enforced, the rule id is named.

## 1. One account identifier

There is exactly one ownership key: **`accountId`**, the stable internal identifier the server
mints. Nothing else is identity — not an email, display name, device, cookie, campaign role,
invitation code, host status, or anything the client sends.

Stored records name their owner with **`ownerAccountId`**. The authenticated caller is
**`accountId`**. No feature introduces `userId`, `ownerId`, `playerId`, `ownerUid`, `accountID`,
`user_id`, or `owner_id`.

> Enforced: `single_ownership_key` (all of `src/`).

Section 1.2 defines the character owner as the authenticated account identifier, and Section 7.7
requires the server to resolve ownership from the verified authentication context on every
sensitive operation.

## 2. One identity module

`src/server/identity/` is the only place that mints an account, generates session material, or
compares session material. Every other module receives an already-resolved account and never
re-derives one.

> Enforced: `session_primitives_confined_to_identity_module` (`createUser`, `randomBytes`,
> `timingSafeEqual` outside `src/server/identity/`), and
> `session_store_confined_to_identity_module` (the session collection outside that module).

Phase 1 continues to use the Phase 0 Development Test Identity. Google Sign-In and the Admin
panel are **Phase 4** work; Section 12 states explicitly that Phase 1 must not advance public
Google authentication merely to create administration. Phase 1 therefore adds no second
identity provider, no password, and no login form beyond the existing development route.

## 3. The client is never an authority

The browser submits intent and renders what the server returns. It does not decide who anyone is,
what they own, or what they may do.

- No server module or admin SDK is imported into `src/client/`.
  > Enforced: `client_must_not_import_server_or_admin_sdk`.
- No `document.cookie`, `localStorage`, `sessionStorage`, or `indexedDB` in `src/client/`.
  > Enforced: `client_must_not_hold_identity_or_canonical_state`.

Section 8 is explicit: character ownership, campaign membership, seat authorization, and game
state must never depend on local storage; clearing browser data may lose preferences but can
never erase or transfer game state. When Phase 1 eventually wants a genuine preference in browser
storage, it must be named as a preference, must be non-authoritative, and must be introduced with
a deliberate amendment to this contract rather than by quietly relaxing the rule.

A client-supplied identifier is a lookup request, never an assertion. The server re-resolves it
under its own authorization.

## 4. One persistence registry

Every Firestore collection is declared in `COLLECTIONS` in `src/server/persistence/`. No module
opens a collection by string literal, because storage no other module knows about is storage the
ownership queries and security rules do not guard.

> Enforced: `collections_come_from_the_registry`.

## 5. Ownership is enforced by the query, not by the caller

An owner-scoped read filters on `ownerAccountId` server-side. It never fetches broadly and then
filters, and it never trusts a client-supplied owner. This is how Phase 0's foundation checks
already work, and character, campaign, and seat reads must follow the same shape.

Campaign membership is a separate authorization from character ownership. Section 7.7 is blunt
about it: hosting a campaign grants no ownership or control of another player's character, and
Section 1.5.10 prohibits trusted-proxy, co-pilot, loan, and host-takeover modes entirely.

## 6. Seats bind, they do not own

A seat is a server-created binding among an authenticated account, a campaign, a character, a
role, and a device session. Per Section 7.7.2 it carries a seat identifier, owner account
identifier, campaign identifier, character identifier, role and permitted actions, device-session
identifier, lifecycle timestamps, and last acknowledged event sequence.

Entering a campaign requires a server-created seat, and the player may select only a character
whose `ownerAccountId` equals the verified `accountId`. Phase 1 proves membership and ownership
persistence; it does not build the realtime table, which is Phase 2.

## 7. Stable identifiers only, no speculative schema

Phase 1 establishes only the identifiers later phases genuinely need: account, character,
campaign, membership, seat, settings, and a rules-version reference. It does **not** design the
Phase 2 tactical schema or the Phase 3 rules schema in advance.

Section 1.12.4 makes the reason concrete: an interface, schema field, endpoint, or event type
that exists without its producer, consumer, authorization, and failure behavior is a prohibited
placeholder. A field with no writer and no reader is not forward-thinking, it is dead weight that
certification will reject.

Later phases **extend** these contracts. They must not discover that the ownership, persistence,
or settings model was temporary.

## 8. Nothing pretends to be the AI Director

Campaign creation persists a real Veyra-or-Garrick choice plus one personality and the derived
avatar key, and locks them against ordinary post-creation editing. That is genuine persistent
configuration for a table the AI runs **later**. Phase 1 exposes no Address-the-Director response
control and no other simulated AI behavior, and any showcase of the flow must say plainly that it
is configuration for the later AI-enabled table.

## Amending this contract

A slice that believes it needs an exception stops and amends this record with the reason, rather
than working around the scanner. Weakening a rule silently — deleting it, broadening its scope, or
excluding a directory — is the exact drift the scan exists to catch, and it is visible in the diff.
