"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CalendarDays, History, Inbox, Info, MapPin, MessageCircle, Pencil, Settings2, ShieldCheck, UsersRound, type LucideIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { StaffGroupDetail } from "@/lib/groups/staff/groups";
import { lifecycle } from "@/app/dashboard/groups/actions";
import { cn } from "@/lib/utils";
import { Avatar, BackLink, base, Field, GroupAvatar, Modal, Notice, Pill, Tag, useGroupAction } from "./shared";
import { enrollmentLabel, peopleCount, roleLabel, visibilityLabel } from "./labels";

type Tab = { slug: string; title: string; icon: LucideIcon; count?: number };

/** The group's section links: four everyday tabs, then a labelled "More" row. Shared with the loading skeleton. */
export function GroupTabs({ groupId, groupName, tab, requests = 0 }: { groupId: string; groupName: string; tab: string; requests?: number }) {
  const main: Tab[] = [
    { slug: "members", title: "Members", icon: UsersRound },
    { slug: "chat", title: "Chat", icon: MessageCircle },
    { slug: "gatherings", title: "Meetings", icon: CalendarDays },
    { slug: "overview", title: "About", icon: Info },
  ];
  const more: Tab[] = [
    { slug: "requests", title: "Join requests", icon: Inbox, count: requests },
    { slug: "settings", title: "Group settings", icon: Settings2 },
  ];
  const link = (t: Tab, quiet: boolean) => <Link key={t.slug} href={`${base}/${groupId}/${t.slug}`} aria-current={tab === t.slug ? "page" : undefined} className={cn(quiet ? "g-more-link" : "g-tab", tab === t.slug && "is-active")}>
    <t.icon className="size-5" aria-hidden />{t.title}{!!t.count && <span className="g-count" aria-label={`${t.count} waiting`}>{t.count}</span>}
  </Link>;
  return <div className="g-nav">
    <nav className="g-tabs" aria-label={`${groupName} sections`}>{main.map(t => link(t, false))}</nav>
    <nav className="g-more" aria-label={`More for ${groupName}`}><span className="g-more-label">More:</span>{more.map(t => link(t, true))}</nav>
  </div>;
}

/**
 * One group: a calm header with the group's one main action (Message group),
 * four everyday tabs, and a labelled "More" row for requests and settings.
 */
