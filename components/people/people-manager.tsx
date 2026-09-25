"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, UserPlus, Users } from "lucide-react";

import { ProfileAvatar } from "@/components/dashboard/profile-avatar";
import { MemberFormPanel } from "@/components/people/member-form-panel";
import {
  countPeople,
  filterPeople,
  fullName,
  getInitials,
  personContext,
  personStatus,
  type PeopleFilter,
  type PeopleSort,
} from "@/components/people/people-format";
import { PEOPLE_DESCRIPTION, PeopleTabs } from "@/components/people/people-tabs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow } from "@/components/ui/list-row";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ChurchMember } from "@/lib/queries/members";
import { cn } from "@/lib/utils";

type PeopleManagerProps = {
  initialMembers: ChurchMember[];
  isAdmin: boolean;
  /**
   * Whether the church offers the member app. When it does, every person
   * shows whether they are on it; when it does not, the question is noise.
   */
  showAppStatus?: boolean;
  /** People connected to an app account, by member id. */
  appConnections?: Record<string, { linkedAt: string }>;
  /** The photo someone set in the app, by member id. Initials without one. */
  appPhotos?: Record<string, string>;
  /** The "Needs your attention" card, drawn between the header and the list. */
  attention?: React.ReactNode;
};

export function PeopleManager({
  initialMembers,
  isAdmin,
  showAppStatus = false,
  appConnections = {},
  appPhotos = {},
  attention,
}: PeopleManagerProps) {
  const [members, setMembers] = useState(initialMembers);
  // The panels above the list change People too — confirming someone from the
  // app adds a person, moving a connection retires one — and each of those
  // re-renders this page with the new list. Take it, rather than keep showing
  // the list as it was when the page first loaded.
  useEffect(() => {
    setMembers(initialMembers);
  }, [initialMembers]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [sortBy, setSortBy] = useState<PeopleSort>("last-name");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"create" | "edit">("edit");
  const [selectedMember, setSelectedMember] = useState<ChurchMember | null>(
    null,
  );
  /** The person just added, so their panel can offer the next steps. */
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  /** Bumped by "Add another" so the add form starts clean every time. */
  const [createKey, setCreateKey] = useState(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isOnApp = useCallback(
    (memberId: string) => showAppStatus && Boolean(appConnections[memberId]),
    [showAppStatus, appConnections],
  );

  const counts = useMemo(() => countPeople(members, isOnApp), [members, isOnApp]);

  const filteredMembers = useMemo(
    () => filterPeople(members, { search, filter, sortBy, isOnApp }),
    [members, search, filter, sortBy, isOnApp],
  );

  const openCreatePanel = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setSelectedMember(null);
    setJustAddedId(null);
    setCreateKey((key) => key + 1);
    setPanelMode("create");
    setPanelOpen(true);
  }, []);

  // Home's "Add a person" links here with ?add=1. Open the form, then drop the
  // flag so a refresh doesn't open it again.
  const addRequested = searchParams.get("add") === "1";
  useEffect(() => {
    if (!addRequested) return;
    if (isAdmin) openCreatePanel();
    const next = new URLSearchParams(searchParams.toString());
    next.delete("add");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [addRequested, isAdmin, openCreatePanel, pathname, router, searchParams]);

  function openMemberPanel(member: ChurchMember) {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setSelectedMember(member);
    setJustAddedId(null);
    setPanelMode("edit");
    setPanelOpen(true);
  }

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setJustAddedId(null);
    // Back to the row (or button) that opened the panel.
    const target = returnFocus.current;
    if (target && document.contains(target)) {
      requestAnimationFrame(() => target.focus());
    }
  }, []);

  // Move focus into the panel when it opens, unless a field already took it
  // (the add form focuses First name itself).
  const panelKey = panelMode === "edit" ? selectedMember?.id ?? "edit" : `new-${createKey}`;
  useEffect(() => {
    if (!panelOpen) return;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) panel.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [panelOpen, panelKey]);

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="alertdialog"]')) {
        closePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, closePanel]);

  /**
   * A save replies with the row as stored, which knows nothing of attendance
   * or where the record came from. Keep those from what was already shown.
   */
  function withKnownHistory(member: ChurchMember): ChurchMember {
    const known = members.find((row) => row.id === member.id);
    if (!known) return { ...member, attendance_count: 0 };
    return {
      ...known,
      ...member,
      attendance_count: known.attendance_count,
      last_attended: known.last_attended,
      source: known.source,
    };
  }

  function handleSaved(member: ChurchMember) {
    const merged = withKnownHistory(member);
    const isNew = !members.some((row) => row.id === member.id);
    setSelectedMember(merged);
    setPanelMode("edit");
    setJustAddedId(isNew ? member.id : null);
    setMembers((prev) => {
      const index = prev.findIndex((row) => row.id === member.id);
      if (index === -1) {
        return [...prev, merged].sort((a, b) =>
          a.last_name.localeCompare(b.last_name),
        );
      }

      const next = [...prev];
      next[index] = merged;
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
    const merged = { ...withKnownHistory(member), is_active: true };
    setSelectedMember(merged);
    setMembers((prev) => {
      const index = prev.findIndex((row) => row.id === member.id);
      if (index === -1) return [...prev, merged];
      const next = [...prev];
      next[index] = merged;
      return next;
    });
    setFilter("all");
  }

  const filters: { value: PeopleFilter; label: string }[] = [
    { value: "all", label: "Everyone" },
    ...(showAppStatus ? [{ value: "on-app" as const, label: "On the app" }] : []),
    { value: "missing-phone", label: "No phone" },
    { value: "inactive", label: "Inactive" },
  ];

  const openId = panelOpen && panelMode === "edit" ? selectedMember?.id : null;

  return (
    <div className="flex w-full flex-col gap-8 pb-28 sm:pb-0">
      <PageHeader
        title="People"
        description={PEOPLE_DESCRIPTION}
        action={
          isAdmin ? (
            <Button
              type="button"
              size="lg"
              className="hidden sm:inline-flex"
              onClick={openCreatePanel}
            >
              <Plus aria-hidden />
              Add person
            </Button>
          ) : null
        }
      />

      <PeopleTabs />

      {attention}

      <section aria-label="Find a person" className="flex flex-col gap-5">
        <div className="relative">
          <label htmlFor="people-search" className="sr-only">
            Search people
          </label>
          <Search
            className="pointer-events-none absolute left-5 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            id="people-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, phone or email"
            autoComplete="off"
            className="min-h-14 w-full rounded-2xl border-[1.5px] border-border bg-card pl-14 pr-5 text-lg text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
            {filters.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  filter === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground/80 hover:border-accent hover:text-foreground",
                )}
              >
                {label}
                <span
                  className={cn(
                    "tabular-nums",
                    filter === value ? "text-primary-foreground/80" : "text-muted-foreground",
                  )}
                >
                  {counts[value]}
                </span>
              </button>
            ))}
          </div>

          <label className="flex items-center gap-3 text-[15px] font-medium text-muted-foreground">
            <span className="shrink-0">Sort by</span>
            <Select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as PeopleSort)}
              className="min-h-11 w-auto"
            >
              <option value="last-name">Last name</option>
              <option value="first-name">First name</option>
            </Select>
          </label>
        </div>

        {!isAdmin ? (
          <p className="text-[15px] text-muted-foreground">
            Only church admins can add people or change their details.
          </p>
        ) : null}

        {members.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No people yet"
            description="Add the people in your church so you can take attendance, check children in and stay in touch."
            action={
              isAdmin ? (
                <Button type="button" size="lg" onClick={openCreatePanel}>
                  <UserPlus aria-hidden />
                  Add your first person
                </Button>
              ) : undefined
            }
          />
        ) : filteredMembers.length === 0 ? (
          <EmptyState
            compact
            icon={Search}
            title={search.trim() ? `No one matches “${search.trim()}”` : "No one here"}
            description={
              search.trim()
                ? "Check the spelling, or search by phone number or email."
                : "No one in your church fits this filter right now."
            }
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Show everyone
              </Button>
            }
          />
        ) : (
          <List label="People">
            {filteredMembers.map((member) => {
              const status = personStatus(member, isOnApp(member.id));
              const hasPhone = Boolean(member.phone?.trim());
              return (
                <ListRow
                  key={member.id}
                  onClick={() => openMemberPanel(member)}
                  selected={openId === member.id}
                  className={cn(!member.is_active && "opacity-75")}
                  leading={
                    <span
                      className="flex size-12 items-center justify-center overflow-hidden rounded-full bg-primary/[0.08] font-heading text-base font-bold text-primary dark:bg-accent/15 dark:text-accent"
                      aria-hidden
                    >
                      <ProfileAvatar
                        url={appPhotos[member.id] ?? member.photo_url}
                        initials={getInitials(member.first_name, member.last_name)}
                      />
                    </span>
                  }
                  title={fullName(member)}
                  subtitle={
                    <span className={cn(!hasPhone && "text-amber-800 dark:text-amber-300")}>
                      {personContext(member)}
                    </span>
                  }
                  status={
                    status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : undefined
                  }
                />
              );
            })}
          </List>
        )}
      </section>

      {isAdmin ? (
        <div className="fixed bottom-20 left-0 right-0 z-40 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:hidden">
          <Button
            type="button"
            size="lg"
            className="mx-auto h-14 w-full max-w-2xl text-base"
            onClick={openCreatePanel}
          >
            <Plus aria-hidden />
            Add person
          </Button>
        </div>
      ) : null}

      {panelOpen ? (
        <>
          {/*
            The panel slides over the list at every width instead of squeezing
            it: inside the shell's max-w-6xl there is no room for a readable
            list and a readable form side by side, and a list that narrows
            whenever someone is opened is a list that jumps.
          */}
          <div
            aria-hidden
            onClick={closePanel}
            className="fixed inset-0 z-50 bg-brand-navy/40 motion-safe:animate-in motion-safe:fade-in-0"
          />
          <aside
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="person-panel-title"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col overflow-y-auto outline-none border-l border-border bg-card shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-right-8 motion-safe:duration-200"
          >
            <div className="p-6 sm:p-8">
              <MemberFormPanel
                key={panelKey}
                member={panelMode === "edit" ? selectedMember : null}
                isAdmin={isAdmin}
                onClose={closePanel}
                onSaved={handleSaved}
                onDeactivated={handleDeactivated}
                onReactivated={handleReactivated}
                justAdded={Boolean(
                  justAddedId && selectedMember?.id === justAddedId,
                )}
                onAddAnother={openCreatePanel}
                showAppStatus={showAppStatus}
                appConnection={
                  panelMode === "edit" && selectedMember
                    ? appConnections[selectedMember.id] ?? null
                    : null
                }
                photoUrl={
                  panelMode === "edit" && selectedMember
                    ? appPhotos[selectedMember.id] ?? null
                    : null
                }
                moveTargets={members.filter(
                  (member) =>
                    member.is_active &&
                    member.id !== selectedMember?.id &&
                    !appConnections[member.id],
                )}
                onAppConnectionMoved={closePanel}
              />
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
