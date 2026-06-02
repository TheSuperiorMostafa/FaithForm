import { notFound, redirect } from "next/navigation";

import { AttendanceSummary } from "./attendance-summary";
import { AttendanceWizard } from "./attendance-wizard";
import {
  getActiveMembers,
  getChurchTimezone,
  getMissedStreaks,
  getRecordByDate,
} from "@/lib/queries/attendance";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import { createClient } from "@/lib/supabase/server";
import { isSundayDate, isValidDateParam } from "@/lib/utils/dates";

type PageProps = {
  params: { date: string };
};

export default async function AttendanceDatePage({ params }: PageProps) {
  const { date } = params;

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

  const existing = await getRecordByDate(supabase, churchId, date);

  if (existing) {
    return <AttendanceSummary data={existing} serviceDate={date} />;
  }

  const [members, streaks] = await Promise.all([
    getActiveMembers(supabase, churchId),
    getMissedStreaks(supabase, churchId, date),
  ]);

  const streaksObject = Object.fromEntries(streaks.entries());

  return (
    <AttendanceWizard
      serviceDate={date}
      members={members}
      streaks={streaksObject}
    />
  );
}
