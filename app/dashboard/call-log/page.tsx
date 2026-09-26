import { redirect } from "next/navigation";
import { Download, Phone } from "lucide-react";
import { getHandledState } from "@/app/dashboard/call-log/handled";
import {
  CALL_LOG_DESCRIPTION,
  CALL_LOG_TITLE,
  toCallListItem,
} from "@/app/dashboard/call-log/call-view";
import { CallsList } from "@/components/voice-assistant/calls-list";
import { RecentCallsBlock } from "@/components/voice-assistant/recent-calls-block";
import { ScoringExplainer } from "@/components/voice-assistant/scoring-explainer";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { isPlatformAdminUserId } from "@/lib/auth/superadmin";
import {
  getRecentPhoneCalls,
  getVoiceAgentSyncStatus,
} from "@/lib/queries/voice-assistant";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CallLogPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();
  const [calls, isStaff] = await Promise.all([
    getRecentPhoneCalls(auth.churchId, 100, supabase),
    // Assistant quality (scores, re-scoring, importing) is FaithForm's to
    // read, the same people who can open the assistant's settings.
    auth.impersonation ? Promise.resolve(true) : isPlatformAdminUserId(auth.userId),
  ]);

  const [handled, agentStatus] = await Promise.all([
    getHandledState(supabase, auth.churchId, calls.map((call) => call.id)),
    isStaff ? getVoiceAgentSyncStatus(auth.churchId, supabase) : Promise.resolve(null),
  ]);

  // Numbers are masked here, on the server, unless this viewer may see them.
  const items = calls.map((call) =>
    toCallListItem(call, handled.byId.get(call.id) ?? null, { isAdmin: auth.isAdmin }),
  );

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        title={CALL_LOG_TITLE}
        description={CALL_LOG_DESCRIPTION}
        icon={Phone}
        secondary={
          auth.isAdmin && calls.length > 0 ? (
            <a
              href="/api/dashboard/voice-assistant/calls/export"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Download aria-hidden className="size-5" />
              Download calls (CSV)
            </a>
          ) : null
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Phone}
          title="No calls yet"
          description="When your phone assistant answers a call, it shows up here with a short summary of what the caller wanted."
        />
      ) : (
        <CallsList calls={items} />
      )}

      {isStaff && (
        <AdvancedSection
          title="Assistant quality"
          description="Scores, re-scoring and importing calls. Churches don't see this section."
        >
          <RecentCallsBlock
            calls={calls}
            isAdmin={auth.isAdmin}
            hasAgent={Boolean(agentStatus?.agentId)}
          />
          <ScoringExplainer />
        </AdvancedSection>
      )}
    </div>
  );
}
