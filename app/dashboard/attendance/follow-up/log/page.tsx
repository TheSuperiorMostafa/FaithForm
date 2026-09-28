import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { FollowUpLog } from "./follow-up-log";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/error-state";
import { ATTENDANCE_COPY } from "@/lib/attendance/page-copy";
import { getChurchAuth } from "@/lib/auth/church";
import { getFollowUpLog } from "@/lib/queries/follow-up-log";
import { createClient } from "@/lib/supabase/server";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

export default async function FollowUpLogPage() {
  if (await pageFeatureBlocked("attendance_follow_up")) return null;

  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  let sundays: Awaited<ReturnType<typeof getFollowUpLog>> | null = null;
  try {
    sundays = await getFollowUpLog(auth.churchId);
  } catch (error) {
    console.error("[attendance] follow-up log failed to load", error);
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          href="/dashboard/attendance/follow-up"
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg text-base font-semibold text-muted-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden />
          Back to Follow-up
        </Link>
        <PageHeader
          title={ATTENDANCE_COPY.followUpLog.title}
          description={ATTENDANCE_COPY.followUpLog.description}
        />
      </div>

      {sundays ? (
        <FollowUpLog sundays={sundays} />
      ) : (
        <ErrorState
          title="Message log didn't load"
          description="Refresh the page to try again. No messages were changed."
        />
      )}
    </div>
  );
}
