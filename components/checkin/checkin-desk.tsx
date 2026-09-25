"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";

import {
  checkInChildren,
  getHouseholdCredentials,
  undoCheckin,
  type ChildCheckinResult,
  type NewFamilyResult,
} from "@/app/dashboard/checkin/actions";
import { MedicalNote, PickupCode } from "@/components/checkin/desk-parts";
import { NewFamilyForm } from "@/components/checkin/new-family-form";
import { RosterBoard } from "@/components/checkin/roster-board";
import { DESK_SEARCH_LABEL, DESK_SEARCH_PLACEHOLDER } from "@/components/checkin/copy";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { SuccessState } from "@/components/ui/success-state";
import {
  buildRosterSearchIndex,
  checkInButtonLabel,
  childCount,
  defaultRoomFor,
  defaultSelection,
  formatServiceDate,
  joinNames,
  searchFamilies,
  type DeskChild,
  type DeskFamily,
} from "@/lib/checkin/desk";
import type { CheckinChild } from "@/lib/checkin/roster-search";
import { cn } from "@/lib/utils";
import type { CheckinSessionRow, ChurchLocation } from "@/types/checkin";

type DeskChildInput = CheckinChild & { medicalNotes?: string | null };

type SuccessData = {
  familyName: string;
  householdId: string | null;
  checkedIn: { name: string; room: string }[];
  failed: { name: string; error: string }[];
  code: string | null;
  sessionIds: string[];
  /** What to put back in the search box if the check-in is undone. */
  query: string;
};

type View =
  | { kind: "search" }
  | { kind: "new_family" }
  | { kind: "success"; data: SuccessData };

/**
 * The check-in desk.
 *
 * Built for a volunteer with a queue in front of them: one big search box,
 * family cards with every child already ticked and their usual room already
 * chosen, one big button, and a success screen with the family's pickup code
 * in type you can read across the desk. Undo is right there for the moment
 * the wrong family was tapped.
 */
