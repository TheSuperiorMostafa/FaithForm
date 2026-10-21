import { redirect } from "next/navigation";
import { TextAppCheck } from "./text-app-check";
import { PageHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { createClient } from "@/lib/supabase/server";
import { isValidDateParam } from "@/lib/utils/dates";

export const dynamic = "force-dynamic";

export default async function CheckTextsPage({ params }: { params: Promise<{ date: string }> }) {
  if (await pageFeatureBlocked("attendance_follow_up")) return null;
  const { date } = await params;
  if (!isValidDateParam(date)) redirect("/dashboard/attendance/follow-up");
  const auth = await getChurchAuth(createClient());
  if (!auth) redirect("/login");
  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader title="Check your text messages" description="One last step after requesting attendance texts." />
      <TextAppCheck serviceDate={date} through={new Date().toISOString()} />
    </div>
  );
}
