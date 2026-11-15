"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

import { formatDateTime } from "@/components/admin/format";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  AdminDomainRequest,
  AdminSiteDomain,
  DomainRequestFilter,
  DomainRequestStatus,
  DomainStatus,
} from "@/lib/sites/domain-queries";
import { cn } from "@/lib/utils";

const REQUEST_BADGES: Record<DomainRequestStatus, { label: string; variant: "success" | "info" | "warning" | "muted" | "destructive" }> = {
  submitted: { label: "New", variant: "warning" },
  in_review: { label: "In review", variant: "info" },
  awaiting_church: { label: "Awaiting church", variant: "warning" },
  in_progress: { label: "In progress", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  declined: { label: "Declined", variant: "muted" },
  cancelled: { label: "Cancelled", variant: "muted" },
};

const DOMAIN_BADGES: Record<DomainStatus, { label: string; variant: "success" | "info" | "warning" | "destructive" }> = {
  live: { label: "Connected", variant: "success" },
  dns_ok: { label: "Finishing connection", variant: "info" },
  pending_dns: { label: "Waiting for settings", variant: "warning" },
  failed: { label: "Needs attention", variant: "destructive" },
};

const FILTER_TABS: { value: DomainRequestFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "submitted", label: "New" },
  { value: "awaiting_church", label: "Awaiting church" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

type QueueDomain = AdminSiteDomain & { setup?: {
  phase: "connecting" | "ownership" | "dns" | "https" | "ready" | "attention";
  title: string;
  description: string;
  checkedAt: string | null;
  nextCheckAt: string | null;
} };

function nextAction(domain: QueueDomain) {
  if (domain.setup) {
    switch (domain.setup.phase) {
      case "ownership": return "Ask the church or its IT person to add the ownership record.";
      case "connecting": return "Hosting setup is queued. Check the saved connection progress.";
      case "dns": return "The church or its IT person needs to update the website settings.";
      case "https": return "Wait for the secure connection check to finish.";
      case "attention": return "Review the connection details and retry the failed step.";
      case "ready": return "Connection complete. Publication is managed separately.";
    }
  }
  switch (domain.status) {
    case "live": return "Connection complete. Publication is managed separately.";
    case "dns_ok": return "Finish the hosting connection and verify the church website.";
    case "failed": return "Review the last check and retry the connection.";
    default: return "The church or its IT person needs to update the website settings.";
  }
}

/** One work queue; changes are made from the church’s setup panel. */
export function DomainRequestsTable({ requests, domains, filter, nextDomainsCursor, currentDomainsCursor }: {
  requests: AdminDomainRequest[];
  domains: QueueDomain[];
  filter: DomainRequestFilter;
  nextDomainsCursor?: string | null;
  currentDomainsCursor?: string | null;
}) {
  const summaries = [
    { label: "Connected addresses", count: domains.filter(domain => domain.status === "live").length },
    { label: "Waiting for church", count: domains.filter(domain => domain.setup ? ["ownership", "dns"].includes(domain.setup.phase) : domain.status === "pending_dns").length },
    { label: "Finishing connection", count: domains.filter(domain => domain.setup ? ["connecting", "https"].includes(domain.setup.phase) : domain.status === "dns_ok").length },
    { label: "Needs attention", count: domains.filter(domain => domain.setup?.phase === "attention" || domain.status === "failed").length },
  ];
  return (
    <div className="flex w-full flex-col gap-6">
      <div><p className="mb-3 text-sm text-muted-foreground">Connection counts for this page</p><dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summaries.map(summary => <div key={summary.label} className="rounded-2xl border border-border bg-card p-5"><dt className="text-sm text-muted-foreground">{summary.label}</dt><dd className="mt-2 text-3xl font-bold tabular-nums">{summary.count}</dd></div>)}
      </dl></div>
      <Card>
        <CardHeader className="gap-3">
          <CardTitle>Requests</CardTitle>
          <nav aria-label="Filter domain requests" className="flex flex-wrap gap-2">
            {FILTER_TABS.map(tab => <Link key={tab.value} href={`/admin/domains?filter=${tab.value}`} aria-current={filter === tab.value ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-sm font-semibold transition-colors", filter === tab.value ? "border-transparent bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:border-accent hover:text-foreground")}>{tab.label}</Link>)}
          </nav>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? <p className="text-sm text-muted-foreground">No requests match this view.</p> : <ul className="divide-y divide-border rounded-xl border border-border">
            {requests.map(request => <li key={request.id} className="flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><Link href={`/admin/churches/${request.churchId}?tab=website`} className="inline-flex min-h-11 items-center break-words font-semibold hover:underline">{request.churchName}</Link><p className="break-words text-sm text-muted-foreground">{request.kind === "register_new" ? "Needs a new address" : "Connecting an existing address"} · {request.hostname ?? "Address not selected"}</p></div>
                <Badge variant={REQUEST_BADGES[request.status].variant}>{REQUEST_BADGES[request.status].label}</Badge>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div><dt className="font-semibold text-muted-foreground">Contact</dt><dd className="mt-1 break-words">{request.contactName ?? "Not provided"}{request.contactEmail ? <span className="block">{request.contactEmail}</span> : null}</dd></div>
                <div><dt className="font-semibold text-muted-foreground">Requested</dt><dd className="mt-1">{formatDateTime(request.createdAt)}</dd></div>
                <div><dt className="font-semibold text-muted-foreground">Next step</dt><dd className="mt-1">{request.status === "awaiting_church" ? "Follow up with the church using the saved contact." : request.status === "completed" ? "Review the connected address." : ["cancelled", "declined"].includes(request.status) ? "No further work scheduled." : "Review the request and its connection progress."}</dd></div>
              </dl>
              <Link href={`/admin/churches/${request.churchId}?tab=website`} className={cn(buttonVariants({ variant: "outline" }), "w-fit")}><ArrowRight className="size-4" aria-hidden />Open church setup</Link>
            </li>)}
          </ul>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Website connections</CardTitle><p className="text-sm text-muted-foreground">Connection progress and the next action for every church address. A connected address does not publish a draft website.</p></CardHeader>
        <CardContent>
          {domains.length === 0 ? <p className="text-sm text-muted-foreground">No church addresses have been added yet.</p> : <ul className="divide-y divide-border rounded-xl border border-border">
            {[...domains].sort((a, b) => Number(a.status === "live") - Number(b.status === "live")).map(domain => <li key={domain.id} className="flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-semibold">{domain.hostname}{domain.isPrimary ? <span className="ml-2 text-sm font-normal text-muted-foreground">Main address</span> : null}</p><p className="mt-1 break-words text-sm text-muted-foreground">{domain.churchName}</p></div><Badge variant={domain.setup?.phase === "attention" ? "destructive" : DOMAIN_BADGES[domain.status].variant}>{domain.setup?.title ?? DOMAIN_BADGES[domain.status].label}</Badge></div>
              <p className="text-sm">{nextAction(domain)}</p>
              <div className="flex flex-wrap items-center justify-between gap-3"><div className="text-sm text-muted-foreground"><p>{domain.setup?.checkedAt ?? domain.dnsCheckedAt ? `Last checked ${formatDateTime((domain.setup?.checkedAt ?? domain.dnsCheckedAt)!)}` : "Waiting for the first connection check"}</p>{domain.setup?.nextCheckAt && domain.setup.phase !== "ready" ? <p className="mt-1">Next check {formatDateTime(domain.setup.nextCheckAt)}</p> : null}</div><div className="flex flex-wrap gap-2">{domain.status === "live" ? <a href={`https://${domain.hostname}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost" })}><ExternalLink className="size-4" aria-hidden />Open address</a> : null}<Link href={`/admin/churches/${domain.churchId}?tab=website`} className={buttonVariants({ variant: "outline" })}><ArrowRight className="size-4" aria-hidden />Open setup</Link></div></div>
            </li>)}
          </ul>}
          {nextDomainsCursor || currentDomainsCursor ? <nav aria-label="Connection pages" className="mt-5 flex flex-wrap justify-between gap-3">
            {currentDomainsCursor ? <Link href={`/admin/domains?filter=${encodeURIComponent(filter)}`} className={buttonVariants({ variant: "outline" })}><ArrowRight className="size-4 rotate-180" aria-hidden />Newest connections</Link> : <span />}
            {nextDomainsCursor ? <Link href={`/admin/domains?filter=${encodeURIComponent(filter)}&domainCursor=${encodeURIComponent(nextDomainsCursor)}`} className={buttonVariants({ variant: "outline" })}>Older connections<ArrowRight className="size-4" aria-hidden /></Link> : null}
          </nav> : null}
        </CardContent>
      </Card>
    </div>
  );
}