export function CheckinDesk({
  sessions,
  locations,
  members,
  serviceDate,
  canAddFamily,
  currentUserId,
}: {
  sessions: CheckinSessionRow[];
  locations: ChurchLocation[];
  members: DeskChildInput[];
  serviceDate: string;
  /** Church admins only: they are the people who may add people and families. */
  canAddFamily: boolean;
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<View>({ kind: "search" });
  const [query, setQuery] = useState("");
  // What the volunteer changed on a card. Anything not in here uses the
  // card's default: ticked, and the child's usual room.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [rooms, setRooms] = useState<Record<string, string>>({});
  const [codeDialog, setCodeDialog] = useState<{ familyName: string; code: string | null } | null>(
    null,
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearchNext = useRef(false);

  const activeRoomIds = useMemo(() => locations.map((location) => location.id), [locations]);
  const searchIndex = useMemo(() => buildRosterSearchIndex(members), [members]);
  const { families, more } = useMemo(
    () => searchFamilies(searchIndex, members, query, sessions),
    [searchIndex, members, query, sessions],
  );

  useEffect(() => {
    if (view.kind === "search" && focusSearchNext.current) {
      focusSearchNext.current = false;
      searchRef.current?.focus();
    }
  }, [view]);

  function roomName(id: string) {
    return locations.find((location) => location.id === id)?.name ?? "their room";
  }

  function isTicked(child: DeskChild) {
    if (child.state.kind === "checked_in") return false;
    return ticked[child.id] ?? true;
  }

  function roomFor(child: DeskChild) {
    return rooms[child.id] ?? defaultRoomFor(child, activeRoomIds);
  }

  function resetDesk(options: { keepQuery?: string } = {}) {
    setTicked({});
    setRooms({});
    setQuery(options.keepQuery ?? "");
    focusSearchNext.current = true;
    setView({ kind: "search" });
  }

  function showSuccess(
    family: { name: string; householdId: string | null },
    results: ChildCheckinResult[],
    nameOf: (memberId: string) => string,
    code: string | null,
  ) {
    const checkedIn = results
      .filter((result): result is Extract<ChildCheckinResult, { ok: true }> => result.ok)
      .map((result) => ({ name: nameOf(result.memberId), room: roomName(result.locationId) }));
    const failed = results
      .filter((result): result is Extract<ChildCheckinResult, { ok: false }> => !result.ok)
      .map((result) => ({ name: nameOf(result.memberId), error: result.error }));

    if (checkedIn.length === 0) {
      toast.error(
        failed.length === 1
          ? `${failed[0].name}: ${failed[0].error}`
          : "We couldn't check those children in. Please try again.",
      );
      return;
    }

    setView({
      kind: "success",
      data: {
        familyName: family.name,
        householdId: family.householdId,
        checkedIn,
        failed,
        code,
        sessionIds: results.flatMap((result) => (result.ok ? [result.sessionId] : [])),
        query,
      },
    });
  }

  function checkInFamily(family: DeskFamily, only?: DeskChild) {
    const chosen = only ? [only] : family.children.filter(isTicked);
    if (chosen.length === 0) {
      toast.error("Tick at least one child.");
      return;
    }
    const missingRoom = chosen.find((child) => !roomFor(child));
    if (missingRoom) {
      toast.error(`Choose a room for ${missingRoom.firstName}.`);
      return;
    }

    startTransition(async () => {
      const result = await checkInChildren({
        children: chosen.map((child) => ({ memberId: child.id, locationId: roomFor(child) })),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const code =
        result.data.pickupCodes.find((entry) => entry.householdId === family.householdId)?.code ??
        null;
      showSuccess(
        { name: family.name, householdId: family.householdId },
        result.data.results,
        (memberId) => {
          const child = family.children.find((candidate) => candidate.id === memberId);
          return child ? `${child.firstName} ${child.lastName}`.trim() : "A child";
        },
        code,
      );
    });
  }

  function newFamilyDone(result: NewFamilyResult) {
    showSuccess(
      { name: result.familyName, householdId: result.householdId },
      result.results,
      (memberId) => {
        const child = result.children.find((candidate) => candidate.memberId === memberId);
        return child ? `${child.firstName} ${child.lastName}`.trim() : "A child";
      },
      result.pickupCodes[0]?.code ?? null,
    );
    if (result.results.some((row) => row.ok)) {
      toast.success(`${result.familyName} added to People.`);
    } else {
      toast.success(`${result.familyName} added to People. Search for them to check the children in.`);
    }
  }

  function undoSuccess(data: SuccessData) {
    startTransition(async () => {
      const result = await undoCheckin(data.sessionIds);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Check-in undone for ${joinNames(data.checkedIn.map((row) => row.name.split(" ")[0]))}.`,
      );
      resetDesk({ keepQuery: data.query });
    });
  }

  function showCode(family: { name: string; householdId: string }) {
    startTransition(async () => {
      const result = await getHouseholdCredentials(family.householdId);
      setCodeDialog({ familyName: family.name, code: result.ok ? result.data.code : null });
    });
  }

  if (locations.length === 0) {
    return (
      <EmptyState
        title="No rooms yet"
        description={
          canAddFamily
            ? "Add the rooms children go to, like Nursery or Preschool. Then you can check children in."
            : "A church admin needs to add the rooms children go to before anyone can be checked in."
        }
        action={
          canAddFamily ? (
            <Link href="/dashboard/checkin/locations" className={buttonVariants({ size: "lg" })}>
              Add rooms
            </Link>
          ) : undefined
        }
      />
    );
  }

  const codeDialogNode = (
    <Dialog open={codeDialog !== null} onOpenChange={(open) => !open && setCodeDialog(null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{codeDialog?.familyName ?? "Pickup code"}</DialogTitle>
        </DialogHeader>
        <div className="px-6 py-8">
          {codeDialog?.code ? (
            <PickupCode code={codeDialog.code} size="xl" />
          ) : (
            <p className="text-center text-base text-muted-foreground">
              We couldn&rsquo;t get a pickup code for this family just now. Try
              again, or a church admin can find it on the family&rsquo;s page in
              People.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" size="lg" onClick={() => setCodeDialog(null)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (view.kind === "success") {
    const data = view.data;
    return (
      <div className="flex w-full flex-col gap-6">
        <SuccessState
          className="py-12"
          title={`${childCount(data.checkedIn.length)} checked in`}
          description={data.familyName}
          actions={
            <>
              <Button type="button" size="lg" className="min-h-14 text-lg" onClick={() => resetDesk()}>
                Check in another family
              </Button>
              {data.code && (
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  onClick={() => setCodeDialog({ familyName: data.familyName, code: data.code })}
                >
                  Show code again
                </Button>
              )}
              <Button
                type="button"
                size="lg"
                variant="ghost"
                disabled={pending}
                onClick={() => undoSuccess(data)}
              >
                Undo
              </Button>
            </>
          }
        >
          <ul className="flex w-full max-w-md flex-col gap-2">
            {data.checkedIn.map((row, index) => (
              <li
                key={`${row.name}-${index}`}
                className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 text-left text-base shadow-sm"
              >
                <span className="font-semibold text-foreground">{row.name}</span>
                <span className="text-muted-foreground">{row.room}</span>
              </li>
            ))}
          </ul>

          {data.failed.length > 0 && (
            <ul className="flex w-full max-w-md flex-col gap-2" aria-label="Not checked in">
              {data.failed.map((row, index) => (
                <li
                  key={`${row.name}-${index}`}
                  className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-[15px] text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100"
                >
                  <span className="font-semibold">{row.name} was not checked in.</span>{" "}
                  {row.error}
                </li>
              ))}
            </ul>
          )}

          {data.code ? (
            <PickupCode code={data.code} familyName={data.familyName} />
          ) : (
            <p className="max-w-md text-[15px] text-muted-foreground">
              We couldn&rsquo;t show a pickup code for this family just now. A
              church admin can find it on the family&rsquo;s page in People.
            </p>
          )}
        </SuccessState>
        {codeDialogNode}
      </div>
    );
  }

  if (view.kind === "new_family") {
    return (
      <NewFamilyForm
        rooms={locations}
        onCancel={() => resetDesk({ keepQuery: query })}
        onDone={newFamilyDone}
      />
    );
  }

  const searching = query.trim().length > 0;

  return (
    <div className="flex w-full flex-col gap-8">
      <section className="flex flex-col gap-3" aria-label="Check a family in">
        <Label htmlFor="desk-search" className="text-lg font-semibold text-foreground">
          {DESK_SEARCH_LABEL}
        </Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-5 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              ref={searchRef}
              id="desk-search"
              type="search"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={query}
              placeholder={DESK_SEARCH_PLACEHOLDER}
              onChange={(event) => {
                setQuery(event.target.value);
                setTicked({});
                setRooms({});
              }}
              className="flex min-h-16 w-full rounded-2xl border-2 border-border bg-background py-4 pl-14 pr-4 text-xl shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>
          {canAddFamily && (
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="min-h-16"
              onClick={() => setView({ kind: "new_family" })}
            >
              <UserPlus aria-hidden />
              New family
            </Button>
          )}
        </div>
      </section>

      {searching ? (
        families.length === 0 ? (
          <EmptyState
            compact
            icon={Search}
            title={`No family found for “${query.trim()}”`}
            description={
              canAddFamily
                ? "Check the spelling, or add them as a new family."
                : "Check the spelling. If they are new, ask a church admin to add the family."
            }
            action={
              canAddFamily ? (
                <Button type="button" size="lg" onClick={() => setView({ kind: "new_family" })}>
                  <UserPlus aria-hidden />
                  New family
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            {families.map((family) => (
              <FamilyCard
                key={family.householdId}
                family={family}
                locations={locations}
                pending={pending}
                isTicked={isTicked}
                roomFor={roomFor}
                onToggle={(child) =>
                  setTicked((current) => ({ ...current, [child.id]: !isTicked(child) }))
                }
                onRoom={(child, roomId) => setRooms((current) => ({ ...current, [child.id]: roomId }))}
                onCheckIn={(only) => checkInFamily(family, only)}
                onShowCode={() => showCode({ name: family.name, householdId: family.householdId })}
              />
            ))}
            {more > 0 && (
              <p className="text-[15px] text-muted-foreground">
                More families match. Type more of the name to narrow the list.
              </p>
            )}
          </div>
        )
      ) : (
        <section className="flex flex-col gap-5" aria-labelledby="rooms-now-heading">
          <SectionHeader
            id="rooms-now-heading"
            title="In the rooms now"
            description={`Checked in on ${formatServiceDate(serviceDate)}.`}
          />
          <RosterBoard sessions={sessions} locations={locations} currentUserId={currentUserId} />
        </section>
      )}

      <p className="text-[15px] text-muted-foreground">
        Children go home through{" "}
        <Link href="/dashboard/checkin/checkout" className="font-semibold text-primary underline underline-offset-4 dark:text-accent">
          Pick up
        </Link>
        , where the parent&rsquo;s code is checked. To change a family or who may
        pick up, go to{" "}
        <Link href="/dashboard/people/households" className="font-semibold text-primary underline underline-offset-4 dark:text-accent">
          People › Families
        </Link>
        .
      </p>

      {codeDialogNode}
    </div>
  );
}

function FamilyCard({
  family,
  locations,
  pending,
  isTicked,
  roomFor,
  onToggle,
  onRoom,
  onCheckIn,
  onShowCode,
}: {
  family: DeskFamily;
  locations: ChurchLocation[];
  pending: boolean;
  isTicked: (child: DeskChild) => boolean;
  roomFor: (child: DeskChild) => string;
  onToggle: (child: DeskChild) => void;
  onRoom: (child: DeskChild, roomId: string) => void;
  onCheckIn: (only?: DeskChild) => void;
  onShowCode: () => void;
}) {
  const selectable = defaultSelection(family);
  const count = family.children.filter(isTicked).length;
  const anyCheckedIn = family.children.some((child) => child.state.kind === "checked_in");
  const titleId = `family-${family.householdId}`;

  return (
    <Card className="flex flex-col gap-5 p-6" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="font-heading text-2xl font-bold text-foreground">
            {family.name}
          </h2>
          {family.guardianNames.length > 0 && (
            <p className="text-[15px] text-muted-foreground">
              Parents: {joinNames(family.guardianNames)}
            </p>
          )}
        </div>
        {anyCheckedIn && (
          <Button type="button" variant="outline" disabled={pending} onClick={onShowCode}>
            Show pickup code
          </Button>
        )}
      </div>

      <ul className="flex flex-col gap-3">
        {family.children.map((child) => {
          const on = isTicked(child);
          const done = child.state.kind === "checked_in";
          const roomId = roomFor(child);

          return (
            <li
              key={child.id}
              className={cn(
                "flex flex-col gap-3 rounded-2xl border-2 p-4 transition-colors motion-reduce:transition-none",
                done
                  ? "border-border bg-muted/40"
                  : on
                    ? "border-accent bg-accent/[0.08]"
                    : "border-border bg-background",
              )}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                {done ? (
                  <div className="flex min-h-14 flex-1 items-center gap-4">
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white"
                    >
                      <Check className="size-6" strokeWidth={3} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-lg font-semibold text-foreground">
                        {child.firstName} {child.lastName}
                      </span>
                      <StatusBadge tone="done" className="mt-1">
                        Checked in
                        {child.state.kind === "checked_in" ? ` · ${child.state.locationName}` : ""}
                      </StatusBadge>
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => onToggle(child)}
                    className="flex min-h-14 flex-1 items-center gap-4 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg border-2",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/50 bg-background",
                      )}
                    >
                      {on && <Check className="size-6" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-lg font-semibold text-foreground">
                        {child.firstName} {child.lastName}
                      </span>
                      {child.state.kind === "on_the_way" ? (
                        <StatusBadge tone="working" className="mt-1">
                          On the way
                        </StatusBadge>
                      ) : (
                        <span className="block text-[15px] text-muted-foreground">
                          {on ? "Checking in" : "Not checking in"}
                        </span>
                      )}
                    </span>
                  </button>
                )}

                {!done && (
                  <div className="flex flex-col gap-2 sm:w-64">
                    <Label htmlFor={`room-${child.id}`} className="text-[15px]">
                      Room for {child.firstName}
                    </Label>
                    <Select
                      id={`room-${child.id}`}
                      value={roomId}
                      onChange={(event) => onRoom(child, event.target.value)}
                      className="min-h-12 text-base"
                    >
                      <option value="">Choose a room…</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}

                {child.state.kind === "on_the_way" && (
                  <Button
                    type="button"
                    size="lg"
                    variant="outline"
                    className="sm:self-end"
                    disabled={pending || !roomId}
                    onClick={() => onCheckIn(child)}
                  >
                    Mark arrived
                  </Button>
                )}
              </div>

              <MedicalNote note={child.medicalNotes} />
            </li>
          );
        })}
      </ul>

      {selectable.length === 0 ? (
        <p className="text-base font-medium text-muted-foreground">
          Everyone in this family is checked in.
        </p>
      ) : (
        <Button
          type="button"
          size="lg"
          className="min-h-14 w-full text-lg"
          disabled={pending || count === 0}
          onClick={() => onCheckIn()}
        >
          {pending ? "Checking in…" : checkInButtonLabel(count)}
        </Button>
      )}
    </Card>
  );
}
