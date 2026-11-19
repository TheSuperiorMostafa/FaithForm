/**
 * Pure, client-safe helpers for the Clips section: the shapes the queue,
 * library and settings routes return, and the plain-language text built from
 * them (post times in the church's time zone, the posting schedule, post
 * status). Kept free of React so they can be unit tested.
 */

import type { JobProgress as JobProgressView } from "@/lib/sermon-media/progress";
import { formatLength, formatTime } from "@/components/sermon-media/time";

export type ClipsView = "review" | "scheduled" | "posted" | "skipped";

export const CLIPS_VIEWS: readonly ClipsView[] = ["review", "scheduled", "posted", "skipped"];

export const CLIPS_VIEW_LABELS: Record<ClipsView, string> = {
  review: "Ready to review",
  scheduled: "Scheduled",
  posted: "Posted",
  skipped: "Skipped",
};

export const CAPTION_MAX = 2200;

export type QueueJob = { progressView: JobProgressView | null } | null;

export type QueueRender = {
  id: string;
  status: "queued" | "rendering" | "ready" | "failed" | "superseded";
  specHash: string;
  previewUrl: string | null;
  downloadUrl: string | null;
  failureReason: string | null;
  job: QueueJob;
};

export type QueuePost = {
  id?: string;
  status: string;
  permalink: string | null;
  last_error: string | null;
  posted_at: string | null;
  created_at?: string;
};

export type QueueItem = {
  id: string;
  recordingId: string;
  recordingTitle: string;
  recordingDate: string;
  startSec: number;
  endSec: number;
  excerpt: string;
  reason: string;
  caption: string;
  auto: boolean;
  editVersion: number;
  needsReview: boolean;
  reviewReason: string | null;
  approvalStatus: "pending" | "approved" | "skipped" | "posted";
  scheduledFor: string | null;
  render: QueueRender | null;
  post: QueuePost | null;
};

export type FacebookPage = { connected: boolean; pageName: string | null; pageId: string | null; needsReconnect: boolean };

export type QueueResponse = {
  items: QueueItem[];
  counts: Record<ClipsView, number>;
  canApprove: boolean;
  facebook: FacebookPage;
};

export type LibraryItem = {
  id: string;
  title: string;
  source: "upload" | "livestream";
  recordingStatus: string;
  durationSec: number | null;
  createdAt: string;
  serviceDate: string | null;
  transcript: "ready" | "none" | "queued" | "dispatched" | "running" | "succeeded" | "failed" | "cancelled";
  job: { progressView: JobProgressView | null } | null;
  sermon: { startSec: number; endSec: number; automatic: boolean } | null;
  clips: { total: number; waiting: number; scheduled: number; posted: number };
};

export type PostSchedule = { days: number[]; time: string; per_day: number };

export type StudioSettings = {
  autoTranscribe: boolean;
  autoConfirmRange: boolean;
  autoClips: boolean;
  clipsPerService: number;
  language: string;
  postSchedule: PostSchedule;
};

export type SettingsResponse = { settings: StudioSettings; timezone: string; canEdit: boolean };

export const WEEKDAYS = [
  { value: 0, short: "Sun", long: "Sunday" },
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
] as const;

const FALLBACK_TZ = "America/New_York";

function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TZ;
  }
}

/** "Mon, Nov 17 at 12:00 PM" in the church's time zone (year added when it differs). */
export function formatPostTime(iso: string, timeZone: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const zone = safeZone(timeZone);
  const year = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" }).format(d);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(year(date) !== year(now) ? { year: "numeric" } : {}),
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(date);
  return `${day} at ${time}`;
}

/** The toast after approving: "Scheduled for Mon, Nov 17 at 12:00 PM on Grace Church." */
export function scheduledMessage(iso: string, timeZone: string, pageName: string | null, now: Date = new Date()): string {
  return `Scheduled for ${formatPostTime(iso, timeZone, now)} on ${pageName || "your Facebook Page"}.`;
}

/** "13:05" → "1:05 PM". */
export function formatTimeOfDay(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return hhmm;
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${match[2]} ${suffix}`;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Which days, in words: "every weekday", "every day", "Sundays and Wednesdays". */
export function describeDays(days: number[]): string {
  const set = [...new Set(days)].filter((day) => day >= 0 && day <= 6).sort((a, b) => a - b);
  if (set.length === 0) return "no days";
  if (set.length === 7) return "every day";
  if (set.length === 5 && [1, 2, 3, 4, 5].every((day) => set.includes(day))) return "every weekday";
  if (set.length === 2 && set.includes(0) && set.includes(6)) return "every weekend";
  return joinWords(set.map((day) => `${WEEKDAYS[day].long}s`));
}

/** "Every weekday at 12:00 PM, one clip a day." */
export function describeSchedule(schedule: PostSchedule): string {
  const days = describeDays(schedule.days);
  const perDay = schedule.per_day === 1 ? "one clip a day" : `up to ${schedule.per_day} clips a day, 4 hours apart`;
  const sentence = `${days} at ${formatTimeOfDay(schedule.time)}, ${perDay}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** "Eastern Time (America/New_York)". */
export function timeZoneLabel(timeZone: string): string {
  const zone = safeZone(timeZone);
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longGeneric" }).formatToParts(new Date());
    const name = parts.find((part) => part.type === "timeZoneName")?.value;
    return name && name !== zone ? `${name} (${zone})` : zone;
  } catch {
    return zone;
  }
}

