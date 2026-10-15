import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SeriesTimeline } from "@/components/sermon-builder/series-timeline";
import type { SermonSeries } from "@/types/sermon";

// tsx preserves this project's classic JSX setting outside Next.js.
Object.assign(globalThis, { React });

const series: SermonSeries = {
  id: "series-1", church_id: "church-1", title: "Hope", theme: "Hope",
  description: null, weeks_planned: 2, created_at: "", updated_at: "",
  plan: { weeks: [
    { week: 1, title: "Original first week", scripture: "John 1:1", themes: ["Hope"] },
    { week: 2, title: "Second week", scripture: "John 2:1", themes: [] },
  ] },
};

test("series cards show saved sermon edits by week, keeping unstarted weeks intact", () => {
  const html = renderToStaticMarkup(createElement(SeriesTimeline, { series, sermons: [{
    id: "sermon-1", title: "A changed title", created_at: "2026-10-15T00:00:00Z", kind: "simple",
    scripture_refs: ["Romans 8:1-4", "Psalm 23:1"], series_week: 1,
  }] }));
  assert.match(html, /A changed title/);
  assert.match(html, /Romans 8:1-4; Psalm 23:1/);
  assert.doesNotMatch(html, /Original first week|John 1:1/);
  assert.match(html, /href="\/dashboard\/sermon-builder\/sermon-1\/edit"/);
  assert.match(html, /Edit this week’s sermon/);
  assert.match(html, /Second week/);
  assert.match(html, /series=series-1&amp;week=2/);
});

test("advanced linked sermons open their existing editor without creating another sermon", () => {
  const html = renderToStaticMarkup(createElement(SeriesTimeline, { series, sermons: [{
    id: "advanced-1", title: "A full sermon", created_at: "2026-10-15T00:00:00Z", kind: "advanced",
    scripture_refs: ["John 3:16"], series_week: 1,
  }] }));
  assert.match(html, /href="\/dashboard\/sermon-builder\/advanced-1"/);
  assert.doesNotMatch(html, /advanced-1\/edit/);
  assert.doesNotMatch(html, /week=1(?:&|&amp;)/);
});
