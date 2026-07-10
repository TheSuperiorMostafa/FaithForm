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
    .select("id, service_date, total_present, total_absent")
    .eq("church_id", churchId)
    .in("service_date", dates);

  if (recordsError) {
    console.error("getRecentSundayRecords:", recordsError.message);
    return result;
  }

  if (!records?.length) {
    return result;
  }

  const recordIds = records.map((r) => r.id);

  const { data: entries, error: entriesError } = await supabase
    .from("attendance_entries")
    .select("record_id, follow_up_requested")
    .in("record_id", recordIds);

  if (entriesError) {
    console.error("getRecentSundayRecords entries:", entriesError.message);
    return result;
  }

  for (const record of records) {
    const followedUp =
      entries?.filter(
        (e) => e.record_id === record.id && e.follow_up_requested,
      ).length ?? 0;

    result.set(record.service_date, {
      totalPresent: record.total_present ?? 0,
      totalAbsent: record.total_absent ?? 0,
      followedUp,
    });
  }

  return result;
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

  const { data: entries, error: entriesError } = await supabase
    .from("attendance_entries")
    .select(
      `
      id,
      status,
      follow_up_requested,
      follow_up_sent_at,
      follow_up_error,
      follow_up_sms_id,
      member:members (
        id,
        first_name,
        last_name,
        phone,
        photo_url
      )
    `,
    )
    .eq("record_id", record.id)
    .order("status", { ascending: true });

  if (entriesError) {
    console.error("getRecordByDate entries:", entriesError.message);
    return null;
  }

  const normalizedEntries: AttendanceEntryWithMember[] = (entries ?? []).map(
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
  };
}

export async function getActiveMembers(
  supabase: SupabaseClient,
  churchId: string,
): Promise<AttendanceMember[]> {
  const { data, error } = await supabase
    .from("members")
    .select("id, first_name, last_name, phone, photo_url")
    .eq("church_id", churchId)
    .eq("is_active", true)
    .order("first_name", { ascending: true });

  if (error) {
    console.error("getActiveMembers:", error.message);
    return [];
  }

  const members = (data ?? []) as Omit<AttendanceMember, "attendance_count">[];

  const { data: presentEntries, error: countsError } = await supabase
    .from("attendance_entries")
    .select("member_id")
    .eq("church_id", churchId)
    .eq("status", "present")
    .not("member_id", "is", null);

  if (countsError) {
    console.error("getActiveMembers counts:", countsError.message);
  }

  const countByMember = new Map<string, number>();
  for (const entry of presentEntries ?? []) {
    if (!entry.member_id) continue;
    countByMember.set(
      entry.member_id,
      (countByMember.get(entry.member_id) ?? 0) + 1,
    );
  }

  return members.map((m) => ({
    ...m,
    attendance_count: countByMember.get(m.id) ?? 0,
  }));
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
