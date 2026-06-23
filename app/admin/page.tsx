import Link from "next/link";
import { Building2, Clock, FileText, Monitor, Users } from "lucide-react";
import { PriorityBadge } from "@/components/admin/badges";
import { formatDate, formatDuration, formatHours } from "@/components/admin/format";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminGivingOverview } from "@/lib/queries/admin-giving";
import { getAdminOverview } from "@/lib/queries/admin";
import { formatCents } from "@/lib/utils/currency";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminOverviewPage() {
  const [overview, giving] = await Promise.all([
    getAdminOverview(),
    getAdminGivingOverview(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <PageHeader
        title="Platform overview"
        description="Monitor churches, users, integrations, and open support across FaithForm."
      />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Total churches"
          value={overview.stats.totalChurches}
          description="Tenant workspaces"
          icon={Building2}
        />
        <StatCard
          label="Total users"
          value={overview.stats.totalUsers}
          description="Church-linked accounts"
          icon={Users}
        />
        <StatCard
          label="Sermons generated"
          value={overview.stats.totalSermons}
          description="All churches"
          icon={FileText}
        />
        <StatCard
          label="Platform hours saved"
          value={formatHours(overview.stats.platformHoursSaved)}
          description="From activity log minutes"
          icon={Clock}
        />
        <StatCard
          label="Pastor time on FaithForm"
          value={formatDuration(overview.stats.pastorMinutes30d * 60)}
          description={`${overview.stats.activeChurches30d} churches active (30d)`}
          icon={Monitor}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Platform giving</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-2xl font-bold">{formatCents(giving.platformVolumeCents)}</p>
          <p className="text-sm text-muted-foreground">Total successful gifts (all churches)</p>
          <div className="grid gap-3 sm:grid-cols-5 text-sm">
            <GivingStat label="Not started" value={giving.notStarted} />
            <GivingStat label="Pending" value={giving.pending} />
            <GivingStat label="Restricted" value={giving.restricted} />
            <GivingStat label="Live" value={giving.live} />
            <GivingStat label="Deauthorized" value={giving.deauthorized} />
          </div>
          {giving.stuckChurches.length > 0 && (
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-sm font-medium">Needs attention</p>
              <ul className="space-y-2 text-sm">
                {giving.stuckChurches.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/admin/churches/${c.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {c.name}
                    </Link>
                    <span className="text-muted-foreground"> — {c.stripeOnboardingStatus}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Integration health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <IntegrationProgress
              label="Google"
              connected={overview.integrationHealth.googleConnected}
              total={overview.integrationHealth.totalChurches}
            />
            <IntegrationProgress
              label="Facebook"
              connected={overview.integrationHealth.facebookConnected}
              total={overview.integrationHealth.totalChurches}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>New churches this month</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {overview.newChurchesThisMonth.map((church) => (
                <div
                  key={church.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-border/60 p-4 transition-colors hover:border-accent/40 hover:bg-accent/5"
                >
                  <Link
                    href={`/admin/churches/${church.id}`}
                    className="font-semibold text-foreground hover:text-accent"
                  >
                    {church.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {formatDate(church.createdAt)}
                  </span>
                </div>
              ))}
              {overview.newChurchesThisMonth.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No churches joined this month.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent open support tickets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {overview.recentTickets.map((ticket) => (
              <Link
                key={ticket.id}
                href={`/admin/support/${ticket.id}`}
                className="flex flex-col gap-2 rounded-xl border border-border/60 p-4 transition-colors hover:border-accent/40 hover:bg-accent/5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-semibold text-foreground">{ticket.subject}</p>
                  <p className="text-sm text-muted-foreground">
                    {ticket.churchName ?? "No church"} - {formatDate(ticket.createdAt)}
                  </p>
                </div>
                <PriorityBadge priority={ticket.priority} />
              </Link>
            ))}
            {overview.recentTickets.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No open support tickets.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function GivingStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function IntegrationProgress({
  label,
  connected,
  total,
}: {
  label: string;
  connected: number;
  total: number;
}) {
  const percent = total > 0 ? Math.round((connected / total) * 100) : 0;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-sm text-muted-foreground">
          {connected}/{total} connected
        </p>
      </div>
      <div className="h-2.5 rounded-full bg-muted">
        <div
          className="h-2.5 rounded-full bg-accent transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
