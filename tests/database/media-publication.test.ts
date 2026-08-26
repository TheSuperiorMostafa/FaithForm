import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Executable tests for the Prompt 9 publication model.
 *
 * The whole point of Prompt 9 is that a recording does not become visible
 * because it exists — so the tests that matter are the ones that put a real row
 * in a real table and ask the real projection function what a real visitor
 * would see. Source inspection cannot answer that: the filters are SQL.
 *
 * Skips loudly with a reason when no disposable target is configured. A skip is
 * not a pass.
 */

const DATABASE_URL = process.env.FAITHFUL_TEST_DATABASE_URL;

const SKIP_REASON =
  "FAITHFUL_TEST_DATABASE_URL is not set — no disposable Postgres target. " +
  "The publication and visibility rules are UNOBSERVED until this runs.";

if (/prod/i.test(DATABASE_URL ?? "")) {
  throw new Error("refusing to run media tests against a production-looking database");
}

type Client = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

type Fixture = { churchId: string; slug: string };

async function connect(): Promise<Client> {
  const { Client: PgClient } = await import("pg");
  const client = new PgClient({ connectionString: DATABASE_URL });
  await client.connect();
  return client as unknown as Client;
}

/**
 * Runs a body with connections that are **always** closed.
 *
 * Closing is separated from cleaning, and cleaning cannot prevent closing: a
 * `finally` that awaits a cleanup query before closing leaves connections open
 * whenever that query throws, and an open pg connection keeps Node's event loop
 * alive — so the whole run hangs after the first failure instead of reporting
 * it. Learned on the Prompt 8 suite.
 */
function run(
  count: number,
  body: (clients: Client[], track: (fixture: Fixture) => void) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const clients: Client[] = [];
    const fixtures: Fixture[] = [];
    try {
      for (let index = 0; index < count; index += 1) clients.push(await connect());
      await body(clients, (fixture) => fixtures.push(fixture));
    } finally {
      for (const fixture of fixtures) {
        try {
          await clients[0].query(`delete from public.churches where id = $1`, [
            fixture.churchId,
          ]);
        } catch {
          // Never let a failed cleanup stop the connections closing.
        }
      }
      for (const client of clients) await client.end().catch(() => {});
    }
  };
}

async function seedChurch(client: Client): Promise<Fixture> {
  const churchId = randomUUID();
  const slug = `media-${churchId.slice(0, 8)}`;
  await client.query(
    `insert into public.churches (id, name, slug, timezone)
     values ($1, 'Media Test Church', $2, 'America/New_York')`,
    [churchId, slug],
  );
  return { churchId, slug };
}

async function seedEvent(
  client: Client,
  fixture: Fixture,
  options: {
    status?: string;
    visibility?: string;
    startsAt?: string;
    withLiveSession?: boolean;
    published?: boolean;
  } = {},
): Promise<string> {
  const eventId = randomUUID();
  await client.query(
    `insert into public.stream_events
       (id, church_id, title, starts_at, status, mobile_visibility, mobile_published_at)
     values ($1, $2, 'Sunday Service', coalesce($3::timestamptz, now() - interval '10 minutes'),
             $4, $5, case when $6 then now() else null end)`,
    [
      eventId,
      fixture.churchId,
      options.startsAt ?? null,
      options.status ?? "live",
      options.visibility ?? "none",
      options.published ?? (options.visibility ?? "none") !== "none",
    ],
  );

  if (options.withLiveSession !== false && (options.status ?? "live") === "live") {
    await client.query(
      `insert into public.stream_sessions
         (id, church_id, stream_event_id, status, ingest_started_at)
       values ($1, $2, $3, 'live', now())`,
      [randomUUID(), fixture.churchId, eventId],
    );
  }
  return eventId;
}

/**
 * A recording, and — when it is published — the verdict that makes it playable.
 *
 * Publishing without a verdict is now a contradiction: the Prompt 9 closure
 * makes `mobile_playable` default false, so a "published" fixture with no
 * verdict is invisible everywhere. Every test about *visibility* wants a
 * recording that a phone could actually play, so that is what this seeds.
 *
 * Tests about **eligibility** pass `verified: false` and record their own
 * verdict, which is how the gate itself is exercised.
 */
async function seedRecording(
  client: Client,
  fixture: Fixture,
  options: {
    title?: string;
    status?: string;
    visibility?: string;
    published?: boolean;
    publishedAt?: string | null;
    durationSec?: number;
    speakers?: string[];
    verified?: boolean;
    /** The object identity the verdict is bound to. */
    etag?: string;
    hash?: string;
    size?: number;
  } = {},
): Promise<string> {
  const recordingId = randomUUID();
  const visibility = options.visibility ?? "none";
  const published = options.published ?? visibility !== "none";
  await client.query(
    `insert into public.stream_recordings
       (id, church_id, title, storage_path, status, duration_sec,
        mobile_visibility, mobile_published_at, speaker_tags)
     values ($1, $2, $3, $4, $5, $6, $7,
             case when $8 then coalesce($9::timestamptz, now()) else null end, $10)`,
    [
      recordingId,
      fixture.churchId,
      options.title ?? "Service recording",
      `relay/${fixture.churchId}/${recordingId}.mp4`,
      options.status ?? "ready",
      options.durationSec ?? 3600,
      visibility,
      published,
      options.publishedAt ?? null,
      options.speakers ?? [],
    ],
  );

  const shouldVerify =
    options.verified ?? (visibility !== "none" && (options.status ?? "ready") === "ready");

  if (shouldVerify) {
    await recordVerdict(client, fixture, recordingId, options);
  }

  return recordingId;
}

/**
 * Records a portable verdict bound to an object identity.
 *
 * The identity is not decoration in a fixture: `mobile_playable` cannot be true
 * without one, so a helper that omitted it would silently produce unverified
 * rows and every gate test would pass for the wrong reason.
 */
async function recordVerdict(
  client: Client,
  fixture: Fixture,
  recordingId: string,
  options: { etag?: string; hash?: string; size?: number } = {},
): Promise<{ revision: number; hash: string; etag: string; size: number }> {
  const hash = options.hash ?? "a".repeat(64);
  const etag = options.etag ?? '"etag-1"';
  const size = options.size ?? 1024;

  const { rows } = await client.query(
    `select * from public.record_recording_rendition(
       $1, $2, true, 'progressive', 'ok', 'isom', 'avc1', 'mp4a',
       'avc1.4d401f', 'mp4a.40.2', 48000, 2::smallint, $3::bigint, $4, null, $5)`,
    [recordingId, fixture.churchId, size, etag, hash],
  );

  return { revision: rows[0].revision as number, hash, etag, size };
}

