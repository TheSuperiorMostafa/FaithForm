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
  const supabase = createClient();
  const [funds, donors, people] = await Promise.all([
    getGivingFunds(auth.churchId),
    supabase.from("giving_donors").select("id, name, email").eq("church_id", auth.churchId).order("name").limit(1000),
    supabase.from("members").select("id, first_name, last_name, email, phone").eq("church_id", auth.churchId).eq("is_active", true)
      .order("last_name").order("first_name").limit(5000),
  ]);
  if (donors.error) throw new Error("Offline giving donors could not load");
  // The People list is a convenience for picking who gave; giving still works without it.
  if (people.error) console.error("[giving] people for donor picker could not load", people.error.message);
  return <div className="flex w-full flex-col gap-8">
    <PageHeader title="Record donations" description="Record gifts your church received in cash, by check or another offline method." />
    <OfflineGivingForm funds={funds.filter(fund => fund.isActive)} donors={donors.data ?? []} people={people.data ?? []} />
  </div>;
}
