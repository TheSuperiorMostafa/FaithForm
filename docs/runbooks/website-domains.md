# Church website domains

FaithForm saves the address, its ownership reservation, and background work before
contacting Vercel. The church can leave the page while setup continues. Connecting
an address and publishing a website remain separate actions.

## Production configuration

Set these on the intended production Vercel project and redeploy. Keep credentials
in the secret manager and server environment, never church settings or browser code.
The application's existing Supabase URL and server credentials are also required.

| Setting | Requirement |
| --- | --- |
| `VERCEL_API_TOKEN` | Required for automated hosting. Use a dedicated, expiring access token scoped to the owning Vercel account/team; its owner must be authorized to manage this project's domains. An integration token needs both `project` and `domain` write permissions. |
| `VERCEL_PROJECT_ID` | Required with the token. Use the ID of the production project that serves church sites; a staging project must never manage production domains. |
| `VERCEL_TEAM_ID` | Set for a team-owned project. Optional for personal-account resources; a token scoped to another team will fail. |
| `CRON_SECRET` | Required for `GET /api/sites/domains/reconcile`. Vercel sends `Authorization: Bearer <CRON_SECRET>` to production cron invocations. Update the secret and redeploy when rotating it. |
| `DOMAIN_PROBE_SECRET` | Optional dedicated HMAC secret; at least 32 random bytes recommended. Worker and middleware must use the same value. Falls back to `SUPABASE_SECRET_KEY`, then `SUPABASE_SERVICE_ROLE_KEY`. Redeploy after rotation. |
| `SITE_DNS_A_RECORD`, `SITE_DNS_CNAME_TARGET` | Optional guided-setup fallbacks. Prefer the project's exact Vercel recommendations; check them before changing these defaults. |
| `NEXT_PUBLIC_SITE_ROOT_HOST` | Optional free church subdomain routing. Custom domains do not require it; reserved platform hosts remain protected when it is unset. |

`/admin/domains` reports missing automation settings without revealing token values.
Configuration presence does not prove that a token has valid access. Check the first
job after any credential, team, project, or deployment change.

## Church and operator workflow

1. A church admin opens `/dashboard/website/domain` and connects an address they own.
   Reservation is atomic and exclusive across churches; repeated submissions reuse
   existing work. A request to buy a new address stays an operator request, without
   silently purchasing a domain or creating a public route.
2. A registrable root such as `example.co.uk` reserves the root and `www` together;
   entering `www.example.co.uk` chooses the same root. Vercel sends `www` visitors
   to the root with a permanent 308 redirect. Other subdomains connect individually.
   Public suffix detection uses pinned `tldts` with private suffix support.
3. With automation configured, the worker registers the domains on the project,
   retrieves project-specific A/CNAME records, and obtains any required TXT
   ownership challenge. After DNS changes it explicitly asks Vercel to verify.
   Ownership confirmation, DNS configuration, and working HTTPS are separate gates.
4. The church copies the displayed records or hands the prepared instructions to
   its IT contact. Change only the requested website records; preserve mail records.
   FaithForm does not have universal access to registrar DNS. Registrar API or
   Domain Connect integration is **not implemented**.
5. The worker checks valid public HTTPS and the expected church destination before
   activating routing. The main and `www` setup is complete only when both pass.
   Signed probes can check a reserved address; they do not grant access to drafts.
6. The church reviews and publishes its saved website separately. A pending
   replacement does not displace an existing working primary address.

Without Vercel credentials, requests and guidance still work. An operator must add
the hostname and intended redirect to the correct Vercel production project using
its Domains settings, check the actual recommended DNS values, and let FaithForm's
HTTPS check finish. The admin connection check schedules work; it cannot mark an
unchecked domain live by assertion.

## Background checks and troubleshooting

`vercel.json` schedules reconciliation every two minutes. The route has a 120-second
limit; the worker starts at most four batches of two jobs and stops starting batches
after 55 seconds. Jobs have a two-minute lease and completions require the matching,
unexpired lease. Crashed work becomes claimable after expiry.

Transient failures use exponential backoff from about one minute, with deterministic
jitter, up to about one hour. Provider retry hints can extend this, bounded at 24
hours. Ready connections are rechecked after six hours. Permanent provider errors
pause scheduling (`available_at IS NULL`) for operator attention; credentials or
conflicts must be corrected before resuming. Check again requests have a 30-second
server cooldown, preserve an outstanding rate-limit delay, and do not bypass an
active lease or verification gates.

