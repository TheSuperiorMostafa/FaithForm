import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  humanPublicationError,
  publishSermonToFaithForm,
  unpublishSermonFromFaithForm,
} from "@/lib/sermons/v1/publication";
import {
  isSermonShared,
  sermonAudienceLabel,
  sermonShareReadiness,
} from "@/lib/sermons/v1/share-rules";

/**
 * The publication rules for sermon notes.
 *
 * Every new sermon starts as a builder draft and nothing in today's builder
 * finishes it, so the old "status must be published" rule made sharing
 * impossible. These pin the rule that replaced it — the app must have
 * something to show — and the history guarantees around it.
 */

const CHURCH = "11111111-1111-4111-8111-111111111111";
const SERMON = "22222222-2222-4222-8222-222222222222";

const OUTLINE = {
  title: "Grace",
  intro: "We begin with a question.",
  points: [{ title: "Grace finds us", summary: "Luke 15" }],
  application: "Go and do likewise.",
  closing: "Amen.",
};

type Row = Record<string, unknown>;
type Call = { table: string; op: "select" | "update"; filters: Row; patch?: Row };

/**
 * Just enough of the Supabase query builder for `from().select().eq().maybeSingle()`
 * and `from().update().eq().eq()`, recording what was asked.
 */
function fakeDb(options: {
  row?: Row | null;
  readError?: { code?: string; message: string };
  updateError?: { code?: string; message: string };
}) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      return {
        select() {
          const call: Call = { table, op: "select", filters: {} };
          calls.push(call);
          const chain = {
            eq(column: string, value: unknown) {
              call.filters[column] = value;
              return chain;
            },
            async maybeSingle() {
              if (options.readError) return { data: null, error: options.readError };
              const row = options.row ?? null;
              const matches =
                row &&
                Object.entries(call.filters).every(([key, value]) => row[key] === value);
              return { data: matches ? row : null, error: null };
            },
          };
          return chain;
        },
        update(patch: Row) {
          const call: Call = { table, op: "update", filters: {}, patch };
          calls.push(call);
          const result = { error: options.updateError ?? null };
          const chain = {
            eq(column: string, value: unknown) {
              call.filters[column] = value;
              return chain;
            },
            then(resolve: (value: typeof result) => unknown) {
              return Promise.resolve(result).then(resolve);
            },
          };
          return chain;
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

function sermonRow(overrides: Row = {}): Row {
  return {
    id: SERMON,
    church_id: CHURCH,
    title: "The Prodigal Son",
    scripture_refs: ["Luke 15:11-32"],
    outline: null,
    status: "draft",
    published_at: null,
    mobile_visibility: "none",
    mobile_published_at: null,
    mobile_unpublished_at: null,
    mobile_publication_version: 1,
    ...overrides,
  };
}

const updates = (calls: Call[]) => calls.filter((call) => call.op === "update");

// ---------------------------------------------------------------------------
// The content rule
// ---------------------------------------------------------------------------

test("a sermon with an outline can be shared, whatever else it lacks", () => {
  assert.deepEqual(
    sermonShareReadiness({ title: "", scripture_refs: [], outline: OUTLINE }),
    { ready: true },
  );
});

test("a titled sermon with scripture can be shared without an outline", () => {
  assert.deepEqual(
    sermonShareReadiness({ title: "Lost and found", scripture_refs: ["Luke 15"], outline: null }),
    { ready: true },
  );
});

test("the readiness rule says what to add when there is nothing to show", () => {
  for (const sermon of [
    { title: "Lost and found", scripture_refs: [], outline: null },
    { title: "", scripture_refs: ["Luke 15"], outline: null },
    { title: "Untitled Sermon", scripture_refs: ["Luke 15"], outline: null },
    { title: "Lost and found", scripture_refs: ["  "], outline: null },
    // An outline the projection would drop is no outline at all.
    { title: "", scripture_refs: [], outline: { styleNotes: "private", points: [{}] } },
  ]) {
    const readiness = sermonShareReadiness(sermon);
    assert.equal(readiness.ready, false, JSON.stringify(sermon));
    assert.ok(!readiness.ready && readiness.title === "Create the lesson first");
    assert.ok(!readiness.ready && /title/.test(readiness.message) && /scripture/.test(readiness.message));
  }
});

test("the builder's draft status no longer blocks sharing", async () => {
  const { db, calls } = fakeDb({ row: sermonRow({ status: "draft" }) });
  const result = await publishSermonToFaithForm(
    { churchId: CHURCH, sermonId: SERMON, visibility: "members" },
    db,
  );
  assert.equal(result.ok, true);
  assert.equal(updates(calls).length, 1);
});

test("a sermon with nothing to show is refused with the reason, and nothing is written", async () => {
  const { db, calls } = fakeDb({ row: sermonRow({ title: "Untitled Sermon", scripture_refs: [] }) });
  const result = await publishSermonToFaithForm(
    { churchId: CHURCH, sermonId: SERMON, visibility: "members" },
    db,
  );
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /^Create the lesson first\./);
  assert.equal(updates(calls).length, 0);
});

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

test("sharing is the publish decision: a draft becomes published in the builder", async () => {
  const { db, calls } = fakeDb({ row: sermonRow() });
  const result = await publishSermonToFaithForm(
    {
      churchId: CHURCH,
      sermonId: SERMON,
      visibility: "followers",
      summary: "  On coming home.  ",
      preachedOn: "2026-09-06",
    },
    db,
  );

  assert.ok(result.ok);
  assert.equal(result.ok && result.markedPublished, true);
  const [update] = updates(calls);
  assert.equal(update.patch?.status, "published");
  assert.ok(typeof update.patch?.published_at === "string");
  assert.equal(update.patch?.mobile_visibility, "followers");
  assert.equal(update.patch?.mobile_unpublished_at, null);
  assert.equal(update.patch?.mobile_summary, "On coming home.");
  assert.equal(update.patch?.mobile_preached_on, "2026-09-06");
  assert.equal(update.patch?.mobile_publication_version, 2);
  assert.equal(update.patch?.mobile_published_at, update.patch?.updated_at);
  // The tenant predicate is on the write itself.
  assert.deepEqual(update.filters, { id: SERMON, church_id: CHURCH });
});

test("updating a shared sermon keeps its first publish time and bumps the version", async () => {
  const firstShared = "2026-08-31T15:00:00.000Z";
  const { db, calls } = fakeDb({
    row: sermonRow({
      status: "published",
      published_at: "2026-08-30T10:00:00.000Z",
      mobile_visibility: "members",
      mobile_published_at: firstShared,
      mobile_publication_version: 4,
    }),
  });

  const result = await publishSermonToFaithForm(
    { churchId: CHURCH, sermonId: SERMON, visibility: "followers" },
    db,
  );

  assert.ok(result.ok);
  assert.equal(result.ok && result.state.status === "published" && result.state.publishedAt, firstShared);
  assert.equal(result.ok && result.markedPublished, false);
  const [update] = updates(calls);
  assert.equal(update.patch?.mobile_published_at, firstShared);
  assert.equal(update.patch?.mobile_publication_version, 5);
  // Already published: the builder's own publish time and status are untouched.
  assert.equal("status" in (update.patch ?? {}), false);
  assert.equal("published_at" in (update.patch ?? {}), false);
});

test("sharing again after removing keeps the first publish time", async () => {
  const firstShared = "2026-08-31T15:00:00.000Z";
  const { db, calls } = fakeDb({
    row: sermonRow({
      status: "published",
      mobile_visibility: "none",
      mobile_published_at: firstShared,
      mobile_unpublished_at: "2026-09-01T09:00:00.000Z",
      mobile_publication_version: 3,
    }),
  });
  const result = await publishSermonToFaithForm(
    { churchId: CHURCH, sermonId: SERMON, visibility: "members" },
    db,
  );
  assert.ok(result.ok);
  const [update] = updates(calls);
  assert.equal(update.patch?.mobile_published_at, firstShared);
  assert.equal(update.patch?.mobile_unpublished_at, null);
});

test("a sermon from another church is not found and not written", async () => {
  const { db, calls } = fakeDb({ row: sermonRow({ church_id: "33333333-3333-4333-8333-333333333333" }) });
  const result = await publishSermonToFaithForm(
    { churchId: CHURCH, sermonId: SERMON, visibility: "members" },
    db,
  );
  assert.deepEqual(result, { ok: false, error: "Sermon not found." });
  assert.equal(updates(calls).length, 0);
});

test("an audience outside the ladder and a malformed date are refused before any read", async () => {
  const { db, calls } = fakeDb({ row: sermonRow() });
  const badAudience = await publishSermonToFaithForm(
    { churchId: CHURCH, sermonId: SERMON, visibility: "none" as never },
    db,
  );
  const badDate = await publishSermonToFaithForm(
    { churchId: CHURCH, sermonId: SERMON, visibility: "members", preachedOn: "Sunday" },
    db,
  );
  assert.equal(badAudience.ok, false);
  assert.equal(badDate.ok, false);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Unsharing
// ---------------------------------------------------------------------------

test("removing from the app sets both filters, bumps the version and leaves the builder status", async () => {
  const { db, calls } = fakeDb({
    row: sermonRow({
      status: "published",
      mobile_visibility: "members",
      mobile_published_at: "2026-08-31T15:00:00.000Z",
      mobile_publication_version: 2,
    }),
  });
  const result = await unpublishSermonFromFaithForm({ churchId: CHURCH, sermonId: SERMON }, db);

  assert.deepEqual(result, { ok: true, state: { status: "unpublished" } });
  const [update] = updates(calls);
  assert.equal(update.patch?.mobile_visibility, "none");
  assert.ok(typeof update.patch?.mobile_unpublished_at === "string");
  assert.equal(update.patch?.mobile_publication_version, 3);
  assert.equal("status" in (update.patch ?? {}), false);
  assert.equal("mobile_published_at" in (update.patch ?? {}), false);
  assert.deepEqual(update.filters, { id: SERMON, church_id: CHURCH });
});

test("unsharing is not gated on the Sermon Builder feature", () => {
  // Removing notes from phones only ever reduces exposure, and a church whose
  // feature was switched off is the one that most needs to be able to.
  const source = readFileSync("app/dashboard/sermon-builder/actions.ts", "utf8");
  const unshare = source.slice(
    source.indexOf("export async function unshareSermonInAppAction"),
    source.indexOf("export async function sharePresentationInAppAction"),
  );
  assert.ok(unshare.length > 0);
  assert.doesNotMatch(unshare, /featureActionError/);
  assert.match(unshare, /auth\.isAdmin/);

  const share = source.slice(
    source.indexOf("export async function shareSermonInAppAction"),
    source.indexOf("export async function unshareSermonInAppAction"),
  );
  assert.match(share, /featureActionError\("sermon_builder"\)/);
  assert.match(share, /auth\.isAdmin/);
});

// ---------------------------------------------------------------------------
// Errors a pastor reads
// ---------------------------------------------------------------------------

test("a database without the publication migration gets a human sentence, not a column name", async () => {
  const { db } = fakeDb({
    readError: { code: "42703", message: "column sermons.mobile_published_at does not exist" },
  });
  const result = await publishSermonToFaithForm(
    { churchId: CHURCH, sermonId: SERMON, visibility: "members" },
    db,
  );
  assert.equal(result.ok, false);
  const message = !result.ok ? result.error : "";
  assert.doesNotMatch(message, /mobile_|column|sermons\./);
  assert.match(message, /isn't set up/);
});

test("any other write failure is a plain retry message", () => {
  const message = humanPublicationError({ code: "23514", message: "violates check constraint sermons_mobile_visibility_check" });
  assert.equal(message, "We couldn't update the FaithForm app just now. Please try again.");
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test("audience labels promise only what the apps do", () => {
  // Both apps require a signed-in follower before opening sermon notes, so a
  // "public" sermon is not readable by "anyone".
  assert.equal(sermonAudienceLabel("public"), "Anyone who has added your church");
  assert.equal(sermonAudienceLabel("followers"), "Anyone who has added your church");
  assert.equal(sermonAudienceLabel("members"), "Members only");
  assert.equal(sermonAudienceLabel("none"), null);
  for (const visibility of ["public", "followers", "members"]) {
    assert.doesNotMatch(sermonAudienceLabel(visibility) ?? "", /^Anyone$/);
  }
});

test("shared means visible, first published, and not taken down", () => {
  assert.equal(isSermonShared({ mobile_visibility: "members", mobile_published_at: "x", mobile_unpublished_at: null }), true);
  assert.equal(isSermonShared({ mobile_visibility: "none", mobile_published_at: "x", mobile_unpublished_at: null }), false);
  assert.equal(isSermonShared({ mobile_visibility: "members", mobile_published_at: null }), false);
  assert.equal(isSermonShared({ mobile_visibility: "members", mobile_published_at: "x", mobile_unpublished_at: "y" }), false);
  assert.equal(isSermonShared({}), false);
});
