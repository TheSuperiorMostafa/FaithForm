import Link from "next/link";
import { redirect } from "next/navigation";
import { DonorsTable } from "@/components/giving/donors-table";
import { GivingSetupCta } from "@/components/giving/giving-setup-cta";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getChurchAuth } from "@/lib/auth/church";
import { getChurchGivingProfile, getDonorsList } from "@/lib/queries/giving";

export const dynamic = "force-dynamic";

export default async function DonorsPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const profile = await getChurchGivingProfile(auth.churchId);
  if (!profile?.stripeChargesEnabled) {
    return (
      <div className="mx-auto max-w-3xl flex flex-col gap-6">
        <BackLink />
        <GivingSetupCta />
      </div>
    );
  }

  const donors = await getDonorsList(auth.churchId);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <BackLink />
      <h1 className="font-heading text-2xl font-bold">Donors</h1>
      <p className="text-sm text-muted-foreground">
        Unique givers with year-to-date totals (successful gifts only).
      </p>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>All donors</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DonorsTable donors={donors} />
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard/giving" className="text-sm text-accent hover:underline">
      ← Back to Giving
    </Link>
  );
}
