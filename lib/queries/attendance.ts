import type { SupabaseClient } from "@supabase/supabase-js";

export type AttendanceMember = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  photo_url: string | null;
  attendance_count: number;
};

export type SundayRecordStatus = {
  totalPresent: number;
  totalAbsent: number;
  followedUp: number;
};

export type AttendanceEntryWithMember = {
  id: string;
  status: "present" | "absent";
  follow_up_requested: boolean;
  follow_up_sent_at: string | null;
  follow_up_error: string | null;
  follow_up_sms_id: string | null;
  member: AttendanceMember | null;
};

export type AttendanceRecordWithEntries = {
  record: {
    id: string;
    service_date: string;
    total_present: number | null;
    total_absent: number | null;
    notes: string | null;
    submitted_at: string;
  };
  entries: AttendanceEntryWithMember[];
  /**
   * False on a database that never received migration 0014, where there is
   * nowhere to store send results. Callers fall back to `follow_up_requested`
   * as the record of "already contacted" so nobody gets texted twice.
   */
  deliveryTrackingAvailable: boolean;
};

export type MissedStreak = {
  consecutiveAbsent: number;
};

export async function getChurchTimezone(
  supabase: SupabaseClient,
  churchId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("churches")
    .select("timezone")
    .eq("id", churchId)
    .maybeSingle();

  if (error || !data?.timezone) {
    return "America/New_York";
  }

  return data.timezone;
}

export async function getRecentSundayRecords(
  supabase: SupabaseClient,
  churchId: string,
  dates: string[],
): Promise<Map<string, SundayRecordStatus>> {
  const result = new Map<string, SundayRecordStatus>();

  if (dates.length === 0) {
    return result;
  }

  const { data: records, error: recordsError } = await supabase
    .from("attendance_records")
    .select(
      "id, service_date, total_present, total_absent, attendance_entries(follow_up_requested)",
    )
    .eq("church_id", churchId)
    .in("service_date", dates);

  if (recordsError) {
    console.error("getRecentSundayRecords:", recordsError.message);
    return result;
  }

  if (!records?.length) {
    return result;
  }

  for (const record of records) {
    const entries = (record.attendance_entries ?? []) as {
      follow_up_requested: boolean;
    }[];
    const followedUp = entries.filter((entry) => entry.follow_up_requested).length;

    result.set(record.service_date, {
      totalPresent: record.total_present ?? 0,
      totalAbsent: record.total_absent ?? 0,
      followedUp,
    });
  }

  return result;
}

export type RecordedService = {
  id: string;
  serviceDate: string;
  totalPresent: number;
  totalAbsent: number;
};

/** Services that already have attendance saved — the Follow-up page's picker. */
export async function listRecordedServices(
  supabase: SupabaseClient,
  churchId: string,
  limit = 8,
): Promise<RecordedService[]> {
  const { data, error } = await supabase
    .from("attendance_records")
    .select("id, service_date, total_present, total_absent")
    .eq("church_id", churchId)
    .order("service_date", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("listRecordedServices:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    serviceDate: row.service_date as string,
    totalPresent: (row.total_present as number | null) ?? 0,
    totalAbsent: (row.total_absent as number | null) ?? 0,
  }));
}

