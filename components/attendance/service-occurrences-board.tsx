"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  History,
  MapPin,
  PenLine,
  QrCode,
  Tablet,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  applyCorrection,
  cancelService,
  getOccurrenceRoster,
  markMemberPresent,
  markRosterPresent,
  refreshOccurrenceHorizon,
  type ServiceMethodCounts,
} from "@/app/dashboard/attendance/services/actions";
import type { ServiceOccurrence } from "@/lib/attendance/v2/occurrences";
import type { RosterEntry } from "@/lib/attendance/v2/roster";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CheckinDisplayPanel } from "@/components/attendance/checkin-display-panel";
import { cn } from "@/lib/utils";

/**
 * The occurrence board.
 *
 * Replaces the Sunday-only picker: a service is whatever the church actually
 * scheduled, on any day, at any campus, and several on one day are several
 * entries rather than one batch.
 *
 * How each person was counted is shown in words and with its own icon, never
 * by colour alone: an automatic check-in, a scanned code, a welcome-desk kiosk
 * and a greeter's mark are different evidence, and a church reviewing a
 * service should be able to tell them apart at a glance.
 */

type MethodStyle = { label: string; icon: LucideIcon; className: string };

const METHODS: Record<string, MethodStyle> = {
  geofence: {
    label: "Automatic",
    icon: MapPin,
    className: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  },
  qr: {
    label: "Scanned",
    icon: QrCode,
    className: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  },
  kiosk: {
    label: "Kiosk",
    icon: Tablet,
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  manual: {
    label: "Marked",
    icon: UserCheck,
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  admin: {
    label: "Corrected",
    icon: PenLine,
    className: "bg-muted text-muted-foreground",
  },
  legacy: {
    label: "Recorded",
    icon: History,
    className: "bg-muted text-muted-foreground",
  },
};

/** Display order for summaries: the methods a church most wants to compare first. */
const METHOD_ORDER = ["geofence", "qr", "kiosk", "manual", "admin", "legacy"];

function MethodBadge({ source }: { source: string | null }) {
  const style = METHODS[source ?? ""];
  if (!style) {
    return <span className="text-xs text-muted-foreground">Present</span>;
  }
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        style.className,
      )}
    >
      <Icon className="size-3" strokeWidth={2} aria-hidden />
      {style.label}
    </span>
  );
}

function methodSummary(bySource: Record<string, number>): string {
  return METHOD_ORDER.filter((key) => (bySource[key] ?? 0) > 0)
    .map((key) => `${bySource[key]} ${METHODS[key].label.toLowerCase()}`)
    .join(" · ");
}

function formatWhen(occurrence: ServiceOccurrence): string {
  // Always the service's own zone — a staff member in another timezone must
  // still see the time the congregation will arrive.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: occurrence.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(occurrence.startsAtUtc));
}

function isOpenNow(occurrence: ServiceOccurrence, now: number): boolean {
  return (
    occurrence.status !== "cancelled" &&
    Date.parse(occurrence.checkinOpensAtUtc) <= now &&
    now <= Date.parse(occurrence.checkinClosesAtUtc)
  );
}

