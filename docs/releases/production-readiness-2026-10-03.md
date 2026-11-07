# Production hardening and recovery verification — October 3, 2026

This records the current pass. Earlier release notes describe their own dates;
their statements about missing migrations or unperformed backups are historical.

## Reviewed changes

- Donor portal payment creation and recurring-gift increases fail closed when
  Giving permissions cannot be read. Viewing, pausing, and cancellation remain
  available. Sign-out confirms server-side revocation before removing the cookie;
  an unsuccessful revocation presents a retry message.
- A broadcast reserves the church's unique active session before relay cleanup
  or provider provisioning. An uncertain start keeps the claim until an operator
  explicitly ends it, preventing an automatic second provider setup.
- Simulated playback resumes its handoff for the existing session after signing
  or database failures. Migration **0151** stores signed source URLs in a private
  service-only table, separate from artwork, with durable completion markers.
  Scheduled and relay polling failures return non-success responses.
- Operations monitoring checks 19 failed, overdue, or stalled queue conditions
  using counts only. Migration **0152** provides private durable alert claims,
  delivery retries, and incident deduplication. A 15-minute cron sends to the
  existing internal support recipients. An authenticated test request cannot
  override its recipients. Provider acceptance is distinct from inbox delivery.

## Current production recovery evidence

The owner explicitly approved a read-only production backup and private local
restore. The database archive restored into a separate Supabase PostgreSQL 17
container with **no network access or exposed ports**. Aggregate church, member,
announcement, donation, and Storage object counts matched the source inventory;
all 129 existing public tables with row-level security retained it.

All **438 uploaded files (694,578,320 bytes)** were downloaded, checksum-verified,
copied into a separate private local restore directory, and verified again.
Every restored file matched its database bucket/object identity and byte count.
Customer rows, filenames, credentials, and recipient addresses are excluded from
this report and Git. The archives and restore manifest remain in private,
Git-ignored directories on the owner's machine.

Both proposed migrations applied successfully to this restored production copy.
Existing aggregate counts remained unchanged. The two new tables and alert
functions denied browser access; the public row-level-security table count rose
from 129 to 131 as expected.

At **05:48 UTC**, the new read-only health probes succeeded against production:
all 19 reported zero failed or overdue jobs. This is a point-in-time observation.

## Local release checks

`pnpm ci:verify` passed: lint (existing warnings, no errors), TypeScript, generated
contract/token/localization checks, all **1,991 application tests**, migration
baseline verification, secret scan, and the production build. All **136 migrations
and 67 database tests** passed on a fresh disposable PostgreSQL 17 server. This
includes real database contention, alert retries/cooldown, tenant isolation, and
private-table/function permissions. Relay shell syntax and whitespace checks also
passed. The temporary restore container and test server were removed or stopped
after verification; private backup files remain.

Final integration inspection made the simulated-handoff foreign-key relationship
explicit in its API query, avoiding an ambiguous join between the event and tenant
constraints. The seven recovery/cron tests, TypeScript, and focused lint were
checked again for that final query change.

## Rollout and remaining verification

Apply **0151** outside a simulated-service window to let in-flight legacy jobs finish
before the private handoff takes over. The web code continues to use the legacy
queue until that migration is visible. The operations cron stays quiet until
**0152** makes its durable alert claim available. Update
`infra/stream-relay/poll-simulated.sh` on the relay after the web deployment.
The owner approved monitoring configuration and one test notification to existing
recipients. Actual test delivery awaits rollout: the sensitive recipient setting
is unavailable to local tooling, so the deployed route must use it directly.

The backup exercise proves logical database recovery and reconstruction of the
uploaded bytes. It does not prove a Supabase physical restore, file uploads through
a fresh Storage API, an independent encrypted offsite archive, or agreed recovery
time/data-loss targets. Queue monitoring also needs an independent uptime monitor
to detect an unavailable application or missed cron invocation. Real provider
streaming and device behavior require controlled live verification.

Do not treat these local fixes or the successful restore as an unconditional
production-readiness declaration.