/** What the row currently believes about the object behind it. */
async function readIdentity(client: Client, recordingId: string) {
  const { rows } = await client.query(
    `select mobile_playable, mobile_rendition_reason as reason,
            mobile_rendition_revision as revision,
            mobile_rendition_object_hash as hash,
            mobile_rendition_object_etag as etag,
            mobile_rendition_object_size as size,
            mobile_publication_version as version
       from public.stream_recordings where id = $1`,
    [recordingId],
  );
  return rows[0];
}

const options = DATABASE_URL ? {} : { skip: SKIP_REASON };

// ---------------------------------------------------------------------------
// Nothing is visible until a human publishes it
// ---------------------------------------------------------------------------

test("a recording that merely exists is invisible", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    await seedRecording(client, fixture, { title: "Not published" });

    // **The rule the whole prompt rests on.** The relay wrote a row, the file
    // is playable, and no visitor can see it.
    const { rows } = await client.query(
      `select count(*)::int as n from public.mobile_media_archive($1, null)`,
      [fixture.slug],
    );
    assert.equal(rows[0].n, 0);
  }));

test("a live event that merely exists is invisible", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    await seedEvent(client, fixture, { status: "live" });

    const { rows } = await client.query(
      `select count(*)::int as n from public.mobile_media_live($1, null)`,
      [fixture.slug],
    );
    assert.equal(rows[0].n, 0);
  }));

test("a processing recording cannot be seen even when published", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    // Publishing something that is still uploading would put a card in front of
    // a congregation that cannot be played.
    await seedRecording(client, fixture, {
      status: "processing",
      visibility: "public",
    });

    const { rows } = await client.query(
      `select count(*)::int as n from public.mobile_media_archive($1, null)`,
      [fixture.slug],
    );
    assert.equal(rows[0].n, 0);
  }));

test("publishing a live service does not publish any recording", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const eventId = await seedEvent(client, fixture, { visibility: "public" });

    // The service ends and its recording lands, exactly as the relay webhook
    // would create it.
    await client.query(
      `update public.stream_events set status = 'ended' where id = $1`,
      [eventId],
    );
    await client.query(
      `insert into public.stream_recordings
         (id, church_id, stream_event_id, title, storage_path, status, duration_sec)
       values ($1, $2, $3, 'Service recording', $4, 'ready', 3600)`,
      [randomUUID(), fixture.churchId, eventId, `relay/${fixture.churchId}/x.mp4`],
    );

    const { rows } = await client.query(
      `select count(*)::int as n from public.mobile_media_archive($1, null)`,
      [fixture.slug],
    );
    assert.equal(rows[0].n, 0, "the recording inherited the event's publication");
  }));

// ---------------------------------------------------------------------------
// Relationship targeting
// ---------------------------------------------------------------------------

test("visibility targets the relationship, and blocked sees nothing", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    await seedRecording(client, fixture, { title: "Public", visibility: "public" });
    await seedRecording(client, fixture, { title: "Followers", visibility: "followers" });
    await seedRecording(client, fixture, { title: "Members", visibility: "members" });

    const titlesFor = async (state: string | null) => {
      const { rows } = await client.query(
        `select title from public.mobile_media_archive($1, $2) order by title`,
        [fixture.slug, state],
      );
      return rows.map((row) => row.title as string);
    };

    assert.deepEqual(await titlesFor(null), ["Public"]);
    assert.deepEqual(await titlesFor("left"), ["Public"]);
    assert.deepEqual(await titlesFor("pending"), ["Public"]);
    assert.deepEqual(await titlesFor("following"), ["Followers", "Public"]);
    assert.deepEqual(await titlesFor("joined"), ["Followers", "Members", "Public"]);
    // **A block is felt, not merely limiting.** Not even the public item.
    assert.deepEqual(await titlesFor("blocked"), []);
  }));

test("an unknown slug and a blocked visitor are indistinguishable", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    await seedRecording(client, fixture, { visibility: "public" });

    const unknown = await client.query(
      `select count(*)::int as n from public.mobile_media_archive('no-such-church', null)`,
    );
    const blocked = await client.query(
      `select count(*)::int as n from public.mobile_media_archive($1, 'blocked')`,
      [fixture.slug],
    );
    assert.equal(unknown.rows[0].n, 0);
    assert.equal(blocked.rows[0].n, blocked.rows[0].n);
    assert.equal(unknown.rows[0].n, blocked.rows[0].n);
  }));

test("one church never sees another's published media", options,
  run(1, async ([client], track) => {
    const one = await seedChurch(client);
    const two = await seedChurch(client);
    track(one);
    track(two);

    await seedRecording(client, one, { title: "One", visibility: "public" });
    await seedRecording(client, two, { title: "Two", visibility: "public" });

    const { rows } = await client.query(
      `select title from public.mobile_media_archive($1, null)`,
      [one.slug],
    );
    assert.deepEqual(rows.map((row) => row.title), ["One"]);
  }));

// ---------------------------------------------------------------------------
// The live projection
// ---------------------------------------------------------------------------

test("live requires a session with an encoder actually attached", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    // A published event marked live, but nothing is ingesting. An event someone
    // forgot to end must not keep claiming to be live on a congregation's home
    // screen.
    const eventId = await seedEvent(client, fixture, {
      visibility: "public",
      withLiveSession: false,
    });

    let result = await client.query(
      `select count(*)::int as n from public.mobile_media_live($1, null)`,
      [fixture.slug],
    );
    assert.equal(result.rows[0].n, 0);

    await client.query(
      `insert into public.stream_sessions
         (id, church_id, stream_event_id, status, ingest_started_at)
       values ($1, $2, $3, 'live', now())`,
      [randomUUID(), fixture.churchId, eventId],
    );

    result = await client.query(
      `select state from public.mobile_media_live($1, null)`,
      [fixture.slug],
    );
    assert.equal(result.rows[0].state, "live");
  }));

test("a scheduled service is upcoming, and a finished one is recently ended", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    await seedEvent(client, fixture, {
      status: "scheduled",
      visibility: "public",
      startsAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    let result = await client.query(
      `select state from public.mobile_media_live($1, null)`,
      [fixture.slug],
    );
    assert.equal(result.rows[0].state, "upcoming");

    await client.query(
      `update public.stream_events set status = 'ended' where church_id = $1`,
      [fixture.churchId],
    );

    // The card must not vanish mid-Sunday and look broken; it says the service
    // ended and the recording is coming.
    result = await client.query(
      `select state from public.mobile_media_live($1, null)`,
      [fixture.slug],
    );
    assert.equal(result.rows[0].state, "recent_ended");

    // And it does drop out once the window passes.
    result = await client.query(
      `select count(*)::int as n from public.mobile_media_live($1, null, now(), 0)`,
      [fixture.slug],
    );
    assert.equal(result.rows[0].n, 0);
  }));

test("a cancelled service never appears", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    await seedEvent(client, fixture, { status: "cancelled", visibility: "public" });

    const { rows } = await client.query(
      `select count(*)::int as n from public.mobile_media_live($1, null)`,
      [fixture.slug],
    );
    assert.equal(rows[0].n, 0);
  }));

