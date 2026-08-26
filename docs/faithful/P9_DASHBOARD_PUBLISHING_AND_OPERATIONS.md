# Prompt 9 — Dashboard Publishing and Operations

*How a pastor puts a service in front of a congregation's phones, how they take
it back, and what an operator needs to run it.*

---

## 1. Where it lives

**Dashboard → Live streaming → Library**, above the media list.

The panel is deliberately next to the recordings it publishes rather than on a
page of its own: publishing is something a staff member does *while looking at a
service*, not a separate administrative errand.

---

## 2. What a staff member sees

Every event and recording from the last few weeks, newest first, each with a
state:

| Badge | Meaning | Publishable |
| --- | --- | --- |
| **Not in Faithful** | the default for everything | yes |
| **Scheduled** | published, and its start is still ahead | yes |
| **Live now** | on air, with an encoder actually attached | yes |
| **Waiting for recording** | the service ended; nothing has landed | no |
| **Processing** | the file is still being written | **no** |
| **Ready to publish** | a playable file exists, nobody has published it | yes |
| **In Faithful** | visible to the people the church chose | yes (to change) |
| **Removed from Faithful** | a staff member took it down | yes (to restore) |
| **Access revoked** | taken down *and* barred from new capabilities | yes (to restore) |
| **Cancelled** | the service never happened | no |
| **Checking the file…** | never verified, or storage could not be read | **no** |
| **Can't be played on phones** | proved unplayable on at least one platform | **no** |

More states than the database stores, because "not visible" has several very
different causes, and telling them apart is the difference between a pastor
waiting patiently and a pastor filing a bug.

The last two are the eligibility gate (`P9_MEDIA_ELIGIBILITY.md`). A recording is
publishable only once this server has proved, from the object's own bytes, that
both supported platforms can play it. **Eligibility outranks intent**: a
recording that was published and has since been proved unplayable stops saying
**In Faithful**, because it is not in Faithful — the projections stopped serving
it. Its `mobile_visibility` is untouched, so a corrected re-upload restores it
without anyone re-publishing.

The refusal names no codec, container or storage path. A pastor needs to know
whether to re-record, wait, or call someone:

> *"This recording is in a format phones can't play. It needs to be re-recorded
> or converted before it can go in the app."*

Publishing **always re-probes first**, whatever the badge said, and passes the
revision of the verdict it acted on. If a probe landed in between, the publish is
refused as stale rather than acting on a verdict that no longer holds.

---

## 3. Publishing

**Publish** opens a dialog with three decisions and nothing else:

### Who can see it

| Option | Sees it |
| --- | --- |
| Anyone using Faithful | everyone, including someone who merely found the church |
| People following this church | `following` and `joined` |
| People who have joined | `joined` only |

The same three levels Prompt 5 established for announcements, enforced by the
same rule in the same place — a `mobile_visibility` column and a filter inside
the projection function.

### Poster

Exactly four choices, validated server-side against the church's own rows:

1. the linked service's artwork;
2. the church's cover image;
3. the church's logo;
4. none — the card falls back to a typographic treatment.

**No uploader is added and no external URL is accepted.** A poster field that
takes any URL is an open redirect and an image-hotlink vector on every visitor's
phone. A value that does not match one of the church's own assets is refused
rather than stored.

### Summary (recordings only)

Optional, 2,000 characters, shown under the title. It exists because the internal
title is often "Service recording" — what the relay generated — and a church
wants to say what the service was about without renaming the file everyone on
staff recognises.

### What is deliberately not here

No speaker field and no series field, because
`stream_recordings.speaker_tags` and `series_id` already exist and are already
edited on the media detail page. Prompt 9 projects them and invents nothing.

`stream_events` has no speaker column, so a **live** card shows no speaker. That
is the honest consequence of not inventing canonical data.

---

## 4. Removing

Two buttons, and the difference matters.

### Remove

The item disappears from the app's lists and detail pages. **Anyone already
watching finishes what they are watching.** Nothing is deleted, and it can be
published again later.

> *"[Title] will disappear from the app. Anyone already watching will finish
> what they are watching. Nothing is deleted, and you can publish it again
> later."*

### Revoke

The item disappears **and** no further playback capability is issued — so anyone
watching right now stops within about a minute, at their next refresh.

> *"[Title] will disappear from the app, **and anyone watching it right now will
> stop within about a minute.** Use this when something is wrong, not when a
> service is simply over."*

Both confirm before acting. Revoke says explicitly what it does to someone
mid-service, because that is the fact a pastor needs in order to choose between
them.

---

## 5. Preview

**Preview what visitors see** reads through **the same projection functions the
app calls**, as an anonymous visitor.

It is deliberately not a second query shaped like the mobile one. A preview built
from a different query is a preview that can be right while the app is wrong,
which is worse than no preview at all.

It says so on the dialog: people who follow or have joined may see more.

---

## 6. History

Every publish, visibility change, removal and revocation, with who and when.

`stream_media_publication_audit` is append-only in practice: a correction is
another row, never an edit, because "it was published for three hours on Sunday"
is a question a church may need to answer long after someone took it down. A
check constraint requires exactly one target, so a row can never be ambiguous
about what it describes.

