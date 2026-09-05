import { redirect } from "next/navigation";
import { RecentCallsBlock } from "@/components/voice-assistant/recent-calls-block";
import { ScoringExplainer } from "@/components/voice-assistant/scoring-explainer";
import { getChurchAuth } from "@/lib/auth/church";
import {
  getRecentPhoneCalls,
  getVoiceAgentSyncStatus,
} from "@/lib/queries/voice-assistant";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CallLogPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();
  const [calls, agentStatus] = await Promise.all([
    getRecentPhoneCalls(auth.churchId, 100, supabase),
    getVoiceAgentSyncStatus(auth.churchId, supabase),
  ]);

  const needsAttention = calls.filter((call) => call.notify_pastor).length;

  return (
    <>
      <header>
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          Call Log
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every call your phone assistant answered — who rang, what they wanted,
          and how it was handled.
          {needsAttention > 0 && (
            <>
              {" "}
              <strong className="font-semibold text-foreground">
                {needsAttention} {needsAttention === 1 ? "call needs" : "calls need"}{" "}
                a reply.
              </strong>
            </>
          )}
        </p>
      </header>

      <RecentCallsBlock
        calls={calls}
        isAdmin={auth.isAdmin}
        hasAgent={Boolean(agentStatus.agentId)}
      />

      <ScoringExplainer />
    </>
  );
}
