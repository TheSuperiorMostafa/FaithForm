import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  announcementState,
  announcementWhen,
  describeDestinations,
  describePostOutcome,
  describeWhen,
  todayDateValue,
} from "@/lib/announcements/composer";
import {
  standaloneBelongsInWeeklyEmail,
  standaloneToEmailEvents,
  type StandaloneEmailRow,
} from "@/lib/announcements/weekly-email";
import type { AnnouncementRow } from "@/lib/queries/announcements";

const NOW = Date.parse("2026-09-19T12:00:00Z");

function row(overrides: Partial<AnnouncementRow> = {}): AnnouncementRow {
  return {
    id: "a1",
    church_id: "c1",
    title: "Fall potluck",
    body: "",
    start_at: "2026-09-26T22:00:00Z",
    end_at: null,
    all_day: false,
    event_location: null,
    is_ready: true,
    push_to_app: false,
    push_to_facebook: false,
    push_to_team: false,
    status: "published",
    google_event_id: null,
    google_calendar_id: null,
    facebook_post_id: null,
    facebook_scheduled_publish_time: null,
    mobile_visibility: "followers",
    gmail_draft_id: null,
    published_at: "2026-09-19T11:00:00Z",
    last_publish_error: null,
    created_at: "2026-09-19T11:00:00Z",
    updated_at: "2026-09-19T11:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// One vocabulary: Draft · Scheduled · Posted · Taken down
// ---------------------------------------------------------------------------

test("the database's statuses map to the page's four words", () => {
  assert.equal(announcementState(row(), { now: NOW }), "posted");
  assert.equal(announcementState(row({ status: "pending" }), { now: NOW }), "draft");
  assert.equal(
    announcementState(row({ status: "pending" }), { takenDown: true, now: NOW }),
    "taken_down",
  );
});

test("only waiting to go out reads as Scheduled", () => {
  const facebookLater = row({
    mobile_visibility: "none",
    facebook_post_id: "1_2",
    facebook_scheduled_publish_time: "2026-09-25T13:00:00Z",
  });
  assert.equal(announcementState(facebookLater, { now: NOW }), "scheduled");

  const emailOnly = row({ mobile_visibility: "none", push_to_team: true });
  assert.equal(announcementState(emailOnly, { now: NOW }), "scheduled");

  // In the app now, even with a Facebook post still to come, is Posted.
  assert.equal(
    announcementState({ ...facebookLater, mobile_visibility: "members" }, { now: NOW }),
    "posted",
  );
});

test("destinations are listed in plain words", () => {
  const text = describeDestinations(
    row({
      push_to_team: true,
      facebook_post_id: "1_2",
      facebook_scheduled_publish_time: "2026-09-26T13:00:00Z",
    }),
    { timeZone: "America/New_York", now: NOW },
  );
  assert.equal(text, "The FaithForm app · Facebook on Sat, Sep 26 at 9:00 AM · Monday's email");
  assert.equal(
    describeDestinations(row({ mobile_visibility: "none" }), { now: NOW }),
    "Not shared anywhere yet",
  );
});

// ---------------------------------------------------------------------------
// The success screen names every place it went
// ---------------------------------------------------------------------------

test("the success lines name each destination", () => {
  const lines = describePostOutcome({
    inApp: true,
    notified: true,
    audience: "members",
    queuedForWeeklyEmail: true,
    facebookScheduledAt: "2026-09-26T13:00:00Z",
    timeZone: "America/New_York",
  });
  assert.deepEqual(lines, [
    "Posted to the FaithForm app.",
    "Members were notified.",
    "Added to Monday's email.",
    "Scheduled on Facebook for Sat, Sep 26 at 9:00 AM.",
  ]);
});

test("an event that already happened is not described as a notification", () => {
  const lines = describePostOutcome({
    inApp: true,
    notified: false,
    audience: "followers",
    alreadyOver: true,
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /no one was notified/);
});

// ---------------------------------------------------------------------------
// When an announcement is saved for
// ---------------------------------------------------------------------------

test("an announcement that is not an event is today, all day", () => {
  const now = new Date("2026-09-19T03:00:00Z");
  const when = announcementWhen({
    dated: false,
    date: "",
    startTime: "",
    endTime: "",
    timeZone: "America/Chicago",
    now,
  });
  // 3am UTC is still the 18th in Chicago.
  assert.deepEqual(when, { startAt: "2026-09-18T00:00:00.000Z", endAt: null, allDay: true });
  assert.equal(todayDateValue("America/Chicago", now), "2026-09-18");
});

test("a day with no time is all day, and an end before the start is refused", () => {
  assert.deepEqual(
    announcementWhen({ dated: true, date: "2026-10-04", startTime: "", endTime: "" }),
    { startAt: "2026-10-04T00:00:00.000Z", endAt: null, allDay: true },
  );
  assert.deepEqual(announcementWhen({ dated: true, date: "", startTime: "", endTime: "" }), {
    error: "Choose the day it's happening.",
  });
  const backwards = announcementWhen({
    dated: true,
    date: "2026-10-04",
    startTime: "18:00",
    endTime: "17:00",
  });
  assert.ok("error" in backwards);
});

test("dates read the same on the server and in the browser", () => {
  assert.equal(
    describeWhen(
      { startAt: "2026-09-27T14:00:00Z", endAt: "2026-09-27T15:30:00Z", allDay: false },
      "America/New_York",
    ),
    "Sun, Sep 27 · 10:00 AM – 11:30 AM",
  );
  assert.equal(
    describeWhen({ startAt: "2026-10-03T00:00:00.000Z", endAt: null, allDay: true }, "America/Los_Angeles"),
    "Sat, Oct 3 · All day",
  );
  assert.equal(
    describeWhen(
      { startAt: "2026-09-18T00:00:00.000Z", endAt: null, allDay: true, undated: true, postedAt: "2026-09-18T15:00:00Z" },
      "America/New_York",
    ),
    "Posted Sep 18",
  );
});

// ---------------------------------------------------------------------------
// Monday's email carries announcements that have no calendar event
// ---------------------------------------------------------------------------

function standalone(overrides: Partial<StandaloneEmailRow> = {}): StandaloneEmailRow {
  return {
    title: "Office closed",
    body: "Back Tuesday.",
    start_at: "2026-09-17T00:00:00.000Z",
    end_at: null,
    all_day: true,
    event_location: null,
    push_to_team: true,
    published_at: "2026-09-17T16:00:00Z",
    undated: true,
    ...overrides,
  };
}

test("a message posted last week reaches this Monday's email, then drops out", () => {
  const monday = "2026-09-21T04:00:00.000Z";
  const now = new Date("2026-09-21T13:00:00Z");
  assert.equal(standaloneBelongsInWeeklyEmail(standalone(), now, monday), true);

  const twoWeeksOld = standalone({ published_at: "2026-09-10T16:00:00Z" });
  assert.equal(standaloneBelongsInWeeklyEmail(twoWeeksOld, now, monday), false);

  const notForEmail = standalone({ push_to_team: false });
  assert.equal(standaloneBelongsInWeeklyEmail(notForEmail, now, monday), false);
});

test("a dated announcement is in the email only while it is still to come", () => {
  const monday = "2026-09-21T04:00:00.000Z";
  const now = new Date("2026-09-21T13:00:00Z");
  const upcoming = standalone({ undated: false, all_day: false, start_at: "2026-09-26T22:00:00Z" });
  const past = standalone({ undated: false, all_day: false, start_at: "2026-09-20T22:00:00Z" });
  const events = standaloneToEmailEvents([upcoming, past], now, monday);
  assert.equal(events.length, 1);
  assert.equal(events[0].startAt, "2026-09-26T22:00:00Z");
  assert.equal(events[0].notes, "Back Tuesday.");
});

// ---------------------------------------------------------------------------
// Source guards for the page
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, "utf8");
const announcementComponents = readdirSync("components/announcements")
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, source: read(`components/announcements/${name}`) }));

