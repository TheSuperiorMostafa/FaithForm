# Prompt 3 — Visitor identity and tenancy report

Implemented at `9bdbbaf` + working tree. Migration `0053_visitor_identity.sql`.

## Executive status

| Layer | Status | Meaning |
| --- | --- | --- |
| Source implementation | Complete | Schema, RLS, grants, domain services, FaithForm administration, and tests are in the repository. |
| Local source verification | Complete | Lint, typecheck, 159 tests, migration baseline, secret scan, production dependency gate, and production build all pass. |
| Disposable database rehearsal | **Pending external access** | No authorized disposable database was available. `0053` has never been executed. |
| Non-production validation | **Pending external access** | Live RLS matrices, policy behaviour, and admin smoke tests require an approved environment. |
| Production rollout | **Pending authorization** | No production database, project, or data was changed. |

Nothing below claims a database result. Every assertion is either a source fact
with a path, or an automated test that reads source.

## Implemented schema

`supabase/migrations/0053_visitor_identity.sql` — nine new tables, two extended
tables, six functions, one trigger. All additive.

| Object | Purpose | Key invariants |
| --- | --- | --- |
| `visitor_accounts` | One profile per credential | `user_id` unique against `auth.users`; `authorization_version` for cache revocation |
| `church_campuses` | Where a church meets | `(church_id, slug)` unique; one primary per church; coordinate pair all-or-nothing; radius 25–2000 m; IANA timezone enforced by trigger |
| `visitor_church_relationships` | Follow/join state | **`unique (account_id, church_id)`** — the multi-church invariant |
| `visitor_relationship_events` | Append-only transition log | Every state change writes one row |
| `visitor_invitations` | Visitor-scoped invitations | `token_hash` unique; only a `people_claim` invitation may carry `member_id` |
| `visitor_people_claims` | A request to be recognised | A `self_request` may never name a target member; one open claim per account per church |
| `visitor_people_links` | Verified account ↔ People | One active link per `member_id`; one active link per `(account_id, church_id)` |
| `visitor_people_link_events` | Claim/link audit | Every approval, rejection, dispute, and revocation |
| `visitor_account_requests` | Export/deletion lifecycle | One open request per kind; `(account_id, kind, idempotency_key)` unique |
| `churches` *(extended)* | Discovery controls | `is_discoverable` **defaults false**; `join_policy`; `public_profile_version` |
| `church_service_times` *(extended)* | Campus attachment | `campus_id` **nullable** — no existing schedule is rewritten |

### Extended, not replaced

`churches.slug` already existed and was already unique (`0013_stripe_giving.sql:43`).
It is reused as the public handle rather than introducing a second identifier
that could disagree with it.

## Identity boundaries

Five identities stay separate, as locked by AD-002:

| Identity | Owner | Grants |
| --- | --- | --- |
| `auth.users.id` | Supabase Auth | Credential only |
| `church_users` | FaithForm | **Dashboard access.** No Faithful module writes this table — asserted by test |
| `visitor_accounts.id` | Faithful | A profile. Never dashboard access |
| `members.id` | The church | The operational person. Never created, merged, or deleted by any Faithful path |
| `giving_donors.id` | The church | Untouched by Prompt 3 |

`grantsDashboardAccess()` (`lib/faithful/relationship-state.ts:171`) is total and
always returns `false`. It exists so the invariant is stated in code, and a test
asserts it for every state.

## Visitor relationship lifecycle

States: `following`, `pending`, `joined`, `left`, `blocked`. The machine is pure
and testable (`lib/faithful/relationship-state.ts`); every write funnels through
one `applyTransition` (`lib/faithful/relationships.ts:104`).

- **Idempotent.** Re-issuing a command that already produced the current state
  returns the row and writes no second audit event.
- **Concurrency-safe.** Updates carry an optimistic `.eq("state", current.state)`
  guard; a lost race re-reads and returns the winner rather than overwriting.
- **`blocked` is terminal.** Checked *before* the transition table, so no action —
  including replaying a previously valid invitation — routes around it. The
  atomic SQL consumer refuses a blocked account too, so this holds at both layers.
- **Multi-church.** One row per `(account, church)`; leaving one church cannot
  touch another.
- **Selected church is a preference.** Stored on the profile, resolved from a
  public slug, and never consulted for authorization.

### Join policies

| Policy | Behaviour |
| --- | --- |
| `open` | `request_join` resolves directly to `joined` |
| `approval_required` | Creates `pending`; staff approve or reject |
| `invite_only` | Refuses both follow and join; only a valid invitation admits |

The policy is read from the church row at decision time, never from the request.

## People claim and link lifecycle

`claim → staff resolution → active link → revocation`, with audit at each step.

**No automatic linking.** Exactly one code path creates a link
(`approveClaim`, `lib/faithful/people-claims.ts:565`), it requires an explicit
`memberId` chosen by a staff member, and a test asserts the count is exactly one.
The approval path never reads `normalized_email` or `normalized_phone` — also
asserted.

