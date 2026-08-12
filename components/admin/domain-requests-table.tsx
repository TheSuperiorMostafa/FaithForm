"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { formatDateTime } from "@/components/admin/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  AdminDomainRequest,
  AdminSiteDomain,
  DomainRequestFilter,
  DomainRequestStatus,
  DomainStatus,
} from "@/lib/sites/domain-queries";
import { cn } from "@/lib/utils";

/**
 * The platform-wide view of both tables.
 *
 * Triage happens on the church's own page — a request is only actionable next
 * to that church's domains and profile, so every row here is a link there
 * rather than a second place to edit the same fields.
 */

const REQUEST_BADGES: Record<
  DomainRequestStatus,
  { label: string; variant: "success" | "info" | "warning" | "muted" | "destructive" }
> = {
  submitted: { label: "New", variant: "warning" },
  in_review: { label: "In review", variant: "info" },
  awaiting_church: { label: "Awaiting church", variant: "warning" },
  in_progress: { label: "In progress", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  declined: { label: "Declined", variant: "muted" },
  cancelled: { label: "Cancelled", variant: "muted" },
};

const DOMAIN_BADGES: Record<
  DomainStatus,
  { label: string; variant: "success" | "info" | "warning" | "destructive" }
> = {
  live: { label: "Live", variant: "success" },
  dns_ok: { label: "DNS OK", variant: "info" },
  pending_dns: { label: "Awaiting DNS", variant: "warning" },
  failed: { label: "Failed", variant: "destructive" },
};

const FILTER_TABS: { value: DomainRequestFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "submitted", label: "New" },
  { value: "awaiting_church", label: "Awaiting church" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

export function DomainRequestsTable({
  requests,
  domains,
  filter,
}: {
  requests: AdminDomainRequest[];
  domains: AdminSiteDomain[];
  filter: DomainRequestFilter;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-col gap-3">
          <CardTitle>Requests</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {FILTER_TABS.map((tab) => (
              <Link
                key={tab.value}
                href={`/admin/domains?filter=${tab.value}`}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  filter === tab.value
                    ? "border-transparent bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:border-accent hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {requests.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Nothing here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Church</th>
                    <th className="px-3 py-3 font-semibold">Asking for</th>
                    <th className="px-3 py-3 font-semibold">Domain</th>
                    <th className="px-3 py-3 font-semibold">Contact</th>
                    <th className="px-3 py-3 font-semibold">Requested</th>
                    <th className="px-6 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr
                      key={request.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-6 py-3">
                        <Link
                          href={`/admin/churches/${request.churchId}?tab=website`}
                          className="font-semibold hover:underline"
                        >
                          {request.churchName}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {request.kind === "register_new"
                          ? "A new domain"
                          : "Connect their own"}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">
                        {request.hostname ?? "—"}
                        {request.alternateHostnames.length > 0 ? (
                          <span className="block text-muted-foreground">
                            +{request.alternateHostnames.length} alt
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {request.contactEmail ?? request.contactName ?? "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                        {formatDateTime(request.createdAt)}
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant={REQUEST_BADGES[request.status].variant}>
                          {REQUEST_BADGES[request.status].label}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Connected domains</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Every hostname the tenant router will answer for.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {domains.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No custom domains yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Hostname</th>
                    <th className="px-3 py-3 font-semibold">Church</th>
                    <th className="px-3 py-3 font-semibold">Last DNS check</th>
                    <th className="px-6 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map((domain) => (
                    <tr
                      key={domain.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-6 py-3">
                        <a
                          href={`https://${domain.hostname}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
                        >
                          {domain.hostname}
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                        {domain.isPrimary ? (
                          <Badge variant="muted" className="ml-2">
                            Primary
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/admin/churches/${domain.churchId}?tab=website`}
                          className="hover:underline"
                        >
                          {domain.churchName}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {domain.dnsDetail ?? "Not checked"}
                        {domain.dnsCheckedAt ? (
                          <span className="block">
                            {formatDateTime(domain.dnsCheckedAt)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant={DOMAIN_BADGES[domain.status].variant}>
                          {DOMAIN_BADGES[domain.status].label}
                        </Badge>
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
