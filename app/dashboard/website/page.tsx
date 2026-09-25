import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, Image as ImageIcon, Inbox } from "lucide-react";

import { ActionCard, ActionGrid } from "@/components/ui/action-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptySite } from "@/components/website-admin/empty-site";
import { PublishCard } from "@/components/website-admin/publish-card";
import { SitePreview } from "@/components/website-admin/site-preview";
import { domainStatusWords } from "@/components/website-admin/website-words";
import { getChurchAuth } from "@/lib/auth/church";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import { getChurchDomains } from "@/lib/sites/domain-queries";
import { getDomainProvider } from "@/lib/sites/domains";
import { countNewSubmissions, getWebsiteForChurch } from "@/lib/sites/queries";

export const dynamic = "force-dynamic";

/**
 * Website → Overview: is it live, the three changes churches make most, the
 * web address, and the site itself.
 */
export default async function WebsiteOverviewPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const site = await getWebsiteForChurch(auth.churchId);
  if (!site) return <EmptySite />;

  const [domains, newMessages] = await Promise.all([
    getChurchDomains(auth.churchId),
    countNewSubmissions(auth.churchId),
  ]);

  const published = site.page.status === "published";
  const previewUrl = `${getCanonicalSiteUrl()}/sites/${site.slug}?preview=1`;

  const rootHost = process.env.NEXT_PUBLIC_SITE_ROOT_HOST?.trim().toLowerCase();
  const faithformAddress = rootHost && site.slug ? `${site.slug}.${rootHost}` : null;
  const connected = domains.find((d) => d.status === "live");
  const primary = domains.find((d) => d.isPrimary) ?? domains[0] ?? null;
  const liveHost = connected?.hostname ?? faithformAddress;
  const liveUrl = liveHost ? `https://${liveHost}` : null;

  const visible = site.sections.filter((s) => s.isVisible).length;
  const automated = getDomainProvider().automated;
  const primaryStatus = primary ? domainStatusWords(primary.status, automated) : null;

  return (
    <div className="flex w-full flex-col gap-8">
      <PublishCard
        initialPublished={published}
        previewUrl={previewUrl}
        liveUrl={liveUrl}
        canEdit={auth.isAdmin}
        summary={`${visible} of ${site.sections.length} sections showing · ${site.theme.name} look`}
      />

      <ActionGrid>
        <ActionCard
          href="/dashboard/website/pages?edit=banner"
          icon={ImageIcon}
          title="Change banner photo"
          description="The big photo at the top of your home page. Changes only your website; your app keeps its cover photo."
        />
        <ActionCard
          href="/dashboard/website/details"
          icon={Clock}
          title="Update service times"
          description="Also updates the app, attendance, and your phone assistant."
        />
        <ActionCard
          href="/dashboard/website/inbox"
          icon={Inbox}
          title="Read your inbox"
          description={
            newMessages > 0
              ? "Messages visitors sent through your website."
              : "No new messages from visitors."
          }
          badge={
            newMessages > 0 ? (
              <StatusBadge tone="attention">{newMessages} new</StatusBadge>
            ) : undefined
          }
        />
      </ActionGrid>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h2 className="font-heading text-lg font-bold">Your web address</h2>
            <p className="text-[15px] text-muted-foreground">
              {primary
                ? primaryStatus?.detail
                : faithformAddress
                  ? "Your free FaithForm address works now. You can also use your own, like gracechurch.org."
                  : "Use your own address, like gracechurch.org, or ask us to set one up."}
            </p>
          </div>
          <Link href="/dashboard/website/domain">
            <Button variant="outline">
              {domains.length === 0 ? "Use my own address" : "Manage web address"}
            </Button>
          </Link>
        </div>

        <ul className="mt-4 flex flex-col gap-2">
          {domains.map((domain) => {
            const words = domainStatusWords(domain.status, automated);
            return (
              <li
                key={domain.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3"
              >
                <span className="text-base font-medium">{domain.hostname}</span>
                <StatusBadge tone={words.tone}>{words.label}</StatusBadge>
              </li>
            );
          })}
          {faithformAddress ? (
            <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
              <span className="text-base font-medium">{faithformAddress}</span>
              <span className="text-sm text-muted-foreground">Free FaithForm address</span>
            </li>
          ) : null}
        </ul>
      </section>

      <SitePreview previewUrl={previewUrl} />
    </div>
  );
}
