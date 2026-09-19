import Link from "next/link";
import { ArrowRight, Radio } from "lucide-react";

import type { GeofenceWindow } from "@/lib/attendance/v2/geofence-config";
import { cn } from "@/lib/utils";

function formatWindow(window: GeofenceWindow): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: window.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(window.checkinOpensAt));
  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: window.timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  return `${day}, ${time(window.checkinOpensAt)} – ${time(window.checkinClosesAt)}`;
}

/**
 * Automatic check-in at a glance, where the member app is managed.
 *
 * It is a feature of the app as much as of attendance, so a church looking
 * after its app sees whether it is live — from the same readiness the phones
 * get — and is one tap from setting it up.
 */
export function AutomaticCheckinSummaryCard({
  problem,
  watching,
  nextWindow,
  canOpenSetup,
}: {
  problem: "geofence_disabled" | "no_campus_configured" | null;
  watching: { campusName: string; radiusMeters: number }[];
  nextWindow: GeofenceWindow | null;
  /** Setup lives under Attendance; only link there for people who can open it. */
  canOpenSetup: boolean;
}) {
  const live = problem === null;
  const detail = live
    ? [
        watching.map((campus) => `${campus.campusName} · ${campus.radiusMeters} m`).join(", "),
        nextWindow ? `Next check-in ${formatWindow(nextWindow)}` : "No services in the next 7 days",
      ].join(" · ")
    : problem === "no_campus_configured"
      ? "Switched on, but your building isn't on the map yet."
      : "People can be checked in the moment their phone arrives at church.";

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-card sm:flex-row sm:items-center sm:p-5 dark:shadow-none">
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl",
          live ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300" : "bg-brand-gold/15 text-accent",
        )}
      >
        <Radio className="size-5" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="flex flex-wrap items-center gap-2 font-heading text-base font-semibold text-foreground">
          Automatic Attendance
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-semibold",
              live
                ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            {live ? "Live" : problem === "no_campus_configured" ? "Needs a location" : "Off"}
          </span>
        </h2>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      {canOpenSetup ? (
        <Link
          href="/dashboard/attendance/setup"
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:border-accent hover:text-accent sm:self-center"
        >
          {live ? "Manage" : "Set it up"}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </section>
  );
}
