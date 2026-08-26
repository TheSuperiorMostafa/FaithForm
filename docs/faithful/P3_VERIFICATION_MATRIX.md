# Prompt 3 — Verification matrix

Every completion gate, the automated test that covers it, and its status.

**Three layers are kept separate and must not be conflated:**

| Layer | Status |
| --- | --- |
| **A — Source completion** | ✅ Complete and automated |
| **B — Non-production validation** | ⛔ Pending — no authorized database was available |
| **C — Production deployment** | ⛔ Pending authorization — nothing was deployed |

A ✅ below means an automated test asserts it **in source**. It does not mean the
behaviour was observed against a database. `0053` has never been executed.

## Layer A — source completion

| # | Completion gate | Evidence | Result |
| ---: | --- | --- | --- |
| 1 | Visitor accounts are separate from `church_users` | `visitor-authorization.test.ts` — "no Faithful module ever writes church_users" | ✅ |
| 2 | Following/joining cannot grant dashboard access | `faithful-relationship-state.test.ts` — asserted for every state | ✅ |
| 3 | Visitor profile creation is idempotent | `lib/faithful/account.ts:70-110`; unique `user_id` + conflict re-read | ✅ |
| 4 | Public discovery is opt-in | `visitor-identity-migration.test.ts` — "off by default", no backfill | ✅ |
| 5 | Public projection leaks no private field | same file — asserts absence of stripe/tokens/ai_knowledge/church_users/feature_permissions | ✅ |
| 6 | Hidden churches never appear | same file — all three projections gate on `is_discoverable` | ✅ |
| 7 | Invalid slug and hidden church are indistinguishable | `visitor-authorization.test.ts` — both return null | ✅ |
| 8 | All three join policies work | `faithful-relationship-state.test.ts` — open/approval/invite_only | ✅ |
| 9 | Multi-church relationships | `unique (account_id, church_id)` per row; migration test | ✅ |
| 10 | Repeated commands are idempotent | state-machine test — follow/request_join/block | ✅ |
| 11 | Concurrent commands are safe | optimistic `.eq("state", …)` guard + unique-index re-read (`relationships.ts:154-196`) | ✅ |
| 12 | Invitations are tenant-bound, expiring, revocable, replay-safe | migration test — atomic `for update` consumer checks all five conditions | ✅ |
| 13 | Wrong-purpose invitation refused | `consume_visitor_invitation` `'wrong_purpose'` branch | ✅ |
| 14 | Blocked visitor cannot replay an invitation | state machine (blocked checked first) **and** SQL consumer `'blocked'` branch | ✅ |
| 15 | Tokens stored hashed, never raw | `visitor-authorization.test.ts`; `faithful-identity.test.ts` | ✅ |
| 16 | Email/phone never automatically link People | `visitor-authorization.test.ts` — approval path never reads normalized contacts | ✅ |
| 17 | Duplicate email/phone across unrelated People | `faithful-identity.test.ts` — asserts collision is expected | ✅ |
| 18 | Exactly one code path creates a link | `visitor-authorization.test.ts` — insert count is exactly 1 | ✅ |
| 19 | One active link per People record | partial unique index on `member_id where is_active` | ✅ |
| 20 | One active link per account per church | partial unique index on `(account_id, church_id) where is_active` | ✅ |
| 21 | Competing claims produce a dispute, not a takeover | `openDisputedClaim`; `member_already_claimed` guard | ✅ |
| 22 | Approve / reject / revoke / dispute all audited | `visitor_people_link_events` written on each | ✅ |
| 23 | Claimant never receives People data | migration test — `visitor_claim_status` has no member id; candidates not in visitor path | ✅ |
| 24 | `members.id` preserved; no create/merge/delete | `visitor-authorization.test.ts` — asserts no insert/update/delete/upsert on `members` | ✅ |
| 25 | Existing attendance rows untouched | migration test — no alter on `attendance_records`/`attendance_entries` | ✅ |
| 26 | Dependent claims fail closed | `unsupported_dependent_claim`; asserted in both test files | ✅ |
| 27 | Campus coordinates validated | schema refine + DB check constraints; `faithful-identity.test.ts` | ✅ |
| 28 | Coordinate pair all-or-nothing | `church_campuses_coordinate_pair_check` + schema refine | ✅ |
| 29 | Geofence radius bounded 25–2000 m | DB check + schema; tested at both edges | ✅ |
| 30 | Timezone validated as real IANA | trigger against `pg_timezone_names` + `Intl` check; DST fixtures tested | ✅ |
| 31 | One primary campus per church | partial unique index `where is_primary` | ✅ |
| 32 | Cross-tenant campus mutation denied | `visitor-authorization.test.ts` — exact `church_id` predicate at the write | ✅ |
| 33 | Existing service times preserved | `campus_id` nullable; migration test asserts not-null absent | ✅ |
| 34 | Export excludes church-owned data | `buildAccountExport` returns profile/relationships/link status only | ✅ |
| 35 | Deletion never destroys church history | `visitor-authorization.test.ts` — no `members`/attendance/giving access | ✅ |
| 36 | Deletion is idempotent and resumable | every step re-runnable; `.in(status, [pending, processing])` guards | ✅ |
| 37 | Duplicate deletion requests collapse | `(account_id, kind, idempotency_key)` unique + one-open partial index | ✅ |
| 38 | Blocks survive account deletion | only live states ended; asserted in test | ✅ |
| 39 | Active links revoked with audit on deletion | `link_revoked_account_deleted` event | ✅ |
| 40 | Every new table has RLS and least-privilege grants | migration test — all nine, RLS + revoke asserted individually | ✅ |
| 41 | No browser write policy on relationship/claim tables | migration test — every policy is `for select` | ✅ |
| 42 | Policy helpers not callable from a browser | migration test — execute revoked | ✅ |
| 43 | Every SECURITY DEFINER pins `search_path` | migration test, and now enforced by `verify-migration-baseline.mjs` | ✅ |
| 44 | Lists bounded and cursor-stable | `visitor-authorization.test.ts` — page probe, stable order, no `.range()` | ✅ |
| 45 | No offset pagination in discovery | migration test on comment-stripped SQL | ✅ |
| 46 | No token/contact/coordinate/People logging | `visitor-authorization.test.ts` — zero `console.*` in every module | ✅ |
| 47 | Migration ordered after `0050` | `pnpm test:migrations` + migration test | ✅ |
| 48 | Prompt 2 tests still green | 67 pre-existing tests still pass within 159 | ✅ |
| 49 | No Prompt 4–12 capability introduced | `visitor-authorization.test.ts` — forbidden-symbol sweep | ✅ |
| 50 | Church resolved server-side, never from client | `visitor-authorization.test.ts` — no `churchId` argument on any action | ✅ |

