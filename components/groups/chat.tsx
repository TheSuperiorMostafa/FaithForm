"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StreamChat, type Channel as StreamChannel } from "stream-chat";
import { Chat, Channel, ChannelHeader, MessageComposer, MessageList, Thread, Window } from "stream-chat-react";
import { Eye, RotateCcw, Search } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatSessionDto } from "@/lib/messaging/session";
import type { StaffGroupListItem } from "@/lib/groups/staff/groups";
import { markRead } from "@/app/dashboard/groups/actions";
import { cn } from "@/lib/utils";
import { base, Empty, GroupAvatar, Notice } from "./shared";
import { peopleCount, reachSentence } from "./labels";
import "stream-chat-react/dist/css/index.css";

async function session(): Promise<ChatSessionDto> {
  const response = await fetch("/api/dashboard/messaging/token", { method: "POST", credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("unavailable");
  return response.json();
}

/** Who a message here reaches, said before anyone types. */
function Reach({ reach, readOnly }: { reach?: { onApp: number; total: number } | null; readOnly: boolean }) {
  if (readOnly) return <Notice tone="info">This chat is read-only. You can read its history, but no one can send new messages.</Notice>;
  return <div className="g-reach" role="note"><Eye className="size-5 shrink-0" aria-hidden /><p><strong>Members on the app will see this.</strong> {reach ? reachSentence(reach.onApp, reach.total) : "People who aren’t on the app won’t get it."}</p></div>;
}

export function GroupChat({ cid, groupId, state, reach }: { cid: string | null; groupId: string; state: string; reach?: { onApp: number; total: number } | null }) {
  const { resolved } = useTheme();
  const [connected, setConnected] = useState<{ client: StreamChat; channel: StreamChannel; suspended: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null); const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!cid || state === "unavailable") return;
    let cancelled = false; let client: StreamChat | null = null;
    setConnected(null); setError(null);
    const connect = async () => {
      try {
        const auth = await session(); if (cancelled) return;
        client = new StreamChat(auth.appKey);
        await client.connectUser({ id: auth.chatUserId }, async () => (await session()).userToken);
        if (cancelled) return;
        const separator = cid.indexOf(":");
        const channel = client.channel(cid.slice(0, separator), cid.slice(separator + 1));
        await channel.watch();
        if (!cancelled) { setConnected({ client, channel, suspended: auth.suspended }); void markRead(groupId); }
      } catch { if (!cancelled) setError("We couldn’t open this chat. The group is fine, and nothing was lost."); }
    };
    const task = connect();
    return () => { cancelled = true; void task.finally(async () => { await client?.disconnectUser().catch(() => undefined); }); };
  }, [cid, groupId, state, retry]);

  if (!cid || state === "unavailable") return <Empty icon="messages" compact title="Chat isn’t available for this group" description="Group chat is turned off for this group or for your church, or it’s still being set up. You can turn it on in Group settings." />;
  if (error) return <div className="space-y-4"><Reach reach={reach} readOnly={state === "read_only"} /><Empty icon="messages" compact title="This chat didn’t open" description={error}><Button onClick={() => setRetry(r => r + 1)}><RotateCcw className="size-5" aria-hidden />Try again</Button></Empty></div>;
  const readOnly = state === "read_only" || Boolean(connected?.suspended);
  return <div className="flex min-w-0 flex-col gap-4">
    <Reach reach={reach} readOnly={readOnly} />
    {!connected
      ? <div className="g-chat g-chat-loading" role="status" aria-label="Opening the chat"><Skeleton className="h-14 w-full rounded-none" /><div className="flex-1 space-y-4 p-6"><Skeleton className="h-12 w-2/3 rounded-2xl" /><Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" /><Skeleton className="h-12 w-3/5 rounded-2xl" /></div><Skeleton className="h-16 w-full rounded-none" /><span className="sr-only">Opening the chat…</span></div>
      : <div className="g-chat"><Chat client={connected.client} theme={`str-chat__theme-${resolved}`}><Channel channel={connected.channel}><Window><ChannelHeader /><MessageList messageActions={["edit", "delete", "react", "reply", "quote", "flag", "pin"]} />{readOnly ? <p className="bg-muted px-5 py-4 text-center text-[15px] text-muted-foreground">This chat is read-only. You can still read its history.</p> : <MessageComposer />}</Window><Thread /></Channel></Chat></div>}
  </div>;
}

/**
 * Every group chat in one place. Groups whose chat can be used come first;
 * read-only ones (archived, or chat turned off) are labelled; groups with no
 * chat at all are left out and counted, so nothing looks broken.
 */
export function Messages({ groups }: { groups: StaffGroupListItem[] }) {
  const [selected, setSelected] = useState<string | null>(null); const [query, setQuery] = useState("");
  const matches = (g: StaffGroupListItem) => g.name.toLowerCase().includes(query.trim().toLowerCase());
  const ready = groups.filter(g => g.chatState === "ready" && matches(g));
  const readOnly = groups.filter(g => g.chatState === "read_only" && matches(g));
  const hidden = groups.filter(g => g.chatState === "unavailable").length;
  const group = groups.find(g => g.id === selected && g.chatState !== "unavailable");

  if (!groups.some(g => g.chatState !== "unavailable")) {
    return <Empty icon="messages" title="No group chats yet" description={groups.length ? "Chat is turned off for your groups, or it’s still being set up. You can turn it on in each group’s settings." : "Create a group first. Each group gets its own chat in the app."} />;
  }

  const row = (g: StaffGroupListItem) => <li key={g.id}><button type="button" aria-pressed={g.id === selected} onClick={() => setSelected(g.id)} className="g-inbox-row">
    <GroupAvatar name={g.name} url={g.coverImageUrl} size={44} />
    <span className="min-w-0 flex-1"><strong className="block truncate text-base">{g.name}</strong><span className="mt-0.5 block text-sm text-muted-foreground">{peopleCount(g.memberCount)}{g.chatState === "read_only" ? (g.status === "archived" ? " · Archived, read-only" : " · Chat off, read-only") : ""}</span></span>
    {g.hasUnseenActivity && <span className="g-new">New</span>}
  </button></li>;

  return <div className="g-inbox">
    <aside className="g-inbox-list" aria-label="Group chats">
      <label className="g-search w-full max-w-none"><Search aria-hidden /><span className="sr-only">Find a group</span><input type="search" placeholder="Find a group" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {ready.length > 0 && <ul className="mt-3 space-y-1">{ready.map(row)}</ul>}
      {readOnly.length > 0 && <><p className="g-inbox-heading">Read-only</p><ul className="space-y-1">{readOnly.map(row)}</ul></>}
      {!ready.length && !readOnly.length && <p className="p-4 text-[15px] text-muted-foreground">No group by that name.</p>}
      {hidden > 0 && <p className="px-3 pt-4 text-sm text-muted-foreground">{hidden} {hidden === 1 ? "group has" : "groups have"} no chat and {hidden === 1 ? "isn’t" : "aren’t"} listed.</p>}
    </aside>
    <div className={cn("min-w-0 p-4 sm:p-6", !group && "flex items-center justify-center")}>
      {group ? <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-heading text-xl font-bold">{group.name}</h2><Link className="g-text-link" href={`${base}/${group.id}/members`}>See who’s in it</Link></div><GroupChat key={group.id} groupId={group.id} cid={`ff_group:grp_${group.id.replace(/-/g, "")}`} state={group.chatState} /></div>
        : <Empty icon="messages" compact title="Choose a group" description="Pick a group on the left to read and send messages. Members on the app will see what you send." />}
    </div>
  </div>;
}
