import { redirect } from "next/navigation";
import { SectionHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

export default async function TabPage() {
  if (await pageFeatureBlocked("member_app")) return null;
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="rounded-xl border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Tab content - focused editor will be added here.
        </p>
      </div>
    </div>
  );
}
