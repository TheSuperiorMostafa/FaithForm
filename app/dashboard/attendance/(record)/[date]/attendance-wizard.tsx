"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import { Check, Hash, Plus, RotateCcw, Search, Smartphone, Users } from "lucide-react";
import { toast } from "sonner";

import { addMember, submitAttendance } from "./actions";
import {
  clearDraft,
  draftHasWork,
  draftKey,
  readDraft,
  writeDraft,
  type AttendanceDraftMode,
} from "@/components/attendance/attendance-draft";
import { ServiceDayHeader } from "@/components/attendance/service-day-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { SuccessState } from "@/components/ui/success-state";
import { Textarea } from "@/components/ui/textarea";
import { describeNameCount, parseHeadcount } from "@/lib/attendance/headcount";
import { describePresence, type PresenceMethod } from "@/lib/attendance/presence";
import type { AttendanceMember } from "@/lib/queries/attendance";
import { formatServiceDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

type MemberStatus = "present" | "absent" | "unmarked";

type WizardMember = AttendanceMember & {
  status: MemberStatus;
};

type AttendanceWizardProps = {
  serviceDate: string;
  members: AttendanceMember[];
  /**
   * Already counted today by the app, a code, the kiosk, the Services roster
   * or a room check-in, and how. They start present and stay present: the
   * sheet cannot un-count a check-in — a wrong one is reversed on Services.
   */
  checkedIn?: Record<string, PresenceMethod[]>;
  /** Correcting a saved Sunday: each person's saved mark. */
  initialStatuses?: Record<string, "present" | "absent">;
  initialNotes?: string;
  editing?: boolean;
  /** How the page opens: by name (the default) or as one number. */
  initialMode?: AttendanceDraftMode;
  /** Correcting a Sunday that was saved as one number. */
  initialHeadcount?: number | null;
  /**
   * A Sunday already saved by name can't be turned into a number without
   * losing who was marked, so "Just a number" is not offered for it.
   */
  numberAllowed?: boolean;
  /** Only Follow-up holders are offered the link across. */
  canFollowUp?: boolean;
};

type SortOption = "first-name" | "last-name" | "most-attended";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "last-name", label: "Last name" },
  { value: "first-name", label: "First name" },
  { value: "most-attended", label: "Comes most often" },
];