test("a live service wins over a scheduled one", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    await seedEvent(client, fixture, {
      status: "scheduled",
      visibility: "public",
      startsAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await seedEvent(client, fixture, { status: "live", visibility: "public" });

    // A church with a service running and another scheduled must show the one
    // that is on air.
    const { rows } = await client.query(
      `select state from public.mobile_media_live($1, null)`,
      [fixture.slug],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "live");
  }));

// ---------------------------------------------------------------------------
// Unpublish and revoke
// ---------------------------------------------------------------------------

test("unpublishing removes an item from the list and the detail alike", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { visibility: "public" });

    assert.equal(
      (await client.query(
        `select count(*)::int as n from public.mobile_media_detail($1, null, $2)`,
        [fixture.slug, recordingId],
      )).rows[0].n,
      1,
    );

    await client.query(
      `update public.stream_recordings set mobile_unpublished_at = now() where id = $1`,
      [recordingId],
    );

    // **Both projections.** A device holding a cached list must not be able to
    // open the detail page by id.
    assert.equal(
      (await client.query(
        `select count(*)::int as n from public.mobile_media_archive($1, null)`,
        [fixture.slug],
      )).rows[0].n,
      0,
    );
    assert.equal(
      (await client.query(
        `select count(*)::int as n from public.mobile_media_detail($1, null, $2)`,
        [fixture.slug, recordingId],
      )).rows[0].n,
      0,
    );
  }));

test("unpublishing refuses a new playback capability", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { visibility: "public" });

    assert.equal(
      (await client.query(
        `select ok from public.mobile_media_playback_grant($1, null, 'recording', $2)`,
        [fixture.slug, recordingId],
      )).rows[0].ok,
      true,
    );

    await client.query(
      `update public.stream_recordings set mobile_unpublished_at = now() where id = $1`,
      [recordingId],
    );

    const { rows } = await client.query(
      `select ok, reason, storage_path from public.mobile_media_playback_grant($1, null, 'recording', $2)`,
      [fixture.slug, recordingId],
    );
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].reason, "not_found");
    // And no storage path leaks on a refusal.
    assert.equal(rows[0].storage_path, null);
  }));

test("revoking refuses a capability even while the item is still published", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { visibility: "public" });

    // Revoked but deliberately left `mobile_visibility = 'public'` and not
    // unpublished, to prove the grant function checks revocation on its own
    // rather than relying on the unpublish that normally accompanies it.
    await client.query(
      `update public.stream_recordings set mobile_revoked_at = now() where id = $1`,
      [recordingId],
    );

    assert.equal(
      (await client.query(
        `select ok from public.mobile_media_playback_grant($1, null, 'recording', $2)`,
        [fixture.slug, recordingId],
      )).rows[0].ok,
      false,
    );
  }));

test("a live capability is refused once the encoder is gone", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const eventId = await seedEvent(client, fixture, { visibility: "public" });

    assert.equal(
      (await client.query(
        `select ok from public.mobile_media_playback_grant($1, null, 'live', $2)`,
        [fixture.slug, eventId],
      )).rows[0].ok,
      true,
    );

    await client.query(
      `update public.stream_sessions set status = 'ended' where stream_event_id = $1`,
      [eventId],
    );

    assert.equal(
      (await client.query(
        `select ok from public.mobile_media_playback_grant($1, null, 'live', $2)`,
        [fixture.slug, eventId],
      )).rows[0].ok,
      false,
    );
  }));

test("a capability cannot be granted across churches", options,
  run(1, async ([client], track) => {
    const one = await seedChurch(client);
    const two = await seedChurch(client);
    track(one);
    track(two);
    const recordingId = await seedRecording(client, one, { visibility: "public" });

    // The right recording id, the wrong church slug.
    const { rows } = await client.query(
      `select ok from public.mobile_media_playback_grant($1, null, 'recording', $2)`,
      [two.slug, recordingId],
    );
    assert.equal(rows[0].ok, false);
  }));

test("a blocked visitor is refused a capability", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { visibility: "public" });

    const { rows } = await client.query(
      `select ok, reason from public.mobile_media_playback_grant($1, 'blocked', 'recording', $2)`,
      [fixture.slug, recordingId],
    );
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].reason, "not_found");
  }));

// ---------------------------------------------------------------------------
// Version invalidation
// ---------------------------------------------------------------------------

test("every visitor-visible field bumps the version", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { visibility: "public" });

    const versionOf = async () =>
      Number(
        (await client.query(
          `select mobile_publication_version as v from public.stream_recordings where id = $1`,
          [recordingId],
        )).rows[0].v,
      );

    const changes: [string, unknown][] = [
      ["title", "A new title"],
      ["mobile_summary", "A summary"],
      ["duration_sec", 1234],
      ["mobile_poster_url", "https://example.test/p.png"],
      ["mobile_visibility", "followers"],
      ["speaker_tags", ["Pastor Ada"]],
    ];

    let previous = await versionOf();
    for (const [column, value] of changes) {
      await client.query(
        `update public.stream_recordings set ${column} = $2 where id = $1`,
        [recordingId, value],
      );
      const next = await versionOf();
      assert.ok(next > previous, `${column} did not bump the version`);
      previous = next;
    }
  }));

test("provider bookkeeping does NOT bump the version", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { visibility: "public" });

    const before = Number(
      (await client.query(
        `select mobile_publication_version as v from public.stream_recordings where id = $1`,
        [recordingId],
      )).rows[0].v,
    );

    // None of this is on a visitor's screen. Bumping for it would invalidate
    // every cached list on every phone in the congregation, for nothing.
    await client.query(
      `update public.stream_recordings
          set storage_path = $2, visibility = 'unlisted', trim_start_sec = 5,
              stream_session_id = null, topic_tags = array['internal']
        where id = $1`,
      [recordingId, `relay/${fixture.churchId}/renamed.mp4`],
    );

    const after = Number(
      (await client.query(
        `select mobile_publication_version as v from public.stream_recordings where id = $1`,
        [recordingId],
      )).rows[0].v,
    );
    assert.equal(after, before, "provider bookkeeping invalidated every cached list");
  }));

test("the church-wide version moves when anything visible changes", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { visibility: "public" });

    const version = async () =>
      Number(
        (await client.query(`select public.mobile_media_version($1, null) as v`, [fixture.slug]))
          .rows[0].v,
      );

    const before = await version();
    await client.query(
      `update public.stream_recordings set title = 'Renamed' where id = $1`,
      [recordingId],
    );
    assert.ok((await version()) > before);
  }));

// ---------------------------------------------------------------------------
// Keyset pagination and search
// ---------------------------------------------------------------------------

