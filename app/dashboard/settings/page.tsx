import { SettingsTabs } from "@/components/settings/settings-tabs";
import { getGivingFundsForSettings } from "@/app/dashboard/settings/giving-actions";
import { listCommunicationAttachments } from "@/lib/announcements/attachments";
import { getChurchGivingProfile } from "@/lib/queries/giving";
import { getFollowUpMessageTemplates } from "@/lib/queries/follow-up-settings";
import { getAnnouncementEmailSettings } from "@/lib/queries/announcement-email-settings";
import { getChurchAuth } from "@/lib/auth/church";
import {
  defaultFeatureFlags,
  getFeatureAccess,
  resolveAllowedFeatures,
} from "@/lib/features/access";
import { FEATURE_KEYS } from "@/lib/features/catalog";
import { getIntegrationStatus } from "@/lib/integrations/tokens";
import {
  getChurchTeamMembers,
  usesFeaturePermissionsColumn,
} from "@/lib/queries/team";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = createClient();
  const [auth, featureAccess] = await Promise.all([
    getChurchAuth(),
    getFeatureAccess(),
  ]);
  if (!auth) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center text-sm text-muted-foreground">
        Link your account to a church to manage settings.
      </div>
    );
  }

  const [
    integrationStatus,
    givingProfile,
    givingFunds,
    followUpTemplates,
    announcementEmailSettings,
    communicationAttachments,
    teamMembers,
    grantsInProperColumn,
  ] =
    await Promise.all([
      getIntegrationStatus(auth.churchId, supabase),
      getChurchGivingProfile(auth.churchId),
      getGivingFundsForSettings(auth.churchId),
      getFollowUpMessageTemplates(auth.churchId, supabase),
      getAnnouncementEmailSettings(auth.churchId, supabase),
      listCommunicationAttachments(auth.churchId),
      getChurchTeamMembers(auth.churchId),
      usesFeaturePermissionsColumn(),
    ]);

  const featureFlags = featureAccess?.flags ?? defaultFeatureFlags();

  // Grantable features are the ones the account has switched on.
  const availableFeatures = FEATURE_KEYS.filter((key) => featureFlags[key]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Connect services, manage your team, and set preferences for your
          church.
        </p>
      </div>

      <SettingsTabs
        isAdmin={auth.isAdmin}
        integrationStatus={integrationStatus}
        givingProfile={givingProfile}
        givingFunds={givingFunds}
        followUpTemplates={followUpTemplates}
        announcementEmailTemplate={announcementEmailSettings}
        communicationAttachments={communicationAttachments}
        team={{
          members: teamMembers,
          availableFeatures,
          currentUserId: auth.userId,
          grantsInProperColumn,
        }}
        allowedFeatures={resolveAllowedFeatures(auth, featureFlags)}
      />
    </div>
  );
}
