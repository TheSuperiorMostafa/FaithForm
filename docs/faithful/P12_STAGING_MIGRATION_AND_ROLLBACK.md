# Prompt 12 — Staging, Migrations, and Rollback

*How to move the schema forward, what each migration does to a live app, and how
to get back.*

---

## 1. The chain

Nine Faithful migrations sit on top of the pre-existing schema:

| | What it adds | What it does to a live app |
| --- | --- | --- |
| 0055–0059 | attendance authority, batching, reporting, detections, check-in sessions | nothing visible; attendance was not reachable |
| 0060 | media publication columns and projections | nothing appears — `mobile_visibility` defaults to `none` |
| 0061 | the mobile-playability gate | **every already-published recording disappears** until re-probed |
| 0062 | codec configuration + object identity | **the same again**, deliberately |
| 0063 | giving publication, donor links, donation attempts | nothing appears — funds default to `none` |

Two of those hide content that was visible. That is the intended behaviour of
both — a verdict taken before the gate existed is not evidence about the object
that is there now — and it is visible to a congregation, so read
`P9_MEDIA_ELIGIBILITY.md` §5 before applying either to a live church.

**None of them writes a donation, a status, or an amount.**

---

## 2. Rehearse first, every time

```bash
FAITHFUL_PG_HOST=localhost pnpm pilot:rehearse
```

Creates a fresh disposable database, applies **every** Faithful migration on
disk in order, runs the whole database suite against it, and drops it.

Two things it does that `pnpm test:concurrency` does not:

1. It applies every migration file present, not the runner's curated list — and
   **fails if a migration on disk is not in that list**, which is how a migration
   added and forgotten would otherwise reach staging unrehearsed.
2. It proves the chain applies from nothing, which is what a new environment does.

It refuses any host matching `prod`, `supabase.co`, `amazonaws` or `rds`. This
command creates and drops databases; pointing it at production would be
catastrophic and is exactly the mistake a tired person makes at 11pm.

A fresh database each run is not fussiness: migration 0055 uses `create policy`,
which has no `if not exists` form, so a second application against the same
database fails. That is a property of the chain, and rehearsing on a reused
database would hide it until staging.

---

## 3. Applying to staging

Nothing below has been done. There is no staging deployment in this repository.

1. **Rehearse locally.** `pnpm pilot:rehearse` must be green.
2. **Check readiness.** `pnpm pilot:readiness` — reports which environment values
   are present, without printing any of them.
3. **Take a backup** you have actually restored from at least once. A backup
   nobody has restored is a hope.
4. **Apply in order**, one at a time, checking after each:
   ```bash
   psql "$STAGING_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0055_*.sql
   # … through 0063
   ```
5. **Verify the projections answer**, before anyone opens an app:
   ```sql
   select count(*) from public.mobile_media_archive('some-slug', 'joined');
   select count(*) from public.mobile_giving_funds('some-slug', 'joined');
   ```
6. **Seed a smoke church** — `pnpm pilot:seed` — and walk the app against it.
7. Only then point a pilot build at staging.

---

## 4. Rollback

Every one of these migrations is **additive**. Nothing drops a table, and nothing
rewrites existing data except the two deliberate `mobile_playable` resets.

So rollback is not `down` migrations — it is **making the new surface invisible**,
which is both faster and safer than reversing DDL under load.

```sql
-- The panic button. Every church, every item, out of the apps.
update public.stream_events     set mobile_visibility = 'none';
update public.stream_recordings set mobile_visibility = 'none';
update public.giving_funds      set mobile_visibility = 'none';
```

After that: the apps show empty states, the dashboard is untouched, the website's
giving flow is untouched, and every existing donation, attendance record and
recording is exactly where it was.

### What not to do

**Do not** try to restore visibility by setting `mobile_playable = true` across
`stream_recordings`. Two check constraints refuse it, which is the point: the
flag cannot exist without the evidence. Re-probe instead.

**Do not** drop the new tables to "undo" 0063. `giving_donation_attempts` is what
makes a retry safe; dropping it mid-pilot would turn every in-flight retry into a
second charge.

---

## 5. What breaks, and what it looks like

| Symptom | Cause | Fix |
| --- | --- | --- |
| App shows "not set up" | the build has no origin | supply `FAITHFUL_API_ORIGIN` / `-Pfaithful.…Origin` |
| Every church's media vanished | 0061 or 0062 applied | open the media library; it re-probes 8 rows per load. Publishing re-probes on the spot |
| A feature has no tab | the capability is not in `ENABLED_CAPABILITIES`, or the platform has no screen | check `lib/mobile/v1/account-service.ts` |
| Giving shows no funds | the church's Stripe is not charge-enabled, or no fund is published | dashboard → Giving |
| A deep link does nothing | it failed one of the four route gates | that is the design; check the capability and the relationship |
| Sign-in does nothing | **there is no sign-in flow** | see the pilot runbook §1 |

---

## 6. What has not been done

* **No migration has been applied to any hosted database.** Every run in this
  repository was against a local disposable PostgreSQL.
* No staging environment exists, and no staging origin is configured anywhere.
* No backup has been taken or restored.
* No production rollback has been rehearsed.
