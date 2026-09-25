import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getHandledState } from "@/app/dashboard/call-log/handled";
import { toCallListItem, withoutCallerNumber } from "@/app/dashboard/call-log/call-view";
import { CallDetailView } from "@/components/voice-assistant/call-detail-view";
import { PageHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { isPlatformAdminUserId } from "@/lib/auth/superadmin";
import { getPhoneCallById } from "@/lib/queries/voice-assistant";
import { createClient } from "@/lib/supabase/server";
import { formatCallDuration } from "@/lib/utils/voice-assistant";

export const dynamic = "force-dynamic";

function formatWhen(iso: string, timeZone: string | null | undefined): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  try {
    return new Date(iso).toLocaleString(undefined, { ...options, timeZone: timeZone || undefined });
  } catch {
    // An unrecognised time zone name falls back to the server's.
    return new Date(iso).toLocaleString(undefined, options);
  }
}

export default async function CallLogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();
  const [call, isStaff] = await Promise.all([
    getPhoneCallById(auth.churchId, id, supabase),
    auth.impersonation ? Promise.resolve(true) : isPlatformAdminUserId(auth.userId),
  ]);
  if (!call) notFound();

  const handled = await getHandledState(supabase, auth.churchId, [call.id]);
  const item = toCallListItem(call, handled.byId.get(call.id) ?? null, {
    isAdmin: auth.isAdmin,
  });

  const when = formatWhen(call.called_at, auth.churchTimezone);
  const duration = formatCallDuration(call.duration_seconds);

  return (
    <div className="flex w-full flex-col gap-8">
      <Link
        href="/dashboard/call-log"
        className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-5" />
        Back to Phone Calls
      </Link>
      <PageHeader
        title={item.callerLabel}
        description={duration === "—" ? when : `${when} · ${duration}`}
      />
      <CallDetailView
        call={withoutCallerNumber(call)}
        item={item}
        isAdmin={auth.isAdmin}
        canMarkHandled={auth.isAdmin && handled.available}
        isStaff={isStaff}
      />
    </div>
  );
}
