import assert from "node:assert/strict";
import test from "node:test";

import {
  describeAppAudience,
  facebookPostUrl,
  hasUnpublishedChannel,
  publishedChannels,
} from "@/lib/announcements/published-channels";
import {
  deleteAppleCalendarEvent,
  eventsFromAppleFeed,
} from "@/lib/integrations/apple-calendar";
import type { AnnouncementRow } from "@/lib/queries/announcements";

const NOW = Date.parse("2026-09-19T12:00:00Z");

function announcement(overrides: Partial<AnnouncementRow> = {}): AnnouncementRow {
  return {
    id: "a1",
    church_id: "c1",
    title: "Fall potluck",
    body: "",
    start_at: "2026-09-26T22:00:00Z",
    end_at: "2026-09-27T00:00:00Z",
    all_day: false,
    event_location: "Fellowship Hall",
    is_ready: true,
    push_to_app: false,
    push_to_facebook: false,
    push_to_team: false,
    status: "published",
    google_event_id: "evt1",
    google_calendar_id: "primary",
    facebook_post_id: null,
    facebook_scheduled_publish_time: null,
    mobile_visibility: "none",
    gmail_draft_id: null,
    published_at: "2026-09-19T11:00:00Z",
    last_publish_error: null,
    created_at: "2026-09-19T11:00:00Z",
    updated_at: "2026-09-19T11:00:00Z",
    ...overrides,
  };
}

test("an announcement published nowhere else offers every place", () => {
  const channels = publishedChannels(announcement(), { now: NOW });

  assert.equal(channels.app.published, false);
  assert.equal(channels.facebook.published, false);
  assert.equal(channels.weeklyEmail.published, false);
  assert.equal(hasUnpublishedChannel(channels), true);
});

test("Facebook counts only once there is a post, not when it was asked for", () => {
  const failed = publishedChannels(
    announcement({ push_to_facebook: true, facebook_post_id: null }),
    { now: NOW },
  );
  assert.equal(failed.facebook.published, false);

  const posted = publishedChannels(
    announcement({ push_to_facebook: true, facebook_post_id: "123_456" }),
    { now: NOW },
  );
  assert.deepEqual(posted.facebook, {
    published: true,
    scheduledFor: null,
    url: "https://www.facebook.com/123/posts/456",
  });
});

test("a scheduled Facebook post reads as scheduled until its time passes", () => {
  const upcoming = publishedChannels(
    announcement({
      facebook_post_id: "123_456",
      facebook_scheduled_publish_time: "2026-09-25T13:00:00Z",
    }),
    { now: NOW },
  );
  assert.equal(
    upcoming.facebook.published && upcoming.facebook.scheduledFor,
    "2026-09-25T13:00:00Z",
  );

  const gone = publishedChannels(
    announcement({
      facebook_post_id: "123_456",
      facebook_scheduled_publish_time: "2026-09-18T13:00:00Z",
    }),
    { now: NOW },
  );
  assert.equal(gone.facebook.published && gone.facebook.scheduledFor, null);
});

test("the weekly email counts whether it was published there or queued", () => {
  assert.equal(
    publishedChannels(announcement({ push_to_team: true })).weeklyEmail.published,
    true,
  );
  assert.equal(
    publishedChannels(announcement(), { queuedForWeeklyEmail: true }).weeklyEmail
      .published,
    true,
  );
});

test("the app audience is said the way the publish form says it", () => {
  const inApp = publishedChannels(announcement({ mobile_visibility: "followers" }));
  assert.equal(inApp.app.published, true);
  assert.equal(describeAppAudience(inApp.app.visibility), "Anyone who has added your church");
  assert.equal(describeAppAudience("members"), "Members only");
  assert.equal(describeAppAudience("none"), "Not shared in the app");
});

test("nothing is left to add once every place has it", () => {
  const everywhere = publishedChannels(
    announcement({
      mobile_visibility: "members",
      facebook_post_id: "123_456",
      push_to_team: true,
    }),
    { now: NOW },
  );
  assert.equal(hasUnpublishedChannel(everywhere), false);
});

test("a Facebook post id becomes the post's own page", () => {
  assert.equal(facebookPostUrl("111_222"), "https://www.facebook.com/111/posts/222");
});

test("an event from an iCloud link is never deleted from FaithForm", async () => {
  await assert.rejects(
    deleteAppleCalendarEvent("church-1", "apple:feed:potluck@icloud.com"),
    /Delete it in Apple Calendar/,
  );
});

test("one date of a repeating iCloud event is not deleted, since the series is one file", async () => {
  await assert.rejects(
    deleteAppleCalendarEvent(
      "church-1",
      "apple:https://p01-caldav.icloud.com/123/calendars/home/youth.ics#20260923T230000Z",
    ),
    /repeating iCloud event/,
  );
});

test("iCloud feed events say which ones repeat", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:potluck@icloud.com",
    "DTSTART:20260926T220000Z",
    "DTEND:20260927T000000Z",
    "SUMMARY:Fall potluck",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:youth@icloud.com",
    "DTSTART:20260902T230000Z",
    "DTEND:20260903T003000Z",
    "RRULE:FREQ=WEEKLY",
    "SUMMARY:Youth night",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const events = eventsFromAppleFeed(ics, "2026-09-20T00:00:00Z", "2026-09-30T00:00:00Z");
  const potluck = events.find((event) => event.title === "Fall potluck");
  const youth = events.filter((event) => event.title === "Youth night");

  assert.equal(potluck?.recurring, false);
  assert.ok(youth.length > 0);
  assert.ok(youth.every((event) => event.recurring === true));
});
