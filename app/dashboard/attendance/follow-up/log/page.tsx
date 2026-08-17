import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { FollowUpLog } from "./follow-up-log";
import { getChurchAuth } from "@/lib/auth/church";
import { getFollowUpLog } from "@/lib/queries/follow-up-log";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function FollowUpLogPage() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  const sundays = await getFollowUpLog(auth.churchId);

  return (
    <div className="flex w-full flex-col gap-5">
      <Link
        href="/dashboard/attendance/follow-up"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to follow-up
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
          Message log
        </h1>
        <p className="text-base text-muted-foreground">
          Every check-in text your church has sent, grouped by the Sunday it
          followed.
        </p>
      </header>

      <FollowUpLog sundays={sundays} />
    </div>
  );
}
