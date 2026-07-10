import Link from "next/link";
import { redirect } from "next/navigation";
import { GenerateStatementsButton } from "@/components/giving/generate-statements-button";
import { GivingSetupCta } from "@/components/giving/giving-setup-cta";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getChurchAuth } from "@/lib/auth/church";
import {
  getChurchGivingProfile,
  getDonorsList,
  getGivingStatements,
} from "@/lib/queries/giving";
import { formatCents } from "@/lib/utils/currency";

export const dynamic = "force-dynamic";

export default async function StatementsPage() {
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

  const year = new Date().getFullYear();
  const [{ monthly, annual }, donors] = await Promise.all([
    getGivingStatements(auth.churchId),
    getDonorsList(auth.churchId),
  ]);

  const donorsWithGifts = donors.filter((d) => d.giftCount > 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <BackLink />
      <h1 className="font-heading text-2xl font-bold">Statements</h1>
      <p className="text-sm text-muted-foreground">
        Gift totals and year-end tax statements for donors.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bulk generate {year}</CardTitle>
        </CardHeader>
        <CardContent>
          {auth.isAdmin ? (
            <GenerateStatementsButton
              year={year}
              hasEin={Boolean(profile.ein)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Only church admins can generate bulk statements.
            </p>
          )}
        </CardContent>
      </Card>

      {donorsWithGifts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-donor statements ({year})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {donorsWithGifts.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between py-3"
                >
                  <span>
                    {d.name ?? d.email}{" "}
                    <span className="text-muted-foreground">
                      · YTD {formatCents(d.ytdCents)}
                    </span>
                  </span>
                  <a
                    href={`/api/dashboard/giving/statements/${d.id}?year=${year}`}
                    className="text-accent hover:underline"
                  >
                    Download PDF
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Monthly</CardTitle>
        </CardHeader>
        <CardContent>
          <StatementList periods={monthly} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Annual</CardTitle>
        </CardHeader>
        <CardContent>
          <StatementList periods={annual} />
        </CardContent>
      </Card>
    </div>
  );
}

function StatementList({
  periods,
}: {
  periods: { label: string; totalCents: number; count: number }[];
}) {
  if (periods.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No statement data yet.</p>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {periods.map((p) => (
        <li
          key={p.label}
          className="flex items-center justify-between py-3 text-sm"
        >
          <span className="font-medium">{p.label}</span>
          <span className="text-muted-foreground">
            {p.count} gifts · {formatCents(p.totalCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard/giving" className="text-sm text-accent hover:underline">
      ← Back to Giving
    </Link>
  );
}