function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function people(n: number) {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

export function AttendanceWizard({
  serviceDate,
  members: initialMembers,
  checkedIn = {},
  initialStatuses,
  initialNotes = "",
  editing = false,
  initialMode = "names",
  initialHeadcount = null,
  numberAllowed = true,
  canFollowUp = false,
}: AttendanceWizardProps) {
  const isCheckedIn = (memberId: string) => Boolean(checkedIn[memberId]?.length);
  const startingStatus = (memberId: string): MemberStatus =>
    isCheckedIn(memberId) ? "present" : (initialStatuses?.[memberId] ?? "unmarked");
  const checkedInCount = initialMembers.filter((m) => isCheckedIn(m.id)).length;
  const dayLabel = formatServiceDate(serviceDate);
  const storageKey = draftKey(serviceDate, editing);

  const [mode, setMode] = useState<AttendanceDraftMode>(numberAllowed ? initialMode : "names");
  const [headcount, setHeadcount] = useState(initialHeadcount ? String(initialHeadcount) : "");
  const [headcountError, setHeadcountError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("last-name");
  const [members, setMembers] = useState<WizardMember[]>(() =>
    initialMembers.map((m) => ({ ...m, status: startingStatus(m.id) })),
  );
  const [notes, setNotes] = useState(initialNotes);
  const [restored, setRestored] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [saved, setSaved] = useState<
    { kind: "names"; present: number; absent: number } | { kind: "number"; count: number } | null
  >(null);

  const [isAdding, startAddTransition] = useTransition();
  const [isSubmitting, startSubmitTransition] = useTransition();

  // ── Draft: bring back unsaved work, then keep it as it changes ────────────
  const draftReady = useRef(false);

  useEffect(() => {
    const draft = readDraft(storageKey);
    if (draft && draftHasWork(draft)) {
      setMode(numberAllowed ? draft.mode : "names");
      setHeadcount(draft.headcount);
      setNotes(draft.notes);
      setMembers((prev) =>
        prev.map((m) =>
          isCheckedIn(m.id) || !draft.statuses[m.id] ? m : { ...m, status: draft.statuses[m.id] },
        ),
      );
      setRestored(true);
    }
    draftReady.current = true;
    // Once, on opening. Reading the draft again on every render would undo marks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftReady.current || saved) return;
    const statuses: Record<string, "present" | "absent"> = {};
    for (const member of members) {
      if (member.status !== "unmarked" && !isCheckedIn(member.id)) statuses[member.id] = member.status;
    }
    const draft = { mode, statuses, headcount, notes };
    if (draftHasWork(draft)) writeDraft(storageKey, draft);
    else clearDraft(storageKey);
    // `isCheckedIn` reads props that don't change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, mode, headcount, notes, saved, storageKey]);

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = query
      ? members.filter((m) => `${m.first_name} ${m.last_name}`.toLowerCase().includes(query))
      : members;

    const sorted = [...matched];
    if (sortBy === "most-attended") {
      sorted.sort((a, b) => {
        if (b.attendance_count !== a.attendance_count) {
          return b.attendance_count - a.attendance_count;
        }
        return a.last_name.localeCompare(b.last_name);
      });
    } else if (sortBy === "first-name") {
      sorted.sort((a, b) => {
        const byFirst = a.first_name.localeCompare(b.first_name);
        if (byFirst !== 0) return byFirst;
        return a.last_name.localeCompare(b.last_name);
      });
    } else {
      sorted.sort((a, b) => {
        const byLast = a.last_name.localeCompare(b.last_name);
        if (byLast !== 0) return byLast;
        return a.first_name.localeCompare(b.first_name);
      });
    }
    return sorted;
  }, [members, search, sortBy]);

  const counts = useMemo(() => {
    let present = 0;
    let absent = 0;
    let unmarked = 0;

    for (const member of members) {
      if (member.status === "present") present++;
      else if (member.status === "absent") absent++;
      else unmarked++;
    }

    return { present, absent, unmarked };
  }, [members]);

  function setMemberStatus(memberId: string, status: MemberStatus) {
    if (isCheckedIn(memberId)) return;
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, status } : m)),
    );
  }

  function toggleMemberStatus(memberId: string) {
    if (isCheckedIn(memberId)) return;
    setMembers((prev) =>
      prev.map((m) => {
        if (m.id !== memberId) return m;
        if (m.status === "present") return { ...m, status: "absent" };
        return { ...m, status: "present" };
      }),
    );
  }

  function handleMemberRowKeyDown(event: KeyboardEvent, memberId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleMemberStatus(memberId);
    }
  }

  function setAllPresent() {
    setMembers((prev) => prev.map((m) => ({ ...m, status: "present" })));
  }

  function setAllAbsent() {
    setMembers((prev) =>
      prev.map((m) => (isCheckedIn(m.id) ? m : { ...m, status: "absent" })),
    );
  }

  function startOver() {
    setMembers((prev) => prev.map((m) => ({ ...m, status: startingStatus(m.id) })));
    setHeadcount(initialHeadcount ? String(initialHeadcount) : "");
    setNotes(initialNotes);
    setRestored(false);
    clearDraft(storageKey);
  }

  function handleAddMember() {
    setAddError(null);
    startAddTransition(async () => {
      try {
        const result = await addMember({
          firstName: newFirstName,
          lastName: newLastName,
          phone: newPhone || undefined,
        });

        if (!result.ok) {
          setAddError(result.error);
          return;
        }

        // They came, which is why they're being added: start them as here.
        setMembers((prev) => [...prev, { ...result.member, status: "present" }]);
        toast.success(`${result.member.first_name} added to People and marked here.`);
        setNewFirstName("");
        setNewLastName("");
        setNewPhone("");
        setAddOpen(false);
      } catch {
        setAddError("We couldn't add them. Check your connection and try again.");
      }
    });
  }

  function saveNumber() {
    const parsed = parseHeadcount(headcount);
    if (!parsed.ok) {
      setHeadcountError(parsed.error);
      return;
    }
    setHeadcountError(null);
    setSubmitError(null);

    startSubmitTransition(async () => {
      try {
        const result = await submitAttendance({
          serviceDate,
          entries: [],
          notes,
          editing,
          headcount: parsed.count,
        });
        if (!result.ok) {
          setSubmitError(result.error);
          return;
        }
        clearDraft(storageKey);
        setSaved({ kind: "number", count: parsed.count });
      } catch {
        setSubmitError("We couldn't save attendance. Your number is still on this page. Try again.");
      }
    });
  }

  async function saveNames() {
    setSubmitError(null);
    const present = counts.present;
    const absent = counts.absent + counts.unmarked;

    const ok = await confirmAction({
      title: `Save attendance for ${dayLabel}?`,
      description:
        counts.unmarked > 0
          ? `${describeNameCount(present, absent)}. That includes ${people(counts.unmarked)} you didn't mark, who will count as not here. You can edit this later.`
          : `${describeNameCount(present, absent)}. You can edit this later.`,
      confirmLabel: "Save attendance",
    });
    if (!ok) return;

    startSubmitTransition(async () => {
      try {
        // Anyone not marked counts as not here.
        const entries = members.map((m) => ({
          memberId: m.id,
          status: (m.status === "present" ? "present" : "absent") as "present" | "absent",
        }));

        const result = await submitAttendance({ serviceDate, entries, notes, editing });

        if (!result.ok) {
          setSubmitError(result.error);
          return;
        }

        clearDraft(storageKey);
        setSaved({ kind: "names", present, absent });
      } catch {
        setSubmitError("We couldn't save attendance. Your marks are still on this page. Try again.");
      }
    });
  }

  if (saved) {
    const summary =
      saved.kind === "number"
        ? `${dayLabel}: ${people(saved.count)} came.`
        : `${dayLabel}: ${describeNameCount(saved.present, saved.absent)}.`;
    return (
      <div className="flex w-full flex-col gap-8">
        <SuccessState
          title={editing ? "Changes saved" : "Attendance saved"}
          description={summary}
          actions={
            <>
              {canFollowUp && saved.kind === "names" && saved.absent > 0 ? (
                <Link
                  href={`/dashboard/attendance/follow-up?date=${serviceDate}`}
                  className={buttonVariants({ size: "lg" })}
                >
                  Text people who missed
                </Link>
              ) : null}
              <Link
                href="/dashboard/attendance"
                className={buttonVariants({
                  size: "lg",
                  variant: canFollowUp && saved.kind === "names" && saved.absent > 0 ? "outline" : "default",
                })}
              >
                Back to Sunday count
              </Link>
            </>
          }
        />
      </div>
    );
  }

  const canSaveNumber = parseHeadcount(headcount).ok;

  return (
    <div className="flex w-full flex-col gap-8">
      <ServiceDayHeader
        title={dayLabel}
        description={
          editing
            ? "Change what was saved for this Sunday, then save again."
            : "Count who came. Pick the quickest way for you."
        }
      />

      {restored ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-2xl border border-brand-gold/40 bg-brand-gold/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-base text-foreground">
            We kept what you entered earlier. Carry on where you left off.
          </p>
          <Button type="button" variant="outline" onClick={startOver}>
            <RotateCcw aria-hidden />
            Start over
          </Button>
        </div>
      ) : null}

      <div role="radiogroup" aria-label="How do you want to count?" className="choice-grid">
        <ModeCard
          icon={Hash}
          title="Just a number"
          description="Type one total. The fastest way."
          selected={mode === "number"}
          disabled={!numberAllowed}
          disabledNote="This Sunday was saved by name. Edit the names so nobody's mark is lost."
          onSelect={() => setMode("number")}
        />
        <ModeCard
          icon={Users}
          title="By name"
          description="Mark who came, so you can follow up with who missed."
          selected={mode === "names"}
          onSelect={() => setMode("names")}
        />
      </div>

      {mode === "number" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <section className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
            <div className="flex flex-col gap-2">
              <Label htmlFor="headcount" className="text-lg font-semibold">
                How many people came?
              </Label>
              <Input
                id="headcount"
                inputMode="numeric"
                autoComplete="off"
                value={headcount}
                placeholder="For example, 142"
                aria-invalid={headcountError ? true : undefined}
                aria-describedby="headcount-help"
                onChange={(event) => {
                  setHeadcount(event.target.value);
                  setHeadcountError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveNumber();
                  }
                }}
                className="h-16 max-w-xs text-3xl font-bold tabular-nums"
              />
              <p id="headcount-help" className="text-[15px] text-muted-foreground">
                {checkedInCount > 0
                  ? `${people(checkedInCount)} already checked in on their phone, at the kiosk or in a kids room. Include them in your total.`
                  : "Count everyone in the room, children included."}
              </p>
              {headcountError ? (
                <p className="text-base font-medium text-destructive" role="alert">
                  {headcountError}
                </p>
              ) : null}
            </div>
            <NotesField value={notes} onChange={setNotes} />
          </section>

          <aside className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card lg:sticky lg:top-6 dark:shadow-none">
            <p className="text-[15px] text-muted-foreground">
              A number shows on your Home chart and monthly report. To text people
              who missed, count by name instead.
            </p>
            {submitError ? (
              <p className="text-base text-destructive" role="alert">
                {submitError}
              </p>
            ) : null}
            <Button
              type="button"
              size="lg"
              className="h-14 w-full text-base"
              disabled={isSubmitting || !canSaveNumber}
              onClick={saveNumber}
            >
              {isSubmitting ? "Saving…" : "Save attendance"}
            </Button>
          </aside>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <section className="flex min-w-0 flex-col gap-4" aria-label="People">
            {checkedInCount > 0 ? (
              <p className="flex items-start gap-3 rounded-2xl border border-brand-navy/15 bg-brand-navy/5 px-5 py-4 text-[15px] text-foreground dark:border-brand-gold/30 dark:bg-brand-gold/10">
                <Smartphone className="mt-0.5 size-5 shrink-0 text-primary dark:text-accent" aria-hidden />
                <span>
                  {people(checkedInCount)} already checked in on their phone, at the
                  kiosk or in a kids room, so they&apos;re marked here. A check-in
                  that was a mistake can be removed on Services.
                </span>
              </p>
            ) : null}

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find someone by name"
                aria-label="Find someone by name"
                className="min-h-12 pl-12 text-base"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="shrink-0 text-[15px] font-medium text-muted-foreground">Sort by</span>
              <div
                role="radiogroup"
                aria-label="Sort people"
                className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
              >
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={sortBy === option.value}
                    onClick={() => setSortBy(option.value)}
                    className={cn(
                      "min-h-11 rounded-lg px-4 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      sortBy === option.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={setAllPresent}>
                Mark everyone here
              </Button>
              <Button type="button" variant="outline" className="flex-1" onClick={setAllAbsent}>
                Mark everyone not here
              </Button>
            </div>

            <ul className="flex flex-col gap-2">
              {filteredMembers.map((member) => {
                const memberLabel = `${member.first_name} ${member.last_name}`;
                const checkInMethods = checkedIn[member.id] ?? [];
                const locked = checkInMethods.length > 0;
                const statusLabel =
                  member.status === "present"
                    ? "here"
                    : member.status === "absent"
                      ? "not here"
                      : "not marked yet";

                return (
                  <li
                    key={member.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={member.status !== "unmarked"}
                    aria-disabled={locked || undefined}
                    aria-label={
                      locked
                        ? `${memberLabel}, here (${describePresence(checkInMethods)}).`
                        : `${memberLabel}, ${statusLabel}. Press to switch between here and not here.`
                    }
                    onClick={() => toggleMemberStatus(member.id)}
                    onKeyDown={(e) => handleMemberRowKeyDown(e, member.id)}
                    className={cn(
                      "flex min-h-[4.5rem] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-card transition-colors dark:shadow-none",
                      locked ? "cursor-default" : "cursor-pointer hover:bg-muted/30",
                      member.status === "present" && "border-green-200/80 dark:border-green-500/30",
                      member.status === "absent" && "border-red-200/80 dark:border-red-500/30",
                    )}
                  >
                    {member.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={member.photo_url}
                        alt=""
                        className="size-11 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-base font-bold text-accent"
                        aria-hidden
                      >
                        {getInitials(member.first_name, member.last_name)}
                      </div>
                    )}

                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-base font-medium text-foreground">{memberLabel}</span>
                      {locked ? (
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Smartphone className="size-4 shrink-0" aria-hidden />
                          {describePresence(checkInMethods)}
                        </span>
                      ) : member.status === "unmarked" ? (
                        <span className="text-sm text-muted-foreground">Not marked yet</span>
                      ) : null}
                    </span>

                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMemberStatus(member.id, "present");
                        }}
                        className={cn(
                          "h-11 min-w-[5.5rem] rounded-lg px-3 text-base font-semibold transition-colors",
                          member.status === "present"
                            ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                            : "bg-muted text-muted-foreground hover:text-foreground",
                        )}
                      >
                        Here
                      </button>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMemberStatus(member.id, "absent");
                        }}
                        className={cn(
                          "disabled:cursor-not-allowed disabled:opacity-50",
                          "h-11 min-w-[5.5rem] rounded-lg px-3 text-base font-semibold transition-colors",
                          member.status === "absent"
                            ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                            : "bg-muted text-muted-foreground hover:text-foreground",
                        )}
                      >
                        Not here
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {filteredMembers.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border py-8 text-center text-base text-muted-foreground">
                {members.length === 0
                  ? "Nobody is in People yet. Add someone below, or count with just a number."
                  : "Nobody matches that name. Add them below if they're new."}
              </p>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-14 w-full text-base"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="size-5" aria-hidden />
              Add someone new
            </Button>

            <NotesField value={notes} onChange={setNotes} />
          </section>

          <aside className="sticky bottom-20 z-30 flex flex-col gap-4 rounded-2xl border border-border bg-card/95 p-5 shadow-card backdrop-blur md:bottom-4 lg:top-6 lg:bottom-auto lg:p-6 dark:shadow-none">
            <dl className="grid grid-cols-3 gap-2 text-center lg:gap-3">
              <Tally label="Here" value={counts.present} tone="good" />
              <Tally label="Not here" value={counts.absent} tone="bad" />
              <Tally label="Not marked" value={counts.unmarked} tone="muted" />
            </dl>
            {counts.unmarked > 0 ? (
              <p className="text-[15px] text-muted-foreground">
                Anyone not marked counts as not here when you save.
              </p>
            ) : null}
            {submitError ? (
              <p className="text-base text-destructive" role="alert">
                {submitError}
              </p>
            ) : null}
            <Button
              type="button"
              size="lg"
              className="h-14 w-full text-base"
              disabled={isSubmitting || members.length === 0}
              onClick={() => void saveNames()}
            >
              {isSubmitting ? "Saving…" : "Save attendance"}
            </Button>
          </aside>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="p-6">
          <DialogHeader>
            <DialogTitle>Add someone new</DialogTitle>
            <DialogDescription>
              They&apos;re added to People and marked here for {dayLabel}.
            </DialogDescription>
          </DialogHeader>

          <form
            className="mt-5 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleAddMember();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-first-name" className="text-base font-semibold">
                First name
              </Label>
              <Input
                id="new-first-name"
                value={newFirstName}
                onChange={(e) => setNewFirstName(e.target.value)}
                required
                className="min-h-12 text-base"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-last-name" className="text-base font-semibold">
                Last name (optional)
              </Label>
              <Input
                id="new-last-name"
                value={newLastName}
                onChange={(e) => setNewLastName(e.target.value)}
                className="min-h-12 text-base"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-phone" className="text-base font-semibold">
                Phone (optional)
              </Label>
              <PhoneInput
                id="new-phone"
                value={newPhone}
                onValueChange={setNewPhone}
                className="min-h-12 rounded-[10px] border-[1.5px] border-border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            {addError ? (
              <p className="text-base text-destructive" role="alert">
                {addError}
              </p>
            ) : null}

            <DialogFooter className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={isAdding}>
                {isAdding ? "Adding…" : "Add and mark here"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModeCard({
  icon: Icon,
  title,
  description,
  selected,
  disabled = false,
  disabledNote,
  onSelect,
}: {
  icon: typeof Hash;
  title: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  disabledNote?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-h-36 items-start gap-4 rounded-2xl border-2 bg-card p-6 text-left shadow-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 dark:shadow-none",
        selected ? "border-accent bg-accent/[0.06]" : "border-border hover:border-accent/50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-xl",
          selected ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-6" strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
          {title}
          {selected ? <Check className="size-5 text-accent" aria-hidden /> : null}
        </span>
        <span className="text-[15px] text-muted-foreground">
          {disabled && disabledNote ? disabledNote : description}
        </span>
      </span>
    </button>
  );
}

function Tally({ label, value, tone }: { label: string; value: number; tone: "good" | "bad" | "muted" }) {
  return (
    <div className="flex flex-col-reverse gap-0.5 rounded-xl bg-muted/50 px-2 py-2 lg:py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "font-heading text-2xl font-bold tabular-nums lg:text-3xl",
          tone === "good" && "text-green-700 dark:text-green-300",
          tone === "bad" && "text-red-700 dark:text-red-300",
          tone === "muted" && "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function NotesField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="service-notes" className="text-base font-semibold">
        Notes about this Sunday (optional)
      </Label>
      <Textarea
        id="service-notes"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="Snow kept some people home, guest speaker…"
        className="resize-none text-base"
      />
    </div>
  );
}
