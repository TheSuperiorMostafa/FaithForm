import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Executable tests for sermon history (migrations 0068 + 0075).
 *
 * The order and the cursor are SQL, so only a real database can say whether a
 * churchgoer sees last Sunday above a sermon shared late, and whether paging
 * ever repeats or skips one. Each run applies the minimal fixture and both
 * migrations (all idempotent), seeds a church of its own and deletes it.
 *
 *   FAITHFORM_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:6433/scratch \
 *     npx tsx --test tests/database/sermon-history.test.ts
 *
 * Skips loudly with a reason when no disposable target is configured. A skip is
 * not a pass.
 */

const DATABASE_URL = process.env.FAITHFORM_TEST_DATABASE_URL;

const SKIP_REASON =
  "FAITHFORM_TEST_DATABASE_URL is not set — no disposable Postgres target. " +
  "Sermon history ordering and paging are UNOBSERVED until this runs.";

if (/prod/i.test(DATABASE_URL ?? "")) {
  throw new Error("refusing to run sermon tests against a production-looking database");
}

type Client = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

const options = DATABASE_URL ? {} : { skip: SKIP_REASON };

async function connect(): Promise<Client> {
  const { Client: PgClient } = await import("pg");
  const client = new PgClient({ connectionString: DATABASE_URL });
  await client.connect();
  return client as unknown as Client;
}

let schemaReady: Promise<void> | null = null;

/** Applies the fixture and both migrations once per process. */
function ensureSchema(client: Client): Promise<void> {
  schemaReady ??= (async () => {
    for (const file of [
      "tests/database/fixtures/sermons.sql",
      "supabase/migrations/0068_faithful_sermon_publication.sql",
      "supabase/migrations/0075_sermon_history_order.sql",
    ]) {
      await client.query(readFileSync(file, "utf8"));
    }
  })();
  return schemaReady;
}

/** A church and its sermons, always deleted — even when an assertion fails. */
function withChurch(
  body: (client: Client, church: { id: string; slug: string }) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const client = await connect();
    const id = randomUUID();
    const slug = `sermons-${id.slice(0, 8)}`;
    try {
      await ensureSchema(client);
      await client.query(
        `insert into public.churches (id, name, slug) values ($1, 'Sermon History Church', $2)`,
        [id, slug],
      );
      await body(client, { id, slug });
    } finally {
      try {
        await client.query(`delete from public.churches where id = $1`, [id]);
      } catch {
        // Never let a failed cleanup stop the connection closing.
      }
      await client.end().catch(() => {});
    }
  };
}

type Seed = {
  title: string;
  preachedOn?: string | null;
  sermonDate?: string | null;
  publishedAt: string;
  visibility?: "public" | "followers" | "members" | "none";
  unpublished?: boolean;
  seriesId?: string | null;
};

