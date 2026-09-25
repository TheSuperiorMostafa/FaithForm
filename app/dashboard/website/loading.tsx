import { Clock, Image as ImageIcon, Inbox } from "lucide-react";

import { ActionCard, ActionGrid } from "@/components/ui/action-card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { SitePreviewSkeleton } from "@/components/website-admin/skeletons";

/** Mirrors Website → Overview. The header and tabs come from the layout. */
export default function WebsiteOverviewLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="website overview">
      {/* Publish card: live or draft is data, so it shimmers. */}
      <section className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-3">
              <Skeleton className="h-7 w-64 max-w-full" />
              <Skeleton className="h-7 w-16 rounded-full" />
            </div>
            <Skeleton className="h-5 w-full max-w-lg" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-12 w-44 rounded-[10px]" />
        </div>
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-11 w-44 rounded-[10px]" />
          <Skeleton className="h-11 w-36 rounded-[10px]" />
        </div>
      </section>

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
          description="Messages visitors sent through your website."
        />
      </ActionGrid>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="font-heading text-lg font-bold">Your web address</h2>
            <Skeleton className="h-5 w-full max-w-md" />
          </div>
          <Skeleton className="h-11 w-48 rounded-[10px]" />
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Skeleton className="h-[54px] w-full rounded-xl" />
        </div>
      </section>

      <SitePreviewSkeleton />
    </SkeletonContainer>
  );
}
