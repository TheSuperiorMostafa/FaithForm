import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { STREAMING_TOOLS } from "@/components/live-streaming/encoder-docs-card";
import { LIVE_TABS } from "@/components/live-streaming/live-tabs";
import type { RecordingPhase } from "@/lib/stream/recording-model";
import {
  filterRecordings,
  MEMBER_APP,
  parseRecordingFilter,
  publishedWhereSentence,
  readyToPublishHeadline,
  recordingFilterHref,
  searchRecordings,
  recordingNextAction,
  recordingTone,
} from "@/lib/stream/recording-status";
import { humanizeStreamError, renameOutcomeMessage, serviceStatusLabel } from "@/lib/stream/user-errors";

const read = (path: string) => readFileSync(path, "utf8");

const PHASES: RecordingPhase[] = [
  "recording",
  "preparing",
  "ready_to_publish",
  "published",
  "needs_attention",
  "unpublished",
  "deleted",
];

// ---------------------------------------------------------------------------
// One state mapping, one tone, one next action
// ---------------------------------------------------------------------------

test("every recording phase has a StatusBadge tone from the canonical set", () => {
  const tones = new Set(["ready", "live", "working", "attention", "done", "neutral"]);
  for (const phase of PHASES) assert.ok(tones.has(recordingTone(phase)), phase);
  assert.equal(recordingTone("recording"), "live");
  assert.equal(recordingTone("preparing"), "working");
  assert.equal(recordingTone("ready_to_publish"), "ready");
  assert.equal(recordingTone("published"), "done");
  assert.equal(recordingTone("needs_attention"), "attention");
});

test("the next action is a verb a pastor understands, and points at the right page", () => {
  const id = "0b7d3c6e-1111-4222-8333-944445555666";
  const action = (phase: RecordingPhase, admin = true) => recordingNextAction({ id, phase: { phase } }, admin);
  assert.deepEqual(action("ready_to_publish"), {
    label: "Review & publish",
    href: `/dashboard/live-streaming/recordings/${id}`,
  });
  assert.equal(action("ready_to_publish", false)?.label, "Review");
  assert.equal(action("needs_attention")?.label, "Fix problem");
  assert.equal(action("published")?.label, "View details");
  assert.equal(action("unpublished")?.label, "Review");
  assert.equal(action("recording")?.href, "/dashboard/live-streaming");
  assert.equal(action("preparing"), null, "nothing to do while it's processing");
});

test("filters: All · Published · Series", () => {
  const list = PHASES.map((phase, index) => ({ id: String(index), phase: { phase } }));
  assert.equal(filterRecordings(list, "all").length, PHASES.length);
  assert.deepEqual(filterRecordings(list, "published").map((item) => item.phase.phase), ["published"]);
  assert.equal(parseRecordingFilter("series"), "series");
  assert.equal(parseRecordingFilter(["needs-action"]), "all", "the old Needs action link lands on All");
  assert.equal(parseRecordingFilter("drop table"), "all");
  assert.equal(parseRecordingFilter(undefined), "all");
  assert.equal(recordingFilterHref("all"), "/dashboard/live-streaming/recordings");
  assert.equal(recordingFilterHref("series"), "/dashboard/live-streaming/recordings?show=series");
  assert.equal(recordingFilterHref("published", " easter "), "/dashboard/live-streaming/recordings?show=published&q=easter");
  assert.equal(recordingFilterHref("series", "easter"), "/dashboard/live-streaming/recordings?show=series");
});

test("search matches title, series or speaker, every word", () => {
  const list = [
    { title: "Easter Sunday", seriesName: "Risen", speaker: "Pastor Ann" },
    { title: "Good Friday", seriesName: null, speaker: "Pastor Ben" },
  ];
  assert.equal(searchRecordings(list, "").length, 2);
  assert.deepEqual(searchRecordings(list, "EASTER").map((r) => r.title), ["Easter Sunday"]);
  assert.deepEqual(searchRecordings(list, "risen ann").map((r) => r.title), ["Easter Sunday"]);
  assert.deepEqual(searchRecordings(list, "ben").map((r) => r.title), ["Good Friday"]);
  assert.equal(searchRecordings(list, "christmas").length, 0);
});

