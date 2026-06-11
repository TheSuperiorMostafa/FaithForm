import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import {
  AUTOMATION_CATALOG,
  DERIVED_AUTOMATION_TYPES,
  type AutomationCategory,
  type AutomationType,
} from "@/lib/automation-catalog";

export type AnnouncementStatus = "draft" | "scheduled" | "active" | "ended";

export function computeAnnouncementStatus(
  isReady: boolean,
  startAt: string,
  endAt: string | null,
): AnnouncementStatus {
  if (!isReady) return "draft";

  const now = Date.now();
  const start = new Date(startAt).getTime();
  const end = endAt ? new Date(endAt).getTime() : null;

  if (end !== null && end < now) return "ended";
  if (start > now) return "scheduled";
  return "active";
}

export type DashboardRange = "week" | "month" | "all";

export type CategoryBreakdown = Record<AutomationCategory, number>;

export type HoursSavedResult = {
  totalMinutes: number;
  totalHours: number;
  taskCount: number;
  deltaPercent: number | null;
  byCategory: CategoryBreakdown;
};

export type StatMetric = {
  value: number;
  deltaPercent: number | null;
  sparkline: number[];
};

export type StatRowResult = {
  phoneCalls: StatMetric;
  smPosts: StatMetric;
  pptxCreated: StatMetric;
};

export type AttendanceWeekPoint = {
  weekLabel: string;
  serviceDate: string;
  present: number;
};

/** @deprecated Use AttendanceWeekPoint — kept for attendance-chart-client */
export type AttendancePoint = {
  serviceDate: string;
  count: number;
};

export type AttendanceTrendResult = {
  points: AttendanceWeekPoint[];
  lastPresent: number | null;
  lastServiceDate: string | null;
  vsFourWeekAvgPercent: number | null;
};

const EMPTY_CATEGORY: CategoryBreakdown = {
  Calendar: 0,
  Communication: 0,
  Phone: 0,
  Social: 0,
  Admin: 0,
};

function emptyBreakdown(): CategoryBreakdown {
  return { ...EMPTY_CATEGORY };
}

function addToCategory(
  breakdown: CategoryBreakdown,
  category: AutomationCategory,
  minutes: number,
) {
  breakdown[category] += minutes;
}

export function parseDashboardRange(
  value: string | string[] | undefined,
): DashboardRange {
  if (value === "month" || value === "all") return value;
  return "week";
}

type DateWindow = {
  currentStart: Date | null;
  currentEnd: Date;
  priorStart: Date | null;
  priorEnd: Date | null;
};

function getDateWindow(range: DashboardRange): DateWindow {
  const now = new Date();
  const currentEnd = now;

  if (range === "all") {
    return {
      currentStart: null,
      currentEnd,
      priorStart: null,
      priorEnd: null,
    };
  }

  const days = range === "week" ? 7 : 30;
  const currentStart = new Date(now);
  currentStart.setDate(currentStart.getDate() - days);

  const priorEnd = new Date(currentStart);
  const priorStart = new Date(priorEnd);
  priorStart.setDate(priorStart.getDate() - days);

  return { currentStart, currentEnd, priorStart, priorEnd };
}

function inWindow(
  iso: string | null | undefined,
  start: Date | null,
  end: Date,
): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (start && d < start) return false;
  if (d > end) return false;
  return true;
}

function percentDelta(current: number, prior: number): number | null {
  if (prior === 0) {
    return current === 0 ? 0 : 100;
  }
  return Math.round(((current - prior) / prior) * 100);
}

function toHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

function countAttendanceReportsInRange(
  records: { service_date: string }[],
  start: Date | null,
  end: Date,
): { monthly: number; quarterly: number; annual: number } {
  const months = new Set<string>();
  const quarters = new Set<string>();
  const years = new Set<string>();

  for (const r of records) {
    const d = new Date(r.service_date);
    if (!inWindow(r.service_date, start, end)) continue;
    const y = d.getFullYear();
    const m = d.getMonth();
    months.add(`${y}-${m}`);
    quarters.add(`${y}-Q${Math.floor(m / 3)}`);
    years.add(String(y));
  }

  return {
    monthly: months.size,
    quarterly: quarters.size,
    annual: years.size,
  };
}

