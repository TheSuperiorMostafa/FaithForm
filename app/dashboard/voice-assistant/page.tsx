import { redirect } from "next/navigation";
import { VoiceAssistantSettings } from "@/components/voice-assistant/voice-assistant-settings";
import { getChurchAuth } from "@/lib/auth/church";
import {
  buildVoiceAssistantFormDefaults,
  getRecentPhoneCalls,
  getVoiceAssistantContext,
  getVoiceAssistantSettings,
} from "@/lib/queries/voice-assistant";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function VoiceAssistantPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();

  const [initialForm, context, recentCalls, settings] = await Promise.all([
    buildVoiceAssistantFormDefaults(auth.churchId, supabase),
    getVoiceAssistantContext(auth.churchId, supabase),
    getRecentPhoneCalls(auth.churchId, 10, supabase),
    getVoiceAssistantSettings(auth.churchId, supabase),
  ]);

  const isConfigured = Boolean(settings?.assistant_name?.trim());

  return (
    <VoiceAssistantSettings
      initialForm={initialForm}
      context={context}
      recentCalls={recentCalls}
      isAdmin={auth.isAdmin}
      isConfigured={isConfigured}
    />
  );
}
