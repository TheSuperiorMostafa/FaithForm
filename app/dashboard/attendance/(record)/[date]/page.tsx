import { notFound, redirect } from "next/navigation";

import { AttendanceSummary, type CheckedInElsewhere } from "./attendance-summary";
import { AttendanceWizard } from "./attendance-wizard";
import {
  checkedInOtherwise,
  getPresenceOnDate,
  type PresenceMethod,
} from "@/lib/attendance/presence";
import {
  getActiveMembers,
  getChurchTimezone,
  getRecordByDate,
  type AttendanceMember,
} from "@/lib/queries/attendance";
import { getFeatureAccess } from "@/lib/features/access";
import { getCurrentChurchId } from "@/lib/auth/current-church";
import { createClient } from "@/lib/supabase/server";
import { isSundayDate, isValidDateParam } from "@/lib/utils/dates";

type PageProps = {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ edit?: string }>;
};

export default async function AttendanceDatePage({ params, searchParams }: PageProps) {
  const [{ date }, query] = await Promise.all([params, searchParams]);

  if (!isValidDateParam(date)) {
    notFound();
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const churchId = await getCurrentChurchId(supabase, user.id);

  if (!churchId) {
    redirect("/dashboard/attendance");
  }

  const timezone = await getChurchTimezone(supabase, churchId);

  if (!isSundayDate(date, timezone)) {
    notFound();
  }

  const [existing, presence] = await Promise.all([
    getRecordByDate(supabase, churchId, date),
    getPresenceOnDate(supabase, churchId, date),
  ]);

  // Everyone the app, a code, the kiosk, the Services roster or a room already
  // counted this day. They came, whatever the sheet says or has yet to say.
  const checkedIn = new Map<string, PresenceMethod[]>();
  for (const [memberId, methods] of presence ?? []) {
    const other = checkedInOtherwise(methods);
    if (other.length > 0) checkedIn.set(memberId, other);
  }

  // Correcting a saved Sunday: the same sheet, starting from what was saved.
  if (existing && query.edit === "1") {
    const active = await getActiveMembers(supabase, churchId);
    const saved = new Map<string, "present" | "absent">();
    const onSheet: AttendanceMember[] = [];
    for (const entry of existing.entries) {
      if (!entry.member) continue;
      saved.set(entry.member.id, entry.status as "present" | "absent");
      onSheet.push(entry.member);
    }
    const listed = new Set(active.map((member) => member.id));
    const others = onSheet.filter((member) => !listed.has(member.id));
    const unlisted = await getMembersByIds(
      supabase,
      churchId,
      Array.from(checkedIn.keys()).filter((id) => !listed.has(id) && !saved.has(id)),
    );

    // Saved as one number: it opens as that number, and can be switched to
    // names. Saved by name: names only, so nobody's mark is lost.
    const countedByNumber = existing.entries.length === 0;
    const access = await getFeatureAccess(supabase);

    return (
      <AttendanceWizard
        serviceDate={date}
        members={[...active, ...others, ...unlisted.values()]}
        checkedIn={Object.fromEntries(checkedIn)}
        initialStatuses={Object.fromEntries(saved)}
        initialNotes={existing.record.notes ?? ""}
        initialMode={countedByNumber ? "number" : "names"}
        initialHeadcount={countedByNumber ? existing.record.total_present : null}
        numberAllowed={countedByNumber}
        canFollowUp={access?.allowed.includes("attendance_follow_up") ?? false}
        editing
      />
    );
  }

  const access = await getFeatureAccess(supabase);

  if (existing) {

    const onSheetPresent = new Set(
      existing.entries
        .filter((entry) => entry.status === "present" && entry.member)
        .map((entry) => entry.member!.id),
    );
    const onSheet = new Map(
      existing.entries
        .filter((entry) => entry.member)
        .map((entry) => [entry.member!.id, entry.member!] as const),
    );

    // Not on the sheet at all: look them up.
    const missing = Array.from(checkedIn.keys()).filter((id) => !onSheet.has(id));
    const extra = await getMembersByIds(supabase, churchId, missing);

    const checkedInElsewhere: CheckedInElsewhere[] = [];
    for (const [memberId, methods] of checkedIn) {
      if (onSheetPresent.has(memberId)) continue;
      const member = onSheet.get(memberId) ?? extra.get(memberId);
      if (!member) continue;
      checkedInElsewhere.push({ member, methods });
    }
    checkedInElsewhere.sort((a, b) =>
      `${a.member.last_name} ${a.member.first_name}`.localeCompare(
        `${b.member.last_name} ${b.member.first_name}`,
      ),
    );

    return (
      <AttendanceSummary
        data={existing}
        serviceDate={date}
        canFollowUp={access?.allowed.includes("attendance_follow_up") ?? false}
        checkedInElsewhere={checkedInElsewhere}
      />
    );
  }

  const members = await getActiveMembers(supabase, churchId);

  // Someone checked in whose record is inactive still came; put them on the
  // sheet rather than lose them from it.
  const listed = new Set(members.map((member) => member.id));
  const unlisted = await getMembersByIds(
    supabase,
    churchId,
    Array.from(checkedIn.keys()).filter((id) => !listed.has(id)),
  );

  return (
    <AttendanceWizard
      serviceDate={date}
      members={[...members, ...unlisted.values()]}
      checkedIn={Object.fromEntries(checkedIn)}
      canFollowUp={access?.allowed.includes("attendance_follow_up") ?? false}
    />
  );
}

async function getMembersByIds(
  supabase: ReturnType<typeof createClient>,
  churchId: string,
  ids: string[],
): Promise<Map<string, AttendanceMember>> {
  const result = new Map<string, AttendanceMember>();
  if (ids.length === 0) return result;

  const { data, error } = await supabase
    .from("members")
    .select("id, first_name, last_name, phone, photo_url")
    .eq("church_id", churchId)
    .in("id", ids);

  if (error) {
    console.error("getMembersByIds:", error.message);
    return result;
  }

  for (const row of data ?? []) {
    result.set(row.id as string, {
      id: row.id as string,
      first_name: row.first_name as string,
      last_name: row.last_name as string,
      phone: (row.phone as string | null) ?? null,
      photo_url: (row.photo_url as string | null) ?? null,
      attendance_count: 0,
    });
  }
  return result;
}
