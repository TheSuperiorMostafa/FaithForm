import { PageHeader } from "@/components/admin/page-header";
import { UsersTable } from "@/components/admin/users-table";
import { getAdminUsers } from "@/lib/queries/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminUsersPage() {
  const users = await getAdminUsers();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Users"
        description="Review every church-linked user, role, and last sign-in."
      />
      <UsersTable users={users} />
    </div>
  );
}