export function GroupDetailShell({ detail, tab, children }: { detail: StaffGroupDetail; tab: string; children: ReactNode }) {
  const g = detail.group;
  const archived = g.status !== "active";
  const href = (slug: string) => `${base}/${g.id}/${slug}`;

  return <div className="flex w-full flex-col gap-6">
    <BackLink />
    <header className="g-group-header">
      <GroupAvatar name={g.name} url={g.cover_image_url} size={88} />
      <div className="min-w-0 flex-1 space-y-2">
        <h1 className="g-group-title">{g.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {archived && <Pill>Archived</Pill>}
          {detail.type && <Tag>{detail.type.name}</Tag>}
          {g.safety_profile === "youth" && <Tag><ShieldCheck className="size-4" aria-hidden />Youth protections on</Tag>}
        </div>
        <p className="text-[15px] text-muted-foreground">{peopleCount(g.member_count)}{detail.campus && ` · ${detail.campus.name}`} · {enrollmentLabel(g.enrollment)}</p>
      </div>
      <div className="g-group-actions">
        <div className="flex flex-wrap gap-3">
          {!archived && <Link href={href("settings")} className={buttonVariants({ variant: "outline", size: "lg" })}><Pencil className="size-5" aria-hidden />Edit group</Link>}
          <Link href={href("chat")} className={buttonVariants({ variant: archived ? "outline" : "default", size: "lg" })}>
            {archived ? <History className="size-5" aria-hidden /> : <MessageCircle className="size-5" aria-hidden />}{archived ? "Read chat history" : "Message group"}
          </Link>
        </div>
        {!archived && <p className="text-sm text-muted-foreground">Members on the app will see your message.</p>}
      </div>
    </header>
    {archived && <Notice tone="info">This group is archived. Members can still read its chat history. Restore it in Group settings to add people and plan meetings again.</Notice>}
    <GroupTabs groupId={g.id} groupName={g.name} tab={tab} requests={g.pending_request_count} />
    <div>{children}</div>
  </div>;
}

export function GroupOverview({ detail, children }: { detail: StaffGroupDetail; children?: ReactNode }) {
  const g = detail.group;
  const schedule = detail.schedules.find(s => s.isActive)?.description;
  return <div className="g-detail-grid">
    <div className="space-y-6">
      <section className="g-panel space-y-5" aria-labelledby="about-title">
        <h2 id="about-title">About this group</h2>
        <p className="whitespace-pre-wrap text-base leading-7 text-muted-foreground">{g.description || "No description yet. Add one in Group settings so people know who it’s for."}</p>
        <dl className="g-facts">
          <div><dt>Who can find it</dt><dd>{visibilityLabel(g.visibility)}</dd></div>
          <div><dt>How people join</dt><dd>{enrollmentLabel(g.enrollment)}</dd></div>
          <div><dt>Size</dt><dd>{g.capacity ? `${peopleCount(g.member_count)} of ${g.capacity} (${Math.max(0, g.capacity - g.member_count)} spots left)` : `${peopleCount(g.member_count)}, no limit`}</dd></div>
          <div><dt>Youth protections</dt><dd>{g.safety_profile === "youth" ? "On: no private messages" : "Off"}</dd></div>
        </dl>
      </section>
      {children}
    </div>
    <aside className="space-y-6">
      <section className="g-panel" aria-labelledby="leaders-title">
        <h2 id="leaders-title">Leaders</h2>
        {detail.leaders.length ? <ul className="mt-2">{detail.leaders.map(l => <li className="g-row" key={l.membershipId}><span className="flex items-center gap-3"><Avatar name={l.name} /><span><strong className="g-row-title">{l.name}</strong><span className="g-row-sub block">{roleLabel(l.role)}</span></span></span></li>)}</ul>
          : <p className="g-row-sub mt-3">No leader yet. Choose one on the <Link className="underline underline-offset-4" href={`${base}/${g.id}/members`}>Members</Link> tab.</p>}
      </section>
      <section className="g-panel space-y-4" aria-labelledby="where-title">
        <h2 id="where-title">When and where</h2>
        <p className="g-meta"><CalendarDays aria-hidden />{schedule ?? "No regular meeting time yet"}</p>
        <p className="g-meta"><MapPin aria-hidden />{g.location_name ?? "No meeting place yet"}</p>
        {g.location_address && <p className="text-[15px] leading-6 text-muted-foreground">{g.location_address}<br />{g.location_visibility === "members" ? "Only group members see this address." : "Everyone who can see the group sees this address."}</p>}
        {g.online_meeting_url && <a className="g-text-link" href={g.online_meeting_url} target="_blank" rel="noopener noreferrer">Open the online meeting link</a>}
      </section>
    </aside>
  </div>;
}

export function GroupLifecycle({ detail }: { detail: StaffGroupDetail }) {
  const [intent, setIntent] = useState<"active" | "archived" | "deleted" | null>(null); const { pending, error, run } = useGroupAction(); const router = useRouter();
  const name = detail.group.name;
  const archived = detail.group.status === "archived";
  return <section className="g-panel space-y-4" aria-labelledby="lifecycle-title">
    <h2 id="lifecycle-title">{archived ? "Restore or delete" : "Archive this group"}</h2>
    <p className="g-row-sub">Archiving keeps the group’s history and makes its chat read-only. You can restore it later.</p>
    <div className="flex flex-wrap gap-3">{!archived ? <Button variant="outline" onClick={() => setIntent("archived")}>Archive group</Button> : <><Button onClick={() => setIntent("active")}>Restore group</Button><Button variant="destructive" onClick={() => setIntent("deleted")}>Delete group forever</Button></>}</div>
    <Modal open={!!intent} onClose={() => setIntent(null)} title={intent === "deleted" ? `Delete ${name} forever?` : intent === "archived" ? `Archive ${name}?` : `Restore ${name}?`} description={intent === "deleted" ? "The group and its chat will be removed for good. This can’t be undone." : intent === "archived" ? "Upcoming meetings will be cancelled. Members can still read the chat history." : "Members can take part again. Check the meeting times to plan what’s next."}>
      <form onSubmit={e => { e.preventDefault(); const typed = String(new FormData(e.currentTarget).get("confirmation") ?? ""); if (intent) run(() => lifecycle(detail.group.id, intent, typed), intent === "deleted" ? `${name} deleted.` : intent === "archived" ? `${name} archived.` : `${name} restored.`, () => { setIntent(null); router.push(intent === "active" ? `${base}/${detail.group.id}` : base); }); }}>
        {intent === "deleted" && <Field label={`Type “${name}” to confirm`}><input autoFocus name="confirmation" required autoComplete="off" /></Field>}
        {error && <Notice>{error}</Notice>}
        <div className="g-form-actions"><Button type="button" variant="ghost" onClick={() => setIntent(null)} disabled={pending}>Go back</Button><Button type="submit" variant={intent === "deleted" ? "destructive" : "default"} disabled={pending}>{pending ? "Working…" : intent === "deleted" ? "Delete group forever" : intent === "archived" ? "Archive group" : "Restore group"}</Button></div>
      </form>
    </Modal>
  </section>;
}
