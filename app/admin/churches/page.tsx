import { ChurchesTable } from "@/components/admin/churches-table";
import { CreateChurchDialog } from "@/components/admin/create-church-dialog";
import { PageHeader } from "@/components/admin/page-header";
import { getAdminChurches } from "@/lib/queries/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminChurchesPage() {
  const churches = await getAdminChurches();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Churches"
        description="Search, sort, and inspect every church workspace."
        action={<CreateChurchDialog />}
      />
      <ChurchesTable churches={churches} />
    </div>
  );
}
