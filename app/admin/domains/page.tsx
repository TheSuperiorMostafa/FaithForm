import { DomainRequestsTable } from "@/components/admin/domain-requests-table";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import {
  listAllDomains,
  listDomainRequests,
  type DomainRequestFilter,
} from "@/lib/sites/domain-queries";
import { getDomainProvider } from "@/lib/sites/domains";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FILTERS: DomainRequestFilter[] = [
  "open",
  "submitted",
  "awaiting_church",
  "in_progress",
  "completed",
  "all",
];

function parseFilter(value: string | undefined): DomainRequestFilter {
  return FILTERS.includes(value as DomainRequestFilter)
    ? (value as DomainRequestFilter)
    : "open";
}

/**
 * The domain work queue.
 *
 * Sorted oldest-first while filtered to open, because a domain request is a
 * promise of human work and the one that has been waiting longest is the one
 * that matters. Every other filter sorts newest-first, which is what you want
 * when you are looking something up rather than working through a list.
 */
export default async function AdminDomainsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const filter = parseFilter(
    typeof query.filter === "string" ? query.filter : undefined,
  );

  const [requests, domains] = await Promise.all([
    listDomainRequests(filter),
    listAllDomains(),
  ]);

  const automated = getDomainProvider().automated;
  const needsAttention = domains.filter((d) => d.status === "dns_ok").length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Domains"
        description="Churches connecting a domain they own, and churches asking us to get them one."
        action={
          <Badge variant={automated ? "success" : "warning"}>
            {automated ? "Provider automated" : "Manual provisioning"}
          </Badge>
        }
      />

      {needsAttention > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <strong>{needsAttention}</strong>{" "}
          {needsAttention === 1 ? "domain has" : "domains have"} correct DNS and
          {automated
            ? " are waiting on the provider to finish."
            : " are waiting on us — add the hostname to the Vercel project, then mark it live."}
        </div>
      ) : null}

      <DomainRequestsTable
        requests={requests}
        domains={domains}
        filter={filter}
      />
    </div>
  );
}
