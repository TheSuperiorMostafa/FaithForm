import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  deriveAdvancedManifestPages,
  derivePresentationManifest,
  deriveSimpleManifestPages,
  hashPresentationManifest,
  splitScriptureForSlides,
} from "@/lib/sermons/v1/presentation-manifest";
import { presentationShareReadiness } from "@/lib/sermons/v1/share-rules";
import {
  publishPresentationToFaithForm,
  unpublishPresentationFromFaithForm,
} from "@/lib/sermons/v1/presentation";
import type { Sermon } from "@/types/sermon";

const CHURCH = "11111111-1111-4111-8111-111111111111";
const SERMON = "22222222-2222-4222-8222-222222222222";

function baseSermon(overrides: Partial<Sermon> = {}): Sermon {
  return {
    id: SERMON,
    church_id: CHURCH,
    created_by: "user",
    series_id: null,
    title: "The Prodigal Son",
    scripture_refs: ["Luke 15:11-32"],
    topic: "Grace",
    audience: "congregation",
    duration_min: 30,
    style_notes: "private notes",
    status: "draft",
    kind: "advanced",
    theme_id: null,
    translation: "KJV",
    sermon_date: "2026-09-14",
    content: {
      intro: "We begin.",
      points: [
        { title: "Lost", body: "The younger son left." },
        { title: "Found", body: "The father ran to meet him." },
      ],
      illustrations: [],
      application: "Welcome the lost.",
      prayer: "Lord, make us like the father.",
    },
    outline: null,
    model_used: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Manifest derivation
// ---------------------------------------------------------------------------

test("advanced manifest follows PPTX page kinds: title, scripture, points, application, closing", () => {
  const pages = deriveAdvancedManifestPages(baseSermon(), [
    { ref: "Luke 15:11-32", text: "A man had two sons. (12) The younger said.", translation: "ESV" },
  ]);

  assert.equal(pages[0]?.kind, "title");
  assert.equal(pages[0]?.title, "The Prodigal Son");
  assert.ok(pages.some((p) => p.kind === "scripture"));
  assert.equal(pages.filter((p) => p.kind === "point").length, 2);
  assert.ok(pages.some((p) => p.kind === "application" && /Welcome/.test(p.body ?? "")));
  assert.ok(pages.some((p) => p.kind === "closing" && /father/.test(p.body ?? "")));
  assert.ok(pages.every((p) => Array.isArray(p.readingOrder) && p.readingOrder.length > 0));
});

test("manuscript style_notes never appear in the manifest", () => {
  const manifest = derivePresentationManifest(baseSermon());
  const blob = JSON.stringify(manifest);
  assert.doesNotMatch(blob, /private notes/);
  assert.doesNotMatch(blob, /style_notes/);
});

test("simple manifest is title plus scripture pages from refs when verses are absent", () => {
  const pages = deriveSimpleManifestPages(
    baseSermon({ kind: "simple", content: null }),
    [],
    "KJV",
  );
  assert.equal(pages[0]?.kind, "title");
  assert.equal(pages.length, 2);
  assert.equal(pages[1]?.kind, "scripture");
  assert.equal(pages[1]?.scripture, "Luke 15:11-32");
});

test("scripture splitting prefers verse markers and stays under the slide budget", () => {
  const chunks = splitScriptureForSlides(
    "Alpha sentence here. (2) Second verse is short. (3) Third verse also.",
    40,
  );
  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0]?.includes("Alpha"));
  assert.ok(chunks.some((c) => c.includes("Second") || c.includes("(2)")));
});

test("content hash is stable for the same manifest and changes when a page changes", () => {
  const a = derivePresentationManifest(baseSermon());
  const b = derivePresentationManifest(baseSermon());
  assert.equal(hashPresentationManifest(a), hashPresentationManifest(b));

  const changed = derivePresentationManifest(
    baseSermon({
      content: {
        intro: "",
        points: [{ title: "Different", body: "Changed." }],
        illustrations: [],
        application: "",
        prayer: "",
      },
    }),
  );
  assert.notEqual(hashPresentationManifest(a), hashPresentationManifest(changed));
});

test("slides readiness requires a real title and something to show", () => {
  assert.equal(presentationShareReadiness(baseSermon()).ready, true);
  assert.equal(
    presentationShareReadiness({
      title: "Untitled Sermon",
      scripture_refs: ["Luke 15"],
      content: null,
      outline: null,
    }).ready,
    false,
  );
  assert.equal(
    presentationShareReadiness({
      title: "Grace",
      scripture_refs: [],
      content: null,
      outline: null,
    }).ready,
    false,
  );
});

// ---------------------------------------------------------------------------
// Publication immutability
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Call = {
  table: string;
  op: "select" | "update" | "insert";
  filters: Row;
  patch?: Row;
  insert?: Row;
};