type AnnouncementRow = {
  created_at: string;
  push_to_app: boolean | null;
  push_to_facebook: boolean | null;
  push_to_team: boolean | null;
};

type PhoneCallRow = { called_at: string | null; created_at?: string };
type AttendanceRow = { service_date: string; submitted_at: string | null };
type SermonAssetRow = {
  kind: string;
  created_at: string;
  sermons: { church_id: string } | { church_id: string }[] | null;
};
type ActivityRow = {
  automation_type: string;
  category: string | null;
  time_saved_minutes: number | null;
  executed_at: string;
};

async function computeDerivedMinutes(
  supabase: SupabaseClient,
  churchId: string,
  window: DateWindow,
  forPrior: boolean,
): Promise<{ minutes: number; tasks: number; byCategory: CategoryBreakdown }> {
  const start = forPrior ? window.priorStart : window.currentStart;
  const end = forPrior
    ? window.priorEnd ?? window.currentEnd
    : window.currentEnd;

  if (forPrior && (!start || !end)) {
    return { minutes: 0, tasks: 0, byCategory: emptyBreakdown() };
  }

  const endDate = end ?? window.currentEnd;

  const [phoneRes, annRes, attRes, assetsRes, activityRes] = await Promise.all([
    supabase
      .from("phone_calls")
      .select("called_at")
      .eq("church_id", churchId),
    supabase
      .from("announcements")
      .select("created_at, push_to_app, push_to_facebook, push_to_team")
      .eq("church_id", churchId),
    supabase
      .from("attendance_records")
      .select("service_date, submitted_at")
      .eq("church_id", churchId),
    supabase
      .from("sermon_assets")
      .select("kind, created_at, sermons!inner(church_id)")
      .eq("sermons.church_id", churchId),
    supabase
      .from("activity_log")
      .select("automation_type, category, time_saved_minutes, executed_at")
      .eq("church_id", churchId),
  ]);

  const byCategory = emptyBreakdown();
  let minutes = 0;
  let tasks = 0;

  const phoneCalls = (phoneRes.data ?? []) as PhoneCallRow[];
  const phoneCount = phoneCalls.filter((r) =>
    inWindow(r.called_at, start, endDate),
  ).length;
  if (phoneCount > 0) {
    const m =
      phoneCount * AUTOMATION_CATALOG["Phone Call + Duration of Call"].minutes;
    minutes += m;
    tasks += phoneCount;
    addToCategory(byCategory, "Phone", m);
  }

  const announcements = (annRes.data ?? []) as AnnouncementRow[];
  for (const a of announcements) {
    if (!inWindow(a.created_at, start, endDate)) continue;
    if (a.push_to_app) {
      const m = AUTOMATION_CATALOG["Church App Updated"].minutes;
      minutes += m;
      tasks += 1;
      addToCategory(byCategory, "Calendar", m);
    }
    if (a.push_to_facebook) {
      const m =
        AUTOMATION_CATALOG["Facebook Post about Announcement"].minutes;
      minutes += m;
      tasks += 1;
      addToCategory(byCategory, "Social", m);
    }
    if (a.push_to_team) {
      const m = AUTOMATION_CATALOG["Announcement Email"].minutes;
      minutes += m;
      tasks += 1;
      addToCategory(byCategory, "Communication", m);
    }
  }

  const attendance = (attRes.data ?? []) as AttendanceRow[];
  const inRangeAttendance = attendance.filter((r) =>
    inWindow(r.submitted_at ?? `${r.service_date}T12:00:00Z`, start, endDate),
  );
  if (inRangeAttendance.length > 0) {
    const weeklyM =
      inRangeAttendance.length *
      AUTOMATION_CATALOG["Track Weekly Attendance"].minutes;
    minutes += weeklyM;
    tasks += inRangeAttendance.length;
    addToCategory(byCategory, "Admin", weeklyM);

    const reports = countAttendanceReportsInRange(
      inRangeAttendance,
      start,
      endDate,
    );
    if (reports.monthly > 0) {
      const m =
        reports.monthly *
        AUTOMATION_CATALOG["Monthly Attendance Report"].minutes;
      minutes += m;
      tasks += reports.monthly;
      addToCategory(byCategory, "Admin", m);
    }
    if (reports.quarterly > 0) {
      const m =
        reports.quarterly *
        AUTOMATION_CATALOG["Quarterly Attendance Report"].minutes;
      minutes += m;
      tasks += reports.quarterly;
      addToCategory(byCategory, "Admin", m);
    }
    if (reports.annual > 0) {
      const m =
        reports.annual * AUTOMATION_CATALOG["Annual Attendance Report"].minutes;
      minutes += m;
      tasks += reports.annual;
      addToCategory(byCategory, "Admin", m);
    }
  }

  const assets = (assetsRes.data ?? []) as SermonAssetRow[];
  for (const asset of assets) {
    if (!inWindow(asset.created_at, start, endDate)) continue;
    if (asset.kind === "social_snippet") {
      const m = AUTOMATION_CATALOG["Right Now Media Post"].minutes;
      minutes += m;
      tasks += 1;
      addToCategory(byCategory, "Social", m);
    } else if (asset.kind === "export_pptx") {
      const m = AUTOMATION_CATALOG["Facebook Post about Announcement"].minutes;
      minutes += m;
      tasks += 1;
      addToCategory(byCategory, "Social", m);
    } else if (asset.kind === "export_pdf") {
      const m = AUTOMATION_CATALOG["Sermon PDF Exported"].minutes;
      minutes += m;
      tasks += 1;
      addToCategory(byCategory, "Admin", m);
    }
  }

  const activities = (activityRes.data ?? []) as ActivityRow[];
  for (const row of activities) {
    if (!inWindow(row.executed_at, start, endDate)) continue;
    if (DERIVED_AUTOMATION_TYPES.has(row.automation_type)) continue;

    const catalog = AUTOMATION_CATALOG[row.automation_type as AutomationType];
    const m =
      row.time_saved_minutes ??
      catalog?.minutes ??
      0;
    if (m <= 0) continue;

    minutes += m;
    tasks += 1;
    const cat =
      (catalog?.category as AutomationCategory | undefined) ??
      (row.category as AutomationCategory | undefined) ??
      "Admin";
    if (cat in byCategory) {
      addToCategory(byCategory, cat, m);
    }
  }

  return { minutes, tasks, byCategory };
}