| Symptom | Operator action |
| --- | --- |
| Ownership step | Copy every displayed TXT record exactly. A Vercel configuration 403 accompanied by an ownership challenge is pending verification, not automatically a bad token. |
| `unauthorized` | Check token expiry, owning team, project access, and deployment environment; rotate/redeploy as needed, then resume the check. |
| `conflict` / `invalid` | Confirm project membership, production assignment, hostname, and redirect. Resolve the conflict before resuming; do not delete another tenant's claim. |
| DNS step | Compare registrar records with this project's recommendations. Check both root and `www`, conflicting A/AAAA/CNAME entries, and propagation. |
| HTTPS / wrong website | Confirm the certificate, production deployment, expected church, and exact `www` redirect. Correct restrictive CAA or proxy settings with the DNS owner as appropriate. Never disable TLS verification to force readiness. |
| Jobs do not advance | Confirm production cron invocations, bearer authentication, migration application, due times, and stale leases. An authenticated 200 can include deferred jobs; inspect per-job state. |

Use `/admin/domains` for triage. For a deliberately selected database target,
this read-only query shows operational state without credentials or contact details:

```sql
SELECT d.id, d.hostname, d.status, j.operation, j.phase, j.last_error_code,
       j.checked_at, j.available_at, j.lease_until, j.attempts
FROM public.site_domains d
JOIN public.site_domain_jobs j ON j.domain_id = d.id
WHERE d.church_id = '<church UUID>'::uuid
ORDER BY d.hostname;
```

After fixing the cause, open the church's Website panel in the control center and
choose **Re-check** or **Verify connection** to resume the existing job. The same
check action can resume a paused disconnect; it retains its removal operation and
hostname reservation. Never recreate it as a connection or clear its lease by hand.
Inspect `site_domain_setup_events` for phase and disconnect history.
Monitor paused/attention jobs and oldest overdue work, not only endpoint uptime.
At the current bounded batch size, sustained backlog needs an explicit capacity
review before increasing cron frequency, concurrency, or provider traffic.

## Disconnecting and ownership safety

Removal stops database-backed public routing and queues provider removal; an
existing middleware cache entry can persist for up to 30 seconds. Removing a main
address also disconnects its managed `www` companion. The claim remains reserved
until Vercel removal succeeds, then a fenced completion deletes the row. A failed
or paused removal must not release the claim early. In-flight connect work is
invalidated and removal waits out its previous lease before provider cleanup.

Temporary provider, DNS, or probe outages preserve previously verified routing.
Pending mappings are excluded from ordinary visitor lookups. Probes reject private
IPv4/IPv6 results, pin a checked public address, retain TLS validation, and do not
follow redirects; only the expected paired `www` redirect is accepted. Proofs are
short-lived and bound to the hostname and expected church.

## Rollout and backout

1. Select the staging database/project explicitly. Apply migration
   `0166_site_domain_onboarding.sql`, configure isolated credentials, and deploy
   the matching application. Never infer a database target from available keys.
2. Exercise an owned test root and `www`: save/retry, ownership TXT when applicable,
   DNS pending, HTTPS readiness, draft privacy, publish, replacement, and removal.
   Check cron authentication and a recoverable provider failure. Verify that the
   existing church site remains reachable during a failed check.
3. Apply the reviewed migration to the explicitly selected production database,
   then deploy the matching application/environment. Migration backfill creates
   jobs without changing existing routing, canonical addresses, or publication.
   Watch initial jobs, backlog, paused failures, and both hostnames on a pilot.
4. For incident containment, disable only this reconciliation cron and stop manual
   triggers while preserving working routes and reservations. Removing the token
   alone is not a full worker stop: guided checks can still run.
5. Back out to a compatible application release that preserves live/verified tenant
   filtering. Leave additive job/event data in place for investigation; do not
   drop claims, reset verified domains, or use older manual activation paths as a
   shortcut. Re-enable checks after the cause is corrected and verify the pilot.

## Primary references

- [Vercel API authentication and team scope](https://vercel.com/docs/rest-api)
  and [integration project/domain permissions](https://vercel.com/docs/integrations/create-integration/vercel-api-integrations).
- [Add project domain](https://vercel.com/docs/rest-api/projects/add-a-domain-to-a-project),
  [verify ownership](https://vercel.com/docs/rest-api/projects/verify-project-domain),
  [update redirects](https://vercel.com/docs/rest-api/projects/update-a-project-domain),
  and [project-specific DNS configuration](https://vercel.com/docs/rest-api/domains/get-a-domain-s-configuration).
- [Vercel cron authentication and secret rotation](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
  for address validation, DNS rebinding, and redirect controls.
- [tldts public/private suffix handling](https://github.com/remusao/tldts#readme).
