"use client";
import { useEffect, useState } from "react";
import { StreamChat, type Channel as StreamChannel } from "stream-chat";
import { Chat, Channel, ChannelHeader, MessageComposer, MessageList, Thread, Window } from "stream-chat-react";
import { MessageCircle, Search } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import type { ChatSessionDto } from "@/lib/messaging/session";
import type { StaffGroupListItem } from "@/lib/groups/staff/groups";
import { markRead } from "@/app/dashboard/groups/actions";
import { Empty, GroupAvatar, PageHeading } from "./shared";
import "stream-chat-react/dist/css/index.css";

async function session(): Promise<ChatSessionDto> {
  const response = await fetch("/api/dashboard/messaging/token", { method: "POST", credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Messages are unavailable right now. Please try again in a moment.");
  return response.json();
}
export function GroupChat({ cid, groupId, state }: { cid: string | null; groupId: string; state: string }) {
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
      } catch { if (!cancelled) setError("We couldn’t connect to the conversation. Your group is still available."); }
    };
    const task = connect();
    return () => { cancelled = true; void task.finally(async () => { await client?.disconnectUser().catch(() => undefined); }); };
  }, [cid, groupId, state, retry]);
  if (!cid || state === "unavailable") return <Empty icon="messages" title="A conversation is on its way" description="Chat is switched off or is still connecting for this group. You can continue managing people and gatherings." />;
  if (error) return <Empty icon="messages" title="Let’s reconnect" description={error}><Button onClick={() => setRetry(r => r + 1)}>Try again</Button></Empty>;
  if (!connected) return <div className="g-empty" role="status"><MessageCircle className="mx-auto mb-4 size-7 animate-pulse text-muted-foreground" /><p>Connecting your conversation…</p></div>;
  return <div className="g-chat"><Chat client={connected.client} theme={`str-chat__theme-${resolved}`}><Channel channel={connected.channel}><Window><ChannelHeader /><MessageList messageActions={["edit", "delete", "react", "reply", "quote", "flag", "pin"]} />{state === "read_only" || connected.suspended ? <p className="bg-muted px-5 py-4 text-center text-sm text-muted-foreground">This conversation is read-only. You can still read its history.</p> : <MessageComposer />}</Window><Thread /></Channel></Chat></div>;
}
export function Messages({ groups }: { groups: StaffGroupListItem[] }) {
  const [selected, setSelected] = useState<string | null>(null); const [query, setQuery] = useState("");
  const group = groups.find(g => g.id === selected); const filtered = groups.filter(g => g.name.toLowerCase().includes(query.toLowerCase()));
  return <><PageHeading title="Keep the connection going." description="All your group conversations, in one familiar place." /><div className="g-inbox"><aside className="g-inbox-list"><label className="g-search mb-3 block"><Search /><span className="sr-only">Find a conversation</span><input placeholder="Find a group…" value={query} onChange={e => setQuery(e.target.value)} /></label>{filtered.length ? filtered.map(g => <button key={g.id} aria-pressed={g.id === selected} onClick={() => setSelected(g.id)}><GroupAvatar name={g.name} url={g.coverImageUrl} size={42} /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{g.name}</strong><span className="mt-1 block text-xs text-muted-foreground">{g.memberCount} members{g.chatState === "unavailable" ? " · Chat unavailable" : g.chatState === "read_only" ? " · Read-only" : ""}</span></span>{g.hasUnseenActivity && <span className="mt-1 size-2 shrink-0 rounded-full bg-brand-gold" aria-label="New activity" />}</button>) : <p className="p-4 text-sm text-muted-foreground">No matching conversations.</p>}</aside>{group ? <GroupChat key={group.id} groupId={group.id} cid={`ff_group:grp_${group.id.replace(/-/g, "")}`} state={group.chatState} /> : <div className="flex items-center justify-center p-6"><Empty icon="messages" title="A little conversation goes a long way" description="Choose a group to catch up, share encouragement, or make plans together." /></div>}</div></>;
}
