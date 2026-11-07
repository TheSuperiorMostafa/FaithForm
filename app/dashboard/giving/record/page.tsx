import { redirect } from "next/navigation";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { ensureDefaultFunds } from "@/lib/giving/funds";
import { getGivingFunds } from "@/lib/queries/giving";
import { createClient } from "@/lib/supabase/server";
import { OfflineGivingForm } from "@/components/giving/offline-giving-form";
import { PageHeader } from "@/components/ui/page-header";

export default async function RecordGivingPage() {
  if (await pageFeatureBlocked("giving")) return null;
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");
  if (!auth.isAdmin) redirect("/dashboard/giving");
  await ensureDefaultFunds(auth.churchId);
  const [funds, donors] = await Promise.all([
    getGivingFunds(auth.churchId),
    createClient().from("giving_donors").select("id, name, email").eq("church_id", auth.churchId).order("name").limit(1000),
  ]);
  if (donors.error) throw new Error("Offline giving donors could not load");
  return <div className="flex w-full flex-col gap-8">
    <PageHeader title="Record donations" description="Record gifts already received in cash, by check or outside FaithForm." />
    <OfflineGivingForm funds={funds.filter(fund => fund.isActive)} donors={donors.data ?? []} />
  </div>;
}
