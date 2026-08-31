import { notFound } from "next/navigation";
import { loadChurchProfileForAdmin } from "@/app/admin/church-profile-actions";
import { ChurchDetailTabs } from "@/components/admin/church-detail-tabs";
import { OpenChurchDashboardButton } from "@/components/admin/open-church-dashboard-button";
import { PageHeader } from "@/components/admin/page-header";
import { getChurchFeatureState } from "@/lib/features/access";
import type { FeatureKey } from "@/lib/features/catalog";
import { listRetellAgents } from "@/lib/integrations/retell-client";
import { hasChurchRetellKey } from "@/lib/integrations/retell-key";
import {
  getAdminChurchActivity,
  getAdminChurchDetail,
  type AdminActivityRange,
} from "@/lib/queries/admin";
import {
  emptyChurchProfileForm,
  profileToFormState,
} from "@/lib/queries/church-profile";
import { getChurchTeamMembers } from "@/lib/queries/team";
import { getVoiceAssistantSettings } from "@/lib/queries/voice-assistant";
import {
  getChurchDomainRequests,
  getChurchDomains,
} from "@/lib/sites/domain-queries";
import { getDomainProvider } from "@/lib/sites/domains";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function parseActivityRange(value: string | undefined): AdminActivityRange {
  if (value === "7d" || value === "30d" || value === "90d" || value === "all") {
    return value;
  }
  return "all";
}

function parsePage(value: string | undefined): number {
  const page = Number(value);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

/** Allowlisted so `?tab=` can only ever name a tab that exists. */
const TABS = [
  "overview",
  "profile",
  "ai",
  "features",
  "users",
  "website",
  "integrations",
  "giving",
  "activity",
  "support",
];

function parseTab(value: string | undefined): string {
  return value && TABS.includes(value) ? value : "overview";
}

export default async function AdminChurchDetailPage({
  params,
  searchParams,
}: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const activityFilters = {
    category:
      typeof query.category === "string"
        ? query.category
        : undefined,
    type: typeof query.type === "string" ? query.type : undefined,
    range: parseActivityRange(
      typeof query.range === "string" ? query.range : undefined,
    ),
    page: parsePage(
      typeof query.page === "string" ? query.page : undefined,
    ),
  };

  const [
    detail,
    activity,
    featureState,
    teamMembers,
    profile,
    domains,
    domainRequests,
    voiceAgentSettings,
    hasRetellKey,
    retellAgents,
  ] = await Promise.all([
    getAdminChurchDetail(id),
    getAdminChurchActivity(id, activityFilters),
    getChurchFeatureState(id, createAdminClient()),
    getChurchTeamMembers(id),
    loadChurchProfileForAdmin(id),
    getChurchDomains(id),
    getChurchDomainRequests(id),
    getVoiceAssistantSettings(id, createAdminClient()),
    hasChurchRetellKey(id),
    // Admin-only page: a Retell outage or a missing key should explain itself
    // in the agent picker, not 500 the whole church record. The reason is kept
    // rather than swallowed — an empty dropdown with no explanation is what
    // made this control look like it was never built.
    listRetellAgents(id)
      .then((agents) => ({ agents, error: null as string | null }))
      .catch((error: unknown) => ({
        agents: [] as Awaited<ReturnType<typeof listRetellAgents>>,
        error:
          error instanceof Error && /RETELL_API_KEY/i.test(error.message)
            ? "No Retell API key is configured — add this church's key below, or set FaithForm's shared key."
            : "Could not reach Retell to list agents.",
      })),
  ]);

  if (!detail) notFound();

  const featurePermissionsByMemberId = Object.fromEntries(
    teamMembers.map((member) => [member.id, member.featurePermissions]),
  ) as Record<string, FeatureKey[]>;

  const profileForm = profile
    ? profileToFormState(profile)
    : emptyChurchProfileForm();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title={detail.church.name}
        description="Manage this church's profile, AI settings, features, users, integrations, activity, and support."
        action={
          <OpenChurchDashboardButton
            churchId={detail.church.id}
            churchName={detail.church.name}
          />
        }
      />
      <ChurchDetailTabs
        detail={detail}
        activity={activity}
        activityFilters={activityFilters}
        featureFlags={featureState.flags}
        featureNotices={featureState.notices}
        featurePermissionsByMemberId={featurePermissionsByMemberId}
        profileForm={profileForm}
        domains={domains}
        domainRequests={domainRequests}
        domainAutomated={getDomainProvider().automated}
        defaultTab={parseTab(
          typeof query.tab === "string" ? query.tab : undefined,
        )}
        voiceAgentSettings={voiceAgentSettings}
        hasRetellKey={hasRetellKey}
        retellAgents={retellAgents.agents}
        retellAgentsError={retellAgents.error}
      />
    </div>
  );
}
