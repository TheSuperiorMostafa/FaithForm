import assert from "node:assert/strict";
import test from "node:test";

import {
  approveState,
  clipPlace,
  describeDays,
  describeSchedule,
  formatPostTime,
  formatTimeOfDay,
  needsPolling,
  postView,
  scheduledMessage,
  type FacebookPage,
  type QueueItem,
  type QueueRender,
} from "@/components/clips/format";

const NOW = new Date("2026-11-16T15:00:00Z");
const PAGE: FacebookPage = { connected: true, pageName: "Grace Church", pageId: "123", needsReconnect: false };
const READY: QueueRender = {
  id: "r1",
  status: "ready",
  specHash: "a".repeat(64),
  previewUrl: "https://example.test/v.mp4",
  downloadUrl: null,
  failureReason: null,
  job: null,
};

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "c1",
    recordingId: "rec1",
    recordingTitle: "Sunday Service",
    recordingDate: "2026-11-15T15:00:00Z",
    startSec: 1450,
    endSec: 1495,
    excerpt: "",
    reason: "",
    caption: "",
    auto: true,
    editVersion: 1,
    needsReview: false,
    reviewReason: null,
    approvalStatus: "pending",
    scheduledFor: null,
    render: READY,
    post: null,
    ...overrides,
  };
}

test("post times read in the church's time zone", () => {
  // 17:00 UTC on Mon 16 Nov 2026 is noon in New York, 9 AM in Los Angeles.
  assert.equal(formatPostTime("2026-11-16T17:00:00Z", "America/New_York", NOW), "Mon, Nov 16 at 12:00 PM");
  assert.equal(formatPostTime("2026-11-16T17:00:00Z", "America/Los_Angeles", NOW), "Mon, Nov 16 at 9:00 AM");
  assert.equal(formatPostTime("2027-01-04T17:00:00Z", "America/New_York", NOW), "Mon, Jan 4, 2027 at 12:00 PM", "another year shows the year");
  assert.equal(formatPostTime("2026-11-16T17:00:00Z", "Not/AZone", NOW), "Mon, Nov 16 at 12:00 PM", "a bad zone falls back");
  assert.equal(formatPostTime("nonsense", "America/New_York", NOW), "");
});

test("the approval toast names the time and the Page", () => {
  assert.equal(
    scheduledMessage("2026-11-16T17:00:00Z", "America/New_York", "Grace Church", NOW),
    "Scheduled for Mon, Nov 16 at 12:00 PM on Grace Church.",
  );
  assert.match(scheduledMessage("2026-11-16T17:00:00Z", "America/New_York", null, NOW), /on your Facebook Page\.$/);
});

test("the posting schedule reads as a sentence", () => {
  assert.equal(formatTimeOfDay("00:05"), "12:05 AM");
  assert.equal(formatTimeOfDay("13:30"), "1:30 PM");
  assert.equal(describeDays([1, 2, 3, 4, 5]), "every weekday");
  assert.equal(describeDays([0, 1, 2, 3, 4, 5, 6]), "every day");
  assert.equal(describeDays([6, 0]), "every weekend");
  assert.equal(describeDays([3, 0]), "Sundays and Wednesdays");
  assert.equal(describeDays([1, 3, 5]), "Mondays, Wednesdays and Fridays");
  assert.equal(describeSchedule({ days: [1, 2, 3, 4, 5], time: "12:00", per_day: 1 }), "Every weekday at 12:00 PM, one clip a day.");
  assert.equal(describeSchedule({ days: [2], time: "09:00", per_day: 2 }), "Tuesdays at 9:00 AM, up to 2 clips a day, 4 hours apart.");
});

test("a clip's place in the service", () => {
  assert.equal(clipPlace(item(), "America/New_York"), "Sun, Nov 15 · 24:10 into the service · 45 seconds");
});

test("Approve unlocks after watching to the end or ticking the box", () => {
  const base = { canApprove: true, facebook: PAGE, render: READY, needsReview: false, watched: false, confirmed: false };
  assert.equal(approveState(base).enabled, false);
  assert.equal(approveState({ ...base, watched: true }).enabled, true);
  assert.equal(approveState({ ...base, confirmed: true }).enabled, true);
  assert.equal(approveState({ ...base, watched: true, canApprove: false }).reason, "Ask a church administrator to approve.");
  assert.equal(approveState({ ...base, watched: true, facebook: { ...PAGE, needsReconnect: true } }).reason, "Reconnect Facebook to approve clips.");
  assert.equal(approveState({ ...base, watched: true, facebook: { ...PAGE, connected: false } }).reason, "Connect Facebook to approve clips.");
  assert.equal(approveState({ ...base, watched: true, render: { ...READY, status: "rendering" } }).enabled, false);
  assert.equal(approveState({ ...base, watched: true, needsReview: true }).enabled, false);
});

test("post status in plain words", () => {
  assert.equal(postView({ status: "uploading", permalink: null, last_error: null, posted_at: null }).label, "Posting…");
  assert.equal(postView({ status: "processing", permalink: null, last_error: null, posted_at: null }).label, "Facebook is processing…");
  const posted = postView({ status: "posted", permalink: "https://facebook.com/x", last_error: null, posted_at: "2026-11-16T17:00:00Z" });
  assert.equal(posted.label, "Posted");
  assert.equal(posted.working, false);
  const failed = postView({ status: "failed", permalink: null, last_error: "The video was too long.", posted_at: null });
  assert.equal(failed.failed, true);
  assert.equal(failed.detail, "The video was too long.");
  assert.equal(postView(null).working, true);
});

test("the page keeps checking only while something is changing", () => {
  assert.equal(needsPolling([item()], "review"), false);
  assert.equal(needsPolling([item({ render: { ...READY, status: "rendering" } })], "review"), true);
  assert.equal(needsPolling([item({ post: { status: "processing", permalink: null, last_error: null, posted_at: null } })], "posted"), true);
  assert.equal(needsPolling([item({ post: { status: "posted", permalink: "x", last_error: null, posted_at: null } })], "posted"), false);
  const soon = new Date(Date.now() + 30_000).toISOString();
  const later = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(needsPolling([item({ scheduledFor: soon })], "scheduled"), true);
  assert.equal(needsPolling([item({ scheduledFor: later })], "scheduled"), false);
});
