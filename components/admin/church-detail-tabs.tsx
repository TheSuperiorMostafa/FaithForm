"use client";

import Link from "next/link";
import { updateChurchUserRole } from "@/app/admin/actions";
import {
  ConnectedBadge,
  PriorityBadge,
  RoleBadge,
  StatusBadge,
} from "@/components/admin/badges";
import { ChurchAttendanceBarChart } from "@/components/admin/charts";
import { formatDate, formatDateTime, formatDuration, formatHours } from "@/components/admin/format";
import { SupportTicketDialog } from "@/components/admin/support-ticket-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFilters } from "@/components/admin/activity-filters";
import { ActivityPagination } from "@/components/admin/activity-pagination";
import { ChurchFeaturesPanel } from "@/components/admin/church-features-panel";
import { ChurchGivingPanel } from "@/components/admin/church-giving-panel";
import type { FeatureFlags } from "@/lib/features/access";
import { getFeature, type FeatureKey } from "@/lib/features/catalog";
import type {
  AdminActivityFilters,
  AdminActivityResult,
  AdminChurchDetail,
} from "@/lib/queries/admin";

type ChurchDetailTabsProps = {
  detail: AdminChurchDetail;
  activity: AdminActivityResult;
  activityFilters: AdminActivityFilters & { range: NonNullable<AdminActivityFilters["range"]> };
  featureFlags: FeatureFlags;
  /** church_users.id → granted features, for the Users tab. */
  featurePermissionsByMemberId: Record<string, FeatureKey[]>;
};

function MemberAccessCell({
  role,
  grants,
}: {
  role: string;
  grants: FeatureKey[] | undefined;
}) {
  if (role === "admin") {
    return <span className="text-muted-foreground">All enabled features</span>;
  }

  if (!grants || grants.length === 0) {
    return <span className="text-muted-foreground">None</span>;
  }

  return (
    <span className="flex flex-wrap gap-1">
      {grants.map((key) => (
        <span
          key={key}
          className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground"
        >
          {getFeature(key).label}
        </span>
      ))}
    </span>
  );
}

