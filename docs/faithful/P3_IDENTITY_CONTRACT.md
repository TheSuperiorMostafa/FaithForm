# Prompt 3 — Identity contract

The authoritative meaning of each object, who may read it, who may mutate it,
and which transitions are legal. Prompts 4–12 must not contradict this without
an explicit superseding decision.

> **Email and phone never grant ownership of anything.** They are mutable
> contact details. They may be normalized for a human to compare, and they may
> cause a record to be *suggested* to authorized staff. No code path anywhere
> may treat possession of an email or phone number as proof of identity, as a
> merge key, or as authorization.

## Objects

### Account — `auth.users.id`

The credential. Owned by Supabase Auth.

- **Read:** the signed-in user (their own subject only).
- **Mutate:** Supabase Auth.
- Confers **nothing** on its own — no church, no role, no People record.

### Staff membership — `church_users`

FaithForm dashboard tenancy and role. Roles are `admin` and `viewer`, plus
optional per-feature grants.

- **Read:** the user themselves, and admins of that church.
- **Mutate:** admins of that church, through existing FaithForm team management.
- **No Faithful code path may write this table.** Enforced by an automated test.
- A visitor relationship never produces a row here, in any state, by any route.

### Visitor profile — `visitor_accounts`

One row per credential. Display name, lifecycle status, accepted policy
versions, consent state, communication preferences, selected church, and
`authorization_version`.

- **Read/mutate:** the owning account only (`user_id = auth.uid()`).
- Staff never read this table. What a church legitimately needs about a claimant
  is projected by function, not by policy.
- **Creation is idempotent.** Two concurrent sign-ins yield one row.

| From | Action | To |
| --- | --- | --- |
| — | first authenticated use | `active` |
| `active` | request deletion | `deletion_requested` |
| `deletion_requested` | deletion processed | `deleted` |
| `active` | deactivate | `deactivated` |

### Visitor–church relationship — `visitor_church_relationships`

Exactly one row per `(account_id, church_id)`, enforced by a unique constraint.
One account may hold relationships with many churches simultaneously and
independently.

- **Read:** the owning account, or staff of that church.
- **Mutate:** server commands only. There is no client insert or update policy.

| From | Action | Actor | To | Notes |
| --- | --- | --- | --- | --- |
| — / `left` / `following` | `follow` | visitor | `following` | Refused for `invite_only`; idempotent from `following` |
| `following` | `unfollow` | visitor | `left` | |
| — / `following` / `left` / `pending` | `request_join` | visitor | `joined` if policy `open`, else `pending` | Refused for `invite_only` |
| — / `following` / `left` / `pending` | `accept_invitation` | visitor | `joined` | Requires a consumed, valid invitation |
| `pending` | `approve` | staff | `joined` | |
| `pending` | `reject` | staff | `left` | |
| `following` / `pending` / `joined` | `leave` | visitor | `left` | |
| any | `block` | staff | `blocked` | Idempotent |
| `blocked` | `unblock` | staff | `left` | Does **not** restore membership |
| `following` / `pending` / `joined` | `revoke` | staff / system | `left` | |

**`blocked` is terminal for visitors.** It is evaluated before the transition
table, and again inside the atomic SQL invitation consumer. No replayed
invitation or repeated command can escape it.

Only `following` and `joined` grant access to what a church publishes. **No
state grants dashboard access.**

### People record — `members`

The church-owned operational person. The only People identity in the system.

- **Read/mutate:** church staff, through the existing People dashboard, unchanged.
- **Faithful may never create, merge, update, or delete a `members` row.**
  Enforced by automated test across every Faithful module.
- `members.id` is stable. Attendance already references it and must keep working.

### People claim — `visitor_people_claims`

A *request* to be recognised as an existing person. Never itself a link.

- **Read:** staff of that church. The claimant reads only their own **status**,
  through `visitor_claim_status()`, which returns no People identifier.
- **Mutate:** server commands only.
- A `self_request` may never name a target member — database constraint.
- One open claim per `(account, church)` — partial unique index.

