import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Announcements that were posted from the composer without a calendar event.
 *
 * They are ordinary `announcements` rows with no `google_event_id`. The ones
 * that are not about an event at all ("Office closed") also have no
 * `event_date`, which is what keeps them off the website's upcoming events
 * and lets the page say "Posted Sep 25" instead of inventing an event time.
 */

export type TakenDownAnnouncement = {
  id: string;
  title: string;
  body: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  undated: boolean;
  graphicUrl: string | null;
  graphicPath: string | null;
  takenDownAt: string;
};

/** Ids of published announcements that are not about an event. */
export async function listUndatedAnnouncementIds(
  supabase: SupabaseClient,
  churchId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("announcements")
    .select("id")
    .eq("church_id", churchId)
    .eq("status", "published")
    .is("google_event_id", null)
    .is("event_date", null);

  if (error) {
    console.error("[announcements] undated ids:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.id as string));
}

/**
 * The most recent announcements someone took down that have no calendar event
 * to come back from, so they can be posted again. Calendar events that were
 * taken down show up among the calendar's events instead.
 *
 * `unsubmitted_at` arrived in 0041 and the image columns in 0023; a database
 * missing either gets an empty list, never an error on the page.
 */
export async function listTakenDownAnnouncements(
  supabase: SupabaseClient,
  churchId: string,
  limit = 10,
): Promise<TakenDownAnnouncement[]> {
  const select = (columns: string) =>
    supabase
      .from("announcements")
      .select(columns)
      .eq("church_id", churchId)
      .neq("status", "published")
      .is("google_event_id", null)
      .not("unsubmitted_at", "is", null)
      .order("unsubmitted_at", { ascending: false })
      .limit(limit);

  let { data, error } = await select(
    "id, title, event_title, body, notes, start_at, end_at, all_day, event_location, event_date, social_graphic_url, social_graphic_path, unsubmitted_at",
  );
  if (error && /all_day|social_graphic/i.test(error.message)) {
    ({ data, error } = await select(
      "id, title, event_title, body, notes, start_at, end_at, event_location, event_date, unsubmitted_at",
    ));
  }
  if (error) {
    if (!/unsubmitted_at/i.test(error.message)) {
      console.error("[announcements] taken down:", error.message);
    }
    return [];
  }

  return ((data ?? []) as unknown as Record<string, unknown>[])
    .filter((row) => row.start_at || row.event_date)
    .map((row) => ({
      id: row.id as string,
      title: (row.title as string) || (row.event_title as string) || "",
      body: (row.body as string) || (row.notes as string) || "",
      startAt: ((row.start_at as string | null) ?? (row.event_date as string)) as string,
      endAt: (row.end_at as string | null) ?? null,
      allDay: Boolean(row.all_day),
      location: (row.event_location as string | null) ?? null,
      undated: !row.event_date,
      graphicUrl: (row.social_graphic_url as string | null) ?? null,
      graphicPath: (row.social_graphic_path as string | null) ?? null,
      takenDownAt: row.unsubmitted_at as string,
    }));
}