test("published always says where members find it", () => {
  assert.equal(MEMBER_APP, "FaithForm app");
  assert.match(publishedWhereSentence({ app: true, website: false }), /FaithForm app under Services/);
  assert.match(publishedWhereSentence({ app: false, website: true }), /isn't in the FaithForm app/);
  assert.match(publishedWhereSentence({ app: true, website: true }), /app under Services, and .*website/);
  assert.equal(readyToPublishHeadline(1), "1 recording ready to publish");
  assert.equal(readyToPublishHeadline(3), "3 recordings ready to publish");
});

// ---------------------------------------------------------------------------
// Errors in plain words
// ---------------------------------------------------------------------------

test("renaming never shows a platform's raw error", () => {
  assert.equal(renameOutcomeMessage([]), "Title updated everywhere.");
  assert.equal(
    renameOutcomeMessage(["youtube"]),
    "Title updated in FaithForm. YouTube didn't accept the new title. It will keep the old one.",
  );
  assert.equal(
    renameOutcomeMessage(["youtube", "facebook"]),
    "Title updated in FaithForm. YouTube and Facebook didn't accept the new title. They will keep the old one.",
  );
  const actions = read("app/dashboard/live-streaming/actions.ts");
  assert.doesNotMatch(actions, /`\$\{platform\}: \$\{error\}`/);
  assert.match(actions, /renameOutcomeMessage\(failed\)/);
});

test("live-stream actions return plain sentences, never error.message", () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.match(humanizeStreamError(new Error("A broadcast is already in progress."), "x"), /already live/);
    assert.match(humanizeStreamError(new Error("Stream credentials are missing."), "x"), /Setup tab/);
    const raw = humanizeStreamError(
      new Error('duplicate column "rtmp_url" violates relay_destinations_pkey'),
      "We couldn't start the livestream.",
    );
    assert.doesNotMatch(raw, /rtmp_url|relay_destinations|violates/);
  } finally {
    console.error = originalError;
  }

  for (const file of [
    "app/dashboard/live-streaming/actions.ts",
    "app/dashboard/live-streaming/media/actions.ts",
    "app/dashboard/media/actions.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /error instanceof Error\s*\?\s*error\.message/, file);
    assert.doesNotMatch(source, /error:\s*written\.error\s*\?\?/, file);
  }
});

