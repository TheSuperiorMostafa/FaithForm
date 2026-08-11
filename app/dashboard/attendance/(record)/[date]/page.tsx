import { notFound, redirect } from "next/navigation";

import { AttendanceSummary } from "./attendance-summary";
import { AttendanceWizard } from "./attendance-wizard";
import {
  getActiveMembers,
  getChurchTimezone,
  getRecordByDate,
} from "@/lib/queries/attendance";
import { getFeatureAccess } from "@/lib/features/access";
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
    const access = await getFeatureAccess(supabase);
    return (
      <AttendanceSummary
        data={existing}
        serviceDate={date}
        canFollowUp={access?.allowed.includes("attendance_follow_up") ?? false}
      />
    );
  }

  const members = await getActiveMembers(supabase, churchId);

  return <AttendanceWizard serviceDate={date} members={members} />;
}
