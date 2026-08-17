import { notFound } from "next/navigation";
import { loadChurchProfileForAdmin } from "@/app/admin/church-profile-actions";
import { ChurchDetailTabs } from "@/components/admin/church-detail-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { getChurchFeatureState } from "@/lib/features/access";
import type { FeatureKey } from "@/lib/features/catalog";
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
import {
  getChurchDomainRequests,
  getChurchDomains,
} from "@/lib/sites/domain-queries";
import { getDomainProvider } from "@/lib/sites/domains";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
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
  const activityFilters = {
    category:
      typeof searchParams.category === "string"
        ? searchParams.category
        : undefined,
    type: typeof searchParams.type === "string" ? searchParams.type : undefined,
    range: parseActivityRange(
      typeof searchParams.range === "string" ? searchParams.range : undefined,
    ),
    page: parsePage(
      typeof searchParams.page === "string" ? searchParams.page : undefined,
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
  ] = await Promise.all([
    getAdminChurchDetail(params.id),
    getAdminChurchActivity(params.id, activityFilters),
    getChurchFeatureState(params.id, createAdminClient()),
    getChurchTeamMembers(params.id),
    loadChurchProfileForAdmin(params.id),
    getChurchDomains(params.id),
    getChurchDomainRequests(params.id),
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
          typeof searchParams.tab === "string" ? searchParams.tab : undefined,
        )}
      />
    </div>
  );
}
