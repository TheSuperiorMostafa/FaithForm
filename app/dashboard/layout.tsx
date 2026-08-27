import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getChurchAuth } from "@/lib/auth/church";
import { getFeatureAccess } from "@/lib/features/access";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [auth, featureAccess, cookieStore] = await Promise.all([
    getChurchAuth(),
    getFeatureAccess(),
    cookies(),
  ]);

  if (!auth) {
    redirect("/login");
  }
  const initialCollapsed = cookieStore.get("sidebar:collapsed")?.value === "1";

  return (
    <>
      <DashboardShell
        userEmail={auth.userEmail}
        churchName={auth.churchName}
        role={auth.role}
        initialCollapsed={initialCollapsed}
        allowedFeatures={featureAccess?.allowed ?? []}
      >
        {children}
      </DashboardShell>
      <Toaster richColors position="top-center" />
    </>
  );
}
