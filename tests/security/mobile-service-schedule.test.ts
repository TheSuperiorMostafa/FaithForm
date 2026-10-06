import assert from "node:assert/strict";
import test from "node:test";
import { getScheduleWindow } from "../../lib/mobile/v1/schedule-service";
import type { RelationshipState } from "../../lib/faithform/relationship-state";
import type { FeedItemDto } from "../../lib/mobile/v1/contract";

const service: FeedItemDto = {
  id: "service:source", serviceOccurrenceId: "11111111-1111-4111-8111-111111111111",
  title: "Sunday worship", body: "", startAt: "2026-10-04T14:00:00Z", endAt: "2026-10-04T15:00:00Z",
  allDay: false, location: null, posterUrl: null, posterAltText: null, isPinned: false,
  visibility: "followers", publicationVersion: 3, publishedAt: null, isEvent: true,
  churchSlug: "target", churchName: "Target", churchTimezone: "America/New_York",
};

for (const state of [null, "left", "blocked", "following", "pending", "joined"] as const) {
  test(`service calendar authorizes target church relationship ${state}`, async () => {
    let queried = false;
    const result = await getScheduleWindow({ userId: "account", churchSlug: "target", from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" }, {
      church: async slug => { assert.equal(slug, "target"); return { id: "target-id", name: "Target", timezone: "America/New_York" }; },
      relationship: async (userId, slug) => { assert.equal(userId, "account"); assert.equal(slug, "target"); return state as RelationshipState | null; },
      announcements: async () => [],
      services: async (church, slug) => { queried = true; assert.equal(church.id, "target-id"); assert.equal(slug, "target"); return [service]; },
    });
    const allowed = ["following", "pending", "joined"].includes(state ?? "");
    assert.equal(queried, allowed);
    assert.equal(result.items.length, allowed ? 1 : 0);
    assert.equal(result.scheduleVersion, allowed ? 3 : 0);
  });
}

test("anonymous and an account related only to another church never query private occurrences", async () => {
  for (const userId of [null, "belongs-to-other-church"]) {
    await getScheduleWindow({ userId, churchSlug: "target", from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" }, {
      church: async () => ({ id: "target-id", name: "Target", timezone: "UTC" }),
      relationship: async (_, slug) => { assert.equal(slug, "target"); return null; },
      announcements: async () => [],
      services: async () => { assert.fail("service query must not run"); },
    });
  }
});
