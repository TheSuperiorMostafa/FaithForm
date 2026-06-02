import { notFound } from "next/navigation";
import { ChurchDetailTabs } from "@/components/admin/church-detail-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { getAdminChurchDetail } from "@/lib/queries/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: { id: string };
};

export default async function AdminChurchDetailPage({ params }: PageProps) {
  const detail = await getAdminChurchDetail(params.id);
  if (!detail) notFound();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title={detail.church.name}
        description="Inspect settings, users, integrations, activity, and support for this church."
      />
      <ChurchDetailTabs detail={detail} />
    </div>
  );
}
