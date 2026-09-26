import { notFound, redirect } from "next/navigation";

import { FollowUpBoard, type FollowUpCandidate } from "./follow-up-board";
import { LogLink } from "../log-link";
import { ServiceDayHeader } from "@/components/attendance/service-day-header";
import { checkedInOtherwise, getPresenceOnDate } from "@/lib/attendance/presence";
import { getChurchAuth } from "@/lib/auth/church";
import { getPriorConsecutiveAbsences, getRecordByDate } from "@/lib/queries/attendance";
import { getFollowUpMessageTemplates } from "@/lib/queries/follow-up-settings";
import { getChurchSmsStatus } from "@/lib/sms/church-sender";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatServiceDate, isValidDateParam } from "@/lib/utils/dates";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ date: string }>;
};

export default async function AttendanceFollowUpDatePage({ params }: PageProps) {
  const { date: selectedDate } = await params;
  if (!isValidDateParam(selectedDate)) notFound();

  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  const [record, presence, texting, templates] = await Promise.all([
    getRecordByDate(supabase, auth.churchId, selectedDate),
    getPresenceOnDate(supabase, auth.churchId, selectedDate),
    getChurchSmsStatus(auth.churchId),
    // Read the way the sender reads them, so the preview is exactly what goes out.
    getFollowUpMessageTemplates(auth.churchId, createAdminClient()),
  ]);
  if (!record) notFound();
  // Marked absent, but checked in by the app, a code, the kiosk or a room:
  // they were there, and a "we missed you" text would be wrong.
  const cameAnyway = (memberId: string) =>
    checkedInOtherwise(presence?.get(memberId)).length > 0;
  const absentEntries = record.entries.filter(
    (entry) =>
      entry.status === "absent" && entry.member && !cameAnyway(entry.member.id),
  );

  // Without migration 0014 there is nowhere to record a send, so the request
  // flag is the only evidence someone was contacted. Treating it as such is
  // what keeps the page from offering to text the same person again.
  const trackingDelivery = record.deliveryTrackingAvailable ?? true;

  const streaks = await getPriorConsecutiveAbsences(
    supabase,
    auth.churchId,
    selectedDate,
    absentEntries.map((entry) => entry.member!.id),
  );

  const candidates: FollowUpCandidate[] = absentEntries
    .map((entry) => ({
      memberId: entry.member!.id,
      name: `${entry.member!.first_name} ${entry.member!.last_name}`.trim(),
      firstName: entry.member!.first_name?.trim() || "Friend",
      phone: entry.member!.phone,
      // This service counts too, so the streak the pastor sees includes today.
      consecutiveAbsent: (streaks.get(entry.member!.id) ?? 0) + 1,
      sentAt:
        entry.follow_up_sent_at ??
        (!trackingDelivery && entry.follow_up_requested ? "recorded" : null),
      // Raw text from the texting service stays in the database.
      error: entry.follow_up_error,
      requested: entry.follow_up_requested,
    }))
    .sort((a, b) => {
      if (b.consecutiveAbsent !== a.consecutiveAbsent) {
        return b.consecutiveAbsent - a.consecutiveAbsent;
      }
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="flex w-full flex-col gap-8">
      <ServiceDayHeader
        title={formatServiceDate(selectedDate)}
        description="Send a friendly text to people who missed. Nothing is sent until you choose."
        backHref="/dashboard/attendance/follow-up"
        backLabel="Back to Follow-up"
        secondary={<LogLink />}
      />
      <FollowUpBoard
        selectedDate={selectedDate}
        candidates={candidates}
        textingConnected={texting.connected}
        templates={templates}
        countedByNumber={record.entries.length === 0}
      />
    </div>
  );
}