export async function getCurrentChurchId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("church_users")
    .select("church_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getCurrentChurchId:", error.message);
  }

  if (data?.church_id) {
    return data.church_id;
  }

  const admin = createAdminClientOrNull();
  if (!admin) {
    return null;
  }

  const { data: adminData, error: adminError } = await admin
    .from("church_users")
    .select("church_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (adminError) {
    console.error("getCurrentChurchId admin:", adminError.message);
  }

  return adminData?.church_id ?? null;
}

export async function getHoursSavedBreakdown(
  supabase: SupabaseClient,
  churchId: string,
  range: DashboardRange,
): Promise<HoursSavedResult> {
  const window = getDateWindow(range);

  const [current, prior] = await Promise.all([
    computeDerivedMinutes(supabase, churchId, window, false),
    computeDerivedMinutes(supabase, churchId, window, true),
  ]);

  const byCategory = current.byCategory;
  const totalMinutes = current.minutes;

  return {
    totalMinutes,
    totalHours: toHours(totalMinutes),
    taskCount: current.tasks,
    deltaPercent:
      range === "all"
        ? null
        : percentDelta(current.minutes, prior.minutes),
    byCategory,
  };
}

function buildSparkline(
  dates: string[],
  window: DateWindow,
  buckets = 8,
): number[] {
  const { currentStart, currentEnd } = window;
  const start = currentStart ?? new Date(0);
  const span = currentEnd.getTime() - start.getTime();
  const bucketMs = span / buckets || 1;
  const counts = Array.from({ length: buckets }, () => 0);

  for (const iso of dates) {
    const t = new Date(iso).getTime();
    if (t < start.getTime() || t > currentEnd.getTime()) continue;
    const idx = Math.min(
      buckets - 1,
      Math.floor((t - start.getTime()) / bucketMs),
    );
    counts[idx] += 1;
  }

  return counts;
}

