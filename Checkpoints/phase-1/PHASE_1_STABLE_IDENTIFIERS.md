---
recordType: phase_stable_identifiers
phase: phase-1
documentVersion: 1
blueprintVersion: ALPHA_3_V1
authoredAt: 2026-08-14T18:00:00Z
---

# Phase 1 stable identifiers

Blueprint ownership: Section 25 Phase 1 build scope and Section 1.12.4 (no speculative
placeholders). This inventory locks the identifiers Phase 1 genuinely produces and consumes.
Later phases **extend** these contracts; they must not discover that ownership or persistence
was temporary.

Cross-reference: `PHASE_1_IDENTITY_AND_OWNERSHIP_CONTRACT.md` §7.

## Inventory

Each row must have a producer, consumer, authorization rule, and failure behavior. Rows without
all four are prohibited.

| Identifier | Producer | Consumer | Authorization | Failure behavior |
| --- | --- | --- | --- | --- |
| `accountId` | Development identity mint (`/api/identity/enter`) | Every authenticated write/read; ownership key on characters, seats, memberships | Verified session cookie → server-resolved accountId; never client-asserted ownership | Unauthenticated → `NOT_AUTHENTICATED`; foreign ownership looks missing (`NOT_FOUND`) |
| `ownerAccountId` | Character create / seat create (copied from session accountId) | Character vault, seat binding, ownership checks | Must equal verified accountId on every sensitive character/seat op | Foreign characterId → `NOT_FOUND` (no leak) |
| `characterId` | Server UUID on character commit | Vault, sheet, seat binding | Owner-scoped queries only | Missing/foreign → `NOT_FOUND` |
| `campaignId` | Server UUID on campaign create | Campaign detail, settings, dock, invites, seats | Membership required; non-members see missing campaign | Non-member → `CampaignNotFoundError` / 404 |
| `membershipId` | Server UUID on create/accept invite | Membership lists, settings owner checks | Active membership document for (campaignId, accountId) | Absent membership → campaign looks missing |
| `seatId` | Server UUID on seat create | Campaign detail seat projection | Owner account must own seated character; one seat per account per campaign | Already seated → `ALREADY_SEATED`; foreign character → 404 |
| `deviceSessionId` | Client-supplied binding token stored on seat; identity session continuity | Seat record; later command/reconnect plumbing | Bound at seat creation to verified account | Seat ops reject mismatched ownership; Phase 1 does not yet enforce reconnect replay |
| `inviteCode` | Server-minted invite document id | Invite preview/accept routes | Preview is bounded; accept requires auth and open invite | Expired/revoked/unknown → invitation unavailable |
| `directorAvatarKey` | Deterministic `identity__personality` at create | Campaign projection continuity for later art | Locked with Director config; not editable after create | PATCH identity/personality → `DIRECTOR_CONFIG_LOCKED` |
| `rulesVersion` | Character rules module constant stamped on drafts/characters | Character projections; later engine versioning | Server-authored only | Clients cannot supply an alternate rules version |
| `requestId` | Client-generated idempotency key on foundation writes | Foundation-check accept path | Session-authenticated; duplicate requestId returns prior commit | Malformed body → `BAD_REQUEST` |
| `projectionVersion` | Server increment on accepted canonical foundation write | Diagnostics projection UI | Server-authored only | Stale client display refreshes from server; client cannot invent versions |
| `lastAcknowledgedEventSequence` | Seat create default `0` | Seat projection (event-ack stub for later command/event core) | Seat owner only | Phase 1 has no event stream yet; field persists for Phase 2 extension without schema break |
| `campaignSettings` doc id (`campaignId`) | Seeded on campaign create | Settings GET/PUT; invite content-profile summary | Members read; owner writes | Non-owner PUT looks missing; validation → `BAD_REQUEST` with message |
| `accountSettings` doc id (`accountId`) | Ensured on first read/update | Account presentation (reducedMotion) | Session account only | Unauthenticated refused; invalid body → `BAD_REQUEST` |
| `entryId` / `messageId` | Server UUID on Chronicle append / Party Chat post | Dock feeds | Chronicle: server-only append; Party Chat: members post | Players cannot POST Chronicle; foreign campaign chat → missing |

## Explicitly not Phase 1 identifiers

Absent on purpose (no stub fields): map coordinate schemas, fog masks, command/event envelopes
beyond the seat ack stub, Timing Authority tokens, AI Director conversation ids, Google subject
ids, Admin role ids, speech provider voice ids.

## Verification

- Architecture conformance scan continues to enforce the single ownership key and collection registry.
- Reentry journey and smoke spine campaign segment prove `accountId` / `characterId` / `campaignId` /
  membership / seat / settings survive leave and return.
- Unit inventory test: `tests/unit/stable-identifiers.test.mjs`.