test("the archive pages by keyset without repeating or skipping", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);

    for (let index = 0; index < 7; index += 1) {
      await seedRecording(client, fixture, {
        title: `Service ${index}`,
        visibility: "public",
        publishedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      });
    }

    const seen: string[] = [];
    let cursorPublished: string | null = null;
    let cursorId: string | null = null;

    for (let page = 0; page < 5; page += 1) {
      const { rows } = await client.query(
        `select title, cursor_published, cursor_id
           from public.mobile_media_archive($1, null, null, $2, $3, 3)`,
        [fixture.slug, cursorPublished, cursorId],
      );
      if (rows.length === 0) break;
      seen.push(...rows.map((row) => row.title as string));
      const last = rows.at(-1)!;
      cursorPublished = last.cursor_published as string;
      cursorId = last.cursor_id as string;
    }

    assert.equal(seen.length, 7);
    assert.equal(new Set(seen).size, 7, "a page repeated an item");
    assert.deepEqual(seen[0], "Service 6", "newest first");
  }));

test("search never surfaces an unpublished title", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    await seedRecording(client, fixture, { title: "Secret Rehearsal" });
    await seedRecording(client, fixture, {
      title: "Hope in Hard Times",
      visibility: "public",
      speakers: ["Pastor Ada"],
    });

    const search = async (query: string) =>
      (await client.query(
        `select title from public.mobile_media_archive($1, null, $2)`,
        [fixture.slug, query],
      )).rows.map((row) => row.title as string);

    assert.deepEqual(await search("hope"), ["Hope in Hard Times"]);
    assert.deepEqual(await search("Ada"), ["Hope in Hard Times"]);
    // **The leak this exists to prevent.** Searching the exact private title
    // must return nothing rather than confirming it exists.
    assert.deepEqual(await search("Secret Rehearsal"), []);
    assert.deepEqual(await search("rehearsal"), []);
  }));

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

test("concurrent publish and unpublish leave one coherent state", options,
  run(2, async ([a, b], track) => {
    const fixture = await seedChurch(a);
    track(fixture);
    const recordingId = await seedRecording(a, fixture, { visibility: "public" });

    // Two staff members on two screens, at the same moment.
    await Promise.all([
      a.query(
        `update public.stream_recordings
            set mobile_visibility = 'members', mobile_published_at = now(),
                mobile_unpublished_at = null
          where id = $1`,
        [recordingId],
      ),
      b.query(
        `update public.stream_recordings set mobile_unpublished_at = now() where id = $1`,
        [recordingId],
      ),
    ]);

    // Whichever won, the row is coherent: it is either visible or not, never
    // both, and the projection agrees with the row.
    const { rows } = await a.query(
      `select mobile_visibility, mobile_unpublished_at from public.stream_recordings where id = $1`,
      [recordingId],
    );
    const visible = Number(
      (await a.query(
        `select count(*)::int as n from public.mobile_media_archive($1, 'joined')`,
        [fixture.slug],
      )).rows[0].n,
    );
    const expectVisible = rows[0].mobile_unpublished_at === null;
    assert.equal(visible, expectVisible ? 1 : 0);
  }));

test("concurrent capability grants during an unpublish never both succeed after it", options,
  run(2, async ([a, b], track) => {
    const fixture = await seedChurch(a);
    track(fixture);
    const recordingId = await seedRecording(a, fixture, { visibility: "public" });

    await a.query(
      `update public.stream_recordings set mobile_unpublished_at = now() where id = $1`,
      [recordingId],
    );

    const [first, second] = await Promise.all([
      a.query(
        `select ok from public.mobile_media_playback_grant($1, null, 'recording', $2)`,
        [fixture.slug, recordingId],
      ),
      b.query(
        `select ok from public.mobile_media_playback_grant($1, null, 'recording', $2)`,
        [fixture.slug, recordingId],
      ),
    ]);

    assert.equal(first.rows[0].ok, false);
    assert.equal(second.rows[0].ok, false);
  }));

// ---------------------------------------------------------------------------
// The audit trail
// ---------------------------------------------------------------------------

test("the audit records who and when, and is append-only in practice", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { visibility: "public" });

    const actor = randomUUID();
    await client.query(
      `insert into auth.users (id, email) values ($1, $2) on conflict do nothing`,
      [actor, `${actor}@test.invalid`],
    );

    for (const [action, next] of [
      ["published", "public"],
      ["visibility_changed", "members"],
      ["unpublished", null],
      ["revoked", null],
    ] as [string, string | null][]) {
      await client.query(
        `insert into public.stream_media_publication_audit
           (church_id, stream_recording_id, action, previous_visibility, new_visibility, actor_user_id)
         values ($1, $2, $3, 'public', $4, $5)`,
        [fixture.churchId, recordingId, action, next, actor],
      );
    }

    const { rows } = await client.query(
      `select action, actor_user_id from public.stream_media_publication_audit
        where stream_recording_id = $1 order by created_at asc`,
      [recordingId],
    );
    assert.equal(rows.length, 4);
    assert.ok(rows.every((row) => row.actor_user_id === actor));
  }));

test("an audit row must name exactly one target", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture);
    const eventId = await seedEvent(client, fixture);

    // Both, and neither, are refused by the check constraint — so a row can
    // never be ambiguous about what it describes.
    await assert.rejects(
      client.query(
        `insert into public.stream_media_publication_audit
           (church_id, stream_event_id, stream_recording_id, action)
         values ($1, $2, $3, 'published')`,
        [fixture.churchId, eventId, recordingId],
      ),
    );
    await assert.rejects(
      client.query(
        `insert into public.stream_media_publication_audit (church_id, action)
         values ($1, 'published')`,
        [fixture.churchId],
      ),
    );
  }));

// ---------------------------------------------------------------------------
// Nothing else moved
// ---------------------------------------------------------------------------

test("the attendance authority is untouched by this migration", options,
  run(1, async ([client]) => {
    // Prompt 9 must not have changed how attendance is counted. The command's
    // signature and the unique counted fact are what everything else rests on.
    const { rows } = await client.query(
      `select proname from pg_proc where proname in
         ('record_attendance', 'record_attendance_batch', 'correct_attendance')
        order by proname`,
    );
    assert.deepEqual(
      rows.map((row) => row.proname),
      ["correct_attendance", "record_attendance", "record_attendance_batch"],
    );

    const columns = await client.query(
      `select column_name from information_schema.columns
        where table_name = 'attendance_facts' and column_name like 'mobile_%'`,
    );
    assert.equal(columns.rows.length, 0, "Prompt 9 added a column to attendance");
  }));

