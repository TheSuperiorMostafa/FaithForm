import Link from "next/link";
import { redirect } from "next/navigation";
import { GivingSetupCta } from "@/components/giving/giving-setup-cta";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getChurchAuth } from "@/lib/auth/church";
import { getChurchGivingProfile } from "@/lib/queries/giving";
import { listConnectedPayouts } from "@/lib/stripe/giving";
import { formatCents } from "@/lib/utils/currency";
import { isStripeConfigured } from "@/lib/stripe/client";

export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const profile = await getChurchGivingProfile(auth.churchId);
  if (!profile?.stripeChargesEnabled || !profile.stripeAccountId) {
    return (
      <div className="mx-auto max-w-3xl flex flex-col gap-6">
        <BackLink />
        <GivingSetupCta />
      </div>
    );
  }

  let payouts: Awaited<ReturnType<typeof listConnectedPayouts>> = [];
  if (isStripeConfigured()) {
    try {
      payouts = await listConnectedPayouts(profile.stripeAccountId);
    } catch (e) {
      console.error("payouts list", e);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <BackLink />
      <h1 className="font-heading text-2xl font-bold">Payouts</h1>
      <p className="text-sm text-muted-foreground">
        Transfers from Stripe to your church bank account.
      </p>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Recent payouts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {payouts.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No payouts yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((p) => (
                    <tr key={p.id} className="border-b border-border/60">
                      <td className="px-4 py-3">
                        {new Date((p.arrival_date ?? 0) * 1000).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {formatCents(p.amount, p.currency)}
                      </td>
                      <td className="px-4 py-3 capitalize">{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
