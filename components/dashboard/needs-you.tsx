import Link from "next/link";
import { ChevronRight, CircleCheck, Film, UserCheck, UserPlus, type LucideIcon } from "lucide-react";

import { getPendingClaims, getPendingJoinRequests } from "@/app/dashboard/people/claim-actions";
import type { FeatureKey } from "@/lib/features/catalog";
import { listStaffRecordings } from "@/lib/stream/recording-publication";

type Item = {
  key: string;
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  cta: string;
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What is waiting on the church right now, in plain words, each with the one
 * button that deals with it. Every source is optional: a failure in one never
 * breaks Home, it just leaves that item out.
 */
async function collect(churchId: string, allowed: FeatureKey[]): Promise<Item[]> {
  const items: Item[] = [];
  const has = (feature: FeatureKey) => allowed.includes(feature);

  const [recordings, joinRequests, claims] = await Promise.all([
    has("live_stream")
      ? listStaffRecordings(churchId, { limit: 20 }).catch(() => [])
      : Promise.resolve([]),
    has("people") || has("member_app")
      ? getPendingJoinRequests().catch(() => ({ items: [] as { state: string }[] }))
      : Promise.resolve({ items: [] as { state: string }[] }),
    has("people") ? getPendingClaims().catch(() => []) : Promise.resolve([]),
  ]);

  const ready = recordings.filter((r) => r.phase.phase === "ready_to_publish");
  if (ready.length > 0) {
    items.push({
      key: "recordings",
      icon: Film,
      title: `${plural(ready.length, "recording is", "recordings are")} ready to publish`,
      description: "Review and share them in the app.",
      href: ready.length === 1 ? `/dashboard/live-streaming/recordings/${ready[0].id}` : "/dashboard/live-streaming/recordings",
      cta: "Review",
    });
  }

  const problems = recordings.filter((r) => r.phase.phase === "needs_attention");
  if (problems.length > 0) {
    items.push({
      key: "recording-problems",
      icon: Film,
      title: `${plural(problems.length, "recording needs", "recordings need")} a look`,
      description: "Something went wrong while preparing it.",
      href: "/dashboard/live-streaming/recordings",
      cta: "See what happened",
    });
  }

  const pendingJoins = joinRequests.items.filter((r) => r.state === "pending");
  if (pendingJoins.length > 0) {
    items.push({
      key: "joins",
      icon: UserPlus,
      title: `${plural(pendingJoins.length, "person wants", "people want")} to join your church`,
      description: "They asked from the FaithForm app.",
      href: "/dashboard/people",
      cta: "Review",
    });
  }

  if (claims.length > 0) {
    items.push({
      key: "claims",
      icon: UserCheck,
      title: `${plural(claims.length, "person needs", "people need")} matching to People`,
      description: "Confirm who they are so their details stay together.",
      href: "/dashboard/people",
      cta: "Confirm",
    });
  }

  return items;
}

export async function NeedsYou({
  churchId,
  allowedFeatures,
}: {
  churchId: string;
  allowedFeatures: FeatureKey[];
}) {
  const items = await collect(churchId, allowedFeatures);

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-4 dark:border-emerald-500/25 dark:bg-emerald-500/10">
        <CircleCheck className="size-6 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden />
        <p className="text-base font-semibold text-foreground">
          You&apos;re all caught up. Nothing is waiting on you.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 md:grid-cols-2" aria-label="Waiting on you">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.key}>
            <Link
              href={item.href}
              className="group flex min-h-[88px] items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 transition-colors hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-amber-500/25 dark:bg-amber-500/10"
            >
              <span
                aria-hidden
                className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-amber-700 shadow-sm dark:bg-amber-500/15 dark:text-amber-200"
              >
                <Icon className="size-6" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold text-foreground">{item.title}</span>
                <span className="block text-[15px] text-foreground/70">{item.description}</span>
              </span>
              <span className="hidden shrink-0 items-center gap-1 rounded-xl bg-white px-4 py-2.5 text-[15px] font-semibold text-primary shadow-sm sm:inline-flex dark:bg-card dark:text-accent">
                {item.cta}
                <ChevronRight className="size-4" aria-hidden />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