async function countInRanges<T extends { at: string }>(
  rows: T[],
  window: DateWindow,
): Promise<{ current: number; prior: number; dates: string[] }> {
  const currentDates: string[] = [];
  let current = 0;
  let prior = 0;

  for (const row of rows) {
    if (inWindow(row.at, window.currentStart, window.currentEnd)) {
      current += 1;
      currentDates.push(row.at);
    } else if (
      window.priorStart &&
      window.priorEnd &&
      inWindow(row.at, window.priorStart, window.priorEnd)
    ) {
      prior += 1;
    }
  }

  return { current, prior, dates: currentDates };
}

export async function getStatRow(
  supabase: SupabaseClient,
  churchId: string,
  range: DashboardRange,
): Promise<StatRowResult> {
  const window = getDateWindow(range);

  const [phoneRes, annRes, assetsRes] = await Promise.all([
    supabase.from("phone_calls").select("called_at").eq("church_id", churchId),
    supabase
      .from("announcements")
      .select("created_at, push_to_facebook")
      .eq("church_id", churchId),
    supabase
      .from("sermon_assets")
      .select("kind, created_at, sermons!inner(church_id)")
      .eq("sermons.church_id", churchId),
  ]);

  const phoneRows = (phoneRes.data ?? []).map((r) => ({
    at: (r as PhoneCallRow).called_at ?? "",
  }));
  const smRows: { at: string }[] = [];
  for (const a of (annRes.data ?? []) as AnnouncementRow[]) {
    if (a.push_to_facebook) smRows.push({ at: a.created_at });
  }
  for (const asset of (assetsRes.data ?? []) as SermonAssetRow[]) {
    if (asset.kind === "social_snippet") {
      smRows.push({ at: asset.created_at });
    }
  }

  const pptxRows: { at: string }[] = [];
  for (const asset of (assetsRes.data ?? []) as SermonAssetRow[]) {
    if (asset.kind === "pptx" || asset.kind === "slides") {
      pptxRows.push({ at: asset.created_at });
    }
  }

  const phone = await countInRanges(phoneRows.filter((r) => r.at), window);
  const sm = await countInRanges(smRows, window);
  const pptx = await countInRanges(pptxRows, window);

  const makeMetric = (
    current: number,
    prior: number,
    dates: string[],
  ): StatMetric => ({
    value: current,
    deltaPercent:
      range === "all" ? null : percentDelta(current, prior),
    sparkline: buildSparkline(dates, window),
  });

  return {
    phoneCalls: makeMetric(phone.current, phone.prior, phone.dates),
    smPosts: makeMetric(sm.current, sm.prior, sm.dates),
    pptxCreated: makeMetric(pptx.current, pptx.prior, pptx.dates),
  };
}

export async function getAttendanceTrend(
  supabase: SupabaseClient,
  churchId: string,
): Promise<AttendanceTrendResult> {
  const since = new Date();
  since.setDate(since.getDate() - 12 * 7);

  const { data } = await supabase
    .from("attendance_records")
    .select("service_date, total_present")
    .eq("church_id", churchId)
    .gte("service_date", since.toISOString().slice(0, 10))
    .order("service_date", { ascending: true });

  const records = (data ?? []) as {
    service_date: string;
    total_present: number | null;
  }[];

  const points: AttendanceWeekPoint[] = records.map((r) => {
    const d = new Date(r.service_date);
    const label = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    return {
      weekLabel: label,
      serviceDate: r.service_date,
      present: r.total_present ?? 0,
    };
  });

  const last = points.at(-1) ?? null;
  const lastFour = points.slice(-4);
  const fourAvg =
    lastFour.length > 0
      ? lastFour.reduce((s, p) => s + p.present, 0) / lastFour.length
      : null;

  let vsFourWeekAvgPercent: number | null = null;
  if (last && fourAvg && fourAvg > 0) {
    vsFourWeekAvgPercent = Math.round(
      ((last.present - fourAvg) / fourAvg) * 100,
    );
  }

  return {
    points,
    lastPresent: last?.present ?? null,
    lastServiceDate: last?.serviceDate ?? null,
    vsFourWeekAvgPercent,
  };
}