test("the old words are gone from the announcements UI", () => {
  for (const { name, source } of announcementComponents) {
    const strings = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const word of [/Verify &(amp;)? submit/, /Unsubmit/, /"Submitted/, /Shared to FB\?/, /Needs verify/, /Tap to (open|collapse)/]) {
      assert.doesNotMatch(strings, word, `${name} still says ${word}`);
    }
  }
});

test("decision text is never smaller than 12px, and Facebook links use the helper", () => {
  for (const { name, source } of announcementComponents) {
    assert.doesNotMatch(source, /text-\[(9|10|11)px\]/, `${name} uses tiny text`);
    assert.doesNotMatch(source, /facebook\.com\/\$\{/, `${name} builds a Facebook link by hand`);
    assert.doesNotMatch(source, /mail\.google\.com/, `${name} hard-codes Gmail`);
    assert.doesNotMatch(source, /window\.confirm/, `${name} uses window.confirm`);
  }
});

test("the page has one primary action and the composer guards unsent work", () => {
  const page = read("app/dashboard/announcements/page.tsx");
  assert.match(page, /title="Announcements"/);
  assert.match(page, /Tell your church what's happening, in the app, by email and on Facebook\./);
  assert.match(page, /action=\{<NewAnnouncementButton \/>\}/);
  assert.doesNotMatch(page, /max-w-/);

  const composer = read("components/announcements/announcement-composer.tsx");
  assert.match(composer, /title: "Discard this announcement\?"/);
  assert.match(composer, /onRequestClose=\{/);
  assert.match(composer, /Post announcement/);
  // The attendance block belongs to the calendar event, not the composer.
  assert.doesNotMatch(composer, /EventAttendance/);

  const context = read("components/announcements/composer-context.tsx");
  assert.match(context, /searchParams\.get\("compose"\) !== "1"/);
  assert.match(context, /router\.replace/);
});

test("server actions never hand raw provider or database text to the page", () => {
  const actions = read("app/dashboard/announcements/actions.ts");
  assert.doesNotMatch(actions, /return \{ error: (error|loadError)\.message \}/);
  // The one `err.message` left is read only to recognise Facebook's schedule
  // refusals, which were written for people; nothing returns it with a
  // made-up fallback any more.
  assert.doesNotMatch(actions, /err instanceof Error \? err\.message : "[^"]/);
  assert.doesNotMatch(actions, /\$\{result\.error\}/);
  assert.match(actions, /toUserError\(/);
});

test("an announcement that is not an event keeps its guards and has no event date", () => {
  const actions = read("app/dashboard/announcements/actions.ts");
  assert.match(actions, /const undated = !googleEventId && formData\.get\("undated"\) === "true"/);
  assert.match(actions, /event_date: payload\.undated \? null : payload\.startAt/);
  // Changing a post that is already on Facebook never forgets the post.
  assert.match(actions, /\.\.\.\(facebookPostId \? \{ facebook_post_id: facebookPostId \} : \{\}\)/);
  const publish = actions.slice(actions.indexOf("export async function publishAnnouncement"));
  assert.ok(
    publish.indexOf('featureActionError("announcements"') < publish.indexOf("parsePublishForm("),
    "the feature gate runs before anything is read from the form",
  );
});
