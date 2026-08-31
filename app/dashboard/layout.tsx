import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ImpersonationBanner } from "@/components/dashboard/impersonation-banner";
import { getChurchAuth } from "@/lib/auth/church";
import { getFeatureAccess } from "@/lib/features/access";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [auth, featureAccess] = await Promise.all([
    getChurchAuth(),
    getFeatureAccess(),
  ]);

  // No staff membership, no dashboard — including for a signed-in Faithful
  // visitor who arrived here on a stale or misrouted link. `/login` is the one
  // place that decides what a signed-in account without a church should see,
  // and it renders that state rather than bouncing back here: this pair used
  // to redirect to each other, which the browser showed as a blank page.
  // Authorization itself is unchanged — nothing here grants access.
  if (!auth) {
    redirect("/login");
  }

  return (
    <>
      <DashboardShell
        userEmail={auth.userEmail}
        churchName={auth.churchName}
        role={auth.role}
        allowedFeatures={featureAccess?.allowed ?? []}
        banner={
          auth.impersonation ? (
            <ImpersonationBanner churchName={auth.churchName} />
          ) : null
        }
      >
        {children}
      </DashboardShell>
      <Toaster richColors position="top-center" />
    </>
  );
}