async function seed(client: Client, churchId: string, sermon: Seed): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into public.sermons
       (id, church_id, title, scripture_refs, sermon_date, series_id,
        mobile_visibility, mobile_published_at, mobile_unpublished_at, mobile_preached_on)
     values ($1, $2, $3, '{Luke 15}', $4, $5, $6, $7, case when $8 then now() else null end, $9)`,
    [
      id,
      churchId,
      sermon.title,
      sermon.sermonDate ?? null,
      sermon.seriesId ?? null,
      sermon.visibility ?? "followers",
      sermon.publishedAt,
      sermon.unpublished ?? false,
      sermon.preachedOn ?? null,
    ],
  );
  return id;
}

type Page = {
  rows: Record<string, unknown>[];
  cursor: [string, string, string] | null;
};

async function page(
  client: Client,
  slug: string,
  state: string | null,
  limit: number,
  cursor: [string, string, string] | null = null,
  query: string | null = null,
): Promise<Page> {
  // Cursor values go back exactly as the function returned them, as text —
  // the same round trip the service makes through PostgREST.
  const { rows } = await client.query(
    `select id, title, preached_on::text as preached_on, published_at,
            cursor_preached::text as cursor_preached,
            cursor_published::text as cursor_published,
            cursor_id::text as cursor_id, series_name
       from public.mobile_sermon_archive($1, $2, $3, $4::date, $5::timestamptz, $6::uuid, $7)`,
    [slug, state, query, cursor?.[0] ?? null, cursor?.[1] ?? null, cursor?.[2] ?? null, limit],
  );
  const last = rows.at(-1);
  return {
    rows,
    cursor: last
      ? [last.cursor_preached as string, last.cursor_published as string, last.cursor_id as string]
      : null,
  };
}

test(
  "history is ordered by when a sermon was preached, not when it was shared",
  options,
  withChurch(async (client, church) => {
    // Shared in the order a busy pastor might: old sermons last.
    await seed(client, church.id, {
      title: "No date at all",
      publishedAt: "2026-09-01T12:00:00Z",
    });
    await seed(client, church.id, {
      title: "Builder date only",
      sermonDate: "2026-08-30",
      publishedAt: "2026-09-12T12:00:00Z",
    });
    await seed(client, church.id, {
      title: "Sixth, shared first",
      preachedOn: "2026-09-06",
      publishedAt: "2026-09-10T12:00:00Z",
    });
    await seed(client, church.id, {
      title: "Sixth, shared second",
      preachedOn: "2026-09-06",
      // The preached-on date wins over the builder's date.
      sermonDate: "2026-01-01",
      publishedAt: "2026-09-11T12:00:00Z",
    });
    await seed(client, church.id, {
      title: "Members only, seventh",
      preachedOn: "2026-09-07",
      publishedAt: "2026-09-08T12:00:00Z",
      visibility: "members",
    });
    await seed(client, church.id, {
      title: "Taken down",
      preachedOn: "2026-09-13",
      publishedAt: "2026-09-13T12:00:00Z",
      unpublished: true,
    });

    const joined = await page(client, church.slug, "joined", 50);
    assert.deepEqual(
      joined.rows.map((row) => row.title),
      [
        "Members only, seventh",
        "Sixth, shared second",
        "Sixth, shared first",
        "No date at all",
        "Builder date only",
      ],
    );

    const following = await page(client, church.slug, "following", 50);
    assert.deepEqual(
      following.rows.map((row) => row.title),
      ["Sixth, shared second", "Sixth, shared first", "No date at all", "Builder date only"],
    );

    // The date the app shows is the date the list is sorted by.
    const builderDateOnly = joined.rows.find((row) => row.title === "Builder date only");
    assert.equal(builderDateOnly?.preached_on, "2026-08-30");
    const noDate = joined.rows.find((row) => row.title === "No date at all");
    assert.equal(noDate?.preached_on, null);
    assert.equal(noDate?.cursor_preached, "2026-09-01");
  }),
);

test(
  "paging by cursor never repeats or skips, including sermons preached the same day",
  options,
  withChurch(async (client, church) => {
    const expected: string[] = [];
    // Twelve sermons over four Sundays, three per day, shared out of order.
    for (let week = 0; week < 4; week += 1) {
      for (let slot = 0; slot < 3; slot += 1) {
        const day = String(1 + week * 7).padStart(2, "0");
        await seed(client, church.id, {
          title: `w${week}s${slot}`,
          preachedOn: `2026-08-${day}`,
          publishedAt: `2026-09-${String(10 - week).padStart(2, "0")}T0${slot}:00:00.123456Z`,
        });
      }
    }
    const everything = await page(client, church.slug, "following", 50);
    expected.push(...everything.rows.map((row) => row.id as string));
    assert.equal(expected.length, 12);

    for (const size of [1, 2, 5]) {
      const seen: string[] = [];
      let cursor: Page["cursor"] = null;
      for (let guard = 0; guard < 20; guard += 1) {
        const current = await page(client, church.slug, "following", size, cursor);
        seen.push(...current.rows.map((row) => row.id as string));
        if (current.rows.length < size) break;
        cursor = current.cursor;
      }
      assert.deepEqual(seen, expected, `page size ${size}`);
    }
  }),
);

test(
  "the largest page can still report a next page",
  options,
  withChurch(async (client, church) => {
    for (let index = 0; index < 52; index += 1) {
      await seed(client, church.id, {
        title: `s${index}`,
        preachedOn: "2026-09-06",
        publishedAt: new Date(Date.UTC(2026, 8, 6, 0, index)).toISOString(),
      });
    }
    // The service asks for limit + 1 = 51 at limit=50; 0068 capped that at 50,
    // so a next page could never be detected.
    assert.equal((await page(client, church.slug, "following", 51)).rows.length, 51);
    assert.equal((await page(client, church.slug, "following", 500)).rows.length, 51);
    assert.equal((await page(client, church.slug, "following", 0)).rows.length, 1);
  }),
);

test(
  "search, blocking and another church's series are still applied",
  options,
  withChurch(async (client, church) => {
    const otherChurch = randomUUID();
    await client.query(
      `insert into public.churches (id, name, slug) values ($1, 'Elsewhere', $2)`,
      [otherChurch, `elsewhere-${otherChurch.slice(0, 8)}`],
    );
    try {
      const foreignSeries = randomUUID();
      await client.query(
        `insert into public.sermon_series (id, church_id, title) values ($1, $2, 'Not yours')`,
        [foreignSeries, otherChurch],
      );
      await seed(client, church.id, {
        title: "The Prodigal Son",
        preachedOn: "2026-09-06",
        publishedAt: "2026-09-07T12:00:00Z",
        seriesId: foreignSeries,
      });
      await seed(client, church.id, {
        title: "The Good Samaritan",
        preachedOn: "2026-08-30",
        publishedAt: "2026-08-31T12:00:00Z",
      });

      const found = await page(client, church.slug, "following", 50, null, "prodigal");
      assert.deepEqual(found.rows.map((row) => row.title), ["The Prodigal Son"]);
      assert.equal(found.rows[0]?.series_name, null);
      // A series title from another church is neither shown nor searchable.
      assert.equal((await page(client, church.slug, "following", 50, null, "Not yours")).rows.length, 0);

      assert.equal((await page(client, church.slug, "blocked", 50)).rows.length, 0);
      // Followers-only notes are not readable without a relationship.
      assert.equal((await page(client, church.slug, null, 50)).rows.length, 0);
    } finally {
      await client.query(`delete from public.churches where id = $1`, [otherChurch]);
    }
  }),
);

test(
  "only the service role can execute the projections, and the old signature is gone",
  options,
  withChurch(async (client) => {
    const archive = "public.mobile_sermon_archive(text,text,text,date,timestamptz,uuid,integer)";
    const detail = "public.mobile_sermon_detail(text,text,uuid)";
    for (const signature of [archive, detail]) {
      for (const role of ["anon", "authenticated"]) {
        const { rows } = await client.query(
          `select has_function_privilege($1, $2, 'execute') as allowed`,
          [role, signature],
        );
        assert.equal(rows[0]?.allowed, false, `${role} on ${signature}`);
      }
      const { rows } = await client.query(
        `select has_function_privilege('service_role', $1, 'execute') as allowed`,
        [signature],
      );
      assert.equal(rows[0]?.allowed, true, `service_role on ${signature}`);
    }

    const { rows } = await client.query(
      `select to_regprocedure('public.mobile_sermon_archive(text,text,text,timestamptz,uuid,integer)') as old`,
    );
    assert.equal(rows[0]?.old, null);
  }),
);

test(
  "the detail shows the same date fallback as the list",
  options,
  withChurch(async (client, church) => {
    const id = await seed(client, church.id, {
      title: "Builder date only",
      sermonDate: "2026-08-30",
      publishedAt: "2026-09-12T12:00:00Z",
    });
    const { rows } = await client.query(
      `select preached_on::text as preached_on from public.mobile_sermon_detail($1, 'following', $2)`,
      [church.slug, id],
    );
    assert.equal(rows[0]?.preached_on, "2026-08-30");
  }),
);
