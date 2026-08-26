"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  applyCorrection,
  cancelService,
  getOccurrenceRoster,
  markMemberPresent,
  markRosterPresent,
  refreshOccurrenceHorizon,
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

/**
 * The occurrence board.
 *
 * Replaces the Sunday-only picker: a service is whatever the church actually
 * scheduled, on any day, at any campus, and several on one day are several
 * entries rather than one batch.
 */

const SOURCE_LABELS: Record<string, string> = {
  manual: "Marked",
  admin: "Corrected",
  geofence: "Automatic",
  qr: "Scanned",
  kiosk: "Kiosk",
  legacy: "Recorded",
};

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

export function ServiceOccurrencesBoard({
  occurrences,
  isAdmin,
}: {
  occurrences: ServiceOccurrence[];
  isAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<ServiceOccurrence | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [search, setSearch] = useState("");

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
        toast.success(
          result.data.created > 0
            ? `${result.data.created} services added.`
            : "Services are up to date.",
        );
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
            Services
          </h1>
          <p className="text-sm text-muted-foreground">
            Every service you hold, on any day. Pick one to mark who came.
          </p>
        </div>
        <Button variant="outline" onClick={refreshHorizon} disabled={pending}>
          Refresh from schedule
        </Button>
      </div>

      {occurrences.length === 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">No services yet</CardTitle>
            <CardDescription>
              Add your service times under Settings, then refresh from schedule.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {occurrences.map((occurrence) => (
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
                {occurrence.status === "active" && (
                  <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                    Open now
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatWhen(occurrence)}
                {occurrence.campusName ? ` · ${occurrence.campusName}` : ""}
              </span>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {selected.label} — {presentCount} present
            </CardTitle>
            <CardDescription>{formatWhen(selected)}</CardDescription>
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
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">
                      {entry.firstName} {entry.lastName}
                    </span>
                    {entry.status && (
                      <span className="text-xs text-muted-foreground">
                        {entry.status === "reversed"
                          ? "Removed"
                          : SOURCE_LABELS[entry.source ?? ""] ?? "Present"}
                      </span>
                    )}
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