test("the legacy recording status is left alone", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);

    // 0034's `published` status remains a permitted value and remains unused.
    // Prompt 9 publishes through `mobile_visibility`, and a row still carrying
    // the legacy status must not become visible because of it.
    const recordingId = await seedRecording(client, fixture, { status: "ready" });
    await client.query(
      `update public.stream_recordings set status = 'published' where id = $1`,
      [recordingId],
    );

    const { rows } = await client.query(
      `select count(*)::int as n from public.mobile_media_archive($1, null)`,
      [fixture.slug],
    );
    assert.equal(rows[0].n, 0, "the legacy status published a recording");
  }));

// ---------------------------------------------------------------------------
// The mobile-playability gate (Prompt 9 closure)
// ---------------------------------------------------------------------------
//
// "Published to Faithful" must mean "playable by Faithful". These exercise the
// four independent places that enforce it: the projections, the detail lookup,
// the transactional publish, and the playback grant.

/** Records a verdict the way the server-side probe would. */
async function verify(
  client: Client,
  fixture: Fixture,
  recordingId: string,
  verdict: {
    playable: boolean;
    kind?: string | null;
    reason: string;
    container?: string | null;
    video?: string | null;
    audio?: string | null;
    /** The object the verdict is bound to. Required for a playable one. */
    etag?: string | null;
    hash?: string | null;
    size?: number | null;
  },
): Promise<void> {
  await client.query(
    `select * from public.record_recording_rendition(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::smallint, $13::bigint, $14, null, $15)`,
    [
      recordingId,
      fixture.churchId,
      verdict.playable,
      verdict.kind ?? (verdict.playable ? "progressive" : null),
      verdict.reason,
      verdict.container ?? null,
      verdict.video ?? null,
      verdict.audio ?? null,
      verdict.playable ? "avc1.4d401f" : null,
      verdict.playable ? "mp4a.40.2" : null,
      verdict.playable ? 48000 : null,
      verdict.playable ? 2 : null,
      verdict.size === undefined ? 1024 : verdict.size,
      verdict.etag === undefined ? '"etag-1"' : verdict.etag,
      verdict.hash === undefined ? "a".repeat(64) : verdict.hash,
    ],
  );
}

const PLAYABLE = { playable: true, reason: "ok", container: "isom", video: "avc1", audio: "mp4a" };

/**
 * The revision of the current verdict.
 *
 * An integer rather than the verification timestamp: Postgres stores
 * microseconds and the driver hands back a millisecond `Date`, so a timestamp
 * used as an optimistic token never matched and every publish failed as stale.
 */
async function revisionOf(client: Client, recordingId: string): Promise<number> {
  const { rows } = await client.query(
    `select mobile_rendition_revision as r from public.stream_recordings where id = $1`,
    [recordingId],
  );
  return Number(rows[0].r);
}

async function publish(
  client: Client,
  fixture: Fixture,
  recordingId: string,
  expected: number | null,
  identity: { hash?: string | null; etag?: string | null } = {},
): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `select * from public.publish_recording_to_faithful($1, $2, 'public', null, null, $3, $4, $5)`,
    [
      recordingId,
      fixture.churchId,
      expected,
      identity.hash === undefined ? "a".repeat(64) : identity.hash,
      identity.etag === undefined ? null : identity.etag,
    ],
  );
  return rows[0];
}

test("a verified playable recording can publish and be granted playback", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { title: "Hope" });

    await verify(client, fixture, recordingId, PLAYABLE);
    const result = await publish(client, fixture, recordingId, await revisionOf(client, recordingId));
    assert.equal(result.ok, true);

    assert.equal(
      (await client.query(
        `select count(*)::int as n from public.mobile_media_archive($1, null)`,
        [fixture.slug],
      )).rows[0].n,
      1,
    );

    const grant = await client.query(
      `select ok, rendition_kind from public.mobile_media_playback_grant($1, null, 'recording', $2)`,
      [fixture.slug, recordingId],
    );
    assert.equal(grant.rows[0].ok, true);
    // The delivery form travels with the grant, so the player is told rather
    // than left to infer it from a URL with no file extension.
    assert.equal(grant.rows[0].rendition_kind, "progressive");
  }));

test("an unverified recording cannot publish, appear, or be played", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture);

    // **No grandfathering.** `mobile_playable` defaults false, so a recording
    // nothing has proved is not publishable however healthy it looks.
    const refused = await publish(client, fixture, recordingId, null);
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "not_verified");

    assert.equal(
      (await client.query(
        `select count(*)::int as n from public.mobile_media_archive($1, null)`,
        [fixture.slug],
      )).rows[0].n,
      0,
    );
  }));

test("Matroska cannot be published", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    // The case the whole gate exists for: `sanitizeRecordingFilename` accepts
    // `.mkv` and `AVPlayer` cannot decode it.
    const recordingId = await seedRecording(client, fixture, { title: "Service.mkv" });
    await verify(client, fixture, recordingId, {
      playable: false,
      reason: "container_matroska",
      container: "matroska",
    });

    const result = await publish(client, fixture, recordingId, null);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "container_matroska");
  }));

test("an unsupported codec cannot be published", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);

    for (const [reason, video, audio] of [
      ["video_codec_unsupported", "hvc1", "mp4a"],
      ["audio_codec_unsupported", "avc1", "ac-3"],
      ["container_brand_unsupported", null, null],
      ["no_playable_track", null, null],
    ] as [string, string | null, string | null][]) {
      const recordingId = await seedRecording(client, fixture);
      await verify(client, fixture, recordingId, {
        playable: false,
        reason,
        video,
        audio,
      });

      const result = await publish(client, fixture, recordingId, null);
      assert.equal(result.ok, false, reason);
      assert.equal(result.reason, reason);
    }
  }));

test("a missing, corrupt or unverifiable rendition cannot be published", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);

    for (const reason of ["file_missing", "file_corrupt", "index_not_found", "probe_unavailable"]) {
      const recordingId = await seedRecording(client, fixture);
      await verify(client, fixture, recordingId, { playable: false, reason });
      assert.equal((await publish(client, fixture, recordingId, null)).ok, false, reason);
    }
  }));

test("a processing recording cannot be published even with a playable verdict", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { status: "processing" });
    await verify(client, fixture, recordingId, PLAYABLE);

    const result = await publish(client, fixture, recordingId, await revisionOf(client, recordingId));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_ready");
  }));

test("a direct write cannot mark a recording playable without evidence", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture);

    // **The bypass this closes.** Setting the flag by hand — a migration, a
    // console, a mistaken script — must not be enough to publish an unverified
    // file. The check constraint requires the evidence alongside the flag.
    await assert.rejects(
      client.query(
        `update public.stream_recordings set mobile_playable = true where id = $1`,
        [recordingId],
      ),
      /stream_recordings_mobile_playable_\w+_check/,
    );
  }));

