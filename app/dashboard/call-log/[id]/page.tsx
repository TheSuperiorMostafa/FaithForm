import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CallDetailView } from "@/components/voice-assistant/call-detail-view";
import { getChurchAuth } from "@/lib/auth/church";
import { getPhoneCallById } from "@/lib/queries/voice-assistant";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CallLogDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();
  const call = await getPhoneCallById(auth.churchId, params.id, supabase);
  if (!call) notFound();

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/dashboard/call-log"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to call log
      </Link>
      <CallDetailView call={call} isAdmin={auth.isAdmin} />
    </div>
  );
}