Email and phone appear only inside `findCandidates`, which produces *suggestions
with reasons* for authorized staff of that church. A shared household phone
yields two candidates and a human decision. Candidates are never returned to
the claimant: `getClaimStatus` returns state only, and the SQL projection
`visitor_claim_status` contains no member identifier at all.

**Competing claims** are handled, not raced: the partial unique index on
`member_id where is_active` makes a double approval a database error, and
redeeming a claim invitation for an already-linked person opens a `disputed`
claim rather than taking over.

**Dependent claims fail closed.** `onBehalfOfMemberId` is accepted by the schema
so the service can refuse it with a specific `unsupported_dependent_claim` error
rather than silently reinterpreting it as a self-claim. Self-managed accounts
only, as scoped.

## Campus model

Church-owned, additive, and inert. Coordinates and `geofence_radius_m` are
stored for Prompt 6; **nothing in Prompt 3 reads a device location or evaluates
a geofence**. The radius is deliberately excluded from the public campus
projection — it is operational configuration, not public information.

Existing church-level service times keep working: `campus_id` is nullable, no
existing row is rewritten, and no address is overwritten.

## Export and deletion

The rule: an account owns its *relationship* to a church, not the church's
record of a person.

**Removed or anonymized** — display name, avatar, communication preferences,
selected church; account status becomes `deleted`; open claims are withdrawn;
active links are revoked with an audit row; live relationships end; invitations
the account accepted are revoked.

**Retained, deliberately** — the `members` row and everything on it, attendance,
giving, and the church's audit trail. A `blocked` relationship also survives, so
deleting and recreating an account cannot launder a block.

`processDeletion` is resumable: every step is safe to repeat, so an interrupted
run completes correctly on retry. A test asserts it never touches `members`,
`attendance_records`, `attendance_entries`, `giving_donations`, or `giving_donors`.

## Files and migrations changed

**Added** — `supabase/migrations/0053_visitor_identity.sql`;
`lib/faithful/` (errors, relationship-state, schemas, invitation-token, account,
discovery, relationships, staff-relationships, people-claims, campuses,
account-lifecycle, invitations); `lib/queries/faithful-settings.ts`;
`app/dashboard/settings/faithful-actions.ts`;
`app/dashboard/people/claim-actions.ts`;
`components/settings/faithful-visibility-card.tsx`;
`components/people/people-claims-panel.tsx`; four test files.

**Modified** — `app/dashboard/people/page.tsx` and
`app/dashboard/settings/page.tsx` (load the new data),
`components/settings/settings-tabs.tsx` (one new tab),
`scripts/verify-migration-baseline.mjs` (see below).

### One Prompt 2 script was changed, and made stricter

`verify-migration-baseline.mjs` previously rejected *any* post-baseline
migration containing `create policy`, `grant`, `revoke`, `enable row level
security`, or `security definer` — which would have forced Prompt 3's new tables
to ship with no RLS at all.

The check is now object-scoped rather than keyword-scoped: a later migration may
secure **only objects it creates in that same file**, and may never name a
baseline-secured object. It additionally now rejects redefining a baseline
function, disabling RLS, touching storage policies, and defining a
`SECURITY DEFINER` function without a pinned `search_path`.

This was verified by deliberate negative tests — five distinct violation classes
were each confirmed to fail the gate. No Prompt 2 test was weakened or deleted;
the suite grew from 67 to 159.

## Verification results

| Gate | Result |
| --- | --- |
| `pnpm lint` | Pass — 0 errors, 44 pre-existing warnings |
| `pnpm typecheck` | Pass |
| `pnpm test` | **159/159 pass** (was 67) |
| `pnpm test:migrations` | Pass |
| `pnpm scan:secrets` | Pass — 815 files |
| `pnpm audit:prod` | Pass — 0 unresolved high/critical |
| `pnpm build` | Pass |
| `git diff --check` | Clean |

## Remaining external work

1. **Rehearse `0053` on a disposable database**, then on a copy of a
   representative upgraded state. It has never been executed.
2. **Exercise the live RLS matrix**: account owner, staff of the same church,
   staff of another church, unauthenticated, blocked visitor, and service role,
   against each of the nine new tables.
3. **Verify `EXPLAIN (ANALYZE, BUFFERS)`** for the discovery keyset query and the
   staff claim/relationship listings at realistic cardinality. The indexes here
   were chosen to match exact filters and orderings, but no plan was measured.
4. **Smoke-test the admin surfaces** in a deployed non-production environment.

## Product and legal decisions still provisional

- **Retention periods.** Deletion anonymizes the visitor profile immediately and
  retains church-owned records. How long the anonymized row, the audit events,
  and the relationship history persist is a product and legal decision that is
  **not encoded here**. No compliance claim is made for any specific regime.
- **Whether `joined` carries ecclesial or legal meaning** — it is currently a
  product relationship only.
- **Minors and guardians.** Out of scope and failing closed. Any dependent model
  needs its own privacy review before the schema is extended.
- **Whether a church may see a claimant's display name** before approving — it
  currently can, which is what makes the queue usable.
- **Dispute escalation.** `disputed` is reachable and audited, but who arbitrates
  between two people claiming the same record is undecided.