export function ChurchDetailTabs({
  detail,
  activity,
  activityFilters,
  featureFlags,
  featurePermissionsByMemberId,
}: ChurchDetailTabsProps) {
  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="features">Features</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="integrations">Integrations</TabsTrigger>
        <TabsTrigger value="giving">Giving</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="support">Support</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="grid gap-4 xl:grid-cols-2">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Simplicity check (last 30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Pastors should spend minimal time on FaithForm while automation handles
              calls and admin work. Compare pastor screen time to hours saved.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <UsageStat
                label="Pastor time on FaithForm"
                value={formatDuration(detail.usageSummary.pastorSeconds30d)}
              />
              <UsageStat
                label="Hours saved (automation)"
                value={`${formatHours(detail.usageSummary.hoursSavedMinutes30d / 60)} hr`}
              />
              <UsageStat
                label="AI phone calls logged"
                value={detail.usageSummary.phoneCalls30d.toLocaleString("en-US")}
              />
              <UsageStat
                label="Pastor time (7 days)"
                value={formatDuration(detail.usageSummary.pastorSeconds7d)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Church profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <DetailItem label="Name" value={detail.church.name} />
            <DetailItem label="Timezone" value={detail.church.timezone} />
            <DetailItem label="Created" value={formatDate(detail.church.createdAt)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Church settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <DetailItem
              label="AI provider"
              value={detail.settings?.aiProvider || "Not configured"}
            />
            <DetailItem
              label="Model"
              value={detail.settings?.model || "Default model"}
            />
            <DetailItem
              label="Denomination"
              value={detail.settings?.denomination || "Not set"}
            />
            <DetailItem
              label="Preaching style"
              value={detail.settings?.preachingStyle || "Not set"}
            />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Attendance trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ChurchAttendanceBarChart points={detail.attendanceTrend} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="features">
        <ChurchFeaturesPanel
          churchId={detail.church.id}
          churchName={detail.church.name}
          flags={featureFlags}
        />
      </TabsContent>

      <TabsContent value="users">
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-primary font-heading text-[13px] uppercase tracking-wide text-primary-foreground dark:bg-secondary dark:text-secondary-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Feature access</th>
                  <th className="px-4 py-3 text-left">Time on FaithForm (7d)</th>
                  <th className="px-4 py-3 text-left">Time on FaithForm (30d)</th>
                  <th className="px-4 py-3 text-left">Last seen</th>
                  <th className="px-4 py-3 text-left">Joined</th>
                  <th className="px-4 py-3 text-left">Change role</th>
                </tr>
              </thead>
              <tbody>
                {detail.users.map((user) => (
                  <tr key={user.id} className="even:bg-background/60 hover:bg-accent/10">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {user.email ?? "Unknown email"}
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="max-w-[18rem] px-4 py-3 text-sm">
                      <MemberAccessCell
                        role={user.role}
                        grants={featurePermissionsByMemberId[user.id]}
                      />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDuration(user.dashboardSeconds7d)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDuration(user.dashboardSeconds30d)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateTime(user.lastSeenAt)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(user.joinedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <form action={updateChurchUserRole} className="flex gap-2">
                        <input type="hidden" name="churchUserId" value={user.id} />
                        <input
                          type="hidden"
                          name="churchId"
                          value={detail.church.id}
                        />
                        <Select
                          name="role"
                          defaultValue={user.role}
                          className="w-32"
                          aria-label={`Change role for ${user.email ?? user.userId}`}
                        >
                          <option value="admin">Admin</option>
                          <option value="viewer">Viewer</option>
                        </Select>
                        <Button type="submit" variant="outline">
                          Save
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </TabsContent>

      <TabsContent value="giving">
        <ChurchGivingPanel detail={detail} />
      </TabsContent>

      <TabsContent value="integrations" className="grid gap-4 md:grid-cols-2">
        {detail.integrations.map((integration) => (
          <Card key={integration.provider}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="capitalize">{integration.provider}</CardTitle>
                <ConnectedBadge connected={integration.connected} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <DetailItem
                label="Account"
                value={integration.accountLabel ?? "Not connected"}
              />
              <DetailItem
                label="Token expiry"
                value={formatDateTime(integration.tokenExpiresAt)}
              />
              <DetailItem
                label="Last updated"
                value={formatDateTime(integration.updatedAt)}
              />
            </CardContent>
          </Card>
        ))}
      </TabsContent>

      <TabsContent value="activity">
        <Card className="overflow-hidden">
          <ActivityFilters
            filterOptions={activity.filterOptions}
            current={{
              category: activityFilters.category,
              type: activityFilters.type,
              range: activityFilters.range ?? "all",
              page: activity.page,
            }}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-primary font-heading text-[13px] uppercase tracking-wide text-primary-foreground dark:bg-secondary dark:text-secondary-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Category</th>
                  <th className="px-4 py-3 text-left">Task</th>
                  <th className="px-4 py-3 text-left">Time saved</th>
                  <th className="px-4 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {activity.rows.map((row) => (
                  <tr key={row.id} className="even:bg-background/60 hover:bg-accent/10">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {row.type ?? "Unknown"}
                    </td>
                    <td className="px-4 py-3">{row.category ?? "Uncategorized"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.task ?? "Untitled task"}
                    </td>
                    <td className="px-4 py-3">{row.timeSavedMinutes} min</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {activity.rows.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No activity matches the current filters.
            </div>
          )}
          <ActivityPagination
            page={activity.page}
            totalPages={activity.totalPages}
            total={activity.total}
          />
        </Card>
      </TabsContent>

      <TabsContent value="support" className="space-y-4">
        <div className="flex justify-end">
          <SupportTicketDialog
            churches={[
              {
                id: detail.church.id,
                name: detail.church.name,
                createdAt: detail.church.createdAt,
              },
            ]}
            defaultChurchId={detail.church.id}
          />
        </div>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-primary font-heading text-[13px] uppercase tracking-wide text-primary-foreground dark:bg-secondary dark:text-secondary-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Subject</th>
                  <th className="px-4 py-3 text-left">Priority</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {detail.supportTickets.map((ticket) => (
                  <tr key={ticket.id} className="even:bg-background/60 hover:bg-accent/10">
                    <td className="px-4 py-3 font-medium text-foreground">
                      <Link
                        href={`/admin/support/${ticket.id}`}
                        className="hover:text-accent"
                      >
                        {ticket.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={ticket.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(ticket.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.supportTickets.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No support tickets for this church.
            </div>
          )}
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}