test("a bypass that sets visibility directly still cannot be seen or played", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture);

    // Skipping the publish function entirely — the shape an existing bad row or
    // a direct API call takes.
    await client.query(
      `update public.stream_recordings
          set mobile_visibility = 'public', mobile_published_at = now()
        where id = $1`,
      [recordingId],
    );

    // The projections filter independently of however the row got that way.
    assert.equal(
      (await client.query(
        `select count(*)::int as n from public.mobile_media_archive($1, null)`,
        [fixture.slug],
      )).rows[0].n,
      0,
    );
    assert.equal(
      (await client.query(
        `select count(*)::int as n from public.mobile_media_detail($1, null, $2)`,
        [fixture.slug, recordingId],
      )).rows[0].n,
      0,
    );
    assert.equal(
      (await client.query(
        `select ok from public.mobile_media_playback_grant($1, null, 'recording', $2)`,
        [fixture.slug, recordingId],
      )).rows[0].ok,
      false,
    );
  }));

test("an existing published row disappears until it is verified", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    // Exactly what migration 0060 left behind: published, and never proved.
    const recordingId = await seedRecording(client, fixture, {
      title: "Published before the gate",
      visibility: "public",
      // Exactly the shape migration 0060 left behind: a church's intent
      // recorded, and nothing ever proved.
      verified: false,
    });

    const invisible = async () =>
      Number(
        (await client.query(
          `select count(*)::int as n from public.mobile_media_archive($1, null)`,
          [fixture.slug],
        )).rows[0].n,
      );

    // **No grandfathering.**
    assert.equal(await invisible(), 0);
    // Search cannot surface it either.
    assert.equal(
      (await client.query(
        `select count(*)::int as n from public.mobile_media_archive($1, null, 'Published')`,
        [fixture.slug],
      )).rows[0].n,
      0,
    );

    await verify(client, fixture, recordingId, PLAYABLE);
    // And it comes back on its own once proved — the church's intent was
    // recorded all along, so nobody has to notice and re-publish.
    assert.equal(await invisible(), 1);
  }));

test("losing a rendition after publication removes it and refuses new capabilities", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { visibility: "public" });
    await verify(client, fixture, recordingId, PLAYABLE);

    assert.equal(
      (await client.query(
        `select ok from public.mobile_media_playback_grant($1, null, 'recording', $2)`,
        [fixture.slug, recordingId],
      )).rows[0].ok,
      true,
    );

    // The file is replaced by something unplayable, or deleted, and the next
    // probe records it.
    await verify(client, fixture, recordingId, { playable: false, reason: "file_missing" });

    assert.equal(
      (await client.query(
        `select count(*)::int as n from public.mobile_media_archive($1, null)`,
        [fixture.slug],
      )).rows[0].n,
      0,
    );
    assert.equal(
      (await client.query(
        `select ok from public.mobile_media_playback_grant($1, null, 'recording', $2)`,
        [fixture.slug, recordingId],
      )).rows[0].ok,
      false,
    );

    // The church's intent survives: `mobile_visibility` is untouched, so a good
    // re-upload restores it without anyone having to re-publish.
    assert.equal(
      (await client.query(
        `select mobile_visibility as v from public.stream_recordings where id = $1`,
        [recordingId],
      )).rows[0].v,
      "public",
    );
  }));

test("becoming unplayable bumps the version, so a cached list refetches", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { visibility: "public" });
    await verify(client, fixture, recordingId, PLAYABLE);

    const version = async () =>
      Number(
        (await client.query(
          `select mobile_publication_version as v from public.stream_recordings where id = $1`,
          [recordingId],
        )).rows[0].v,
      );

    const before = await version();
    await verify(client, fixture, recordingId, { playable: false, reason: "file_missing" });
    // Appearing and disappearing is as visitor-visible as a title change.
    assert.ok((await version()) > before);
  }));

test("re-recording the same verdict does not invalidate every cached list", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { visibility: "public" });
    await verify(client, fixture, recordingId, PLAYABLE);

    const version = async () =>
      Number(
        (await client.query(
          `select mobile_publication_version as v from public.stream_recordings where id = $1`,
          [recordingId],
        )).rows[0].v,
      );

    const before = await version();
    // A routine re-probe finding the same answer. Bumping for the fresh
    // timestamp alone would cost a congregation a full refetch for nothing.
    await verify(client, fixture, recordingId, PLAYABLE);
    assert.equal(await version(), before);
  }));

test("a verdict cannot be recorded across churches", options,
  run(1, async ([client], track) => {
    const one = await seedChurch(client);
    const two = await seedChurch(client);
    track(one);
    track(two);
    const recordingId = await seedRecording(client, one);

    const { rows } = await client.query(
      `select * from public.record_recording_rendition(
         $1, $2, true, 'progressive', 'ok', 'isom', 'avc1', 'mp4a',
         'avc1.4d401f', 'mp4a.40.2', 48000, 2::smallint, 10::bigint, '"etag-x"', null,
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')`,
      [recordingId, two.churchId],
    );
    assert.equal(rows[0].ok, false);

    // And the recording is still unplayable.
    assert.equal(
      (await client.query(
        `select mobile_playable as p from public.stream_recordings where id = $1`,
        [recordingId],
      )).rows[0].p,
      false,
    );
  }));

test("a publish cannot be made against another church's recording", options,
  run(1, async ([client], track) => {
    const one = await seedChurch(client);
    const two = await seedChurch(client);
    track(one);
    track(two);
    const recordingId = await seedRecording(client, one);
    await verify(client, one, recordingId, PLAYABLE);

    const result = await publish(client, two, recordingId, null);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_found");
  }));

test("a stale verdict cannot be published against", options,
  run(2, async ([a, b], track) => {
    const fixture = await seedChurch(a);
    track(fixture);
    const recordingId = await seedRecording(a, fixture);
    await verify(a, fixture, recordingId, PLAYABLE);
    const seen = await revisionOf(a, recordingId);

    // A concurrent re-probe replaces the verdict between the read and the write.
    await verify(b, fixture, recordingId, PLAYABLE);

    const result = await publish(a, fixture, recordingId, seen);
    // Refused rather than published against a verdict that no longer holds.
    assert.equal(result.ok, false);
    assert.equal(result.reason, "verification_stale");

    // With the current verdict it succeeds.
    assert.equal((await publish(a, fixture, recordingId, await revisionOf(a, recordingId))).ok, true);
  }));

test("concurrent publishes against one verdict produce one winner", options,
  run(2, async ([a, b], track) => {
    const fixture = await seedChurch(a);
    track(fixture);
    const recordingId = await seedRecording(a, fixture);
    await verify(a, fixture, recordingId, PLAYABLE);
    const stamp = await revisionOf(a, recordingId);

    const [first, second] = await Promise.all([
      publish(a, fixture, recordingId, stamp),
      publish(b, fixture, recordingId, stamp),
    ]);

    // Both may succeed — publishing twice with the same visibility is
    // idempotent — but the row must be coherent afterwards.
    assert.ok(first.ok || second.ok);
    const { rows } = await a.query(
      `select mobile_visibility as v, mobile_playable as p
         from public.stream_recordings where id = $1`,
      [recordingId],
    );
    assert.equal(rows[0].v, "public");
    assert.equal(rows[0].p, true);
  }));

