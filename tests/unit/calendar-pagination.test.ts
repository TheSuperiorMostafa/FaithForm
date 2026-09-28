import assert from "node:assert/strict";
import test from "node:test";

import { collectCalendarPages } from "@/lib/integrations/calendar-pagination";

test("reads later calendar pages, including an empty intermediate page", async () => {
  const requested: (string | undefined)[] = [];
  const events = await collectCalendarPages(async (token) => {
    requested.push(token);
    if (!token) return { items: Array.from({ length: 250 }, (_, i) => i), nextPageToken: "page-2" };
    if (token === "page-2") return { items: [], nextPageToken: "page-3" };
    return { items: [250] };
  });

  assert.equal(events.length, 251);
  assert.equal(events[250], 250);
  assert.deepEqual(requested, [undefined, "page-2", "page-3"]);
});

test("fails the whole read when a later page fails", async () => {
  await assert.rejects(
    collectCalendarPages(async (token) => {
      if (!token) return { items: ["partial"], nextPageToken: "more" };
      throw new Error("Google Calendar unavailable");
    }),
    /Google Calendar unavailable/,
  );
});

test("rejects a repeated page token instead of looping forever", async () => {
  await assert.rejects(
    collectCalendarPages(async () => ({ items: [], nextPageToken: "same" })),
    /repeated page token/,
  );
});
