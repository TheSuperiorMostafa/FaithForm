"use client";
import { usePathname } from "next/navigation";
import { CalendarPlus, MessageCircle, Pencil, Plus, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { BackLink, base, GroupsNav } from "./shared";
import { GroupTabs } from "./group-detail";
import { GROUPS_SECTIONS, type GroupsSection } from "./sections";

/**
 * Loading states for every Groups route. The catch-all route has one
 * loading.tsx, so this reads the path and draws the matching layout: same
 * roots, header, links, grids and paddings as the real page. Titles, tab
 * labels and buttons are real text; only data shimmers.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTION_BY_PATH: Record<string, GroupsSection> = { "": "list", messages: "messages", requests: "requests", insights: "insights", moderation: "moderation", settings: "settings" };

export function GroupsSkeleton() {
  const path = usePathname() ?? base;
  const [first = "", second] = path.replace(/^\/dashboard\/groups\/?/, "").split("/");
  if (UUID.test(first)) return <GroupDetailSkeleton groupId={first} tab={second || "members"} />;
  return <SectionSkeleton section={SECTION_BY_PATH[first] ?? "list"} />;
}

function StaticButton({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "outline" }) {
  return <Button size="lg" variant={variant} disabled tabIndex={-1} aria-hidden>{children}</Button>;
}

function Rows({ count = 3, action = true }: { count?: number; action?: boolean }) {
  return <ul className="g-list">{Array.from({ length: count }).map((_, i) => <li key={i} className="g-list-row">
    <div className="flex min-w-0 flex-1 items-center gap-4"><Skeleton className="size-11 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-72 max-w-full" /></div></div>
    {action && <div className="flex gap-2"><Skeleton className="h-11 w-28 rounded-[10px]" /><Skeleton className="h-11 w-28 rounded-[10px]" /></div>}
  </li>)}</ul>;
}

function SectionSkeleton({ section }: { section: GroupsSection }) {
  const copy = GROUPS_SECTIONS[section];
  return <SkeletonContainer label={copy.title.toLowerCase()} className="flex w-full flex-col gap-8">
    <PageHeader title={copy.title} description={copy.description} action={section === "list" ? <StaticButton><Plus className="size-5" aria-hidden />Create group</StaticButton> : undefined} />
    <GroupsNav />
    {section === "list" && <ListBody />}
    {section === "messages" && <div className="g-inbox">
      <aside className="g-inbox-list"><label className="g-search w-full max-w-none"><Search aria-hidden /><input type="search" disabled placeholder="Find a group" aria-hidden tabIndex={-1} /></label><ul className="mt-3 space-y-1">{Array.from({ length: 6 }).map((_, i) => <li key={i} className="g-inbox-row"><Skeleton className="size-11 rounded-[13px]" /><span className="flex-1 space-y-2"><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-24" /></span></li>)}</ul></aside>
      <div className="flex items-center justify-center p-6"><Skeleton className="h-40 w-full max-w-md rounded-2xl" /></div>
    </div>}
    {section === "requests" && <Rows />}
    {section === "moderation" && <div className="flex flex-col gap-6"><div className="g-toolbar"><div className="g-segment"><button type="button" className="is-active" disabled>Needs review</button><button type="button" disabled>Handled</button></div><p className="text-[15px] text-muted-foreground">Only church staff can see this page.</p></div><Rows action={false} /></div>}
    {section === "insights" && <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{["People in groups", "Joined a group", "Average attendance", "Showed up"].map(t => <div key={t} className="g-stat"><span>{t}</span><Skeleton className="my-2.5 h-8 w-16" /><Skeleton className="h-4 w-40" /></div>)}</div>
      <section className="g-panel space-y-5"><div><h2>Attendance each week</h2><p className="g-row-sub">The last 12 weeks, members and guests together.</p></div><Skeleton className="h-[190px] w-full rounded-xl" /></section>
    </div>}
    {section === "settings" && <div className="g-detail-grid">
      <div className="space-y-6"><section className="g-panel space-y-4"><h2>Messages in the app</h2><p className="g-row-sub">These apply to every group. A group can be stricter in its own settings.</p>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</section><section className="g-panel space-y-4"><h2>Kinds of groups</h2>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</section></div>
      <aside className="space-y-6"><section className="g-panel space-y-3"><Skeleton className="h-28 w-full" /></section><section className="g-panel space-y-3"><h2>Is chat up to date?</h2><Skeleton className="h-5 w-full" /></section></aside>
    </div>}
  </SkeletonContainer>;
}

function ListBody() {
  return <div className="flex flex-col gap-6">
    <dl className="g-summary">{["Active groups", "People in groups", "Group leaders"].map(t => <div key={t}><dt>{t}</dt><dd><Skeleton className="mt-1 h-[30px] w-14" /></dd></div>)}</dl>
    <div className="g-toolbar">
      <div className="g-segment">{["Active", "Waiting to join", "Archived"].map((t, i) => <button type="button" key={t} disabled className={i === 0 ? "is-active" : undefined}>{t} <Skeleton className="h-4 w-4" /></button>)}</div>
      <div className="flex flex-1 flex-wrap justify-end gap-3"><label className="g-search"><Search aria-hidden /><input type="search" disabled placeholder="Search groups or leaders" aria-hidden tabIndex={-1} /></label><label className="g-select-inline"><select disabled aria-hidden tabIndex={-1}><option>All kinds of groups</option></select></label></div>
    </div>
    <ul className="g-grid">{Array.from({ length: 6 }).map((_, i) => <li key={i}><div className="g-group-card">
      <div className="g-card-head"><Skeleton className="size-16 rounded-[19px]" /><div className="flex-1 space-y-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-6 w-24 rounded-full" /></div></div>
      <ul className="g-card-meta">{["w-32", "w-44", "w-36"].map(w => <li key={w}><Skeleton className={`h-5 ${w}`} /></li>)}</ul>
    </div></li>)}</ul>
  </div>;
}

function GroupDetailSkeleton({ groupId, tab }: { groupId: string; tab: string }) {
  return <SkeletonContainer label="group" className="flex w-full flex-col gap-6">
    <BackLink />
    <header className="g-group-header">
      <Skeleton className="size-[88px] rounded-[26px]" />
      <div className="min-w-0 flex-1 space-y-3"><Skeleton className="h-9 w-64 max-w-full" /><Skeleton className="h-7 w-28 rounded-full" /><Skeleton className="h-5 w-56" /></div>
      <div className="g-group-actions"><div className="flex flex-wrap gap-3"><StaticButton variant="outline"><Pencil className="size-5" aria-hidden />Edit group</StaticButton><StaticButton><MessageCircle className="size-5" aria-hidden />Message group</StaticButton></div><p className="text-sm text-muted-foreground">Members on the app will see your message.</p></div>
    </header>
    <GroupTabs groupId={groupId} groupName="Group" tab={tab} />
    <div>
      {tab === "members" && <div className="space-y-6">
        <div className="g-toolbar"><label className="g-search"><Search aria-hidden /><input type="search" disabled placeholder="Find someone in this group" aria-hidden tabIndex={-1} /></label><StaticButton><UserPlus className="size-5" aria-hidden />Add people</StaticButton></div>
        <Skeleton className="h-5 w-52" />
        <div className="g-panel g-table-wrap"><table className="g-table"><thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Recent meetings</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead><tbody>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td><div className="flex items-center gap-3"><Skeleton className="size-11 rounded-full" /><div className="space-y-2"><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-48" /></div></div></td><td><Skeleton className="h-12 w-36 rounded-xl" /></td><td><Skeleton className="h-5 w-28" /></td><td><Skeleton className="ml-auto h-11 w-24 rounded-[10px]" /></td></tr>)}</tbody></table></div>
      </div>}
      {tab === "chat" && <div className="flex flex-col gap-4"><Skeleton className="h-[54px] w-full rounded-[14px]" /><div className="g-chat"><Skeleton className="h-14 w-full rounded-none" /><div className="flex-1 space-y-4 p-6"><Skeleton className="h-12 w-2/3 rounded-2xl" /><Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" /><Skeleton className="h-12 w-3/5 rounded-2xl" /></div><Skeleton className="h-16 w-full rounded-none" /></div></div>}
      {tab === "gatherings" && <div className="flex flex-col gap-8"><div className="flex flex-col gap-6"><div className="g-toolbar"><div className="g-segment"><button type="button" className="is-active" disabled>Coming up</button><button type="button" disabled>Past meetings</button></div><StaticButton><CalendarPlus className="size-5" aria-hidden />Plan a meeting</StaticButton></div><Rows /></div><section className="g-panel space-y-2"><h2>Regular meeting time</h2><p className="g-row-sub">Set a repeating time and the next meetings are added for you.</p><Skeleton className="mt-3 h-14 w-full" /></section></div>}
      {tab === "overview" && <div className="g-detail-grid"><div className="space-y-6"><section className="g-panel space-y-5"><h2>About this group</h2><Skeleton className="h-20 w-full" /><Skeleton className="h-24 w-full" /></section><section className="g-panel space-y-4"><h2>Invite links</h2><Skeleton className="h-28 w-full" /></section></div><aside className="space-y-6"><section className="g-panel space-y-3"><h2>Leaders</h2><Skeleton className="h-14 w-full" /></section><section className="g-panel space-y-3"><h2>When and where</h2><Skeleton className="h-5 w-48" /><Skeleton className="h-5 w-40" /></section></aside></div>}
      {tab === "requests" && <Rows count={2} />}
      {tab === "settings" && <div className="flex flex-col gap-8"><section className="g-panel space-y-4"><h2>Group photo</h2><Skeleton className="h-40 w-full" /></section><section className="g-panel space-y-5"><h2>The basics</h2>{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</section></div>}
    </div>
  </SkeletonContainer>;
}
