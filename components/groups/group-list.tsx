"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarDays, Inbox, Search, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import type { StaffGroupListItem, StaffGroupType } from "@/lib/groups/staff/groups";
import type { ChurchGroupSummary } from "@/lib/groups/staff/insights";
import { cn } from "@/lib/utils";
import { base, Empty, GroupAvatar, Pill, Tag, TextLink } from "./shared";
import { CreateGroupButton } from "./group-form";
import { peopleCount } from "./labels";

type Filter = "active" | "attention" | "archived";

export function GroupList({ groups, summary, types, campuses }: { groups: StaffGroupListItem[]; summary: ChurchGroupSummary; types: StaffGroupType[]; campuses: { id: string; name: string }[] }) {
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState<Filter>("active"); const [category, setCategory] = useState("");
  const active = groups.filter(g => g.status === "active");
  const counts: Record<Filter, number> = { active: active.length, attention: active.filter(g => g.pendingRequestCount > 0).length, archived: groups.length - active.length };
  const filtered = useMemo(() => groups.filter(g => (filter === "archived" ? g.status === "archived" : g.status === "active") && (filter !== "attention" || g.pendingRequestCount > 0) && (!category || g.type?.id === category) && `${g.name} ${g.leaders.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())), [groups, filter, category, query]);
  const searching = Boolean(query.trim() || category);

  return <div className="flex flex-col gap-6">
    <dl className="g-summary" aria-label="Groups at a glance">
      <div><dt>Active groups</dt><dd>{summary.activeGroups}</dd></div>
      <div><dt>People in groups</dt><dd>{summary.peopleInGroups}</dd></div>
      <div><dt>Group leaders</dt><dd>{summary.leaders}</dd></div>
    </dl>

    {summary.pendingRequests > 0 && <div className="g-callout"><span className="flex items-center gap-3"><Inbox className="size-6 shrink-0" aria-hidden /><span><strong>{peopleCount(summary.pendingRequests)}</strong> {summary.pendingRequests === 1 ? "has" : "have"} asked to join a group.</span></span><TextLink href={`${base}/requests`}>Review join requests</TextLink></div>}

    <div className="g-toolbar">
      <div className="g-segment" role="group" aria-label="Show">
        {([["active", "Active"], ["attention", "Waiting to join"], ["archived", "Archived"]] as const).map(([value, name]) => <button type="button" key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={cn(filter === value && "is-active")}>{name} <span className="g-segment-count">{counts[value]}</span></button>)}
      </div>
      <div className="flex flex-1 flex-wrap justify-end gap-3">
        <label className="g-search"><Search aria-hidden /><span className="sr-only">Search groups or leaders</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search groups or leaders" /></label>
        <label className="g-select-inline"><span className="sr-only">Show one kind of group</span><select value={category} onChange={e => setCategory(e.target.value)}><option value="">All kinds of groups</option>{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      </div>
    </div>

    <p className="sr-only" aria-live="polite">{filtered.length} {filtered.length === 1 ? "group" : "groups"} shown</p>

    {filtered.length ? <ul className="g-grid" aria-label="Groups">{filtered.map(g => <li key={g.id}><Link className="g-group-card" href={`${base}/${g.id}`}>
      <div className="g-card-head">
        <GroupAvatar name={g.name} url={g.coverImageUrl} size={64} />
        <div className="min-w-0 flex-1">
          <h2 className="g-card-title">{g.name}</h2>
          <div className="mt-1.5 flex flex-wrap gap-2">{g.type && <Tag>{g.type.name}</Tag>}{g.isYouth && <Tag><ShieldCheck className="size-4" aria-hidden />Youth</Tag>}</div>
        </div>
      </div>
      {(g.status === "archived" || g.pendingRequestCount > 0) && <div>{g.status === "archived" ? <Pill>Archived</Pill> : <Pill tone="attention">{peopleCount(g.pendingRequestCount)} asked to join</Pill>}</div>}
      <ul className="g-card-meta">
        <li><UsersRound aria-hidden />{peopleCount(g.memberCount)}{g.capacity !== null && ` · ${Math.max(0, g.capacity - g.memberCount)} spots left`}</li>
        <li><CalendarDays aria-hidden />{g.scheduleText ?? "No regular meeting time yet"}</li>
        <li><UserRound aria-hidden /><span className="truncate">{g.leaders.length ? `Led by ${g.leaders.join(" & ")}` : "No leader yet"}</span></li>
      </ul>
    </Link></li>)}</ul>
      : <Empty icon={searching ? "search" : "groups"}
          title={searching ? "No groups match" : filter === "archived" ? "No archived groups" : filter === "attention" ? "No one is waiting to join" : "No groups yet"}
          description={searching ? "Try another name, or show all kinds of groups." : filter === "active" ? "Groups are small groups, classes and teams. Create one and add its people in one step." : filter === "attention" ? "When someone asks to join a group, it shows up here." : "Groups you archive are kept here. You can restore them at any time."}>
          {filter === "active" && !searching && <CreateGroupButton types={types} campuses={campuses} label="Create your first group" />}
        </Empty>}
  </div>;
}
