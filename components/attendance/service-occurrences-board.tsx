"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowUp,
  CalendarClock,
  CalendarX,
  History,
  MapPin,
  PenLine,
  QrCode,
  Search,
  Tablet,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  applyCorrection,
  cancelService,
  getOccurrenceRoster,
  markMemberPresent,
  markRosterPresent,
  type ServiceMethodCounts,
} from "@/app/dashboard/attendance/services/actions";
import type { ServiceOccurrence } from "@/lib/attendance/v2/occurrences";
import type { RosterEntry } from "@/lib/attendance/v2/roster";
import { CheckinDisplayPanel } from "@/components/attendance/checkin-display-panel";
import { serviceStatus } from "@/components/attendance/service-status";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { List, ListRow } from "@/components/ui/list-row";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

/**
 * The Services page.
 *
 * A service is whatever the church actually scheduled, on any day, at any
 * campus, and several on one day are several entries rather than one batch.
 * Sunday worship and calendar events that count attendance come first; the
 * rest of the schedule (Bible study, a weeknight service, a class) is listed
 * underneath so it can be marked by hand too.
 *
 * How each person was counted is shown in words and with its own icon, never
 * by colour alone: a phone check-in, a scanned code, a welcome-desk kiosk and
 * a greeter's mark are different evidence, and a church reviewing a service
 * should be able to tell them apart at a glance.
 */

type MethodStyle = { label: string; short: string; icon: LucideIcon; className: string };

const METHODS: Record<string, MethodStyle> = {
  geofence: {
    label: "Checked in on their phone",
    icon: MapPin,
    short: "on their phone",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  },
  qr: {
    label: "Scanned the code on screen",
    icon: QrCode,
    short: "scanned the code",
    className: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  },
  kiosk: {
    label: "Checked in at the kiosk",
    icon: Tablet,
    short: "at the kiosk",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  manual: {
    label: "Marked by staff",
    icon: UserCheck,
    short: "marked by staff",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  admin: {
    label: "Corrected by an admin",
    icon: PenLine,
    short: "corrected by an admin",
    className: "bg-muted text-foreground/80",
  },
  legacy: {
    label: "From earlier records",
    icon: History,
    short: "from earlier records",
    className: "bg-muted text-foreground/80",
  },
};

/** Display order for summaries: the methods a church most wants to compare first. */
const METHOD_ORDER = ["geofence", "qr", "kiosk", "manual", "admin", "legacy"];

function MethodBadge({ source }: { source: string | null }) {
  const style = METHODS[source ?? ""];
  if (!style) {
    return <span className="text-sm text-muted-foreground">Here</span>;
  }
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold",
        style.className,
      )}
    >
      <Icon className="size-4" strokeWidth={2} aria-hidden />
      {style.label}
    </span>
  );
}

function methodSummary(bySource: Record<string, number>): string {
  return METHOD_ORDER.filter((key) => (bySource[key] ?? 0) > 0)
    .map((key) => `${bySource[key]} ${METHODS[key].short}`)
    .join(" · ");
}

function formatWhen(occurrence: ServiceOccurrence): string {
  // Always the service's own zone — a staff member in another timezone must
  // still see the time the congregation will arrive.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: occurrence.timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(occurrence.startsAtUtc));
}

function formatDay(occurrence: ServiceOccurrence): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: occurrence.timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(occurrence.startsAtUtc));
}

