import { redirect } from "next/navigation";
import { VoiceAssistantSettings } from "@/components/voice-assistant/voice-assistant-settings";
import { getChurchAuth } from "@/lib/auth/church";
import {
  buildVoiceProfileSummary,
  getChurchProfile,
} from "@/lib/queries/church-profile";
import {
  buildVoiceAssistantFormDefaults,
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

  const [initialForm, context, settings, agentStatus, profile] =
    await Promise.all([
      buildVoiceAssistantFormDefaults(auth.churchId, supabase),
      getVoiceAssistantContext(auth.churchId, supabase),
      getVoiceAssistantSettings(auth.churchId, supabase),
      getVoiceAgentSyncStatus(auth.churchId, supabase),
      getChurchProfile(auth.churchId, supabase),
    ]);

  const isConfigured = Boolean(settings?.assistant_name?.trim());
  const profileSummary = profile
    ? buildVoiceProfileSummary(
        profile,
        profile.name,
        initialForm.assistantName,
      )
    : {
        denomination: "",
        churchPhone: "",
        greetingMessage: "",
        hasOpenOfficeDay: false,
      };

  return (
    <VoiceAssistantSettings
      initialForm={initialForm}
      profileSummary={profileSummary}
      context={context}
      agentStatus={agentStatus}
      isAdmin={auth.isAdmin}
      isConfigured={isConfigured}
    />
  );
}