export async function getRecordByDate(
  supabase: SupabaseClient,
  churchId: string,
  date: string,
): Promise<AttendanceRecordWithEntries | null> {
  const { data: record, error: recordError } = await supabase
    .from("attendance_records")
    .select(
      "id, service_date, total_present, total_absent, notes, submitted_at",
    )
    .eq("church_id", churchId)
    .eq("service_date", date)
    .maybeSingle();

  if (recordError) {
    console.error("getRecordByDate:", recordError.message);
    return null;
  }

  if (!record) {
    return null;
  }

  const MEMBER_COLUMNS = `
      member:members (
        id,
        first_name,
        last_name,
        phone,
        photo_url
      )`;

  const ENTRY_COLUMNS = `
      id,
      status,
      follow_up_requested,
      follow_up_sent_at,
      follow_up_error,
      follow_up_sms_id,${MEMBER_COLUMNS}
    `;

  // Delivery tracking arrived in migration 0014. A database that never got it
  // failed this whole query, so a recorded service rendered as if nobody had
  // been marked absent — the follow-up list came up empty every time. Fall back
  // to the columns that always existed rather than losing the service.
  const LEGACY_ENTRY_COLUMNS = `
      id,
      status,
      follow_up_requested,${MEMBER_COLUMNS}
    `;

  const loadEntries = (columns: string) =>
    supabase
      .from("attendance_entries")
      .select(columns)
      .eq("record_id", record.id)
      .order("status", { ascending: true });

  let deliveryTrackingAvailable = true;
  let { data: entries, error: entriesError } = await loadEntries(ENTRY_COLUMNS);

  if (entriesError && /follow_up_(sent_at|error|sms_id)/i.test(entriesError.message)) {
    console.warn(
      "getRecordByDate: follow-up delivery columns are missing — run `pnpm db:attendance-follow-up`.",
    );
    deliveryTrackingAvailable = false;
    ({ data: entries, error: entriesError } =
      await loadEntries(LEGACY_ENTRY_COLUMNS));
  }

  if (entriesError) {
    console.error("getRecordByDate entries:", entriesError.message);
    return null;
  }

  type RawEntry = {
    id: string;
    status: string;
    follow_up_requested: boolean;
    follow_up_sent_at?: string | null;
    follow_up_error?: string | null;
    follow_up_sms_id?: string | null;
    member: AttendanceMember | AttendanceMember[] | null;
  };

  const normalizedEntries: AttendanceEntryWithMember[] = (
    (entries ?? []) as unknown as RawEntry[]
  ).map(
    (entry) => {
      const rawMember = entry.member as
        | AttendanceMember
        | AttendanceMember[]
        | null;
      const member = Array.isArray(rawMember) ? rawMember[0] ?? null : rawMember;

      return {
        id: entry.id,
        status: entry.status as "present" | "absent",
        follow_up_requested: entry.follow_up_requested,
        follow_up_sent_at: entry.follow_up_sent_at ?? null,
        follow_up_error: entry.follow_up_error ?? null,
        follow_up_sms_id: entry.follow_up_sms_id ?? null,
        member,
      };
    },
  );

  return {
    record,
    entries: normalizedEntries,
    deliveryTrackingAvailable,
  };
}

export async function getActiveMembers(
  supabase: SupabaseClient,
  churchId: string,
): Promise<AttendanceMember[]> {
  const { data, error } = await supabase
    .from("members")
    .select(
      "id, first_name, last_name, phone, photo_url, attendance_entries(count)",
    )
    .eq("church_id", churchId)
    .eq("is_active", true)
    .eq("attendance_entries.status", "present")
    .order("first_name", { ascending: true });

  if (error) {
    console.error("getActiveMembers:", error.message);
    return [];
  }

  return (data ?? []).map((member) => {
    const counts = member.attendance_entries as
      | { count: number }[]
      | null;
    return {
      id: member.id,
      first_name: member.first_name,
      last_name: member.last_name,
      phone: member.phone,
      photo_url: member.photo_url,
      attendance_count: counts?.[0]?.count ?? 0,
    } as AttendanceMember;
  });
}

export async function getMissedStreaks(
  supabase: SupabaseClient,
  churchId: string,
  asOfDate: string,
): Promise<Map<string, MissedStreak>> {
  const counts = await getPriorConsecutiveAbsences(supabase, churchId, asOfDate);
  const streaks = new Map<string, MissedStreak>();

  for (const [memberId, consecutive] of Array.from(counts.entries())) {
    if (consecutive >= 2) {
      streaks.set(memberId, { consecutiveAbsent: consecutive });
    }
  }

  return streaks;
}

export async function getPriorConsecutiveAbsences(
  supabase: SupabaseClient,
  churchId: string,
  asOfDate: string,
  memberIds?: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  const { data: records, error: recordsError } = await supabase
    .from("attendance_records")
    .select("id, service_date")
    .eq("church_id", churchId)
    .lt("service_date", asOfDate)
    .order("service_date", { ascending: false })
    .limit(8);

  if (recordsError || !records?.length) {
    return counts;
  }

  const recordIds = records.map((r) => r.id);

  const { data: entries, error: entriesError } = await supabase
    .from("attendance_entries")
    .select("record_id, member_id, status")
    .in("record_id", recordIds)
    .not("member_id", "is", null);

  if (entriesError || !entries?.length) {
    return counts;
  }

  const entriesByRecord = new Map<string, typeof entries>();
  for (const recordId of recordIds) {
    entriesByRecord.set(
      recordId,
      entries.filter((e) => e.record_id === recordId),
    );
  }

  const targetMemberIds = memberIds?.length
    ? memberIds
    : Array.from(
        new Set(
          entries
            .map((e) => e.member_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

  for (const memberId of targetMemberIds) {
    let consecutive = 0;

    for (const record of records) {
      const recordEntries = entriesByRecord.get(record.id) ?? [];
      const memberEntry = recordEntries.find((e) => e.member_id === memberId);

      if (!memberEntry || memberEntry.status !== "absent") {
        break;
      }

      consecutive++;
    }

    if (consecutive > 0) {
      counts.set(memberId, consecutive);
    }
  }

  return counts;
}
