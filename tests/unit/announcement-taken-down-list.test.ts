import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

import { listTakenDownAnnouncements } from "@/lib/announcements/standalone";

test("previously posted announcements remain recoverable without a take-down timestamp", async () => {
  const requestUrls: URL[] = [];
  const client = createClient("https://qa.supabase.co", "test-key", {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        requestUrls.push(new URL(String(input)));
        return new Response(JSON.stringify([{
          id: "qa-announcement",
          title: "QA announcement",
          event_title: "QA announcement",
          body: "",
          notes: null,
          start_at: "2026-09-27T00:00:00Z",
          end_at: null,
          all_day: true,
          event_location: null,
          event_date: null,
          social_graphic_url: null,
          social_graphic_path: null,
          unsubmitted_at: null,
          updated_at: "2026-09-27T16:58:49Z",
        }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  });

  const rows = await listTakenDownAnnouncements(client, "qa-church");

  assert.equal(requestUrls[0]?.searchParams.get("or"), "(unsubmitted_at.not.is.null,published_by.not.is.null)");
  assert.equal(requestUrls[0]?.searchParams.get("status"), "neq.published");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].takenDownAt, "2026-09-27T16:58:49Z");
});
