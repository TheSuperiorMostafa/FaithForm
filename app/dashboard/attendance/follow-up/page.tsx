import { redirect } from "next/navigation";

import { FollowUpBoard, type FollowUpCandidate } from "./follow-up-board";
import { getChurchAuth } from "@/lib/auth/church";
import {
  getPriorConsecutiveAbsences,
  getRecordByDate,
  listRecordedServices,
} from "@/lib/queries/attendance";
import { createClient } from "@/lib/supabase/server";
import { isValidDateParam } from "@/lib/utils/dates";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ date?: string }>;
};

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
      <div className="flex w-full flex-col gap-5">
        <header className="flex flex-col gap-2">
          <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
            Follow-up
          </h1>
          <p className="text-base text-muted-foreground">
            Choose who gets a check-in text after a service.
          </p>
        </header>
        <p className="rounded-xl border border-dashed border-border px-5 py-12 text-center text-base text-muted-foreground">
          No attendance has been submitted yet. Once a Sunday is marked, the
          people who missed it show up here.
        </p>
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

  const record = await getRecordByDate(supabase, auth.churchId, selectedDate);
  const absentEntries = (record?.entries ?? []).filter(
    (entry) => entry.status === "absent" && entry.member,
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
      name: `${entry.member!.first_name} ${entry.member!.last_name}`,
      phone: entry.member!.phone,
      // This service counts too, so the streak the pastor sees includes today.
      consecutiveAbsent: (streaks.get(entry.member!.id) ?? 0) + 1,
      sentAt:
        entry.follow_up_sent_at ??
        (!trackingDelivery && entry.follow_up_requested ? "recorded" : null),
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
    <FollowUpBoard
      services={services}
      selectedDate={selectedDate}
      candidates={candidates}
    />
  );
}
