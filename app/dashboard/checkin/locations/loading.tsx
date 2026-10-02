import {
  ACTIVE_NOW_DESCRIPTION,
  ACTIVE_NOW_TITLE,
  ACTIVITY_DESCRIPTION,
  ACTIVITY_TITLE,
  ROOM_SETTINGS_DESCRIPTION,
  ROOM_SETTINGS_TITLE,
  ROOMS_DESCRIPTION,
  ROOMS_TITLE,
} from "@/components/checkin/copy";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Mirrors the Rooms page: alerts slot, Active now roster cards, activity list,
 * and a collapsed Room settings disclosure. Static titles stay real text.
 */
export default function CheckinLocationsLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="rooms">
      <SectionHeader title={ROOMS_TITLE} description={ROOMS_DESCRIPTION} />

      <section className="flex flex-col gap-5">
        <SectionHeader title={ACTIVE_NOW_TITLE} description={ACTIVE_NOW_DESCRIPTION} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, room) => (
            <Card key={room} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <Skeleton className="h-[25px] w-32" />
                <Skeleton className="h-[30px] w-8" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-7 w-36 rounded-full" />
              </div>
              <Skeleton className="h-[22px] w-full" />
              <Skeleton className="h-11 w-full rounded-[10px]" />
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title={ACTIVITY_TITLE} description={ACTIVITY_DESCRIPTION} />
        <div className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
          {Array.from({ length: 4 }).map((_, row) => (
            <div key={row} className="flex items-center gap-3 px-3 py-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56 max-w-full" />
              </div>
              <Skeleton className="h-4 w-14 shrink-0" />
            </div>
          ))}
        </div>
      </section>

      <div className="rounded-2xl border border-border bg-card/50">
        <div className="flex min-h-12 w-full items-center justify-between gap-3 px-5 py-3">
          <div className="space-y-0.5">
            <p className="text-[15px] font-semibold text-foreground">{ROOM_SETTINGS_TITLE}</p>
            <p className="text-sm text-muted-foreground">{ROOM_SETTINGS_DESCRIPTION}</p>
          </div>
        </div>
      </div>
    </SkeletonContainer>
  );
}
