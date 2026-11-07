import { redirect } from "next/navigation";
import { SectionHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

export default async function ServiceTimesPage() {
  if (await pageFeatureBlocked("member_app")) return null;
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  return (
    <div className="flex w-full flex-col gap-6">
      <SectionHeader
        title="Service times"
        description="When your church meets for worship services."
      />
      <div className="rounded-xl border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Service times editor - fields will be added here.
        </p>
      </div>
    </div>
  );
}
