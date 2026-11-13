import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";

import LiveWatchPage from "@/app/live/[slug]/page";
import { toBrowseItem, toBrowseSeries, DASHBOARD_MEDIA_LINKS } from "@/lib/media/browse";
import { assembleBrowse } from "@/lib/media/shelves";
import { listPublishableMedia } from "@/lib/media/v1/publication";
import { getMediaItem, listMediaItems } from "@/lib/stream/media-library";

Object.assign(globalThis, { React });
const church = "11111111-1111-4111-8111-111111111111";
const first = "22222222-2222-4222-8222-222222222222";
const second = "33333333-3333-4333-8333-333333333333";
const collection = "44444444-4444-4444-8444-444444444444";

function database(t: TestContext) {
  const state = { legacy: false, selects: [] as string[], zone: "America/New_York", serviceDate: "2026-01-04" as string | null };
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    assert.equal(url.hostname, "library-dates.example.test");
    assert.equal(url.searchParams.get("church_id"), `eq.${church}`);
    if (url.pathname.endsWith("/stream_events") || url.pathname.endsWith("/stream_sessions")) return Response.json([]);
    assert.ok(url.pathname.endsWith("/stream_recordings"));
    const select = url.searchParams.get("select") ?? "";
    state.selects.push(select);
    if (state.legacy && select.includes("service_date")) return Response.json({ code: "42703", message: "column stream_recordings.service_date does not exist" }, { status: 400 });
    const rows = [
      { id: first, title: "Older service uploaded later", created_at: "2026-11-13T03:12:00Z", recording_started_at: "2026-11-13T03:11:00Z", service_date: state.serviceDate },
      { id: second, title: "Newer service uploaded earlier", created_at: "2026-10-01T03:12:00Z", recording_started_at: "2026-10-01T03:11:00Z", service_date: "2026-10-11" },
    ].map(row => ({
      ...row, duration_sec: 60, storage_path: `qa/${row.id}.mp4`, visibility: "public", series_id: collection,
      speaker_tags: ["QA Speaker"], chapter_tags: ["John 3:16"], topic_tags: ["Hope"],
      churches: [{ timezone: state.zone }], media_series: { name: "QA Series", slug: "qa-series" },
      artwork_wide_url: "https://media.example.test/qa-artwork.jpg",
      status: "processing", mobile_visibility: "none", mobile_playable: false,
    })).map(row => state.legacy ? { ...row, recording_started_at: undefined, service_date: undefined, churches: undefined } : row);
    const id = url.searchParams.get("id")?.replace(/^eq\./, "");
    return Response.json(id ? rows.find(row => row.id === id) ?? null : rows);
  });
  return { state, db: createClient("https://library-dates.example.test", "safe-test-key", { auth: { persistSession: false, autoRefreshToken: false } }) };
}

test("library reads preserve upload timestamps while shelves order by the chosen church-local service day", async t => {
  const { state, db } = database(t);
  const items = await listMediaItems(church, db);
  assert.equal(items[0].createdAt, "2026-11-13T03:12:00Z");
  assert.equal(items[0].recordedAt, "2026-01-04T17:00:00.000Z");
  assert.equal(items[1].recordedAt, "2026-10-11T16:00:00.000Z");
  assert.deepEqual(items[0].tags, { speakers: ["QA Speaker"], chapters: ["John 3:16"], topics: ["Hope"] });
  const single = await getMediaItem(church, first, db);
  assert.equal(single?.recordedAt, items[0].recordedAt);
  const browseItems = items.map(toBrowseItem);
  const series = toBrowseSeries([{ id: collection, churchId: church, name: "QA Series", description: null, slug: "qa-series", artwork: { poster: null, wide: null, banner: null } }], browseItems);
  assert.equal(series[0].latestAt, "2026-10-11T16:00:00.000Z");
  assert.equal(assembleBrowse({ items: browseItems, series, live: null, links: DASHBOARD_MEDIA_LINKS }).featured?.id, second);
  for (const columns of state.selects) for (const field of ["recording_started_at", "service_date", "churches(timezone)"]) assert.ok(columns.includes(field), field);
});

test("library and publication listing use church time zones and retain recorder fallback when a date is cleared", async t => {
  const { state, db } = database(t);
  state.zone = "Pacific/Kiritimati";
  assert.equal((await getMediaItem(church, first, db))?.recordedAt, "2026-01-03T22:00:00.000Z");
  const dated = await listPublishableMedia(church, { supabase: db });
  assert.equal(dated.find(item => item.id === first)?.occurredAt, "2026-01-03T22:00:00.000Z");
  assert.equal(dated[0].id, second);
  state.serviceDate = null;
  assert.equal((await getMediaItem(church, first, db))?.recordedAt, "2026-11-13T03:11:00Z");
  assert.equal((await listPublishableMedia(church, { supabase: db })).find(item => item.id === first)?.occurredAt, "2026-11-13T03:11:00Z");
});

test("a library on an older schema retains the existing creation-date fallback", async t => {
  const { state, db } = database(t);
  state.legacy = true;
  const item = await getMediaItem(church, first, db);
  assert.ok(item);
  assert.equal(item.recordedAt, item.createdAt);
  assert.equal(toBrowseItem(item).recordedAt, item.createdAt);
  assert.equal(state.selects.length, 2);
});

test("the public past-services page uses the church's date instead of the server or viewer clock", async t => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://live-dates.example.test", SUPABASE_SECRET_KEY: "safe-test-key" })) {
    const before = process.env[key]; process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  let zone = "America/New_York", recordedAt = "2026-11-13T03:11:00Z";
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    assert.equal(url.hostname, "live-dates.example.test");
    if (url.pathname.endsWith("/churches")) {
      assert.equal(url.searchParams.get("slug"), "eq.qa-date-church");
      return Response.json({ id: church, name: "QA Date Church", slug: "qa-date-church", timezone: zone });
    }
    assert.ok(url.pathname.endsWith("/rpc/web_recordings"));
    assert.deepEqual(JSON.parse(String(init?.body)), { p_church_slug: "qa-date-church", p_recording_id: null, p_limit: 9 });
    return Response.json([{ id: first, church_id: church, title: "QA evening service", recorded_at: recordedAt, duration_sec: 60, listed: true }]);
  });
  for (const [timeZone, instant, expected] of [
    ["America/New_York", "2026-11-13T03:11:00Z", "Nov 12, 2026"],
    ["Asia/Tokyo", "2026-11-13T03:11:00Z", "Nov 13, 2026"],
    ["Pacific/Kiritimati", "2026-01-03T22:00:00Z", "Jan 4, 2026"],
  ]) {
    zone = timeZone; recordedAt = instant;
    const html = renderToStaticMarkup(await LiveWatchPage({ params: Promise.resolve({ slug: "qa-date-church" }) }));
    assert.ok(html.includes(expected), `${timeZone}: ${expected}`);
    assert.ok(html.includes(`/live/qa-date-church/watch/${first}`));
  }
});
