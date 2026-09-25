import Link from "next/link";
import { ArrowRight, Heart, Mail } from "lucide-react";

import { AnnouncementEmailForm } from "@/components/settings/announcement-email-form";
import { AppleMailDraftsCard } from "@/components/settings/apple-calendar-connect";
import { BrandColorsCard } from "@/components/settings/brand-colors-card";
import { pickChurchBasics } from "@/components/settings/church-basics";
import { ChurchDetailsForm, ChurchImagesCard } from "@/components/settings/church-info-card";
import { CommunicationAttachmentsForm } from "@/components/settings/communication-attachments-form";
import { ConnectedAccountsCard } from "@/components/settings/connected-accounts-card";
import { FollowUpMessagesForm } from "@/components/settings/follow-up-messages-form";
import type { ResolvedSettingsTab } from "@/components/settings/settings-tabs-config";
import { TeamMembersCard } from "@/components/settings/team-members-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { listCommunicationAttachments } from "@/lib/announcements/attachments";
import type { ChurchAuth } from "@/lib/auth/church";
import { FEATURE_KEYS, type FeatureKey } from "@/lib/features/catalog";
import type { FeatureFlags } from "@/lib/features/access";
import { getIntegrationStatus } from "@/lib/integrations/tokens";
import { getAnnouncementEmailSettings } from "@/lib/queries/announcement-email-settings";
import { getChurchAppInfo } from "@/lib/queries/church-app-info";
import { getFollowUpMessageTemplates } from "@/lib/queries/follow-up-settings";
import { getChurchTeamMembers } from "@/lib/queries/team";
import { createClient } from "@/lib/supabase/server";

export type SettingsPanelContext = {
  auth: ChurchAuth;
  flags: FeatureFlags;
  /** What this person can open. */
  allowedFeatures: FeatureKey[];
};

/**
 * Loads and renders one Settings section. Each section fetches only what it
 * shows, so opening Team never waits on calendars or email templates.
 */
export async function SettingsTabPanel({
  tab,
  context,
}: {
  tab: ResolvedSettingsTab;
  context: SettingsPanelContext;
}) {
  try {
    switch (tab) {
      case "church":
        return await ChurchInfoPanel(context);
      case "team":
        return await TeamPanel(context);
      case "accounts":
        return await AccountsPanel(context);
      case "messages":
        return await MessagesPanel(context);
      case "advanced":
        return await AdvancedPanel(context);
      case "giving":
        return await GivingPanel();
    }
  } catch (error) {
    console.error(`[settings] ${tab} failed to load:`, error);
    return (
      <ErrorState
        compact
        title="This section didn't load"
        description="Nothing you saved was lost. Refresh the page to try again, and if it keeps happening, contact FaithForm support."
      />
    );
  }
}

async function ChurchInfoPanel({ auth, allowedFeatures }: SettingsPanelContext) {
  const [appInfo, colors] = await Promise.all([
    getChurchAppInfo(auth.churchId),
    auth.isAdmin
      ? createClient()
          .from("churches")
          .select("giving_primary_color, giving_accent_color")
          .eq("id", auth.churchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!appInfo) {
    return (
      <ErrorState
        compact
        title="Your church details didn't load"
        description="Nothing you saved was lost. Refresh the page to try again, and if it keeps happening, contact FaithForm support."
      />
    );
  }

  const info = appInfo.info;
  const colorRow = colors.data as { giving_primary_color: string | null; giving_accent_color: string | null } | null;

  return (
    <div className="flex flex-col gap-6">
      <ChurchImagesCard
        logoUrl={info.logoUrl || null}
        coverUrl={info.coverImageUrl || null}
        canEdit={auth.isAdmin}
      />
      <ChurchDetailsForm
        initial={pickChurchBasics(info)}
        timezone={appInfo.context.timezone || auth.churchTimezone}
        canEdit={auth.isAdmin}
        appPageHref={allowedFeatures.includes("member_app") ? "/dashboard/app" : null}
      />
      {auth.isAdmin && (
        <BrandColorsCard
          primaryColor={colorRow?.giving_primary_color ?? null}
          accentColor={colorRow?.giving_accent_color ?? null}
        />
      )}
    </div>
  );
}

async function TeamPanel({ auth, flags }: SettingsPanelContext) {
  const members = await getChurchTeamMembers(auth.churchId);
  // Only what the account has switched on can be handed out.
  const availableFeatures = FEATURE_KEYS.filter((key) => flags[key]);

  return (
    <TeamMembersCard
      isAdmin={auth.isAdmin}
      members={members}
      availableFeatures={availableFeatures}
      currentUserId={auth.userId}
    />
  );
}

async function AccountsPanel({ auth, allowedFeatures }: SettingsPanelContext) {
  const status = await getIntegrationStatus(auth.churchId, createClient());
  return <ConnectedAccountsCard status={status} allowedFeatures={allowedFeatures} />;
}

async function MessagesPanel({ auth, allowedFeatures }: SettingsPanelContext) {
  const supabase = createClient();
  const showEmail = allowedFeatures.includes("announcements");
  const showTexts = allowedFeatures.includes("attendance");

  const [emailSettings, attachments, followUps] = await Promise.all([
    showEmail ? getAnnouncementEmailSettings(auth.churchId, supabase) : Promise.resolve(null),
    showEmail ? listCommunicationAttachments(auth.churchId) : Promise.resolve([]),
    showTexts ? getFollowUpMessageTemplates(auth.churchId, supabase) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      {emailSettings && (
        <>
          <AnnouncementEmailForm isAdmin={auth.isAdmin} template={emailSettings} />
          <CommunicationAttachmentsForm isAdmin={auth.isAdmin} attachments={attachments} />
        </>
      )}
      {followUps && <FollowUpMessagesForm isAdmin={auth.isAdmin} templates={followUps} />}
    </div>
  );
}

async function AdvancedPanel({ auth, allowedFeatures }: SettingsPanelContext) {
  const showMail = auth.isAdmin && allowedFeatures.includes("announcements");
  const status = showMail ? await getIntegrationStatus(auth.churchId, createClient()) : null;
  const apple = status?.apple ?? null;
  const mailPossible = Boolean(apple?.connected && !apple.readOnly);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Light or dark</CardTitle>
          <CardDescription className="text-[15px]">
            How FaithForm looks on this computer. Only you see this.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle variant="cards" />
        </CardContent>
      </Card>

      {showMail && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-5 text-accent" strokeWidth={1.75} aria-hidden />
              Apple Mail drafts
            </CardTitle>
            <CardDescription className="text-[15px]">
              Write the weekly announcement email as a draft in your iCloud Mail.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {apple && mailPossible ? (
              <AppleMailDraftsCard status={apple} />
            ) : (
              <p className="text-[15px] text-muted-foreground">
                This needs iCloud Calendar connected with an Apple ID. Go to{" "}
                <Link
                  href="/dashboard/settings?tab=accounts"
                  className="font-semibold text-primary underline underline-offset-4 dark:text-accent"
                >
                  Connected accounts
                </Link>
                , choose Connect next to iCloud Calendar, then &ldquo;Connect with an Apple ID&rdquo;.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function GivingPanel() {
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-4">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
        >
          <Heart className="size-6" strokeWidth={1.75} />
        </span>
        <div className="space-y-1.5">
          <CardTitle>Giving is set up on the Giving page</CardTitle>
          <CardDescription className="text-[15px]">
            Online giving, funds, deposits to your bank and year-end statements are all in one
            place now.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Link href="/dashboard/giving" className={buttonVariants({ size: "lg" })}>
          Open Giving
          <ArrowRight aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