function fakePresentationDb(options: {
  sermon?: Row | null;
  latestVersion?: number | null;
  insertId?: string;
  readError?: { code?: string; message: string };
  updateError?: { code?: string; message: string };
  insertError?: { code?: string; message: string };
}) {
  const calls: Call[] = [];
  const sermon = options.sermon === undefined ? null : options.sermon;

  const db = {
    from(table: string) {
      return {
        select(_columns?: string) {
          const call: Call = { table, op: "select", filters: {} };
          calls.push(call);
          const chain: Record<string, unknown> = {
            eq(column: string, value: unknown) {
              call.filters[column] = value;
              return chain;
            },
            neq() {
              return chain;
            },
            is() {
              return chain;
            },
            order() {
              return chain;
            },
            limit() {
              return chain;
            },
            async maybeSingle() {
              if (options.readError) return { data: null, error: options.readError };
              if (table === "sermons") {
                if (!sermon) return { data: null, error: null };
                const matches = Object.entries(call.filters).every(
                  ([key, value]) => sermon[key] === value,
                );
                return { data: matches ? sermon : null, error: null };
              }
              if (table === "sermon_presentation_versions") {
                if (options.latestVersion == null) return { data: null, error: null };
                return { data: { version: options.latestVersion }, error: null };
              }
              return { data: null, error: null };
            },
            async single() {
              return (chain.maybeSingle as () => Promise<unknown>)();
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
            is() {
              return chain;
            },
            neq() {
              return chain;
            },
            then(resolve: (value: typeof result) => unknown) {
              return Promise.resolve(result).then(resolve);
            },
          };
          return chain;
        },
        insert(row: Row) {
          const call: Call = { table, op: "insert", filters: {}, insert: row };
          calls.push(call);
          const chain = {
            select() {
              return {
                async single() {
                  if (options.insertError) {
                    return { data: null, error: options.insertError };
                  }
                  return {
                    data: {
                      id: options.insertId ?? "33333333-3333-4333-8333-333333333333",
                      version: row.version,
                      published_at: row.published_at,
                      content_hash: row.content_hash,
                    },
                    error: null,
                  };
                },
              };
            },
          };
          return chain;
        },
      };
    },
  };

  return { db: db as unknown as SupabaseClient, calls };
}

test("publishing inserts a new version and does not update an existing manifest", async () => {
  const sermon = {
    id: SERMON,
    church_id: CHURCH,
    title: "The Prodigal Son",
    scripture_refs: ["Luke 15:11-32"],
    topic: "Grace",
    kind: "advanced",
    theme_id: null,
    translation: "KJV",
    content: {
      intro: "",
      points: [{ title: "Lost", body: "Left home." }],
      illustrations: [],
      application: "Welcome them.",
      prayer: "Amen.",
    },
    outline: null,
    status: "draft",
    published_at: null,
  };

  const { db, calls } = fakePresentationDb({
    sermon,
    latestVersion: 1,
    insertId: "44444444-4444-4444-8444-444444444444",
  });

  const result = await publishPresentationToFaithForm(
    { churchId: CHURCH, sermonId: SERMON, visibility: "members" },
    db,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.state.status, "published");
  if (result.state.status !== "published") return;
  assert.equal(result.state.version, 2);

  const inserts = calls.filter((c) => c.op === "insert");
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]?.table, "sermon_presentation_versions");
  assert.equal(inserts[0]?.insert?.version, 2);
  assert.equal(inserts[0]?.insert?.mobile_visibility, "members");
  assert.deepEqual(inserts[0]?.insert?.renditions, { slides: [] });
  assert.ok((inserts[0]?.insert?.manifest as { pages: unknown[] })?.pages?.length);

  // Prior active versions are retired via update of visibility only — never
  // the manifest.
  const versionUpdates = calls.filter(
    (c) => c.op === "update" && c.table === "sermon_presentation_versions",
  );
  assert.ok(versionUpdates.length >= 1);
  for (const update of versionUpdates) {
    assert.equal("manifest" in (update.patch ?? {}), false);
    assert.equal("content_hash" in (update.patch ?? {}), false);
    assert.equal(update.patch?.mobile_visibility, "none");
    assert.ok(typeof update.patch?.unpublished_at === "string");
  }
});

test("unpublishing sets both filters and leaves version rows otherwise intact", async () => {
  const { db, calls } = fakePresentationDb({
    sermon: { id: SERMON, church_id: CHURCH },
  });

  const result = await unpublishPresentationFromFaithForm(
    { churchId: CHURCH, sermonId: SERMON },
    db,
  );
  assert.deepEqual(result, { ok: true, state: { status: "unpublished" } });

  const updates = calls.filter((c) => c.op === "update");
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.patch?.mobile_visibility, "none");
  assert.ok(typeof updates[0]?.patch?.unpublished_at === "string");
  assert.equal("manifest" in (updates[0]?.patch ?? {}), false);
});

test("presentation share actions require sermon_builder and member_app; unshare does not", () => {
  const source = readFileSync("app/dashboard/sermon-builder/actions.ts", "utf8");
  const share = source.slice(
    source.indexOf("export async function sharePresentationInAppAction"),
    source.indexOf("export async function unsharePresentationInAppAction"),
  );
  const unshare = source.slice(
    source.indexOf("export async function unsharePresentationInAppAction"),
  );

  assert.match(share, /featureActionError\("sermon_builder"\)/);
  assert.match(share, /featureActionError\("member_app"\)/);
  assert.match(share, /auth\.isAdmin/);
  assert.doesNotMatch(unshare, /featureActionError/);
  assert.match(unshare, /auth\.isAdmin/);
});
