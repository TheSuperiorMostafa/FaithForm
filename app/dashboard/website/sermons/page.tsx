import { redirect } from "next/navigation";
import Link from "next/link";

import { EmptySite } from "@/components/website-admin/empty-site";
import { MediaTable } from "@/components/website-admin/media-table";
import { getChurchAuth } from "@/lib/auth/church";
import { getSiteMediaForChurch, getWebsiteForChurch } from "@/lib/sites/queries";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

export default async function WebsiteSermonsPage() {
  if (await pageFeatureBlocked("website")) return null;

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const site = await getWebsiteForChurch(auth.churchId);
  if (!site) return <EmptySite />;

  const items = await getSiteMediaForChurch(auth.churchId);

  const recordings = site.profile.media.filter(item => item.id.startsWith("recording:"));
  return <div className="flex w-full flex-col gap-6">
    <section className="rounded-2xl border border-border bg-card p-5" aria-labelledby="website-recordings-heading">
      <h2 id="website-recordings-heading" className="font-heading text-lg font-semibold">Latest website recordings</h2>
      <p className="mt-1 text-[15px] text-muted-foreground">These recordings appear among the latest messages on your website. Open your recordings to manage the full library, or add a video link below.</p>
      <Link href="/dashboard/live-streaming/recordings" className="mt-3 inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-4">Upload or manage recordings</Link>
      {recordings.length > 0 ? <ul className="mt-4 divide-y divide-border">{recordings.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <span className="min-w-0 break-words text-[15px] font-medium">{item.title}</span>
        <Link href={`/dashboard/live-streaming/recordings/${item.id.slice("recording:".length)}`} className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-4">Edit recording</Link>
      </li>)}</ul> : <p className="mt-3 text-[15px] text-muted-foreground">No recordings among the latest messages on your website.</p>}
    </section>
    <MediaTable key={`${auth.userId}:${auth.churchId}`} recoveryScope={{ userId: auth.userId, churchId: auth.churchId }} items={items} canEdit={auth.isAdmin} isLive={site.settings?.isPublished === true && site.page.status === "published"} />
  </div>;
}
