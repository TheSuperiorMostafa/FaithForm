import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTOMATION_CATALOG,
  DERIVED_AUTOMATION_TYPES,
  type AutomationCategory,
  type AutomationType,
} from "@/lib/automation-catalog";
import { phoneCallMinutesSaved } from "@/lib/utils/phone-call-time-saved";

export type CategoryBreakdown = Record<AutomationCategory, number>;

export type HoursSavedWindow = {
  start: Date | null;
  end: Date;
};

export type HoursSavedComputation = {
  minutes: number;
  tasks: number;
  byCategory: CategoryBreakdown;
  automationMinutes: Map<string, number>;
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

function creditAutomation(
  automationMinutes: Map<string, number>,
  automationType: string,
  minutes: number,
) {
  if (minutes <= 0) return;
  automationMinutes.set(
    automationType,
    (automationMinutes.get(automationType) ?? 0) + minutes,
  );
}

export function inHoursSavedWindow(
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

export function toHoursSaved(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
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
    if (!inHoursSavedWindow(r.service_date, start, end)) continue;
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
  push_to_facebook: boolean | null;
  push_to_team: boolean | null;
};

type PhoneCallRow = {
  called_at: string | null;
  duration_seconds: number | null;
  call_type: string | null;
};

type AttendanceRow = { service_date: string; submitted_at: string | null };

type SermonAssetRow = {
  kind: string;
  created_at: string;
  sermons: { church_id: string } | { church_id: string }[] | null;
};

type SermonRow = {
  created_at: string;
  outline_generated_at: string | null;
  content_generated_at: string | null;
  published_at: string | null;
  status: string;
};

type ActivityRow = {
  automation_type: string;
  category: string | null;
  time_saved_minutes: number | null;
  executed_at: string;
};

function creditCatalogEntry(
  automationMinutes: Map<string, number>,
  byCategory: CategoryBreakdown,
  automationType: AutomationType,
  count = 1,
): number {
  const entry = AUTOMATION_CATALOG[automationType];
  const totalMinutes = entry.minutes * count;
  creditAutomation(automationMinutes, automationType, totalMinutes);
  addToCategory(byCategory, entry.category, totalMinutes);
  return totalMinutes;
}

export type HoursSavedSources = {
  phoneCalls: PhoneCallRow[];
  announcements: AnnouncementRow[];
  attendance: AttendanceRow[];
  assets: SermonAssetRow[];
  sermons: SermonRow[];
  activities: ActivityRow[];
};

export async function loadHoursSavedSources(
  supabase: SupabaseClient,
  churchId: string,
  window: HoursSavedWindow,
  paginate = false,
  phoneClient: SupabaseClient = supabase,
): Promise<HoursSavedSources> {
  const { start, end } = window;
  const startIso = start?.toISOString();
  const endIso = end.toISOString();

  const phoneQuery = phoneClient
    .from("phone_calls")
    .select("called_at, duration_seconds, call_type")
    .eq("church_id", churchId)
    .lte("called_at", endIso);
  const announcementQuery = supabase
    .from("announcements")
    .select("created_at, push_to_facebook, push_to_team")
    .eq("church_id", churchId)
    .lte("created_at", endIso);
  const assetQuery = supabase
    .from("sermon_assets")
    .select("kind, created_at, sermons!inner(church_id)")
    .eq("sermons.church_id", churchId)
    .lte("created_at", endIso);
  const activityQuery = supabase
    .from("activity_log")
    .select("automation_type, category, time_saved_minutes, executed_at")
    .eq("church_id", churchId)
    .lte("executed_at", endIso);

  if (startIso) {
    phoneQuery.gte("called_at", startIso);
    announcementQuery.gte("created_at", startIso);
    assetQuery.gte("created_at", startIso);
    activityQuery.gte("executed_at", startIso);
  }

  // The dashboard needs every range from this snapshot, including records beyond
  // PostgREST's row cap. Other reports retain their existing bounded query path.
  type RowsResult = { data: unknown[] | null; error: unknown };
  type SourceQuery = PromiseLike<RowsResult> & {
    order(column: string): unknown;
    range(start: number, end: number): PromiseLike<RowsResult>;
  };
  const read = async (query: SourceQuery) => {
    if (!paginate) return await query;
    const rows: unknown[] = [];
    const pageSize = 1000;
    query.order("id");
    for (let offset = 0; ; offset += pageSize) {
      const result = await query.range(offset, offset + pageSize - 1);
      if (result.error) throw result.error;
      rows.push(...(result.data ?? []));
      if (!result.data || result.data.length < pageSize) return { data: rows };
    }
  };
  const [phoneRes, annRes, attRes, assetsRes, sermonsRes, activityRes] =
    await Promise.all([
      read(phoneQuery),
      read(announcementQuery),
      read(supabase
        .from("attendance_records")
        .select("service_date, submitted_at")
        .eq("church_id", churchId)),
      read(assetQuery),
      read(supabase
        .from("sermons")
        .select(
          "created_at, outline_generated_at, content_generated_at, published_at, status",
        )
        .eq("church_id", churchId)),
      read(activityQuery),
    ]);

  return {
    phoneCalls: (phoneRes.data ?? []) as PhoneCallRow[],
    announcements: (annRes.data ?? []) as AnnouncementRow[],
    attendance: (attRes.data ?? []) as AttendanceRow[],
    assets: (assetsRes.data ?? []) as SermonAssetRow[],
    sermons: (sermonsRes.data ?? []) as SermonRow[],
    activities: (activityRes.data ?? []) as ActivityRow[],
  };
}

export async function computeHoursSaved(
  supabase: SupabaseClient,
  churchId: string,
  window: HoursSavedWindow,
  phoneClient: SupabaseClient = supabase,
): Promise<HoursSavedComputation> {
  return computeHoursSavedFromSources(await loadHoursSavedSources(supabase, churchId, window, false, phoneClient), window);
}

/** Reuse one authorized snapshot for different reporting windows. */
export function computeHoursSavedFromSources(
  sources: HoursSavedSources,
  { start, end }: HoursSavedWindow,
): HoursSavedComputation {
  const automationMinutes = new Map<string, number>();
  const byCategory = emptyBreakdown();
  let minutes = 0;
  let tasks = 0;
  const { phoneCalls, announcements, attendance, assets, sermons, activities } = sources;
  const phoneCallsInWindow = phoneCalls.filter((r) =>
    inHoursSavedWindow(r.called_at, start, end),
  );
  if (phoneCallsInWindow.length > 0) {
    let phoneMinutes = 0;
    for (const call of phoneCallsInWindow) {
      const callMinutes = phoneCallMinutesSaved(call.duration_seconds);
      phoneMinutes += callMinutes;
      creditAutomation(
        automationMinutes,
        "Phone Call + Duration of Call",
        callMinutes,
      );
    }
    minutes += phoneMinutes;
    tasks += phoneCallsInWindow.length;
    addToCategory(byCategory, "Phone", phoneMinutes);
  }

  for (const a of announcements) {
    if (!inHoursSavedWindow(a.created_at, start, end)) continue;
    if (a.push_to_facebook) {
      const m = creditCatalogEntry(
        automationMinutes,
        byCategory,
        "Facebook Post about Announcement",
      );
      minutes += m;
      tasks += 1;
    }
    if (a.push_to_team) {
      const m = creditCatalogEntry(
        automationMinutes,
        byCategory,
        "Announcement Email",
      );
      minutes += m;
      tasks += 1;
    }
  }

  const inRangeAttendance = attendance.filter((r) =>
    inHoursSavedWindow(
      r.submitted_at ?? `${r.service_date}T12:00:00Z`,
      start,
      end,
    ),
  );
  if (inRangeAttendance.length > 0) {
    const weeklyM = creditCatalogEntry(
      automationMinutes,
      byCategory,
      "Track Weekly Attendance",
      inRangeAttendance.length,
    );
    minutes += weeklyM;
    tasks += inRangeAttendance.length;

    // Only credit reports FaithForm actually generates today (monthly PDF).
    const reports = countAttendanceReportsInRange(
      inRangeAttendance,
      start,
      end,
    );
    if (reports.monthly > 0) {
      const m = creditCatalogEntry(
        automationMinutes,
        byCategory,
        "Monthly Attendance Report",
        reports.monthly,
      );
      minutes += m;
      tasks += reports.monthly;
    }
  }

  const assetTypeByKind: Record<string, AutomationType> = {
    social_snippet: "Social Snippet Generated",
    discussion_questions: "Discussion Questions Generated",
    export_pdf: "Sermon PDF Exported",
    export_pptx: "Sermon PPTX Exported",
  };

  for (const asset of assets) {
    if (!inHoursSavedWindow(asset.created_at, start, end)) continue;
    const automationType = assetTypeByKind[asset.kind];
    if (!automationType) continue;
    const m = creditCatalogEntry(automationMinutes, byCategory, automationType);
    minutes += m;
    tasks += 1;
  }

  for (const sermon of sermons) {
    if (inHoursSavedWindow(sermon.created_at, start, end)) {
      const m = creditCatalogEntry(
        automationMinutes,
        byCategory,
        "Sermon Created",
      );
      minutes += m;
      tasks += 1;
    }
    if (
      sermon.outline_generated_at &&
      inHoursSavedWindow(sermon.outline_generated_at, start, end)
    ) {
      const m = creditCatalogEntry(
        automationMinutes,
        byCategory,
        "Sermon Outline Generated",
      );
      minutes += m;
      tasks += 1;
    }
    if (
      sermon.content_generated_at &&
      inHoursSavedWindow(sermon.content_generated_at, start, end)
    ) {
      const m = creditCatalogEntry(
        automationMinutes,
        byCategory,
        "Sermon Draft Generated",
      );
      minutes += m;
      tasks += 1;
    }
    if (
      sermon.status === "published" &&
      sermon.published_at &&
      inHoursSavedWindow(sermon.published_at, start, end)
    ) {
      const m = creditCatalogEntry(
        automationMinutes,
        byCategory,
        "Sermon Published",
      );
      minutes += m;
      tasks += 1;
    }
  }

  for (const row of activities) {
    if (!inHoursSavedWindow(row.executed_at, start, end)) continue;
    if (DERIVED_AUTOMATION_TYPES.has(row.automation_type)) continue;

    const catalog = AUTOMATION_CATALOG[row.automation_type as AutomationType];
    const m =
      row.time_saved_minutes ?? catalog?.minutes ?? 0;
    if (m <= 0) continue;

    minutes += m;
    tasks += 1;
    creditAutomation(automationMinutes, row.automation_type, m);
    const cat =
      (catalog?.category as AutomationCategory | undefined) ??
      (row.category as AutomationCategory | undefined) ??
      "Admin";
    if (cat in byCategory) {
      addToCategory(byCategory, cat, m);
    }
  }

  return { minutes, tasks, byCategory, automationMinutes };
}

export function topAutomationsFromMap(
  automationMinutes: Map<string, number>,
  limit = 5,
): { rank: number; automationType: string; minutes: number }[] {
  return Array.from(automationMinutes.entries())
    .filter(([, mins]) => mins > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([automationType, mins], index) => ({
      rank: index + 1,
      automationType,
      minutes: mins,
    }));
}
