import { redirect } from "next/navigation";
import { VoiceAssistantSettings } from "@/components/voice-assistant/voice-assistant-settings";
import { getChurchAuth } from "@/lib/auth/church";
import {
  buildVoiceAssistantFormDefaults,
  getRecentPhoneCalls,
  getVoiceAgentSyncStatus,
  getVoiceAssistantContext,
  getVoiceAssistantSettings,
} from "@/lib/queries/voice-assistant";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function VoiceAssistantPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();

  const [initialForm, context, recentCalls, settings, agentStatus] =
    await Promise.all([
      buildVoiceAssistantFormDefaults(auth.churchId, supabase),
      getVoiceAssistantContext(auth.churchId, supabase),
      getRecentPhoneCalls(auth.churchId, 25, supabase),
      getVoiceAssistantSettings(auth.churchId, supabase),
      getVoiceAgentSyncStatus(auth.churchId, supabase),
    ]);

  const isConfigured = Boolean(settings?.assistant_name?.trim());

  return (
    <VoiceAssistantSettings
      initialForm={initialForm}
      context={context}
      recentCalls={recentCalls}
      agentStatus={agentStatus}
      isAdmin={auth.isAdmin}
      isConfigured={isConfigured}
    />
  );
}
