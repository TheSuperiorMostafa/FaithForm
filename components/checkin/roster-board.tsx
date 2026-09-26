"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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
import { occupancyLabel, roomPreview, UNDO_CHECKIN_WINDOW_MS } from "@/lib/checkin/desk";
import { undoToast } from "@/lib/ui/undo-toast";
import { cn } from "@/lib/utils";
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
  // Rooms stay closed to a short summary so ten rooms fit on one screen. An
  // opened room spreads across the full row to show every child and the
  // Move / Mark arrived / Undo controls.
  const [openRooms, setOpenRooms] = useState<Set<string>>(() => new Set());

  function toggleRoom(id: string) {
    setOpenRooms((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {locations.map((location) => {
        const roster = byLocation.get(location.id) ?? [];
        const here = roster.filter((row) => row.status === "checked_in").length;
        const full = location.capacity != null && here >= location.capacity;
        const onTheWay = roster.filter((row) => row.status === "pre_checked_in").length;
        const open = openRooms.has(location.id) && roster.length > 0;
        const listId = `room-list-${location.id}`;
        const preview = roomPreview(
          roster.map((row) => `${row.firstName} ${row.lastName}`),
        );

        return (
          <Card
            key={location.id}
            className={cn("flex flex-col gap-3 p-4", open && "col-span-full")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-heading text-lg font-bold leading-snug text-foreground [overflow-wrap:anywhere]">
                  {location.name}
                </h3>
                {location.description && (
                  <p className="truncate text-[15px] text-muted-foreground">
                    {location.description}
                  </p>
                )}
              </div>
              {/* The count is the thing people look for, so it is big. */}
              <p
                className="shrink-0 font-heading text-3xl font-bold leading-none tabular-nums text-foreground"
                aria-hidden
              >
                {here}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={full ? "attention" : here > 0 ? "ready" : "neutral"}>
                {occupancyLabel(here, location.capacity)}
              </StatusBadge>
              {onTheWay > 0 && (
                <StatusBadge tone="working">{onTheWay} on the way</StatusBadge>
              )}
            </div>

            {roster.length === 0 ? (
              <p className="text-[15px] text-muted-foreground">Nobody here yet.</p>
            ) : (
              <>
                {!open && (
                  <p className="line-clamp-2 text-[15px] text-muted-foreground">{preview}</p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  aria-expanded={open}
                  aria-controls={listId}
                  onClick={() => toggleRoom(location.id)}
                >
                  {open ? (
                    <>
                      <ChevronUp aria-hidden />
                      Hide the list
                    </>
                  ) : (
                    <>
                      <ChevronDown aria-hidden />
                      {roster.length === 1 ? "Show 1 child" : `Show all ${roster.length} children`}
                    </>
                  )}
                </Button>
              </>
            )}

            {open && (
              <ul id={listId} className="flex flex-col divide-y divide-border border-t border-border">
                {roster.map((session) => (
                  <li key={session.id} className="flex flex-col gap-3 py-4 last:pb-0">
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