/** "Nov 16 service" date for a recording. */
export function formatServiceDate(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: safeZone(timeZone), weekday: "short", month: "short", day: "numeric" }).format(date);
}

/** "Sun, Nov 16 · 24:10 into the service · 45 seconds". */
export function clipPlace(item: Pick<QueueItem, "recordingDate" | "startSec" | "endSec">, timeZone: string): string {
  const parts = [
    formatServiceDate(item.recordingDate, timeZone),
    `${formatTime(item.startSec)} into the service`,
    formatLength(item.endSec - item.startSec),
  ].filter(Boolean);
  return parts.join(" · ");
}

export const POST_WORKING = ["starting", "uploading", "finishing", "processing", "needs_check"];

export type PostView = {
  tone: "working" | "done" | "attention";
  label: string;
  detail: string;
  working: boolean;
  failed: boolean;
};

/** Live post status in plain words. A missing post row means it was just handed over. */
export function postView(post: QueuePost | null): PostView {
  if (!post) return { tone: "working", label: "Posting…", detail: "Sending the video to Facebook.", working: true, failed: false };
  switch (post.status) {
    case "posted":
      return { tone: "done", label: "Posted", detail: "It's on your Facebook Page.", working: false, failed: false };
    case "processing":
      return { tone: "working", label: "Facebook is processing…", detail: "This usually takes a few minutes. This page updates by itself.", working: true, failed: false };
    case "needs_check":
      return { tone: "working", label: "Checking with Facebook…", detail: "We're confirming the post. This page updates by itself.", working: true, failed: false };
    case "failed":
      return {
        tone: "attention",
        label: "Not posted",
        detail: post.last_error || "Facebook didn't accept the video. The clip is saved, so you can try again.",
        working: false,
        failed: true,
      };
    default:
      return { tone: "working", label: "Posting…", detail: "Sending the video to Facebook.", working: true, failed: false };
  }
}

export function renderActive(render: QueueRender | null): boolean {
  return render?.status === "queued" || render?.status === "rendering";
}

/** Whether any clip in a view is still changing, so the page should keep checking. */
export function needsPolling(items: QueueItem[], view: ClipsView): boolean {
  return items.some((item) => {
    if (renderActive(item.render)) return true;
    if (view === "posted") return postView(item.post).working;
    // A clip told to post now sits in Scheduled for about a minute.
    if (view === "scheduled" && item.scheduledFor) return new Date(item.scheduledFor).getTime() - Date.now() < 2 * 60_000;
    return false;
  });
}

export function facebookReady(facebook: FacebookPage): boolean {
  return facebook.connected && !facebook.needsReconnect && Boolean(facebook.pageId);
}

/**
 * Whether Approve can be pressed, and if not, the one sentence saying why.
 * Watching to the end, or ticking "I watched this video", both count.
 */
export function approveState(input: {
  canApprove: boolean;
  facebook: FacebookPage;
  render: QueueRender | null;
  needsReview: boolean;
  watched: boolean;
  confirmed: boolean;
}): { enabled: boolean; reason: string | null } {
  if (!input.canApprove) return { enabled: false, reason: "Ask a church administrator to approve." };
  if (!facebookReady(input.facebook)) {
    return {
      enabled: false,
      reason: input.facebook.needsReconnect ? "Reconnect Facebook to approve clips." : "Connect Facebook to approve clips.",
    };
  }
  if (!input.render || input.render.status !== "ready") return { enabled: false, reason: "The video isn't ready yet." };
  if (input.needsReview) return { enabled: false, reason: "Check the clip in the editor first." };
  if (!input.watched && !input.confirmed) return { enabled: false, reason: "Watch the video to the end, or tick the box." };
  return { enabled: true, reason: null };
}

export const CLIPS_TITLE = "Clips";
export const CLIPS_DESCRIPTION =
  "Short vertical videos from your sermons, with captions, for Facebook. Watch each one, approve it, and it posts on your schedule.";
export const CLIPS_EMPTY_REVIEW =
  "After Sunday's service, FaithForm finds the best moments, crops them for Facebook and adds captions. They'll appear here for you to approve.";

export const CLIP_EDITOR_TITLE = "Edit clip";
export const CLIP_EDITOR_DESCRIPTION =
  "Choose the moment, check the captions and make the final video. Then approve it to post on your schedule.";
