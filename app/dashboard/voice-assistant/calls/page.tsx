import { redirect } from "next/navigation";
import { RecentCallsBlock } from "@/components/voice-assistant/recent-calls-block";
import { getChurchAuth } from "@/lib/auth/church";
import {
  getRecentPhoneCalls,
  getVoiceAgentSyncStatus,
} from "@/lib/queries/voice-assistant";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function VoiceAssistantCallsPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();
  const [calls, agentStatus] = await Promise.all([
    getRecentPhoneCalls(auth.churchId, 100, supabase),
    getVoiceAgentSyncStatus(auth.churchId, supabase),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Review scored calls from your voice assistant — listen, read transcripts,
        and sync from Retell.
      </p>

      <RecentCallsBlock
        calls={calls}
        isAdmin={auth.isAdmin}
        hasAgent={Boolean(agentStatus.agentId)}
      />
    </div>
  );
}