Staff read their own church's history through their own session. Writes go
through the service role from a server action that has already checked the actor
is an admin — so there is **no insert policy at all**.

---

## 7. Authorization

Publishing is **admin-only** (`requireCorrectionRights`-equivalent). Putting
something in front of a congregation's phones is a higher bar than editing a
title: the same bar as an attendance correction, and for the same reason — it is
visible to people outside the building and it is hard to un-see.

The church comes from the caller's own session, and every write carries an exact
tenant predicate, so an id from another church matches nothing rather than being
published by a guess.

---

## 8. Operations

### Configuration

Prompt 9 adds **no new environment variable.** Playback signing derives its
sub-key from `STREAM_PLAYBACK_SECRET`, which is already required in production
(`lib/env/production.ts`).

If it is unset or a placeholder, the panel says so — without naming the variable:

> *"Publishing to Faithful isn't set up on this FaithForm installation yet. Ask
> whoever runs it to finish the setup — the steps are in the deployment
> runbook."*

A pastor is not the person who edits an environment variable, and naming one on
screen is both unhelpful and one more place a deployment detail travels to a
browser.

### Applying migrations 0060, 0061 and 0062

Additive: columns on two existing tables, one new audit table, two triggers, five
projection functions (0060), then nine eligibility columns, a check constraint
and the gated projections (0061). **Migrations 0055–0059 are untouched.**

```bash
createdb faithful_rehearsal
psql faithful_rehearsal -f tests/database/fixtures/bootstrap.sql
for n in 0055 0056 0057 0058 0059 0060 0061 0062; do
  psql faithful_rehearsal -f supabase/migrations/${n}_*.sql
done

FAITHFUL_TEST_DATABASE_URL=postgres://…/faithful_rehearsal pnpm test:concurrency
```

Expect `ℹ pass 130`. Use a **fresh database each run** — migration 0055 uses
`create policy`, which has no `if not exists` form, so a second application
against the same database fails.

**0062 does the same thing again, deliberately.** It sets every `mobile_playable`
back to false before adding the constraint that requires an object identity: a
verdict taken before identities existed is not evidence about the object that is
there now. The operational advice below applies unchanged — open the media
library, and publishing re-probes on the spot.

**0061 hides recordings that are currently published.** `mobile_playable`
defaults to false, so every recording already in Faithful disappears from the
app until a probe proves it. That is deliberate — those rows were published
before anything checked they could be played — but it is visible to a
congregation, so on a live church do it when someone is available to open the
media library, which verifies the newest rows on sight, eight per page load.
Publishing is unaffected: it probes on the spot. Nothing has to be re-published
by hand.

**Applying the migration publishes nothing.** `mobile_visibility` defaults to
`'none'` on both tables, so every existing event and every existing recording —
including everything already in the media library — stays invisible until a human
acts.

### Rolling back

There is nothing to roll back that affects visitors: setting every
`mobile_visibility` back to `'none'` makes the app show nothing, and the columns
are inert. The tables and functions can be left in place.

```sql
-- The panic button. Every church, every item, invisible.
update public.stream_events     set mobile_visibility = 'none';
update public.stream_recordings set mobile_visibility = 'none';
```

Do **not** roll back by setting `mobile_playable = true` across the table to
restore the old behaviour. The check constraint refuses it, which is the point:
the flag cannot exist without the evidence.

### View counts

Faithful's plays are recorded through the **existing** `media_views` mechanism
with `source = 'app'`, which 0047 already permits. The viewer key is a random
value the install generates and is never derived from an account, exactly as the
website's is. No person-level viewing analytics is added, and none should be.

---

## 9. What to check when something is wrong

| Symptom | Likely cause |
| --- | --- |
| The panel says publishing isn't set up | `STREAM_PLAYBACK_SECRET` is unset, short, or still `replace-me` |
| A recording will not publish | it is still `processing` — no playable file exists yet |
| A service says "Waiting for recording" and stays there | the relay never called `recording-complete`, or the upload failed its existence check |
| A published service does not appear as live | the event is `live` but no session has `ingest_started_at` — the encoder is not attached |
| One visitor sees nothing, everyone else is fine | the item was published to followers or members and that person has neither |
| Everyone sees "no longer available" mid-service | someone pressed **Revoke** |
| A recording says **Can't be played on phones** | its format is not one both platforms can play — usually HEVC or Matroska from a changed encoder setting. `P9_MEDIA_ELIGIBILITY.md` §7 |
| A recording says **Checking the file…** and stays there | storage could not be read. It is retried; a verdict is never guessed from a failure |
| A recording that was in Faithful vanished from the app | it was re-probed and is no longer playable. The church's intent is intact — fix the file and it returns by itself |
| **Publish** returned "check the file again" | a re-probe landed while the page was open. Reload and publish again |
| **Publish** says the file changed since it was checked | someone re-ran an upload from the streaming box. Wait for the re-probe and publish again — the recording is bound to specific bytes, not to a path |
| A recording vanished right after a re-upload | the same thing, working. It returns by itself once the new file verifies |
