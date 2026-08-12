import { redirect } from "next/navigation";

import { DomainWorkspace } from "@/components/website-admin/domain-workspace";
import { getChurchAuth } from "@/lib/auth/church";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import {
  getChurchDomainRequests,
  getChurchDomains,
  getOpenDomainRequest,
} from "@/lib/sites/domain-queries";
import { dnsRecordsFor, getDomainProvider } from "@/lib/sites/domains";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Where a church sets up their web address.
 *
 * Three addresses can exist at once and the page is ordered by how much work
 * each costs the church: the FaithForm subdomain already works and needs
 * nothing, a domain they own needs two DNS records, and a domain they do not
 * have yet needs us. Leading with the one that already works means a church
 * that only wanted "is my site reachable?" is answered before being asked to
 * do anything.
 */
export default async function WebsiteDomainPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const { data: church } = await createAdminClient()
    .from("churches")
    .select("slug, name, email")
    .eq("id", auth.churchId)
    .maybeSingle();

  const [domains, openRequest, history] = await Promise.all([
    getChurchDomains(auth.churchId),
    getOpenDomainRequest(auth.churchId),
    getChurchDomainRequests(auth.churchId),
  ]);

  const rootHost = process.env.NEXT_PUBLIC_SITE_ROOT_HOST?.trim().toLowerCase();
  const slug = (church?.slug as string | null) ?? null;

  // Every church has this the moment their site publishes — no DNS, no wait.
  const faithformAddress =
    rootHost && slug ? `${slug}.${rootHost}` : null;

  return (
    <DomainWorkspace
      domains={domains.map((domain) => ({
        ...domain,
        records: dnsRecordsFor(domain.hostname),
      }))}
      openRequest={openRequest}
      history={history.filter((r) => r.id !== openRequest?.id)}
      faithformAddress={faithformAddress}
      previewUrl={slug ? `${getCanonicalSiteUrl()}/sites/${slug}?preview=1` : null}
      canEdit={auth.isAdmin}
      defaults={{
        contactName: null,
        contactEmail: (church?.email as string | null) ?? null,
      }}
      /* Shown so a church knows whether the last step is automatic or a person. */
      automated={getDomainProvider().automated}
    />
  );
}