test("a live event is unaffected by the recording gate", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    // An event has no stored file to verify; its eligibility is the session
    // check that was already there.
    const eventId = await seedEvent(client, fixture, { visibility: "public" });

    const { rows } = await client.query(
      `select ok, rendition_kind from public.mobile_media_playback_grant($1, null, 'live', $2)`,
      [fixture.slug, eventId],
    );
    assert.equal(rows[0].ok, true);
    assert.equal(rows[0].rendition_kind, "hls");

    assert.equal(
      (await client.query(
        `select count(*)::int as n from public.mobile_media_live($1, null)`,
        [fixture.slug],
      )).rows[0].n,
      1,
    );
  }));

test("relationship and blocked rules are unchanged by the gate", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { visibility: "members" });
    await verify(client, fixture, recordingId, PLAYABLE);

    const count = async (state: string | null) =>
      Number(
        (await client.query(
          `select count(*)::int as n from public.mobile_media_archive($1, $2)`,
          [fixture.slug, state],
        )).rows[0].n,
      );

    assert.equal(await count("joined"), 1);
    assert.equal(await count("following"), 0);
    assert.equal(await count(null), 0);
    // A block is still felt, verified or not.
    assert.equal(await count("blocked"), 0);
  }));

// ---------------------------------------------------------------------------
// The verdict is bound to an object, not to a path
// ---------------------------------------------------------------------------
//
// `infra/stream-relay/upload-recording.sh` uploads with `x-upsert: true`, so
// re-running it replaces the object underneath an unchanged storage path. A
// verdict recorded against a path therefore says nothing about what is at that
// path afterwards, and everything below is about closing that.

test("a playable verdict cannot exist without an object identity", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { verified: false });

    // The probe reports a perfectly good rendition and no identity for it. The
    // function refuses to call that playable rather than recording a claim with
    // nothing to bind it to.
    await verify(client, fixture, recordingId, {
      ...PLAYABLE, etag: null, hash: null, size: null,
    });

    const row = await readIdentity(client, recordingId);
    assert.equal(row.mobile_playable, false);
    assert.equal(row.reason, "object_identity_unavailable");
  }));

test("a hash alone is not enough — delivery would have nothing to compare", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { verified: false });

    // A capability issuance and a delivery request cannot re-hash a window; they
    // compare what a response advertises. A verdict carrying only a hash would be
    // publishable and then undeliverable.
    await verify(client, fixture, recordingId, {
      ...PLAYABLE, etag: null, size: null, hash: "b".repeat(64),
    });
    assert.equal((await readIdentity(client, recordingId)).mobile_playable, false);

    // A length is enough to compare, so the same verdict with one stands.
    await verify(client, fixture, recordingId, {
      ...PLAYABLE, etag: null, size: 4096, hash: "b".repeat(64),
    });
    assert.equal((await readIdentity(client, recordingId)).mobile_playable, true);
  }));

test("a direct write cannot forge an identity-less playable row", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { verified: false });

    // The structural floor, underneath every function. A console, a migration or
    // a mistaken script cannot set the flag without the evidence.
    await assert.rejects(
      () =>
        client.query(
          `update public.stream_recordings
              set mobile_playable = true, mobile_rendition_kind = 'progressive',
                  mobile_rendition_verified_at = now()
            where id = $1`,
          [recordingId],
        ),
      /stream_recordings_mobile_playable_identity_check/,
    );
  }));

test("publishing is bound to the identity, not only to the revision", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { verified: false });
    const recorded = await recordVerdict(client, fixture, recordingId);

    // The revision is current and the identity is wrong: a caller that re-probed
    // something, or nothing, and is publishing against bytes nobody looked at.
    const wrongHash = await publish(client, fixture, recordingId, recorded.revision, {
      hash: "c".repeat(64),
    });
    assert.equal(wrongHash.ok, false);
    assert.equal(wrongHash.reason, "verification_stale");

    // Omitting it is not a way around it: null only matches a row that also has
    // none, so a caller cannot opt out of the binding.
    const omitted = await publish(client, fixture, recordingId, recorded.revision, { hash: null });
    assert.equal(omitted.ok, false);
    assert.equal(omitted.reason, "verification_stale");

    // And the honest call lands.
    const correct = await publish(client, fixture, recordingId, recorded.revision, {
      hash: recorded.hash,
      etag: recorded.etag,
    });
    assert.equal(correct.ok, true);
  }));

test("an ETag mismatch at publish is refused even with the right hash", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { verified: false });
    const recorded = await recordVerdict(client, fixture, recordingId);

    const result = await publish(client, fixture, recordingId, recorded.revision, {
      hash: recorded.hash,
      etag: '"a-different-object"',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "verification_stale");
  }));

test("an overwritten object is withdrawn from every surface at once", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { verified: false });
    const recorded = await recordVerdict(client, fixture, recordingId);
    await publish(client, fixture, recordingId, recorded.revision, { hash: recorded.hash });

    const before = await readIdentity(client, recordingId);
    assert.equal(
      (await client.query(`select count(*)::int as n from public.mobile_media_archive($1, null)`,
        [fixture.slug])).rows[0].n,
      1,
    );

    // Somebody re-ran `upload-recording.sh`. Nothing was read; the honest state
    // is "we no longer know", not "we know it is bad".
    await client.query(
      `select * from public.invalidate_recording_rendition($1, $2, 'object_changed')`,
      [recordingId, fixture.churchId],
    );

    const after = await readIdentity(client, recordingId);
    assert.equal(after.mobile_playable, false);
    assert.equal(after.reason, "object_changed");

    // **Every surface, independently.** List, search, detail and the grant.
    const list = await client.query(
      `select count(*)::int as n from public.mobile_media_archive($1, null)`, [fixture.slug]);
    assert.equal(list.rows[0].n, 0);

    const search = await client.query(
      `select count(*)::int as n from public.mobile_media_archive($1, 'Service')`, [fixture.slug]);
    assert.equal(search.rows[0].n, 0);

    const detail = await client.query(
      `select count(*)::int as n from public.mobile_media_detail($1, null, $2)`,
      [fixture.slug, recordingId]);
    assert.equal(detail.rows[0].n, 0);

    const grant = await client.query(
      `select ok from public.mobile_media_playback_grant($1, null, 'recording', $2)`,
      [fixture.slug, recordingId]);
    assert.equal(grant.rows[0].ok, false);

    // A device holding yesterday's list cannot use it either: the publication
    // version moved in the same statement, so every cached ETag is stale.
    assert.ok(
      (after.version as number) > (before.version as number),
      "the cache version did not move, so a stale list would still open the item",
    );

    // The church's *intent* is untouched. Only its eligibility was withdrawn.
    const intent = await client.query(
      `select mobile_visibility, mobile_unpublished_at from public.stream_recordings where id = $1`,
      [recordingId]);
    assert.equal(intent.rows[0].mobile_visibility, "public");
    assert.equal(intent.rows[0].mobile_unpublished_at, null);
  }));

