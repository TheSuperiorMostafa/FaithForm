import { Clock, Image as ImageIcon, Link2, MapPin, Smartphone, Type, Users } from "lucide-react";

import { Card } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

const JUMPS = [
  { label: "Look & name", icon: ImageIcon },
  { label: "About", icon: Type },
  { label: "Service times", icon: Clock },
  { label: "Location & contact", icon: MapPin },
  { label: "Social", icon: Users },
  { label: "Links", icon: Link2 },
];

/** Mirrors the Church App page: header, church page editor beside the phone, then access cards. */
export default function MemberAppLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="church app">
      <PageHeader
        title="Church App"
        icon={Smartphone}
        description="Your church's page in the FaithForm app, and how people find and add your church."
      />

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Your church page"
          description="What people see when they open your church in the app. Your website and phone assistant use the same details, so a change here updates them too."
        />
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2">
              {JUMPS.map(({ label, icon: Icon }) => (
                <span
                  key={label}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-muted-foreground"
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </span>
              ))}
              <div className="ml-auto flex items-center gap-2 px-2">
                <Skeleton className="h-1.5 w-20 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>

            {[
              { title: "Look & name", icon: ImageIcon },
              { title: "About", icon: Type },
              { title: "Service times", icon: Clock },
            ].map(({ title, icon: Icon }) => (
              <section
                key={title}
                className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
              >
                <header className="mb-5 flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <h3 className="font-heading text-base font-bold text-foreground">{title}</h3>
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                </header>
                <div className="flex flex-col gap-4">
                  <Skeleton className="h-12 w-full rounded-[10px]" />
                  <Skeleton className="h-12 w-full rounded-[10px]" />
                </div>
              </section>
            ))}
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
      </section>

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
    </SkeletonContainer>
  );
}