| From | Action | Actor | To |
| --- | --- | --- | --- |
| — | open claim | visitor | `pending` |
| — | redeem claim invitation | visitor | `pending`, or `disputed` if the person is already linked |
| `pending` / `disputed` | approve **with an explicit member** | staff | `approved` + active link |
| `pending` / `disputed` | reject | staff | `rejected` |
| `pending` | flag | staff | `disputed` |
| `pending` / `disputed` | account deleted | system | `withdrawn` |

### Active People link — `visitor_people_links`

The verified answer to a claim.

- **Read:** the linked account, and staff of that church. An active link means
  that person *is* the account holder, so their own `member_id` discloses nothing
  new to them.
- **Created by exactly one code path**, `approveClaim`, which requires a staff
  member to name the record explicitly.

Two database invariants:
- at most one active link per `member_id`;
- at most one active link per `(account_id, church_id)`.

Revocation sets `is_active = false` and writes an audit row. **The `members` row
is untouched** — the person still exists and keeps their history.

### Invitation — `visitor_invitations`

Church-issued, purpose-bound, expiring, revocable, single-use by default.

- **Read/mutate:** service role only. There is no browser policy on this table
  at all.
- Only the SHA-256 **hash** is stored. The raw token is returned once, at
  creation, and is never recoverable.
- `purpose` is `join` or `people_claim`. A `people_claim` invitation may name a
  `member_id`; a `join` invitation may not — database constraint.
- Consumption is one atomic locked statement that checks purpose, revocation,
  expiry, remaining uses, and **blocked status** together.

An invitation **can never produce staff access.** It is structurally incapable of
writing `church_users`.

### Campus — `church_campuses`

Church-owned place. Additive to the existing church address.

- **Read:** staff of that church; the public sees only active, public campuses
  of a discoverable church, through a projection that **excludes the geofence
  radius**.
- **Mutate:** admins of that church, with an exact tenant predicate at the write.
- Coordinates are all-or-nothing, bounded to valid ranges; radius is 25–2000 m;
  timezone must be a real IANA zone (trigger-enforced); at most one primary
  campus per church (partial unique index).

`church_service_times.campus_id` is **nullable**. Existing church-level
schedules keep their exact current meaning.

### Selected church preference — `visitor_accounts.selected_church_id`

**A preference. Never authorization.**

Reading it must never imply the account still has a usable relationship with
that church. Every authorization decision re-derives the relationship. A
selected church that is `blocked`, `left`, or absent grants nothing.

## Church discovery

- A church is publicly listed **only** when an authorized admin explicitly
  enables it. `is_discoverable` defaults to `false`; the migration lists nobody.
- The public sees a projection function, never a `churches` row. Adding a
  private column to `churches` later cannot widen it.
- A hidden church and a nonexistent slug are **indistinguishable** — both return
  null — so the profile endpoint is not an existence oracle.
- Listings are keyset-paginated on `(name, id)` and capped at 50.

## Reader/mutator summary

| Object | Owner reads | Same-church staff read | Other-church staff | Anonymous | Client writes |
| --- | --- | --- | --- | --- | --- |
| `visitor_accounts` | ✅ | ❌ | ❌ | ❌ | own row only |
| `visitor_church_relationships` | ✅ | ✅ | ❌ | ❌ | ❌ server only |
| `visitor_people_claims` | status only, by function | ✅ | ❌ | ❌ | ❌ server only |
| `visitor_people_links` | ✅ | ✅ | ❌ | ❌ | ❌ server only |
| `visitor_invitations` | ❌ | ❌ | ❌ | ❌ | ❌ service role only |
| `church_campuses` | — | ✅ | ❌ | public projection only | ❌ server only |
| `visitor_account_requests` | ✅ | ❌ | ❌ | ❌ | ❌ server only |
| `members` | via own active link | ✅ existing dashboard | ❌ | ❌ | unchanged |

## Cache revocation

`visitor_accounts.authorization_version` increments whenever a cached
authorization decision could become wrong: blocking, leaving, link revocation,
consent withdrawal, and account deletion. Prompt 4 compares it; Prompt 3
guarantees it moves.