test("publishing after an invalidation requires a fresh probe, not a retry", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { verified: false });
    const recorded = await recordVerdict(client, fixture, recordingId);
    await client.query(
      `select * from public.invalidate_recording_rendition($1, $2, 'object_changed')`,
      [recordingId, fixture.churchId]);

    // The old verdict is not merely stale, it is withdrawn. Re-presenting it —
    // even with the revision the invalidation produced — publishes nothing.
    const stale = await publish(client, fixture, recordingId, recorded.revision, {
      hash: recorded.hash });
    assert.equal(stale.ok, false);

    const withCurrentRevision = await publish(
      client, fixture, recordingId, await revisionOf(client, recordingId), { hash: recorded.hash });
    assert.equal(withCurrentRevision.ok, false);
    assert.equal(withCurrentRevision.reason, "object_changed");
  }));

test("a corrected re-upload gets a new identity and a new revision, and returns", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { verified: false });
    const first = await recordVerdict(client, fixture, recordingId);
    await publish(client, fixture, recordingId, first.revision, { hash: first.hash });
    await client.query(
      `select * from public.invalidate_recording_rendition($1, $2, 'object_changed')`,
      [recordingId, fixture.churchId]);

    // The church fixes the encoder and uploads again. The probe proves the new
    // bytes and binds the verdict to *them*.
    const second = await recordVerdict(client, fixture, recordingId, {
      hash: "d".repeat(64), etag: '"etag-2"', size: 2048,
    });
    assert.ok(second.revision > first.revision, "the revision did not move");

    const row = await readIdentity(client, recordingId);
    assert.equal(row.hash, "d".repeat(64));
    assert.equal(row.etag, '"etag-2"');
    assert.equal(row.mobile_playable, true);

    // **Nobody re-published it.** The intent survived the invalidation, so the
    // recording comes back on its own the moment it verifies.
    const list = await client.query(
      `select count(*)::int as n from public.mobile_media_archive($1, null)`, [fixture.slug]);
    assert.equal(list.rows[0].n, 1);

    // And the old identity cannot publish against the new row.
    const withOldIdentity = await publish(client, fixture, recordingId, second.revision, {
      hash: first.hash });
    assert.equal(withOldIdentity.ok, false);
  }));

test("the grant hands out the identity the delivery route must serve", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { verified: false });
    const recorded = await recordVerdict(client, fixture, recordingId, {
      hash: "e".repeat(64), etag: '"etag-9"', size: 4096,
    });
    await publish(client, fixture, recordingId, recorded.revision, { hash: recorded.hash });

    const { rows } = await client.query(
      `select ok, storage_path, object_etag, object_hash, object_size, rendition_kind
         from public.mobile_media_playback_grant($1, null, 'recording', $2)`,
      [fixture.slug, recordingId]);

    // Without this the route would resolve a mutable path and stream whatever is
    // at it — which is exactly the substitution being defended against.
    assert.equal(rows[0].ok, true);
    assert.equal(rows[0].object_etag, '"etag-9"');
    assert.equal(rows[0].object_hash, "e".repeat(64));
    assert.equal(Number(rows[0].object_size), 4096);
    assert.equal(rows[0].rendition_kind, "progressive");
  }));

test("a live grant carries no object identity, because there is no object", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const eventId = await seedEvent(client, fixture, {
      status: "live", visibility: "public", withLiveSession: true, published: true,
    });

    const { rows } = await client.query(
      `select ok, object_etag, object_hash, object_size
         from public.mobile_media_playback_grant($1, null, 'live', $2)`,
      [fixture.slug, eventId]);
    assert.equal(rows[0].ok, true);
    assert.equal(rows[0].object_etag, null);
    assert.equal(rows[0].object_hash, null);
    assert.equal(rows[0].object_size, null);
  }));

test("the codec configuration is recorded for support, and never projected", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const recordingId = await seedRecording(client, fixture, { verified: false });
    await recordVerdict(client, fixture, recordingId);
    await publish(client, fixture, recordingId, await revisionOf(client, recordingId));

    const row = await client.query(
      `select mobile_rendition_video_profile as v, mobile_rendition_audio_profile as a,
              mobile_rendition_audio_sample_rate as rate, mobile_rendition_audio_channels as ch
         from public.stream_recordings where id = $1`, [recordingId]);
    assert.equal(row.rows[0].v, "avc1.4d401f");
    assert.equal(row.rows[0].a, "mp4a.40.2");
    assert.equal(row.rows[0].rate, 48000);
    assert.equal(row.rows[0].ch, 2);

    // A visitor is told nothing at all. Not a codec, not a profile, not a hash.
    const projection = await client.query(
      `select * from public.mobile_media_archive($1, null)`, [fixture.slug]);
    const columns = Object.keys(projection.rows[0]).join(" ");
    for (const leak of ["profile", "codec", "hash", "etag", "object", "storage"]) {
      assert.ok(!columns.includes(leak), `the archive projection exposes ${leak}`);
    }
  }));

test("cross-tenant behaviour is unchanged by any of it", options,
  run(1, async ([client], track) => {
    const one = await seedChurch(client);
    const two = await seedChurch(client);
    track(one);
    track(two);
    const recordingId = await seedRecording(client, one, { verified: false });
    const recorded = await recordVerdict(client, one, recordingId);

    // Every identity-bearing function keeps its tenant predicate on the write.
    const foreignVerdict = await client.query(
      `select * from public.record_recording_rendition(
         $1, $2, true, 'progressive', 'ok', 'isom', 'avc1', 'mp4a',
         'avc1.4d401f', 'mp4a.40.2', 48000, 2::smallint, 1024::bigint, '"x"', null, $3)`,
      [recordingId, two.churchId, "f".repeat(64)]);
    assert.equal(foreignVerdict.rows[0].ok, false);

    const foreignInvalidate = await client.query(
      `select * from public.invalidate_recording_rendition($1, $2, 'object_changed')`,
      [recordingId, two.churchId]);
    assert.equal(foreignInvalidate.rows[0].ok, false);

    const foreignPublish = await publish(client, two, recordingId, recorded.revision, {
      hash: recorded.hash });
    assert.equal(foreignPublish.ok, false);
    assert.equal(foreignPublish.reason, "not_found");

    // The row is exactly as it was.
    const row = await readIdentity(client, recordingId);
    assert.equal(row.hash, recorded.hash);
    assert.equal(row.revision, recorded.revision);
  }));
