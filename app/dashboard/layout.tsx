import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getFeatureAccess } from "@/lib/features/access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: link } = await supabase
    .from("church_users")
    .select("role, churches(name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const linkRow = link as
    | { role: string; churches: { name: string } | { name: string }[] | null }
    | null;
  const churchName = linkRow?.churches
    ? Array.isArray(linkRow.churches)
      ? (linkRow.churches[0]?.name ?? null)
      : linkRow.churches.name
    : null;
  const role = linkRow?.role ?? null;

  const featureAccess = await getFeatureAccess(supabase);

  const initialCollapsed = cookies().get("sidebar:collapsed")?.value === "1";

  return (
    <>
      <DashboardShell
        userEmail={user.email ?? ""}
        churchName={churchName}
        role={role}
        initialCollapsed={initialCollapsed}
        allowedFeatures={featureAccess?.allowed ?? []}
      >
        {children}
      </DashboardShell>
      <Toaster richColors position="top-center" />
    </>
  );
}
