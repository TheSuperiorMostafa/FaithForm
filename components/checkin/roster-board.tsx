"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, ArrowRightLeft, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { checkInMember, moveSession } from "@/app/dashboard/checkin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ChurchMember } from "@/lib/queries/members";
import type { CheckinSessionRow, ChurchLocation } from "@/types/checkin";

type RosterBoardProps = {
  sessions: CheckinSessionRow[];
  locations: ChurchLocation[];
  members: ChurchMember[];
  /** member id → the room an admin set as their usual place. */
  defaultLocationByMember: Record<string, string>;
  serviceDate: string;
};

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A medical note is the one thing on this screen that has to be impossible to
 * scroll past. It is rendered as a warning row rather than an icon with a
 * tooltip, because a volunteer holding a toddler is not going to hover.
 */
function MedicalNote({ note }: { note: string | null }) {
  if (!note?.trim()) return null;

  return (
    <p className="mt-1 flex items-start gap-1.5 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
      <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{note}</span>
    </p>
  );
}

export function RosterBoard({
  sessions,
  locations,
  members,
  defaultLocationByMember,
  serviceDate,
}: RosterBoardProps) {
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");

  const checkedInMemberIds = useMemo(
    () => new Set(sessions.map((s) => s.memberId)),
    [sessions],
  );

  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return members
      .filter((m) => !checkedInMemberIds.has(m.id))
      .filter((m) =>
        term
          ? `${m.first_name} ${m.last_name}`.toLowerCase().includes(term)
          : true,
      )
      .slice(0, 50);
  }, [members, search, checkedInMemberIds]);

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

  // Picking a person pre-selects the room an admin put them in, which is what
  // makes a Sunday queue move: for most children the volunteer confirms rather
  // than chooses.
  function handleSelectMember(memberId: string) {
    setSelectedMember(memberId);
    const preferred = defaultLocationByMember[memberId];
    if (preferred) setSelectedLocation(preferred);
  }

  function handleCheckIn() {
    if (!selectedMember || !selectedLocation) {
      toast.error("Pick a person and a room.");
      return;
    }

    const formData = new FormData();
    formData.set("memberId", selectedMember);
    formData.set("locationId", selectedLocation);

    startTransition(async () => {
      const result = await checkInMember(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Checked in.");
      setSelectedMember("");
      setSearch("");
    });
  }

  function handleMove(sessionId: string, locationId: string) {
    const formData = new FormData();
    formData.set("sessionId", sessionId);
    formData.set("locationId", locationId);

    startTransition(async () => {
      const result = await moveSession(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Moved.");
    });
  }

  if (locations.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No rooms yet. Add one under <strong>Rooms</strong> and it becomes
            assignable straight away.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="size-4" aria-hidden />
            Check someone in
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="checkin-search">Person</Label>
            <Input
              id="checkin-search"
              value={search}
              placeholder="Start typing a name…"
              onChange={(event) => {
                setSearch(event.target.value);
                setSelectedMember("");
              }}
            />
            {search.trim() && (
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border">
                {candidates.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    Nobody left to check in by that name.
                  </p>
                ) : (
                  candidates.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => handleSelectMember(member.id)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                        selectedMember === member.id ? "bg-accent/15 font-semibold" : ""
                      }`}
                    >
                      <span>
                        {member.first_name} {member.last_name}
                      </span>
                      {defaultLocationByMember[member.id] && (
                        <span className="text-xs text-muted-foreground">
                          {
                            locations.find(
                              (l) => l.id === defaultLocationByMember[member.id],
                            )?.name
                          }
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="checkin-location">Room</Label>
            <Select
              id="checkin-location"
              value={selectedLocation}
              onChange={(event) => setSelectedLocation(event.target.value)}
            >
              <option value="">Choose a room…</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </div>

          <Button
            type="button"
            disabled={pending || !selectedMember || !selectedLocation}
            onClick={handleCheckIn}
          >
            Check in
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {locations.map((location) => {
          const roster = byLocation.get(location.id) ?? [];
          const overCapacity =
            location.capacity != null && roster.length > location.capacity;

          return (
            <Card key={location.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle>{location.name}</CardTitle>
                  {location.description && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {location.description}
                    </p>
                  )}
                </div>
                <Badge variant={overCapacity ? "warning" : "muted"}>
                  {roster.length}
                  {location.capacity != null && ` / ${location.capacity}`}
                </Badge>
              </CardHeader>
              <CardContent>
                {roster.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nobody checked in here yet.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border/60">
                    {roster.map((session) => (
                      <li key={session.id} className="py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">
                              {session.firstName} {session.lastName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {session.status === "pre_checked_in"
                                ? "Pre-checked in — not yet received"
                                : `In at ${formatTime(session.checkedInAt)}`}
                              {session.householdName && ` · ${session.householdName}`}
                            </p>
                          </div>
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <ArrowRightLeft className="size-3.5" aria-hidden />
                            <span className="sr-only">
                              Move {session.firstName} to another room
                            </span>
                            <Select
                              value={session.locationId}
                              disabled={pending}
                              onChange={(event) =>
                                handleMove(session.id, event.target.value)
                              }
                              className="h-8 py-0 text-xs"
                            >
                              {locations.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.name}
                                </option>
                              ))}
                            </Select>
                          </label>
                        </div>
                        <MedicalNote note={session.medicalNotes} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {serviceDate}. Releasing a child happens under{" "}
        <strong>Checkout</strong> — it needs a credential, so it is never a
        button on this list.
      </p>
    </div>
  );
}
