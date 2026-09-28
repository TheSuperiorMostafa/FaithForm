import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export function AdminStatGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="p-5">
          <Skeleton className="mb-4 size-10 rounded-xl" />
          <Skeleton className="mb-2 h-4 w-28" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="mt-3 h-3 w-36" />
        </Card>
      ))}
    </div>
  );
}

export function AdminTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card className="overflow-hidden">
      <div className="space-y-2 border-b border-border p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid gap-3 p-4 sm:grid-cols-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function AdminChartSkeleton() {
  return (
    <Card className="p-6">
      <Skeleton className="mb-2 h-5 w-44" />
      <Skeleton className="mb-6 h-4 w-64" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </Card>
  );
}

export function AdminOverviewSkeleton() {
  return (
    <SkeletonContainer
      className="mx-auto flex w-full max-w-6xl flex-col gap-5"
      label="platform overview"
    >
      <div>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold tracking-tight text-foreground">
          Platform overview
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monitor churches, users, integrations, and open support across FaithForm.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total churches", "Tenant workspaces"],
          ["Total users", "Church-linked accounts"],
          ["Sermons generated", "All churches"],
          ["Platform hours saved", "From activity log minutes"],
        ].map(([label, description]) => (
          <Card key={label} className="relative overflow-hidden border-t-[3px] border-t-accent p-6">
            <Skeleton className="absolute right-5 top-5 size-10 rounded-xl" />
            <p className="pr-12 text-sm font-medium text-muted-foreground">{label}</p>
            <Skeleton className="mt-2 h-10 w-20" />
            <p className="mt-2 text-xs text-muted-foreground">{description}</p>
          </Card>
        ))}
      </div>

      {/* Platform Giving Card */}
      <Card className="p-6 space-y-4">
        <h2 className="font-heading text-lg font-semibold">Platform giving</h2>
        <div className="space-y-1">
          <Skeleton className="h-8 w-32" />
          <p className="text-sm text-muted-foreground">Total successful gifts (all churches)</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-5 pt-2">
          {["Not started", "Pending", "Restricted", "Live", "Deauthorized"].map((label) => (
            <div key={label} className="space-y-1">
              <span className="text-sm">{label}</span>
              <Skeleton className="h-5 w-12" />
            </div>
          ))}
        </div>
      </Card>

      {/* 2-Column Grid */}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-6 space-y-4">
          <Skeleton className="h-5 w-36" />
          <div className="space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-full rounded-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full rounded-full" />
            </div>
          </div>
        </Card>
        <Card className="p-6 space-y-4">
          <Skeleton className="h-5 w-44" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </SkeletonContainer>
  );
}

export function AdminChurchDetailSkeleton() {
  return (
    <SkeletonContainer
      className="mx-auto flex w-full max-w-6xl flex-col gap-6"
      label="church details"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="border-l-4 border-accent pl-3">
            <Skeleton className="h-8 w-56" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage this church&apos;s profile, AI settings, features, users, integrations, activity, and support.
          </p>
        </div>
        <Skeleton className="h-10 w-44 rounded-lg" />
      </div>

      <div className="space-y-4">
        <div className="flex w-full gap-1 overflow-x-auto rounded-lg border border-border p-1 sm:w-auto sm:self-start">
          {["Overview", "Profile", "AI", "Features", "Users", "Website", "Integrations", "Giving", "Activity", "Support"].map((tab) => (
            <span key={tab} className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted-foreground">
              {tab}
            </span>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="xl:col-span-2">
            <div className="p-6">
              <h2 className="font-heading text-lg font-semibold">Automation activity (last 30 days)</h2>
            </div>
            <div className="p-6 pt-0">
              <p className="mb-4 text-sm text-muted-foreground">
                Time saved by automation and AI calls for this church.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {["Hours saved (automation)", "AI phone calls logged"].map((label) => (
                  <div key={label} className="rounded-xl border border-border/60 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                    <Skeleton className="mt-2 h-8 w-20" />
                  </div>
                ))}
              </div>
            </div>
          </Card>
          {["Church profile", "Church settings"].map((title) => (
            <Card key={title}>
              <div className="p-6">
                <h2 className="font-heading text-lg font-semibold">{title}</h2>
              </div>
              <div className="space-y-4 p-6 pt-0">
                {Array.from({ length: title === "Church profile" ? 3 : 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between gap-4">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
                {title === "Church settings" && (
                  <div className="space-y-2 border-t border-border pt-4">
                    <p className="text-sm font-medium">Platform reporting</p>
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-8 w-44 rounded-lg" />
                  </div>
                )}
              </div>
            </Card>
          ))}
          <Card className="xl:col-span-2 p-6">
            <h2 className="font-heading text-lg font-semibold">Attendance trend</h2>
            <Skeleton className="mt-4 h-64 w-full rounded-xl" />
          </Card>
        </div>
      </div>
    </SkeletonContainer>
  );
}

export function AdminPageSkeleton() {
  return (
    <SkeletonContainer
      className="mx-auto flex w-full max-w-6xl flex-col gap-6"
      label="admin"
    >
      <div>
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <AdminStatGridSkeleton />
      <AdminTableSkeleton />
    </SkeletonContainer>
  );
}
