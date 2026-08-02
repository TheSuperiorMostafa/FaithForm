import { redirect } from "next/navigation";

import { EmptySite } from "@/components/website-admin/empty-site";
import { PublishCard } from "@/components/website-admin/publish-card";
import { getChurchAuth } from "@/lib/auth/church";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import {
  countNewSubmissions,
  getSiteDomains,
  getWebsiteForChurch,
} from "@/lib/sites/queries";

export const dynamic = "force-dynamic";

export default async function WebsiteOverviewPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const site = await getWebsiteForChurch(auth.churchId);
  if (!site) return <EmptySite />;

  const [domains, newMessages] = await Promise.all([
    getSiteDomains(auth.churchId),
    countNewSubmissions(auth.churchId),
  ]);

  const published = site.page.status === "published";
  const previewUrl = `${getCanonicalSiteUrl()}/sites/${site.slug}?preview=1`;
  const primary = domains.find((d) => d.isPrimary) ?? domains[0];
  const liveUrl = primary ? `https://${primary.hostname}` : null;

  const visible = site.sections.filter((s) => s.isVisible).length;

  return (
    <div className="flex flex-col gap-6">
      <PublishCard
        initialPublished={published}
        previewUrl={previewUrl}
        liveUrl={liveUrl}
        canEdit={auth.isAdmin}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Sections live" value={`${visible} of ${site.sections.length}`} />
        <Stat label="Theme" value={site.theme.name} />
        <Stat
          label="New messages"
          value={String(newMessages)}
          href={newMessages > 0 ? "/dashboard/website/messages" : undefined}
        />
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <h2 className="font-heading text-lg font-bold">Web address</h2>
        {domains.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            No custom domain is connected yet, so your site is reachable at the
            preview link above. Contact us when you&apos;re ready to point your
            own domain at it.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {domains.map((domain) => (
              <li
                key={domain.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
              >
                <span className="font-mono text-sm">{domain.hostname}</span>
                <span className="text-xs text-muted-foreground">
                  {domain.isPrimary ? "Primary · " : ""}
                  {domain.verifiedAt ? "Verified" : "Pending verification"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Domains are managed by FaithForm. Ask support to add or change one.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const body = (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-heading text-2xl font-bold">{value}</div>
    </div>
  );

  return href ? (
    <a href={href} className="transition-opacity hover:opacity-80">
      {body}
    </a>
  ) : (
    body
  );
}
