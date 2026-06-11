import { notFound } from "next/navigation";
import { ChurchDetailTabs } from "@/components/admin/church-detail-tabs";
import { PageHeader } from "@/components/admin/page-header";
import {
  getAdminChurchActivity,
  getAdminChurchDetail,
  type AdminActivityRange,
} from "@/lib/queries/admin";

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

  const [detail, activity] = await Promise.all([
    getAdminChurchDetail(params.id),
    getAdminChurchActivity(params.id, activityFilters),
  ]);

  if (!detail) notFound();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title={detail.church.name}
        description="Inspect settings, users, integrations, activity, and support for this church."
      />
      <ChurchDetailTabs
        detail={detail}
        activity={activity}
        activityFilters={activityFilters}
      />
    </div>
  );
}
