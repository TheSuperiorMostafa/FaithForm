import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, History } from "lucide-react";

import { FollowUpBoard, type FollowUpCandidate } from "./follow-up-board";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ATTENDANCE_COPY } from "@/lib/attendance/page-copy";
import { checkedInOtherwise, getPresenceOnDate } from "@/lib/attendance/presence";
import { getChurchAuth } from "@/lib/auth/church";
import {
  getPriorConsecutiveAbsences,
  getRecordByDate,
  listRecordedServices,
} from "@/lib/queries/attendance";
import { getFollowUpMessageTemplates } from "@/lib/queries/follow-up-settings";
import { getChurchSmsStatus } from "@/lib/sms/church-sender";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isValidDateParam } from "@/lib/utils/dates";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ date?: string }>;
};

function LogLink() {
  return (
    <Link
      href="/dashboard/attendance/follow-up/log"
      className={buttonVariants({ variant: "outline" })}
    >
      <History aria-hidden />
      Message log
    </Link>
  );
}

export default async function AttendanceFollowUpPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  const services = await listRecordedServices(supabase, auth.churchId);

  if (services.length === 0) {
    return (
      <div className="flex w-full flex-col gap-8">
        <PageHeader
          title={ATTENDANCE_COPY.followUp.title}
          description={ATTENDANCE_COPY.followUp.description}
          secondary={<LogLink />}
        />
        <EmptyState
          icon={CalendarCheck}
          title="No Sundays counted yet"
          description="Once a Sunday is counted by name, the people who missed it show up here."
        />
      </div>
    );
  }

  const requested = query.date;
  const selectedDate =
    requested &&
    isValidDateParam(requested) &&
    services.some((service) => service.serviceDate === requested)
      ? requested
      : services[0].serviceDate;

  const [record, presence, texting, templates] = await Promise.all([
    getRecordByDate(supabase, auth.churchId, selectedDate),
    getPresenceOnDate(supabase, auth.churchId, selectedDate),
    getChurchSmsStatus(auth.churchId),
    // Read the way the sender reads them, so the preview is exactly what goes out.
    getFollowUpMessageTemplates(auth.churchId, createAdminClient()),
  ]);
  // Marked absent, but checked in by the app, a code, the kiosk or a room:
  // they were there, and a "we missed you" text would be wrong.
  const cameAnyway = (memberId: string) =>
    checkedInOtherwise(presence?.get(memberId)).length > 0;
  const absentEntries = (record?.entries ?? []).filter(
    (entry) =>
      entry.status === "absent" && entry.member && !cameAnyway(entry.member.id),
  );

  // Without migration 0014 there is nowhere to record a send, so the request
  // flag is the only evidence someone was contacted. Treating it as such is
  // what keeps the page from offering to text the same person again.
  const trackingDelivery = record?.deliveryTrackingAvailable ?? true;

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
      <PageHeader
        title={ATTENDANCE_COPY.followUp.title}
        description={ATTENDANCE_COPY.followUp.description}
        secondary={<LogLink />}
      />
      <FollowUpBoard
        services={services}
        selectedDate={selectedDate}
        candidates={candidates}
        textingConnected={texting.connected}
        templates={templates}
        countedByNumber={(record?.entries.length ?? 0) === 0}
      />
    </div>
  );
}