export function ServiceOccurrencesBoard({
  upcoming,
  recent,
  counts,
  isAdmin,
}: {
  upcoming: ServiceOccurrence[];
  recent: ServiceOccurrence[];
  counts: Record<string, ServiceMethodCounts>;
  isAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<ServiceOccurrence | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [search, setSearch] = useState("");
  // Read once per render of the list; the badge is a hint, and the server
  // decides whether check-in is really open.
  const [now] = useState(() => Date.now());

  /**
   * Batch keys, held per submission intent rather than per click.
   *
   * A ref, not state: changing it must not re-render, and it must survive the
   * failed render-free path a retry takes.
   */
  const batchKeys = useRef<Record<string, string>>({});

  const openRoster = (occurrence: ServiceOccurrence) => {
    setSelected(occurrence);
    setRoster([]);
    startTransition(async () => {
      setRoster(await getOccurrenceRoster(occurrence.id));
    });
  };

  const refreshRoster = (occurrenceId: string) => {
    startTransition(async () => {
      setRoster(await getOccurrenceRoster(occurrenceId));
    });
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return roster;
    return roster.filter((entry) =>
      `${entry.firstName} ${entry.lastName}`.toLowerCase().includes(term),
    );
  }, [roster, search]);

  const presentCount = roster.filter((entry) => entry.status === "active").length;

  const rosterBySource = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const entry of roster) {
      if (entry.status !== "active" || !entry.source) continue;
      tally[entry.source] = (tally[entry.source] ?? 0) + 1;
    }
    return tally;
  }, [roster]);

  const mark = (occurrenceId: string, memberId: string) => {
    startTransition(async () => {
      const result = await markMemberPresent({ occurrenceId, memberId });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      // "Already counted" is a success, not an error — someone may have checked
      // themselves in a moment ago.
      toast.success(
        result.data.outcome === "already_counted" ? "Already counted." : "Marked present.",
      );
      refreshRoster(occurrenceId);
    });
  };

  const markAll = (occurrenceId: string) => {
    const unmarked = roster.filter((entry) => entry.status !== "active");
    if (unmarked.length === 0) {
      toast.success("Everyone is already counted.");
      return;
    }

    const memberIds = unmarked.map((entry) => entry.memberId);

    // One key per *intent*, not per click. If the first submission times out
    // and the person presses the button again, the same key comes back, so the
    // database recognises the retry instead of treating it as a second batch.
    // A fresh key each time would be a new batch of attempts every press.
    const intent = `${occurrenceId}:${[...memberIds].sort().join(",")}`;
    const batchKey = (batchKeys.current[intent] ??= crypto.randomUUID());

    startTransition(async () => {
      const result = await markRosterPresent({
        occurrenceId,
        memberIds,
        batchKey,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const counted = result.data.filter((row) => row.outcome === "counted").length;
      const already = result.data.filter((row) => row.outcome === "already_counted").length;
      toast.success(
        already > 0
          ? `${counted} marked, ${already} already counted.`
          : `${counted} marked present.`,
      );
      refreshRoster(occurrenceId);
    });
  };

  const correct = (
    occurrenceId: string,
    factId: string,
    action: "reverse" | "restore",
  ) => {
    startTransition(async () => {
      const result = await applyCorrection({ factId, action });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(action === "reverse" ? "Attendance removed." : "Attendance restored.");
      refreshRoster(occurrenceId);
    });
  };

  const refreshHorizon = () => {
    startTransition(async () => {
      const result = await refreshOccurrenceHorizon();
      if (result.ok) {
        const changed = result.data.created + result.data.refreshed + result.data.retired;
        toast.success(changed > 0 ? "Services updated from your schedule." : "Services are up to date.");
      } else {
        toast.error(result.message);
      }
    });
  };

  const renderRow = (occurrence: ServiceOccurrence) => {
    const summary = counts[occurrence.id];
    const openNow = isOpenNow(occurrence, now);
    return (
      <button
        key={occurrence.id}
        type="button"
        onClick={() => openRoster(occurrence)}
        className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-left transition-colors ${
          selected?.id === occurrence.id
            ? "border-accent bg-accent/5"
            : "border-border bg-background hover:border-accent/50"
        }`}
      >
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">
            {occurrence.label}
            {occurrence.status === "cancelled" && (
              <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">
                Cancelled
              </span>
            )}
            {openNow && (
              <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                Check-in open
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatWhen(occurrence)}
            {occurrence.campusName ? ` · ${occurrence.campusName}` : ""}
          </span>
        </div>
        {summary && summary.counted > 0 ? (
          <span className="flex flex-col items-end text-right">
            <span className="text-sm font-semibold text-foreground">
              {summary.counted} present
            </span>
            <span className="text-xs text-muted-foreground">
              {methodSummary(summary.bySource)}
            </span>
          </span>
        ) : null}
      </button>
    );
  };

  const nothing = upcoming.length === 0 && recent.length === 0;

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
            Events &amp; services
          </h1>
          <p className="text-sm text-muted-foreground">
            Every event that counts attendance, including Sunday services.
            Pick one to see who came and how they checked in.
          </p>
        </div>
        <Button variant="outline" onClick={refreshHorizon} disabled={pending}>
          Refresh from schedule
        </Button>
      </div>

      {nothing && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">No attendance events yet</CardTitle>
            <CardDescription>
              Enable attendance on a calendar event, or add weekly service times in{" "}
              <Link
                href="/dashboard/attendance/setup"
                className="font-semibold text-accent hover:underline"
              >
                Automatic Attendance
              </Link>
              , and they appear here.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="services-upcoming">
          <h2 id="services-upcoming" className="text-sm font-semibold text-muted-foreground">
            Open and coming up
          </h2>
          {upcoming.map(renderRow)}
        </section>
      )}

      {recent.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="services-recent">
          <h2 id="services-recent" className="text-sm font-semibold text-muted-foreground">
            Recent
          </h2>
          {recent.map(renderRow)}
        </section>
      )}

      {selected && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {selected.label} — {presentCount} present
            </CardTitle>
            <CardDescription>
              {formatWhen(selected)}
              {presentCount > 0 && methodSummary(rosterBySource)
                ? ` · ${methodSummary(rosterBySource)}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {selected.status !== "cancelled" && (
              <CheckinDisplayPanel occurrenceId={selected.id} isAdmin={isAdmin} />
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={search}
                placeholder="Search people"
                onChange={(event) => setSearch(event.target.value)}
                className="max-w-xs"
                aria-label="Search people"
              />
              <Button
                variant="outline"
                onClick={() => markAll(selected.id)}
                disabled={pending || selected.status === "cancelled"}
              >
                Mark everyone present
              </Button>
              {isAdmin && selected.status !== "cancelled" && (
                <Button
                  variant="outline"
                  onClick={() =>
                    startTransition(async () => {
                      const result = await cancelService({ occurrenceId: selected.id });
                      if (result.ok) toast.success("Service cancelled.");
                      else toast.error(result.message);
                    })
                  }
                  disabled={pending}
                >
                  Cancel service
                </Button>
              )}
            </div>

            {roster.length === 0 && !pending && (
              <p className="text-sm text-muted-foreground">
                No people in this church yet. Add them on the People page.
              </p>
            )}

            <div className="flex flex-col divide-y divide-border">
              {filtered.map((entry) => (
                <div
                  key={entry.memberId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-foreground">
                      {entry.firstName} {entry.lastName}
                    </span>
                    {entry.status === "reversed" ? (
                      <span className="text-xs text-muted-foreground">Removed</span>
                    ) : entry.status === "active" ? (
                      <MethodBadge source={entry.source} />
                    ) : null}
                  </div>

                  <div className="flex gap-2">
                    {entry.status !== "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || selected.status === "cancelled"}
                        onClick={() => mark(selected.id, entry.memberId)}
                      >
                        {entry.status === "reversed" ? "Mark again" : "Present"}
                      </Button>
                    )}
                    {isAdmin && entry.factId && entry.status === "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => correct(selected.id, entry.factId!, "reverse")}
                      >
                        Remove
                      </Button>
                    )}
                    {isAdmin && entry.factId && entry.status === "reversed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => correct(selected.id, entry.factId!, "restore")}
                      >
                        Restore
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