function people(n: number) {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

export function ServiceOccurrencesBoard({
  upcoming,
  recent,
  other,
  counts,
  isAdmin,
}: {
  upcoming: ServiceOccurrence[];
  recent: ServiceOccurrence[];
  other: { upcoming: ServiceOccurrence[]; recent: ServiceOccurrence[] };
  counts: Record<string, ServiceMethodCounts>;
  isAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<ServiceOccurrence | null>(null);
  // null: not loaded yet, or it failed (see `rosterFailed`).
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [rosterFailed, setRosterFailed] = useState(false);
  const [search, setSearch] = useState("");
  // Read once per render of the list; the badge is a hint, and the server
  // decides whether check-in is really open.
  const [now, setNow] = useState(() => Date.now());
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * Batch keys, held per submission intent rather than per click.
   *
   * A ref, not state: changing it must not re-render, and it must survive the
   * failed render-free path a retry takes.
   */
  const batchKeys = useRef<Record<string, string>>({});

  const loadRoster = (occurrenceId: string) => {
    startTransition(async () => {
      try {
        const entries = await getOccurrenceRoster(occurrenceId);
        setRoster(entries);
        setRosterFailed(entries === null);
      } catch {
        setRosterFailed(true);
      }
    });
  };

  const openRoster = (occurrence: ServiceOccurrence) => {
    setSelected(occurrence);
    setRoster(null);
    setRosterFailed(false);
    setSearch("");
    loadRoster(occurrence.id);
    // Below the two-column layout the roster sits under the list: bring it
    // into view rather than leave it rendering far below.
    requestAnimationFrame(() => {
      if (window.matchMedia("(min-width: 1024px)").matches) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      panelRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      panelRef.current?.focus({ preventScroll: true });
    });
  };

  const backToList = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    listRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  useEffect(() => {
    let cancelled = false;
    let loading = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || pending || loading || !navigator.onLine) return;
      setNow(Date.now());
      if (!selected) return;
      loading = true;
      try {
        const entries = await getOccurrenceRoster(selected.id);
        // Keep the last good roster through a failed refresh.
        if (!cancelled && entries) setRoster(entries);
      } catch {
        // Keep the last successful roster during a connection interruption.
      } finally {
        loading = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 15_000);
    const visible = () => void refresh();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [selected, pending]);

  const filtered = useMemo(() => {
    const list = roster ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((entry) =>
      `${entry.firstName} ${entry.lastName}`.toLowerCase().includes(term),
    );
  }, [roster, search]);

  const presentCount = (roster ?? []).filter((entry) => entry.status === "active").length;

  const rosterBySource = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const entry of roster ?? []) {
      if (entry.status !== "active" || !entry.source) continue;
      tally[entry.source] = (tally[entry.source] ?? 0) + 1;
    }
    return tally;
  }, [roster]);

  const mark = (occurrenceId: string, entry: RosterEntry) => {
    startTransition(async () => {
      try {
        const result = await markMemberPresent({ occurrenceId, memberId: entry.memberId });
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        // "Already counted" is a success, not an error — someone may have
        // checked themselves in a moment ago.
        toast.success(
          result.data.outcome === "already_counted"
            ? `${entry.firstName} was already counted.`
            : `${entry.firstName} ${entry.lastName} marked here.`,
        );
        loadRoster(occurrenceId);
      } catch {
        toast.error("We couldn't mark them here. Check your connection and try again.");
      }
    });
  };

  const markAll = async (occurrence: ServiceOccurrence) => {
    const unmarked = (roster ?? []).filter((entry) => entry.status !== "active");
    if (unmarked.length === 0) {
      toast.success("Everyone is already counted.");
      return;
    }

    const ok = await confirmAction({
      title: `Mark ${people(unmarked.length)} here?`,
      description: `Everyone in People who isn't counted yet for ${occurrence.label} on ${formatDay(occurrence)} will be marked here — ${people(unmarked.length)}. Only do this if the whole church was there. An admin can remove anyone marked by mistake.`,
      confirmLabel: `Mark ${people(unmarked.length)} here`,
      destructive: true,
    });
    if (!ok) return;

    const memberIds = unmarked.map((entry) => entry.memberId);

    // One key per *intent*, not per click. If the first submission times out
    // and the person presses the button again, the same key comes back, so the
    // database recognises the retry instead of treating it as a second batch.
    // A fresh key each time would be a new batch of attempts every press.
    const intent = `${occurrence.id}:${[...memberIds].sort().join(",")}`;
    const batchKey = (batchKeys.current[intent] ??= crypto.randomUUID());

    startTransition(async () => {
      try {
        const result = await markRosterPresent({
          occurrenceId: occurrence.id,
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
            ? `${people(counted)} marked here for ${occurrence.label}. ${already} were already counted.`
            : `${people(counted)} marked here for ${occurrence.label}.`,
        );
        loadRoster(occurrence.id);
      } catch {
        toast.error("We couldn't mark everyone here. Nobody was marked twice. Try again.");
      }
    });
  };

  const correct = (
    occurrenceId: string,
    entry: RosterEntry,
    action: "reverse" | "restore",
    offerUndo = true,
  ) => {
    const name = `${entry.firstName} ${entry.lastName}`.trim();
    startTransition(async () => {
      try {
        const result = await applyCorrection({ factId: entry.factId!, action });
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        loadRoster(occurrenceId);
        if (action === "reverse" && offerUndo) {
          // Reversible, so it happens now and offers Undo.
          toast.success(`${name} is no longer counted.`, {
            duration: 10_000,
            action: {
              label: "Undo",
              onClick: () => correct(occurrenceId, entry, "restore", false),
            },
          });
        } else {
          toast.success(action === "reverse" ? `${name} is no longer counted.` : `${name} is counted again.`);
        }
      } catch {
        toast.error("We couldn't change that. Check your connection and try again.");
      }
    });
  };

  const cancel = async (occurrence: ServiceOccurrence) => {
    const ok = await confirmAction({
      title: `Cancel ${occurrence.label}?`,
      description: `${formatWhen(occurrence)}. Nobody will be able to check in to it, and it can't be un-cancelled. The ${people(presentCount)} already counted stay counted.`,
      confirmLabel: "Cancel service",
      cancelLabel: "Keep service",
      destructive: true,
    });
    if (!ok) return;

    startTransition(async () => {
      try {
        const result = await cancelService({ occurrenceId: occurrence.id });
        if (result.ok) {
          toast.success(`${occurrence.label} on ${formatDay(occurrence)} is cancelled.`);
          setSelected({ ...occurrence, status: "cancelled" });
        } else {
          toast.error(result.message);
        }
      } catch {
        toast.error("We couldn't cancel that service. Try again.");
      }
    });
  };

  const renderRow = (occurrence: ServiceOccurrence) => {
    const summary = counts[occurrence.id];
    const status = serviceStatus(occurrence, now);
    const isSelected = selected?.id === occurrence.id;
    return (
      <ListRow
        key={occurrence.id}
        onClick={() => openRoster(occurrence)}
        selected={isSelected}
        leading={
          <span
            aria-hidden
            className={cn(
              "flex size-12 items-center justify-center rounded-xl",
              status.label === "Check-in open"
                ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            {status.label === "Cancelled" ? (
              <CalendarX className="size-6" strokeWidth={1.75} />
            ) : (
              <CalendarClock className="size-6" strokeWidth={1.75} />
            )}
          </span>
        }
        title={occurrence.label}
        subtitle={
          <>
            {formatWhen(occurrence)}
            {occurrence.campusName ? ` · ${occurrence.campusName}` : ""}
            {summary && summary.counted > 0 ? ` · ${summary.counted} here` : ""}
          </>
        }
        status={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
        aria-label={`${occurrence.label}, ${formatWhen(occurrence)}, ${status.label}${summary && summary.counted > 0 ? `, ${summary.counted} here` : ""}. Open to see who came.`}
      />
    );
  };

  const otherCount = other.upcoming.length + other.recent.length;
  const nothing = upcoming.length === 0 && recent.length === 0 && otherCount === 0;

  if (nothing) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No services yet"
        description="Add your service times in Setup, or turn on attendance for an event on your calendar, and they show up here."
        action={
          <Link href="/dashboard/attendance/setup" className={buttonVariants({ size: "lg" })}>
            Add service times
          </Link>
        }
      />
    );
  }

  const selectedStatus = selected ? serviceStatus(selected, now) : null;
  const cancelled = selected?.status === "cancelled";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
      <div ref={listRef} className="flex min-w-0 scroll-mt-6 flex-col gap-8">
        {upcoming.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="services-upcoming">
            <h2 id="services-upcoming" className="font-heading text-xl font-bold text-foreground">
              Open and coming up
            </h2>
            <List>{upcoming.map(renderRow)}</List>
          </section>
        )}

        {recent.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="services-recent">
            <h2 id="services-recent" className="font-heading text-xl font-bold text-foreground">
              Recent
            </h2>
            <List>{recent.map(renderRow)}</List>
          </section>
        )}

        {otherCount > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="services-other">
            <div className="flex flex-col gap-1">
              <h2 id="services-other" className="font-heading text-xl font-bold text-foreground">
                Other services on your schedule
              </h2>
              <p className="text-[15px] text-muted-foreground">
                Bible study, weeknight services and classes. Open one to mark who came.
              </p>
            </div>
            <List>{[...other.upcoming, ...other.recent].map(renderRow)}</List>
          </section>
        )}
      </div>

      <section
        ref={panelRef}
        tabIndex={-1}
        aria-label={selected ? `Who came to ${selected.label}` : "Who came"}
        className="scroll-mt-6 rounded-2xl border border-border bg-card p-6 shadow-card outline-none lg:sticky lg:top-6 dark:shadow-none"
      >
        {!selected ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span
              aria-hidden
              className="flex size-14 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
            >
              <Users className="size-7" strokeWidth={1.5} />
            </span>
            <h2 className="font-heading text-lg font-bold text-foreground">Choose a service</h2>
            <p className="max-w-sm text-[15px] text-muted-foreground">
              Pick a service from the list to see who came and how, or to mark people by hand.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="font-heading text-2xl font-bold text-foreground">{selected.label}</h2>
                {selectedStatus ? (
                  <StatusBadge tone={selectedStatus.tone}>{selectedStatus.label}</StatusBadge>
                ) : null}
              </div>
              <p className="text-[15px] text-muted-foreground">
                {formatWhen(selected)}
                {selected.campusName ? ` · ${selected.campusName}` : ""}
              </p>
              <p className="text-base font-semibold text-foreground">
                {roster === null ? " " : `${presentCount} here`}
                {presentCount > 0 && methodSummary(rosterBySource) ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {methodSummary(rosterBySource)}
                  </span>
                ) : null}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void markAll(selected)}
                disabled={pending || cancelled || roster === null}
              >
                <UserCheck aria-hidden />
                Mark everyone here
              </Button>
              {isAdmin && !cancelled && (
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void cancel(selected)}
                  disabled={pending}
                >
                  <CalendarX aria-hidden />
                  Cancel service
                </Button>
              )}
              <Button variant="ghost" className="lg:hidden" onClick={backToList}>
                <ArrowUp aria-hidden />
                Back to the list
              </Button>
            </div>

            {!cancelled && (
              <AdvancedSection
                title="Check-in screen and welcome desk"
                description="Show a code on a screen for people to scan, or set up a tablet at the door."
              >
                <CheckinDisplayPanel occurrenceId={selected.id} isAdmin={isAdmin} />
              </AdvancedSection>
            )}

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                placeholder="Find someone by name"
                onChange={(event) => setSearch(event.target.value)}
                className="min-h-12 pl-12 text-base"
                aria-label="Find someone by name"
                type="search"
              />
            </div>

            {rosterFailed ? (
              <ErrorState
                compact
                title="Who came didn't load"
                description="Nothing was lost. Try again, and if it keeps happening, contact FaithForm support."
                onRetry={() => loadRoster(selected.id)}
              />
            ) : roster === null ? (
              <div className="flex flex-col gap-3" aria-hidden>
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            ) : roster.length === 0 ? (
              <EmptyState
                compact
                icon={Users}
                title="Nobody in People yet"
                description="Add people on the People page, then mark who came here."
                action={
                  <Link href="/dashboard/people?add=1" className={buttonVariants({ variant: "outline" })}>
                    Add a person
                  </Link>
                }
              />
            ) : (
              <ul className="-mx-2 flex flex-col divide-y divide-border px-2 lg:max-h-[calc(100vh-18rem)] lg:overflow-y-auto">
                {filtered.map((entry) => (
                  <li
                    key={entry.memberId}
                    className="flex min-h-16 flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-base font-medium text-foreground">
                        {entry.firstName} {entry.lastName}
                      </span>
                      {entry.status === "reversed" ? (
                        <span className="text-sm text-muted-foreground">Removed by an admin</span>
                      ) : entry.status === "active" ? (
                        <MethodBadge source={entry.source} />
                      ) : null}
                    </div>

                    <div className="flex gap-2">
                      {entry.status !== "active" && (
                        <Button
                          variant="outline"
                          disabled={pending || cancelled}
                          onClick={() => mark(selected.id, entry)}
                        >
                          {entry.status === "reversed" ? "Mark here again" : "Mark here"}
                        </Button>
                      )}
                      {isAdmin && entry.factId && entry.status === "active" && (
                        <Button
                          variant="outline"
                          disabled={pending}
                          onClick={() => correct(selected.id, entry, "reverse")}
                        >
                          Remove
                        </Button>
                      )}
                      {isAdmin && entry.factId && entry.status === "reversed" && (
                        <Button
                          variant="outline"
                          disabled={pending}
                          onClick={() => correct(selected.id, entry, "restore")}
                        >
                          Restore
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
                {filtered.length === 0 ? (
                  <li className="py-6 text-center text-base text-muted-foreground">
                    Nobody matches that name.
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
