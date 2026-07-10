"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";

import { MemberFormPanel } from "@/components/people/member-form-panel";
import { Button } from "@/components/ui/button";
import type { ChurchMember } from "@/lib/queries/members";
import { formatPhoneDisplay } from "@/lib/people/validate-member";
import { cn } from "@/lib/utils";

type PeopleManagerProps = {
  initialMembers: ChurchMember[];
  isAdmin: boolean;
};

type FilterOption = "all" | "missing-phone" | "inactive";
type SortOption = "last-name" | "first-name";

function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export function PeopleManager({ initialMembers, isAdmin }: PeopleManagerProps) {
  const [members, setMembers] = useState(initialMembers);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [sortBy, setSortBy] = useState<SortOption>("last-name");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"create" | "edit">("edit");
  const [selectedMember, setSelectedMember] = useState<ChurchMember | null>(
    null,
  );

  const stats = useMemo(() => {
    const active = members.filter((member) => member.is_active);
    const withPhone = active.filter((member) => member.phone?.trim()).length;
    return {
      total: active.length,
      withPhone,
      missingPhone: active.length - withPhone,
    };
  }, [members]);

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();

    let list = members.filter((member) => {
      if (filter === "inactive") return !member.is_active;
      if (!member.is_active) return false;
      if (filter === "missing-phone") return !member.phone?.trim();
      return true;
    });

    if (query) {
      list = list.filter((member) => {
        const fullName = `${member.first_name} ${member.last_name}`.toLowerCase();
        const phone = member.phone ?? "";
        const email = member.email ?? "";
        return (
          fullName.includes(query) ||
          phone.includes(query) ||
          email.toLowerCase().includes(query)
        );
      });
    }

    const sorted = [...list];
    if (sortBy === "first-name") {
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
  }, [members, search, filter, sortBy]);

  function openCreatePanel() {
    setSelectedMember(null);
    setPanelMode("create");
    setPanelOpen(true);
  }

  function openMemberPanel(member: ChurchMember) {
    setSelectedMember(member);
    setPanelMode("edit");
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
  }

  function handleSaved(member: ChurchMember) {
    setSelectedMember(member);
    setPanelMode("edit");
    setMembers((prev) => {
      const index = prev.findIndex((row) => row.id === member.id);
      if (index === -1) {
        return [...prev, { ...member, attendance_count: 0 }].sort((a, b) =>
          a.last_name.localeCompare(b.last_name),
        );
      }

      const next = [...prev];
      next[index] = {
        ...next[index],
        ...member,
        attendance_count: next[index].attendance_count,
      };
      return next;
    });
  }

  function handleDeactivated(memberId: string) {
    setMembers((prev) =>
      prev.map((member) =>
        member.id === memberId ? { ...member, is_active: false } : member,
      ),
    );
    if (filter !== "inactive") {
      setFilter("all");
    }
  }

  function handleReactivated(member: ChurchMember) {
    setSelectedMember(member);
    setMembers((prev) => {
      const index = prev.findIndex((row) => row.id === member.id);
      if (index === -1) return [...prev, { ...member, attendance_count: 0 }];
      const next = [...prev];
      next[index] = {
        ...next[index],
        ...member,
        is_active: true,
        attendance_count: next[index].attendance_count,
      };
      return next;
    });
    setFilter("all");
  }

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-6 pb-28 lg:flex-row lg:items-start",
        panelOpen ? "max-w-6xl" : "max-w-2xl",
      )}
    >
      <div className="flex w-full flex-col gap-5 lg:min-w-0 lg:flex-1">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
            People
          </h1>
          <p className="text-base text-muted-foreground">
            Add phone numbers so follow-up texts can reach absent members.
          </p>
        </div>
        {isAdmin ? (
          <Button
            type="button"
            className="hidden h-12 shrink-0 gap-2 text-base sm:inline-flex"
            onClick={openCreatePanel}
          >
            <Plus className="size-5" aria-hidden />
            Add Person
          </Button>
        ) : null}
      </header>

      {!isAdmin ? (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-card dark:shadow-none">
          Contact your church admin to update phone numbers.
        </p>
      ) : null}

      <div className="rounded-xl border border-border bg-card px-4 py-3 text-center text-base font-semibold text-foreground shadow-card dark:shadow-none">
        {stats.total} people · {stats.withPhone} with phone · {stats.missingPhone}{" "}
        missing phone
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search people..."
          className="min-h-12 w-full rounded-[10px] border-[1.5px] border-border bg-card pl-12 pr-4 text-base text-foreground outline-none ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["missing-phone", "Missing phone"],
            ["inactive", "Inactive"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
              filter === value
                ? "bg-accent text-accent-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          Sort by
        </span>
        <div
          role="radiogroup"
          aria-label="Sort people"
          className="inline-flex flex-wrap rounded-lg border border-border bg-card p-1"
        >
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
        </div>
      </div>

      {members.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center shadow-card dark:shadow-none">
          <p className="text-base text-muted-foreground">
            No people on your roster yet.
          </p>
          {isAdmin ? (
            <Button type="button" className="h-12 text-base" onClick={openCreatePanel}>
              Add your first person
            </Button>
          ) : null}
        </div>
      ) : filteredMembers.length === 0 ? (
        <p className="py-8 text-center text-base text-muted-foreground">
          No one matches your search.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filteredMembers.map((member) => {
            const phoneLabel = member.phone
              ? formatPhoneDisplay(member.phone)
              : null;
            const hasPhone = Boolean(member.phone?.trim());

            return (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => openMemberPanel(member)}
                  aria-current={
                    panelOpen &&
                    panelMode === "edit" &&
                    selectedMember?.id === member.id
                      ? "true"
                      : undefined
                  }
                  className={cn(
                    "flex min-h-[4.5rem] w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left shadow-card transition-colors hover:bg-muted/30 dark:shadow-none",
                    !member.is_active && "opacity-70",
                    panelOpen &&
                      panelMode === "edit" &&
                      selectedMember?.id === member.id &&
                      "border-accent ring-2 ring-accent/40",
                  )}
                >
                  <div
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-base font-bold text-accent"
                    aria-hidden
                  >
                    {getInitials(member.first_name, member.last_name)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-medium text-foreground">
                        {member.first_name} {member.last_name}
                      </span>
                      {!member.is_active ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                          Inactive
                        </span>
                      ) : hasPhone ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-500/15 dark:text-green-300">
                          Text ready
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          No phone
                        </span>
                      )}
                    </div>
                    <p
                      className={cn(
                        "text-sm",
                        hasPhone
                          ? "text-muted-foreground"
                          : "text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {phoneLabel ??
                        (isAdmin
                          ? "No phone — tap to add"
                          : "No phone on file")}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {isAdmin ? (
        <div className="fixed bottom-20 left-0 right-0 z-40 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:hidden md:bottom-0 md:left-60">
          <Button
            type="button"
            size="lg"
            className="mx-auto h-14 w-full max-w-2xl gap-2 text-base"
            onClick={openCreatePanel}
          >
            <Plus className="size-5" aria-hidden />
            Add Person
          </Button>
        </div>
      ) : null}
      </div>

      {panelOpen ? (
        <>
          <button
            type="button"
            aria-label="Close panel"
            onClick={closePanel}
            className="fixed inset-0 z-40 bg-brand-navy/50 lg:hidden"
          />
          <aside
            className={cn(
              "fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-border bg-card p-6 shadow-card-hover",
              "lg:sticky lg:top-6 lg:z-auto lg:inset-y-auto lg:w-[380px] lg:max-w-none lg:shrink-0 lg:rounded-2xl lg:border lg:shadow-card lg:dark:shadow-none",
            )}
          >
            <MemberFormPanel
              key={panelMode === "edit" ? selectedMember?.id ?? "edit" : "new"}
              member={panelMode === "edit" ? selectedMember : null}
              isAdmin={isAdmin}
              onClose={closePanel}
              onSaved={handleSaved}
              onDeactivated={handleDeactivated}
              onReactivated={handleReactivated}
            />
          </aside>
        </>
      ) : null}
    </div>
  );
}
