import Link from "next/link";
import { redirect } from "next/navigation";
import { GivingSetupCta } from "@/components/giving/giving-setup-cta";
import { RecurringActions } from "@/components/giving/recurring-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getChurchAuth } from "@/lib/auth/church";
import {
  getChurchGivingProfile,
  getFailedSubscriptions,
  getGivingSubscriptions,
} from "@/lib/queries/giving";
import { formatCents } from "@/lib/utils/currency";

export const dynamic = "force-dynamic";

export default async function RecurringGivingPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const profile = await getChurchGivingProfile(auth.churchId);
  if (!profile?.stripeChargesEnabled) {
    return (
      <div className="mx-auto max-w-3xl flex-col gap-6 flex">
        <BackLink />
        <GivingSetupCta />
      </div>
    );
  }

  const [subscriptions, failed] = await Promise.all([
    getGivingSubscriptions(auth.churchId),
    getFailedSubscriptions(auth.churchId),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <BackLink />
      <h1 className="font-heading text-2xl font-bold">Recurring gifts</h1>

      {failed.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Failed payments — needs attention
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <FailedTable subscriptions={failed} />
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>All recurring</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {subscriptions.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No recurring gifts yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-border text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Donor</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Fund</th>
                    <th className="px-4 py-3">Interval</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((s) => (
                    <tr key={s.id} className="border-b border-border/60">
                      <td className="px-4 py-3">
                        {s.donorName || s.donorEmail || "—"}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {formatCents(s.amountCents, s.currency)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {s.fundName ?? "—"}
                      </td>
                      <td className="px-4 py-3 capitalize">{s.interval}ly</td>
                      <td className="px-4 py-3 capitalize">
                        <span
                          className={
                            s.status === "past_due" || s.status === "unpaid"
                              ? "font-medium text-destructive"
                              : ""
                          }
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <RecurringActions subscription={s} />
                      </td>
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

function FailedTable({
  subscriptions,
}: {
  subscriptions: Awaited<ReturnType<typeof getFailedSubscriptions>>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="border-b border-border text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Donor</th>
            <th className="px-4 py-3">Amount</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.map((s) => (
            <tr key={s.id} className="border-b border-border/60">
              <td className="px-4 py-3">
                {s.donorName || s.donorEmail || "—"}
              </td>
              <td className="px-4 py-3">{formatCents(s.amountCents, s.currency)}</td>
              <td className="px-4 py-3 capitalize text-destructive">{s.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
