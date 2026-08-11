"use client";

import { useMemo, useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { ArrowLeft, Check, Plus, Search } from "lucide-react";

import { addMember, submitAttendance } from "./actions";
import { Button } from "@/components/ui/button";
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
};

type SortOption = "first-name" | "last-name" | "most-attended";

function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export function AttendanceWizard({
  serviceDate,
  members: initialMembers,
}: AttendanceWizardProps) {
  const [submitted, setSubmitted] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("last-name");
  const [members, setMembers] = useState<WizardMember[]>(() =>
    initialMembers.map((m) => ({ ...m, status: "unmarked" as MemberStatus })),
  );
  const [notes, setNotes] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [submitResult, setSubmitResult] = useState<{
    present: number;
    absent: number;
  } | null>(null);

  const [isAdding, startAddTransition] = useTransition();
  const [isSubmitting, startSubmitTransition] = useTransition();

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = query
      ? members.filter((m) => {
          const fullName = `${m.first_name} ${m.last_name}`.toLowerCase();
          return fullName.includes(query);
        })
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
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, status } : m)),
    );
  }

  function toggleMemberStatus(memberId: string) {
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
    setMembers((prev) => prev.map((m) => ({ ...m, status: "absent" })));
  }

  function resetAll() {
    setMembers((prev) => prev.map((m) => ({ ...m, status: "unmarked" })));
  }

  function handleAddMember() {
    setAddError(null);
    startAddTransition(async () => {
      const result = await addMember({
        firstName: newFirstName,
        lastName: newLastName,
        phone: newPhone || undefined,
      });

      if (!result.ok) {
        setAddError(result.error);
        return;
      }

      setMembers((prev) => [
        ...prev,
        { ...result.member, status: "unmarked" },
      ]);
      setNewFirstName("");
      setNewLastName("");
      setNewPhone("");
      setAddOpen(false);
    });
  }

  function handleSubmit() {
    setSubmitError(null);

    startSubmitTransition(async () => {
      const entries = members.map((m) => ({
        memberId: m.id,
        status: m.status as "present" | "absent",
      }));

      const result = await submitAttendance({
        serviceDate,
        entries,
        notes,
      });

      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }

      setSubmitResult({ present: counts.present, absent: counts.absent });
      setSubmitted(true);
    });
  }

  if (submitted && submitResult) {
    return (
      <div className="flex w-full flex-col items-center gap-6 py-8 text-center">
        <div className="flex size-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/15">
          <Check className="size-10 text-green-700 dark:text-green-300" strokeWidth={1.75} aria-hidden />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-[26px] font-bold text-foreground">
            Attendance saved!
          </h1>
          <p className="text-base text-muted-foreground">
            {formatServiceDate(serviceDate)} — {submitResult.present} present,{" "}
            {submitResult.absent} absent.
          </p>
        </div>
        <Button
          render={<Link href="/dashboard/attendance" />}
          nativeButton={false}
          size="lg"
          className="h-14 w-full max-w-sm text-base"
        >
          Mark another Sunday
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard/attendance"
          className="inline-flex items-center gap-2 text-base font-semibold text-muted-foreground hover:text-accent"
        >
          <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden />
          Back to Sundays
        </Link>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
          {formatServiceDate(serviceDate)}
        </h1>
        <p className="text-base text-muted-foreground">
          Mark each member as present or absent.
        </p>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search members..."
          className="min-h-12 w-full rounded-[10px] border-[1.5px] border-border bg-card pl-12 pr-4 text-base text-foreground outline-none ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 text-base"
          onClick={setAllPresent}
        >
          All Present
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 text-base"
          onClick={setAllAbsent}
        >
          All Absent
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 flex-1 text-base"
          onClick={resetAll}
        >
          Reset
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card px-4 py-3 text-center text-base font-semibold text-foreground shadow-card dark:shadow-none">
        Present: {counts.present} | Absent: {counts.absent} | Unmarked:{" "}
        {counts.unmarked}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          Sort by
        </span>
        <div
          role="radiogroup"
          aria-label="Sort members"
          className="inline-flex flex-wrap rounded-lg border border-border bg-card p-1"
        >
          <button
            type="button"
            role="radio"
            aria-checked={sortBy === "first-name"}
            onClick={() => setSortBy("first-name")}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
              sortBy === "first-name"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            First name
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={sortBy === "last-name"}
            onClick={() => setSortBy("last-name")}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
              sortBy === "last-name"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Last name
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={sortBy === "most-attended"}
            onClick={() => setSortBy("most-attended")}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
              sortBy === "most-attended"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Most attended
          </button>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {filteredMembers.map((member) => {
          const memberLabel = `${member.first_name} ${member.last_name}`;
          const statusLabel =
            member.status === "present"
              ? "present"
              : member.status === "absent"
                ? "absent"
                : "unmarked";

          return (
            <li
              key={member.id}
              role="button"
              tabIndex={0}
              aria-pressed={member.status !== "unmarked"}
              aria-label={`${memberLabel}, ${statusLabel}. Click to toggle present or absent.`}
              onClick={() => toggleMemberStatus(member.id)}
              onKeyDown={(e) => handleMemberRowKeyDown(e, member.id)}
              className={cn(
                "flex min-h-[4.5rem] cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-card transition-colors hover:bg-muted/30 dark:shadow-none",
                member.status === "present" &&
                  "border-green-200/80 dark:border-green-500/30",
                member.status === "absent" &&
                  "border-red-200/80 dark:border-red-500/30",
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

              <span className="min-w-0 flex-1 text-base font-medium text-foreground">
                {memberLabel}
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
                  Present
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMemberStatus(member.id, "absent");
                  }}
                  className={cn(
                    "h-11 min-w-[5.5rem] rounded-lg px-3 text-base font-semibold transition-colors",
                    member.status === "absent"
                      ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  Absent
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {filteredMembers.length === 0 ? (
        <p className="py-6 text-center text-base text-muted-foreground">
          No members match your search.
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        className="h-14 w-full gap-2 text-base"
        onClick={() => setAddOpen(true)}
      >
        <Plus className="size-5" aria-hidden />
        Add Someone New
      </Button>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="service-notes"
          className="text-base font-semibold text-foreground"
        >
          Any notes about this service?
        </label>
        <textarea
          id="service-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Optional notes..."
          className="w-full resize-none rounded-[10px] border-[1.5px] border-border bg-card px-4 py-3 text-base text-foreground outline-none ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      </div>

      {submitError ? (
        <p className="text-base text-destructive" role="alert">
          {submitError}
        </p>
      ) : null}

      {/* Sticky rather than fixed: a fixed bar has to guess the sidebar's
          width to stay centred, and the sidebar collapses. Sticking to the
          bottom of the scroll container keeps it exactly as wide as the
          content column, centred in both states. The mobile offset clears
          the bottom nav. */}
      <div className="sticky bottom-20 z-40 -mx-1 rounded-xl border border-border bg-background/95 px-3 py-3 shadow-card backdrop-blur md:bottom-0 dark:shadow-none">
        <Button
          type="button"
          size="lg"
          className="h-14 w-full text-base"
          disabled={counts.unmarked > 0 || isSubmitting}
          onClick={handleSubmit}
        >
          {isSubmitting ? "Submitting..." : "Submit Attendance"}
        </Button>
        {counts.unmarked > 0 ? (
          <p className="mt-2 text-center text-sm text-muted-foreground">
            {counts.unmarked} still unmarked
          </p>
        ) : null}
      </div>

      <Dialog.Root open={addOpen} onOpenChange={setAddOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-brand-navy/50" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-card-hover">
            <Dialog.Title className="font-heading text-xl font-semibold text-foreground">
              Add Someone New
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-base text-muted-foreground">
              They will be added to your member list and this week&apos;s
              attendance.
            </Dialog.Description>

            <form
              className="mt-5 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                handleAddMember();
              }}
            >
              <div className="flex flex-col gap-2">
                <label htmlFor="new-first-name" className="text-base font-semibold">
                  First name
                </label>
                <input
                  id="new-first-name"
                  value={newFirstName}
                  onChange={(e) => setNewFirstName(e.target.value)}
                  required
                  className="min-h-12 rounded-[10px] border-[1.5px] border-border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="new-last-name" className="text-base font-semibold">
                  Last name
                </label>
                <input
                  id="new-last-name"
                  value={newLastName}
                  onChange={(e) => setNewLastName(e.target.value)}
                  required
                  className="min-h-12 rounded-[10px] border-[1.5px] border-border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="new-phone" className="text-base font-semibold">
                  Phone (optional)
                </label>
                <input
                  id="new-phone"
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="min-h-12 rounded-[10px] border-[1.5px] border-border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>

              {addError ? (
                <p className="text-base text-destructive" role="alert">
                  {addError}
                </p>
              ) : null}

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 flex-1 text-base"
                  onClick={() => setAddOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="h-12 flex-1 text-base"
                  disabled={isAdding}
                >
                  {isAdding ? "Adding..." : "Add Member"}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