test("scheduled services use Upcoming · Live · Ended · Cancelled, never raw enums", () => {
  assert.equal(serviceStatusLabel("scheduled"), "Upcoming");
  assert.equal(serviceStatusLabel("live"), "Live");
  assert.equal(serviceStatusLabel("ended"), "Ended");
  assert.equal(serviceStatusLabel("cancelled"), "Cancelled");
  for (const file of [
    "components/live-streaming/schedule-card.tsx",
    "components/live-streaming/service-presentation-linker.tsx",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /\{\s*(event|e)\.status\s*\}/, `${file} renders a raw status`);
    assert.match(source, /serviceStatusLabel\(/, file);
  }
});

// ---------------------------------------------------------------------------
// The Sunday workflow and forgiving destructive actions
// ---------------------------------------------------------------------------

test("tabs are Go live · Recordings · Upcoming · Setup, and the page is called Live", () => {
  assert.deepEqual(
    LIVE_TABS.map((tab) => tab.label),
    ["Go live", "Recordings", "Upcoming", "Setup"],
  );
  const layout = read("app/dashboard/live-streaming/layout.tsx");
  assert.match(layout, /PageHeader/);
  assert.match(read("components/live-streaming/live-tabs.ts"), /LIVE_PAGE_TITLE = "Live"/);
  assert.equal(
    LIVE_TABS.some((tab) => tab.href.includes("/media")),
    false,
    "the old Library tab is part of Recordings",
  );
});

test("the Go live card has one big action per state and keeps the reassuring end confirm", () => {
  const card = read("components/live-streaming/broadcast/control-center.tsx");
  assert.match(card, /Go live\n/);
  assert.match(card, /End service/);
  assert.match(card, /Your recording will be saved automatically and prepared for publishing\./);
  assert.match(card, /Waiting for video/);
  assert.match(card, /Get help/);
  assert.match(card, /Technical details/);
  assert.match(card, /DEFAULT_SERVICE_TITLE = "Sunday Service"/);
  const page = read("app/dashboard/live-streaming/page.tsx");
  assert.doesNotMatch(page, /ScheduleCard|ServicePresentationLinker/, "schedule and slides live on Upcoming");
  assert.match(read("app/dashboard/live-streaming/upcoming/page.tsx"), /ScheduleCard/);
});

test("the ready-to-publish prompt is persistent: Later folds it for the session, never removes it", () => {
  const source = read("components/live-streaming/broadcast/ready-to-publish-card.tsx");
  assert.match(source, /sessionStorage/);
  assert.doesNotMatch(source, /localStorage/);
  assert.match(source, /if \(folded\)/, "a folded card still renders a line");
  assert.match(read("app/dashboard/live-streaming/page.tsx"), /ready_to_publish/);
});

test("the review page publishes to the app in one button, and deletes only from a labelled danger section", () => {
  const review = read("components/live-streaming/recordings/recording-review.tsx");
  assert.match(review, /"Publish to the app"/);
  assert.match(review, /"Show it on your church website"/);
  assert.doesNotMatch(review, /List it on your website/, "anything on the website is listed");
  assert.match(review, /under Services/);
  assert.doesNotMatch(review, /DropdownMenu|MoreHorizontal/, "delete is no longer in an icon-only menu");
  assert.match(review, /confirmLabel: "Delete recording"/);
  const unpublish = review.slice(review.indexOf("const unpublish"), review.indexOf("const remove"));
  assert.match(unpublish, /destructive: true/);
  assert.doesNotMatch(review, /window\.confirm/);
});

test("cancelling a service, removing slides and artwork, and replacing the key all ask first", () => {
  const schedule = read("components/live-streaming/schedule-card.tsx");
  assert.match(schedule, /confirmLabel: "Cancel service"/);
  assert.match(read("components/live-streaming/service-presentation-linker.tsx"), /confirmAction\(/);
  assert.match(read("components/media/series-artwork-panel.tsx"), /confirmAction\(/);
  assert.match(read("components/media/artwork-field.tsx"), /confirmAction\(/);
  const key = read("components/live-streaming/encoder-setup-card.tsx");
  const replace = key.slice(key.indexOf("const replaceKey"));
  assert.match(replace, /destructive: true/);
});

// ---------------------------------------------------------------------------
// Setup is guided and speaks plainly
// ---------------------------------------------------------------------------

test("setup offers the five choices, and its default copy has no streaming jargon", () => {
  assert.deepEqual(
    STREAMING_TOOLS.map((tool) => tool.name),
    ["OBS Studio", "ATEM Mini", "vMix", "This computer (camera)", "Someone else sets it up"],
  );
  for (const tool of STREAMING_TOOLS) {
    assert.ok(tool.steps.length <= 3, `${tool.name} has more than three steps`);
    assert.doesNotMatch(tool.steps.join(" "), /RTMP|relay|provision|ingest|bitrate|keyframe/i, tool.name);
  }
  const guide = read("components/live-streaming/setup/streaming-setup-guide.tsx");
  assert.match(guide, /Copy both|CopyBothButton/);
  assert.match(guide, /Waiting for your video…/);
  assert.match(guide, /Connected ✓/);
  assert.match(guide, /After the service/);
  assert.match(read("components/live-streaming/setup/recording-settings-card.tsx"), /Let me review first/);
  const platforms = read("components/live-streaming/platforms-card.tsx");
  assert.doesNotMatch(platforms, /Destination handed to the relay|provisioned|errorMessage/);
  assert.match(platforms, /\/dashboard\/settings\?tab=accounts/);
});

// ---------------------------------------------------------------------------
// Names, dead code and skeletons
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

test("one member-app name across the Live area", () => {
  const files = [
    ...walk("app/dashboard/live-streaming"),
    ...walk("components/live-streaming"),
    ...walk("components/media"),
  ];
  assert.ok(files.length > 30, "swept too few files");
  for (const file of files) {
    assert.doesNotMatch(read(file), /Faithful app/, `${file} uses the old app name`);
  }
});

test("the Reports page is named Reports and has no support clutter", () => {
  const page = read("app/dashboard/library/page.tsx");
  assert.match(page, /REPORTS_TITLE = "Reports"/);
  assert.match(page, /Monthly attendance reports to download\./);
  assert.doesNotMatch(page, /mailto:|Video embed placeholder/);
  assert.match(page, /import \{ getCurrentChurchId \} from "@\/lib\/auth\/current-church"/);
});

test("dead media list is gone and old media addresses still resolve", () => {
  assert.equal(existsSync("components/live-streaming/media-list.tsx"), false);
  for (const route of [
    "app/dashboard/live-streaming/media/page.tsx",
    "app/dashboard/live-streaming/media/all/page.tsx",
    "app/dashboard/live-streaming/media/series/page.tsx",
    "app/dashboard/live-streaming/media/series/[slug]/page.tsx",
    "app/dashboard/live-streaming/media/tag/[axis]/[value]/page.tsx",
    "app/dashboard/live-streaming/media/[id]/page.tsx",
  ]) {
    assert.match(read(route), /redirect\(/, route);
  }
});

test("every Live, Recordings and Reports route has its own skeleton with static text real", () => {
  const pages = [
    ...walk("app/dashboard/live-streaming"),
    ...walk("app/dashboard/library"),
  ].filter((file) => file.endsWith("page.tsx") && !file.includes("/media/"));
  assert.ok(pages.length >= 8, `only ${pages.length} pages`);
  for (const page of pages) {
    const loading = page.replace(/page\.tsx$/, "loading.tsx");
    assert.ok(existsSync(loading), `${page} has no loading.tsx`);
    const source = read(loading);
    assert.match(source, /SkeletonContainer|MediaGridSkeleton/, loading);
    assert.doesNotMatch(source, /max-w-(3xl|4xl|5xl|6xl)/, `${loading} sets its own page width`);
  }
  assert.match(read("app/dashboard/live-streaming/setup/loading.tsx"), /What do you stream with\?/);
  assert.match(read("app/dashboard/live-streaming/recordings/[id]/loading.tsx"), /All recordings/);
});
