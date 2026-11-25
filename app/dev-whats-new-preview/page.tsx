import { notFound } from "next/navigation";
import { Toaster } from "sonner";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { WhatsNewDialog } from "@/components/dashboard/whats-new-dialog";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { FEATURE_KEYS, isFeatureKey, type FeatureKey } from "@/lib/features/catalog";
import { pendingWhatsNew } from "@/lib/releases/pending";
import { RELEASES } from "@/lib/releases/whats-new";

export const dynamic = "force-dynamic";

/**
 * Local preview of the "What's new" pop-up inside the dashboard shell, with no
 * sign-in or database. `?features=people,website` previews what a church with
 * only those features sees. Closing it saves nothing here; reload to see it again.
 */
export default async function DevWhatsNewPreview({
  searchParams,
}: {
  searchParams: Promise<{ features?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { features } = await searchParams;
  const allowed: FeatureKey[] = features
    ? features.split(",").map((key) => key.trim()).filter(isFeatureKey)
    : [...FEATURE_KEYS];
  const release = pendingWhatsNew(RELEASES, allowed, new Set());

  return (
    <>
      <DashboardShell userEmail="pastor@example.org" churchName="Grace Community Church" role="admin" allowedFeatures={allowed}>
        <div className="flex w-full flex-col gap-8">
          <PageHeader title="Home" description="How Grace Community Church is doing this week." />
          <div className="grid gap-4 sm:grid-cols-3">
            {["Attendance", "Giving", "New people"].map((label) => (
              <Card key={label} className="p-6">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-2 font-heading text-3xl font-bold">—</p>
              </Card>
            ))}
          </div>
          {!release ? <p className="text-muted-foreground">Nothing new for these features, so no pop-up.</p> : null}
        </div>
      </DashboardShell>
      {release ? <WhatsNewDialog release={release} /> : null}
      <Toaster richColors position="top-center" />
    </>
  );
}
