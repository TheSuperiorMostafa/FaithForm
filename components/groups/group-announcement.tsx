"use client";

import { useId, useRef, useState } from "react";
import { Plus, Send } from "lucide-react";
import { StreamChat } from "stream-chat";
import { toast } from "sonner";
import type { StaffGroupListItem } from "@/lib/groups/staff/groups";
import type { ChatSessionDto } from "@/lib/messaging/session";
import { Button } from "@/components/ui/button";
import { SearchPicker } from "@/components/ui/search-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { toUserError } from "@/lib/errors/user-error";
import { deliverGroupAnnouncement } from "@/lib/groups/announcement-delivery";

async function session(): Promise<ChatSessionDto> {
  const response = await fetch("/api/dashboard/messaging/token", { method: "POST", credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("messaging_unavailable");
  return response.json();
}

/** Uses the staff member's own chat credential: the provider enforces church reach. */
export function GroupAnnouncement({ groups }: { groups: StaffGroupListItem[] }) {
  const titleId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep provider message IDs across retries, including an ambiguous network timeout.
  const batch = useRef<string | null>(null);
  const ready = groups.filter(group => group.status === "active" && group.chatState === "ready");
  const send = async () => {
    if (pending || !message.trim() || !selected.length) return;
    const targets = ready.filter(group => selected.includes(group.id));
    if (targets.length !== selected.length) { setError("One of these groups is no longer available. Choose the groups again."); return; }
    if (!(await confirmAction({ title: "Send this group announcement?", description: `This message will appear in ${targets.map(group => group.name).join(", ")}. Members on the app can receive a notification according to their notification settings.`, confirmLabel: `Send to ${targets.length} ${targets.length === 1 ? "group" : "groups"}` }))) return;
    setPending(true); setError(null);
    batch.current ??= crypto.randomUUID();
    let client: StreamChat | null = null;
    const sent = new Set<string>();
    try {
      const auth = await session();
      if (auth.suspended) throw new Error("messaging_suspended");
      client = new StreamChat(auth.appKey);
      await client.connectUser({ id: auth.chatUserId }, async () => (await session()).userToken);
      const connected = client;
      const delivery = await deliverGroupAnnouncement(batch.current, targets.map(group => group.id), message.trim(), (groupId, payload) => connected.channel("ff_group", `grp_${groupId.replace(/-/g, "")}`).sendMessage(payload));
      delivery.sent.forEach(id => sent.add(id));
      if (delivery.failed) throw new Error("announcement_incomplete");
      toast.success(`Announcement sent to ${sent.size} ${sent.size === 1 ? "group" : "groups"}.`);
      setOpen(false); setMessage(""); setSelected([]); batch.current = null;
    } catch (cause) {
      setSelected(ids => ids.filter(id => !sent.has(id)));
      setError(sent.size ? `Sent to ${sent.size} ${sent.size === 1 ? "group" : "groups"}. The remaining groups are still selected. Try again to finish sending.` : toUserError(cause, "We couldn't send this announcement. Please try again."));
    } finally {
      await client?.disconnectUser().catch(() => undefined);
      setPending(false);
    }
  };
  return <>
    <Button size="lg" variant="outline" onClick={() => setOpen(true)}><Plus className="size-5" aria-hidden />Send a message</Button>
    <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}>
      <DialogContent aria-labelledby={titleId} aria-describedby={descriptionId} className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-xl">
        <DialogHeader className="shrink-0 pr-14"><DialogTitle id={titleId}>Send a message</DialogTitle><DialogDescription id={descriptionId}>Choose groups and write a message. Members on the app can receive a notification.</DialogDescription></DialogHeader>
        <div className="min-h-0 flex-auto space-y-5 overflow-y-auto px-6 py-4">
          {ready.length ? <SearchPicker items={ready.map(group => ({ id: group.id, label: group.name, description: `${group.memberCount} people` }))} value={selected} onChange={ids => { if (!pending) setSelected(ids); }} multiple label="To" placeholder="Search groups" emptyText="No available groups match." showAllWhenEmpty /> : <p>There are no active groups with Messaging available. Turn on chat in Group settings first.</p>}
          <label className="block space-y-2"><span className="font-medium">Message</span><textarea className="min-h-36 w-full rounded-xl border bg-background p-3 text-base" maxLength={5000} value={message} disabled={pending} onChange={event => { setMessage(event.target.value); batch.current = null; }} placeholder="Type a message…" /></label>
          <p className="text-right text-sm text-muted-foreground">{message.length}/5000</p>
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </div>
        <DialogFooter className="shrink-0"><Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button><Button onClick={() => void send()} disabled={pending || !message.trim() || !selected.length}><Send className="size-5" aria-hidden />{pending ? "Sending…" : "Send message"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
