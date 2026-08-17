import { PageHeader } from "@/components/admin/page-header";
import { UsersTable } from "@/components/admin/users-table";
import { getChurchFeatureFlags } from "@/lib/features/access";
import { FEATURE_KEYS, type FeatureKey } from "@/lib/features/catalog";
import { getAdminUsers } from "@/lib/queries/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminUsersPage() {
  const users = await getAdminUsers();

  // Grantable features are per account, so the manage dialog needs each
  // church's flags. One lookup per distinct church, not per user.
  const churchIds = Array.from(new Set(users.map((user) => user.churchId)));
  const admin = createAdminClient();
  const flagPairs = await Promise.all(
    churchIds.map(async (churchId) => {
      const flags = await getChurchFeatureFlags(churchId, admin);
      const enabled = FEATURE_KEYS.filter((key) => flags[key]) as FeatureKey[];
      return [churchId, enabled] as const;
    }),
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Users"
        description="Review every church-linked user, and adjust their role or feature access."
      />
      <UsersTable
        users={users}
        featuresByChurch={Object.fromEntries(flagPairs)}
      />
    </div>
  );
}
