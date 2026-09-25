import Link from "next/link";
import {
  CalendarClock,
  CalendarDays,
  ChevronRight,
  HandCoins,
  ImageIcon,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { hasAnyCalendar } from "@/lib/integrations/calendar";
import type { FeatureKey } from "@/lib/features/catalog";
import { getChurchProfile } from "@/lib/queries/church-profile";
import { createAdminClientOrNull } from "@/lib/supabase/admin";

import {
  planGettingStarted,
  type GettingStartedKey,
  type GettingStartedSignals,
} from "./getting-started-items";

const ICONS: Record<GettingStartedKey, LucideIcon> = {
  serviceTimes: CalendarClock,
  logo: ImageIcon,
  team: UsersRound,
  calendar: CalendarDays,
  giving: HandCoins,
};

const TITLE = "Finish setting up";
const DESCRIPTION = "A few things that make FaithForm work better for your church.";

/**
 * How many people have a sign-in for this church. A head-only count, scoped
 * by church id, the same shape as `countChurchAdmins` in `lib/queries/team`.
 * (The full roster query looks every member up in Auth, which is too heavy
 * for Home.) Null when it cannot be answered, so the item is simply hidden.
 */
async function countTeam(churchId: string): Promise<number | null> {
  const admin = createAdminClientOrNull();
  if (!admin) return null;
  const { count, error } = await admin
    .from("church_users")
    .select("id", { count: "exact", head: true })
    .eq("church_id", churchId);
  if (error) {
    console.error("[getting-started] team count:", error.message);
    return null;
  }
  return count ?? null;
}

/** Every check is independent and optional: a failure hides only its own item. */
async function loadSignals(churchId: string, allowed: FeatureKey[]): Promise<GettingStartedSignals> {
  const [profile, teamSize, hasCalendar] = await Promise.all([
    getChurchProfile(churchId).catch((error: unknown) => {
      console.error("[getting-started] church profile:", error);
      return null;
    }),
    countTeam(churchId).catch(() => null),
    hasAnyCalendar(churchId).catch((error: unknown) => {
      console.error("[getting-started] calendar:", error);
      return null;
    }),
  ]);

  return {
    hasServiceTimes: profile ? profile.serviceTimes.length > 0 : null,
    hasLogo: profile ? Boolean(profile.logoUrl) : null,
    teamSize,
    hasCalendar,
    givingReady: allowed.includes("giving") && profile ? profile.stripeChargesEnabled : null,
  };
}

/**
 * Home's first-run checklist. Shows only what is still to do, each item a
 * big row that goes straight to the place to do it, and ticks itself off from
 * the church's real data (no "mark as done" to forget). Renders nothing once
 * everything is done, for non-admins (these are admin tasks), or if nothing
 * could be checked.
 *
 * Place on Home inside `<Suspense fallback={<GettingStartedSkeleton />}>`.
 */
export async function GettingStartedCard({
  churchId,
  allowedFeatures,
  isAdmin,
}: {
  churchId: string;
  allowedFeatures: FeatureKey[];
  isAdmin: boolean;
}) {
  if (!isAdmin || !churchId) return null;

  let plan;
  try {
    plan = planGettingStarted(await loadSignals(churchId, allowedFeatures), allowedFeatures);
  } catch (error) {
    console.error("[getting-started] failed:", error);
    return null;
  }

  if (plan.todo.length === 0) return null;

  return (
    <section aria-labelledby="getting-started-title">
      <Card className="rounded-3xl p-6">
        <GettingStartedHeader doneCount={plan.doneCount} totalCount={plan.totalCount} />
        <ul className="mt-5 flex flex-col gap-3">
          {plan.todo.map((item) => {
            const Icon = ICONS[item.key];
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="group flex min-h-[76px] items-center gap-4 rounded-2xl border border-border bg-background px-4 py-3 transition-colors hover:border-accent/50 hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <span
                    aria-hidden
                    className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-primary dark:text-accent"
                  >
                    <Icon className="size-6" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-bold text-foreground">{item.title}</span>
                    <span className="block text-[15px] text-muted-foreground">{item.description}</span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 rounded-xl border border-border bg-card px-4 py-2.5 text-[15px] font-semibold text-primary sm:inline-flex dark:text-accent">
                    {item.cta}
                    <ChevronRight className="size-4" aria-hidden />
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground sm:hidden" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

function GettingStartedHeader({
  doneCount,
  totalCount,
}: {
  doneCount?: number;
  totalCount?: number;
}) {
  const known = typeof doneCount === "number" && typeof totalCount === "number" && totalCount > 0;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id="getting-started-title" className="font-heading text-xl font-bold text-foreground">
          {TITLE}
        </h2>
        <p className="mt-1 text-base text-muted-foreground">{DESCRIPTION}</p>
      </div>
      {known ? (
        <p className="shrink-0 rounded-full bg-muted px-3 py-1 text-sm font-semibold text-foreground">
          {doneCount} of {totalCount} done
        </p>
      ) : (
        <Skeleton className="h-7 w-24 shrink-0 rounded-full" />
      )}
    </div>
  );
}

/** Same card, same header text; only the rows and the count shimmer. */
export function GettingStartedSkeleton() {
  return (
    <SkeletonContainer label="Finish setting up">
      <Card className="rounded-3xl p-6">
        <GettingStartedHeader />
        <div className="mt-5 flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex min-h-[76px] items-center gap-4 rounded-2xl border border-border bg-background px-4 py-3"
            >
              <Skeleton className="size-12 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-44 max-w-full" />
                <Skeleton className="h-4 w-64 max-w-full" />
              </div>
              <Skeleton className="hidden h-11 w-24 shrink-0 rounded-xl sm:block" />
            </div>
          ))}
        </div>
      </Card>
    </SkeletonContainer>
  );
}
