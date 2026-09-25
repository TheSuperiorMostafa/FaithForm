"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  checkInChildren,
  moveSession,
  undoCheckin,
} from "@/app/dashboard/checkin/actions";
import { MedicalNote } from "@/components/checkin/desk-parts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { occupancyLabel, UNDO_CHECKIN_WINDOW_MS } from "@/lib/checkin/desk";
import { undoToast } from "@/lib/ui/undo-toast";
import type { CheckinSessionRow, ChurchLocation } from "@/types/checkin";

function formatTime(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Who is in each room right now, under the desk.
 *
 * Every row can be moved to another room, a child marked "On the way" can be
 * marked arrived, and a check-in this volunteer made in the last few minutes
 * can be undone. Releasing a child is never a button here: that happens under
 * Pick up, where the parent's code is checked.
 */
export function RosterBoard({
  sessions,
  locations,
  currentUserId,
}: {
  sessions: CheckinSessionRow[];
  locations: ChurchLocation[];
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  // Undo buttons disappear on their own when their ten minutes are up.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const byLocation = useMemo(() => {
    const groups = new Map<string, CheckinSessionRow[]>();
    for (const location of locations) groups.set(location.id, []);
    for (const session of sessions) {
      const bucket = groups.get(session.locationId) ?? [];
      bucket.push(session);
      groups.set(session.locationId, bucket);
    }
    return groups;
  }, [sessions, locations]);

  function roomName(id: string) {
    return locations.find((location) => location.id === id)?.name ?? "that room";
  }

  function move(session: CheckinSessionRow, locationId: string) {
    if (locationId === session.locationId) return;
    const from = session.locationId;

    const formData = new FormData();
    formData.set("sessionId", session.id);
    formData.set("locationId", locationId);

    startTransition(async () => {
      const result = await moveSession(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      undoToast(`${session.firstName} moved to ${roomName(locationId)}.`, async () => {
        const back = new FormData();
        back.set("sessionId", session.id);
        back.set("locationId", from);
        const undone = await moveSession(back);
        return undone.ok ? undefined : undone.error;
      }, { undoneMessage: `${session.firstName} is back in ${roomName(from)}.` });
    });
  }

  function markArrived(session: CheckinSessionRow) {
    startTransition(async () => {
      const result = await checkInChildren({
        children: [{ memberId: session.memberId, locationId: session.locationId }],
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const outcome = result.data.results[0];
      if (!outcome?.ok) {
        toast.error(outcome?.error ?? "We couldn't mark that child as arrived.");
        return;
      }
      toast.success(`${session.firstName} has arrived in ${session.locationName}.`);
    });
  }

  async function undo(session: CheckinSessionRow) {
    const confirmed = await confirmAction({
      title: `Undo ${session.firstName}'s check-in?`,
      description: `${session.firstName} ${session.lastName} will be taken off the ${session.locationName} list. You can check them in again at any time.`,
      confirmLabel: "Undo check-in",
    });
    if (!confirmed) return;

    startTransition(async () => {
      const result = await undoCheckin([session.id]);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${session.firstName}'s check-in was undone.`);
    });
  }

  function canUndo(session: CheckinSessionRow): boolean {
    if (session.status !== "checked_in" || !session.checkedInAt) return false;
    if (session.checkedInBy !== currentUserId) return false;
    return now - new Date(session.checkedInAt).getTime() < UNDO_CHECKIN_WINDOW_MS;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {locations.map((location) => {
        const roster = byLocation.get(location.id) ?? [];
        const here = roster.filter((row) => row.status === "checked_in").length;
        const full = location.capacity != null && here >= location.capacity;

        return (
          <Card key={location.id} className="flex flex-col gap-4 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-heading text-xl font-bold text-foreground">
                  {location.name}
                </h3>
                {location.description && (
                  <p className="mt-1 text-[15px] text-muted-foreground">
                    {location.description}
                  </p>
                )}
              </div>
              <StatusBadge tone={full ? "attention" : here > 0 ? "ready" : "neutral"}>
                {occupancyLabel(here, location.capacity)}
              </StatusBadge>
            </div>

            {roster.length === 0 ? (
              <p className="text-[15px] text-muted-foreground">
                Nobody is checked in here yet.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {roster.map((session) => (
                  <li key={session.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-semibold text-foreground">
                          {session.firstName} {session.lastName}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[15px] text-muted-foreground">
                          {session.status === "pre_checked_in" ? (
                            <StatusBadge tone="working">On the way</StatusBadge>
                          ) : (
                            <span>In at {formatTime(session.checkedInAt)}</span>
                          )}
                          {session.householdName && <span>{session.householdName}</span>}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {session.status === "pre_checked_in" && (
                          <Button
                            type="button"
                            disabled={pending}
                            onClick={() => markArrived(session)}
                          >
                            Mark arrived
                          </Button>
                        )}
                        {canUndo(session) && (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={pending}
                            onClick={() => void undo(session)}
                          >
                            Undo check-in
                          </Button>
                        )}
                      </div>
                    </div>

                    <MedicalNote note={session.medicalNotes} />

                    <label className="flex flex-wrap items-center gap-3 text-[15px] font-medium text-foreground">
                      <span>Move to</span>
                      <Select
                        value={session.locationId}
                        disabled={pending}
                        onChange={(event) => move(session, event.target.value)}
                        className="w-auto min-w-48"
                        aria-label={`Move ${session.firstName} to another room`}
                      >
                        {locations.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
