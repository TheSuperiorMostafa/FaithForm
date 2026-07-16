import { redirect } from "next/navigation";
import { RecentCallsBlock } from "@/components/voice-assistant/recent-calls-block";
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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
          Call Log
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review scored calls from your voice assistant — listen, read
          transcripts, and sync from Retell.
        </p>
      </div>

      <RecentCallsBlock
        calls={calls}
        isAdmin={auth.isAdmin}
        hasAgent={Boolean(agentStatus.agentId)}
      />
    </div>
  );
}
