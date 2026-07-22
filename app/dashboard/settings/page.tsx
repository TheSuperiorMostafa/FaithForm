import { redirect } from "next/navigation";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { getGivingFundsForSettings } from "@/app/dashboard/settings/giving-actions";
import { getChurchGivingProfile } from "@/lib/queries/giving";
import { getFollowUpMessageTemplates } from "@/lib/queries/follow-up-settings";
import { getAnnouncementEmailSettings } from "@/lib/queries/announcement-email-settings";
import { getChurchAuth } from "@/lib/auth/church";
import { getIntegrationStatus } from "@/lib/integrations/tokens";
import { getChurchAISettings } from "@/lib/queries/sermons";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const auth = await getChurchAuth(supabase);
  if (!auth) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center text-sm text-muted-foreground">
        Link your account to a church to manage settings.
      </div>
    );
  }

  const [
    settings,
    integrationStatus,
    givingProfile,
    givingFunds,
    followUpTemplates,
    announcementEmailSettings,
  ] =
    await Promise.all([
      getChurchAISettings(auth.churchId),
      getIntegrationStatus(auth.churchId, supabase),
      getChurchGivingProfile(auth.churchId),
      getGivingFundsForSettings(auth.churchId),
      getFollowUpMessageTemplates(auth.churchId, supabase),
      getAnnouncementEmailSettings(auth.churchId, supabase),
    ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Connect services and manage AI preferences for your church.
        </p>
      </div>

      <SettingsTabs
        isAdmin={auth.isAdmin}
        integrationStatus={integrationStatus}
        settings={settings}
        givingProfile={givingProfile}
        givingFunds={givingFunds}
        followUpTemplates={followUpTemplates}
        announcementEmailTemplate={announcementEmailSettings}
      />
    </div>
  );
}
