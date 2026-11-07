import { Image as ImageIcon, Smartphone } from "lucide-react";

import { ChurchAppSettings } from "@/components/member-app/church-app-settings";
import { BrandColorsSkeleton } from "@/components/settings/brand-colors-skeleton";
import { Card } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { getChurchAuth } from "@/lib/auth/church";

export default async function MemberAppLoading() {
  const auth = await getChurchAuth();
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="Church App">
      <PageHeader
        title="Church App"
        icon={Smartphone}
        description="Your church's page in the FaithForm app, and how people find and add your church."
      />

      <div inert>
        <ChurchAppSettings
          colors={auth?.isAdmin && <BrandColorsSkeleton />}
          editorFallback={<EditorSkeleton canEdit={auth?.isAdmin ?? false} />}
          access={<AccessSkeleton />}
        />
      </div>
    </SkeletonContainer>
  );
}

function EditorSkeleton({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex min-h-12 items-center justify-end gap-2 rounded-2xl border border-border bg-card px-5">
          <Skeleton className="h-1.5 w-20 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
        {!canEdit && (
          <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            Only church admins can change the church page. You can still preview it here.
          </p>
        )}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <header className="mb-5 flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
              <ImageIcon className="size-[18px]" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-heading text-base font-bold text-foreground">Look &amp; name</h3>
              <p className="text-sm text-muted-foreground">
                The first thing people see when they open your church. Also shown in Settings → Church info.
              </p>
            </div>
          </header>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-semibold">Cover photo</span>
                <span className="font-medium text-muted-foreground underline underline-offset-4">Use a link instead</span>
              </div>
              <p className="text-sm text-muted-foreground">
                A wide photo of your building, your people, or worship. It fills the top of your page. Widescreen, 16:9 — the shape the apps show. Your website shows the middle band.
              </p>
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <Skeleton className="aspect-video w-full max-w-md" />
                <Skeleton className="h-10 w-44" />
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
              <div className="space-y-2">
                <p className="text-sm font-semibold">Logo</p>
                <Skeleton className="aspect-square w-full" />
              </div>
              <div className="flex flex-col gap-4">
                {["Church name", "Tagline"].map((label) => (
                  <div key={label} className="space-y-1.5">
                    <p className="text-sm font-semibold">{label}</p>
                    <Skeleton className="h-12 w-full rounded-[10px]" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      <aside className="xl:sticky xl:top-6 xl:self-start">
        <div className="mb-3 flex items-center justify-between xl:justify-center">
          <p className="text-sm font-semibold text-muted-foreground">Live preview</p>
        </div>
        <div className="flex flex-col items-center gap-4">
          <div className="inline-flex rounded-full border border-border bg-muted/50 p-1 text-sm font-semibold">
            <span className="inline-flex min-h-11 items-center rounded-full bg-background px-4 text-foreground shadow-sm">
              Your people
            </span>
            <span className="inline-flex min-h-11 items-center rounded-full px-4 text-muted-foreground">
              Someone new
            </span>
          </div>
          <div className="relative w-[340px] max-w-full rounded-[54px] bg-neutral-900 p-[11px]">
            <Skeleton className="h-[690px] w-full rounded-[44px]" />
          </div>
        </div>
        <p className="mx-auto mt-3 max-w-[320px] text-center text-sm text-muted-foreground">
          Updates as you type. People see changes the next time they open your page.
        </p>
      </aside>
    </div>
  );
}

function AccessSkeleton() {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="How people add your church"
        description="Each person has one church in the app. Invitation links are the easiest way in; being listed in search is optional."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} className="space-y-4 p-6">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-[10px]" />
          </Card>
        ))}
      </div>
    </section>
  );
}