### Gate commands

| Command | Result |
| --- | --- |
| `pnpm lint` | ✅ 0 errors (44 pre-existing warnings) |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ **159/159** |
| `pnpm test:migrations` | ✅ |
| `pnpm scan:secrets` | ✅ 815 files |
| `pnpm audit:prod` | ✅ 0 unresolved high/critical |
| `pnpm build` | ✅ |
| `git diff --check` | ✅ clean |

### Migration gate — negative verification

The baseline verifier was changed, so it was proven still to bite. Five
deliberate violations were each confirmed to fail:

| Injected violation | Caught |
| --- | --- |
| Post-baseline `revoke` on `church_integrations` | ✅ |
| `disable row level security` on `members` | ✅ (two findings) |
| `create policy` on `storage.objects` | ✅ |
| `SECURITY DEFINER` without `search_path` | ✅ |
| `create policy` on a table the file does not create | ✅ |

## Layer B — non-production validation ⛔

None of the following was performed. Each requires an authorized database.

| # | Check | Blocker |
| ---: | --- | --- |
| B1 | Apply `0053` from baseline | No disposable database |
| B2 | Apply `0053` from a representative upgraded state | No non-production copy |
| B3 | Live RLS matrix — 6 principals × 9 tables | No database |
| B4 | Two-connection race on a single-use invitation | No database |
| B5 | `EXPLAIN (ANALYZE, BUFFERS)` for discovery keyset and staff listings | No representative cardinality |
| B6 | Confirm `anon` can execute the three discovery functions and sees no hidden church | No database |
| B7 | Confirm existing `attendance_entries` still resolve post-migration | No database |
| B8 | Admin UI smoke tests with two churches | No deployed environment |
| B9 | Verify partial unique indexes reject a real double approval | No database |

**Indexes in `0053` are unmeasured.** They were chosen to match exact filters and
orderings, not validated against a plan. B5 must run before production.

## Layer C — production deployment ⛔

Nothing was deployed. No production database, project, secret, or record was
read or changed.

| # | Gate | Status |
| ---: | --- | --- |
| C1 | Hosted CI pass | Not run |
| C2 | Layer B complete | Blocked |
| C3 | Product sign-off: all churches start unlisted, `approval_required` | Not obtained |
| C4 | **Legal sign-off on retention periods** | Not obtained |
| C5 | Named owner for People-claim disputes | Not assigned |
| C6 | Rollback vs forward-fix decision recorded for the deploying environment | Not made |

## Explicitly not claimed

- No compliance claim for GDPR, CCPA, or any other regime. Deletion behaviour is
  implemented and tested; **retention periods are undecided**.
- No performance claim. No query plan was measured.
- No claim that RLS behaves correctly at runtime — only that the policies,
  grants, and revocations are present in the migration source.
- No guardian, dependent, or minor support. Those paths fail closed.
