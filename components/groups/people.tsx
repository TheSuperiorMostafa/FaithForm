"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Link2, Search, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { undoToast } from "@/lib/ui/undo-toast";
import type { StaffMemberRow, StaffRequestRow, listStaffBans, listStaffInvitations } from "@/lib/groups/staff/people";
import type { GroupRole } from "@/lib/groups/types";
import * as actions from "@/app/dashboard/groups/actions";
import { Avatar, base, date, Empty, Field, Modal, Notice, Submit, Tag, useGroupAction } from "./shared";
import { addedMessage, addPeopleLabel, capacityProblem, peopleCount, ROLE_HINTS, roleLabel } from "./labels";
import { PeopleChooser, usePeopleDirectory } from "./people-picker";

export function Requests({ requests, embedded = false }: { requests: StaffRequestRow[]; embedded?: boolean }) {
  const { pending, error, run } = useGroupAction();
  if (!requests.length) return <Empty icon="requests" compact={embedded} title="No one is waiting to join" description="When someone asks to join a group in the app, you’ll approve them here." />;
  return <div className="space-y-4">
    {error && <Notice>{error}</Notice>}
    <ul className="g-list" aria-label="Join requests">{requests.map(r => <li className="g-list-row" key={r.requestId}>
      <div className="flex min-w-0 flex-1 gap-4"><Avatar name={r.name} /><div className="min-w-0">
        <p className="g-row-title">{r.name}</p>
        <p className="g-row-sub">Asked to join {embedded ? "this group" : <Link className="font-semibold text-foreground underline underline-offset-4" href={`${base}/${r.groupId}/members`}>{r.groupName}</Link>} on {date(r.requestedAt)}</p>
        {r.message && <p className="g-quote">“{r.message}”</p>}
      </div></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={pending} onClick={() => run(() => actions.decideRequest(r.groupId, r.requestId, "decline"), `${r.name}’s request declined.`)}><X className="size-5" aria-hidden />Decline</Button>
        <Button disabled={pending} onClick={() => run(() => actions.decideRequest(r.groupId, r.requestId, "approve"), `${r.name} added to ${r.groupName}.`)}><Check className="size-5" aria-hidden />Approve</Button>
      </div>
    </li>)}</ul>
  </div>;
}

export function Members({ groupId, groupName, capacity, memberCount, members, archived, bans }: { groupId: string; groupName: string; capacity: number | null; memberCount: number; members: StaffMemberRow[]; archived: boolean; bans: Awaited<ReturnType<typeof listStaffBans>> }) {
  const [search, setSearch] = useState(""); const [adding, setAdding] = useState(false); const [removing, setRemoving] = useState<StaffMemberRow | null>(null);
  const { pending, error, run } = useGroupAction();
  const router = useRouter();
  const filtered = members.filter(m => m.name.toLowerCase().includes(search.trim().toLowerCase()));
  const onApp = members.filter(m => m.hasApp).length;

  async function changeRole(m: StaffMemberRow, role: GroupRole) {
    const previous = m.role;
    if (role === previous) return;
    if (role === "manager" && !(await confirmAction({ title: `Make ${m.name} a manager?`, description: `Managers can change ${groupName}’s settings and choose its leaders in the app. Only give this to people you trust with the whole group.`, confirmLabel: "Make manager" }))) return;
    run(() => actions.memberRole(groupId, m.membershipId, role), undefined, () => {
      undoToast(`${m.name} is now a ${roleLabel(role).toLowerCase()} of ${groupName}.`, async () => {
        const undo = await actions.memberRole(groupId, m.membershipId, previous);
        router.refresh();
        return undo.ok ? null : undo.error;
      }, { undoneMessage: `${m.name} is a ${roleLabel(previous).toLowerCase()} again.` });
    });
  }

  return <div className="space-y-6">
    <div className="g-toolbar">
      <label className="g-search"><Search aria-hidden /><span className="sr-only">Find someone in this group</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find someone in this group" /></label>
      {!archived && <Button size="lg" onClick={() => setAdding(true)}><UserPlus className="size-5" aria-hidden />Add people</Button>}
    </div>
    {members.length > 0 && <p className="text-[15px] text-muted-foreground">{peopleCount(members.length)} · {onApp} on the app{capacity !== null && ` · ${Math.max(0, capacity - memberCount)} spots left`}</p>}
    {error && <Notice>{error}</Notice>}
    {filtered.length ? <div className="g-panel g-table-wrap"><table className="g-table">
      <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Recent meetings</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
      <tbody>{filtered.map(m => <tr key={m.membershipId}>
        <td><div className="flex items-center gap-3"><Avatar name={m.name} /><div><div className="g-row-title">{m.name}</div><p className="g-row-sub">Joined {date(m.joinedAt)} · {m.hasApp ? "On the app" : "Not on the app yet"}</p></div></div></td>
        <td><select aria-label={`Role for ${m.name}`} title={ROLE_HINTS[m.role]} value={m.role} disabled={pending || archived} onChange={e => void changeRole(m, e.target.value as GroupRole)} className="g-role-select"><option value="member">Member</option><option value="leader">Leader</option><option value="manager">Manager</option></select></td>
        <td className="whitespace-nowrap text-muted-foreground">{m.recentGatherings ? `Came to ${m.attendedRecent} of ${m.recentGatherings}` : "No attendance yet"}</td>
        <td className="text-right">{!archived && <Button variant="ghost" disabled={pending} onClick={() => setRemoving(m)} aria-label={`Remove ${m.name} from ${groupName}`}><X className="size-5" aria-hidden />Remove</Button>}</td>
      </tr>)}</tbody>
    </table></div>
      : <Empty icon={search ? "search" : "groups"} compact title={search ? "No one by that name" : "No one in this group yet"} description={search ? "Try a different name." : archived ? "This group is archived." : "Use Add people to choose people from your church, or share an invite link from the About tab."} />}

    {!!bans.length && <details className="g-panel g-details"><summary>Removed and not allowed back ({bans.length})</summary><ul>{bans.map(b => <li key={b.banId} className="g-row"><div><p className="g-row-title">{b.name}</p><p className="g-row-sub">{b.reason ?? "Can’t rejoin this group"}</p></div><Button variant="outline" disabled={pending} onClick={() => run(() => actions.liftBan(groupId, b.banId), `${b.name} can join ${groupName} again.`)}>Allow back in</Button></li>)}</ul></details>}

    {adding && <AddPeople groupId={groupId} groupName={groupName} capacity={capacity} memberCount={memberCount} close={() => setAdding(false)} />}
    <Modal title={`Remove ${removing?.name ?? "this person"} from ${groupName}?`} description="They’ll leave the group and its chat. You can add them back later." open={!!removing} onClose={() => setRemoving(null)}>{removing && <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => actions.removeMember(groupId, removing.membershipId, f.has("ban"), String(f.get("reason") ?? "")), `${removing.name} removed from ${groupName}.`, () => setRemoving(null)); }}>
      <Field label="Reason (optional, only staff see this)"><textarea name="reason" maxLength={500} rows={3} /></Field>
      <label className="g-check"><input type="checkbox" name="ban" /><span>Don’t let them join this group again</span></label>
      {error && <Notice>{error}</Notice>}
      <div className="g-form-actions"><Button type="button" variant="ghost" onClick={() => setRemoving(null)}>Go back</Button><Button type="submit" variant="destructive" disabled={pending}>Remove {removing.name}</Button></div>
    </form>}</Modal>
  </div>;
}

function AddPeople({ groupId, groupName, capacity, memberCount, close }: { groupId: string; groupName: string; capacity: number | null; memberCount: number; close: () => void }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [leaders, setLeaders] = useState<string[]>([]);
  const { directory, retry } = usePeopleDirectory(groupId);
  const { pending, error, run } = useGroupAction();
  const tooMany = capacityProblem(capacity, memberCount, chosen.length);
  const names = directory.status === "ready" ? chosen.map(id => directory.items.find(i => i.id === id)?.label ?? "") : [];
  return <Modal open title={`Add people to ${groupName}`} description="Search your church’s People. Everyone you choose stays listed while you search for the next person." onClose={close} dirty={chosen.length > 0}>
    <div className="space-y-6">
      <PeopleChooser directory={directory} retry={retry} autoFocus label="Find people" value={chosen} onChange={setChosen} leaders={leaders} onLeadersChange={setLeaders} />
      {tooMany && <Notice>{tooMany}</Notice>}
      {error && <Notice>{error}</Notice>}
      <div className="g-form-actions">
        <Button type="button" variant="ghost" onClick={close} disabled={pending}>Cancel</Button>
        <Button disabled={pending || chosen.length === 0 || Boolean(tooMany)} onClick={() => run(() => actions.addPeople(groupId, chosen, leaders), data => addedMessage(groupName, data.added, names), close)}><UserPlus className="size-5" aria-hidden />{pending ? "Adding…" : addPeopleLabel(chosen.length)}</Button>
      </div>
    </div>
  </Modal>;
}

export function Invitations({ groupId, groupName, invitations, archived }: { groupId: string; groupName: string; invitations: Awaited<ReturnType<typeof listStaffInvitations>>; archived: boolean }) {
  const { pending, error, run } = useGroupAction(); const [url, setUrl] = useState<string | null>(null); const [copied, setCopied] = useState(false);
  async function stop(id: string) {
    const ok = await confirmAction({ title: "Turn off this invite link?", description: `Anyone who has this link won’t be able to use it to join ${groupName}. People who already joined stay in the group.`, confirmLabel: "Turn off link", destructive: true });
    if (ok) run(() => actions.revokeInvitation(groupId, id), "Invite link turned off.", () => setUrl(null));
  }
  return <section className="g-panel space-y-5" aria-labelledby="invite-title">
    <div className="flex items-start justify-between gap-4"><div><h2 id="invite-title">Invite links</h2><p className="g-row-sub">Make a link to send by text or email. Anyone with it can join {groupName} in the app.</p></div><Link2 className="size-6 shrink-0 text-muted-foreground" aria-hidden /></div>
    {!archived && <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => actions.createInvitation(groupId, Number(f.get("uses")), Number(f.get("days"))), "Invite link ready. Copy it now.", data => { setUrl(data.url); setCopied(false); }); }} className="space-y-4">
      <div className="g-form-grid"><Field label="Link works for"><select name="days" defaultValue="7"><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></Field><Field label="How many people can use it"><input name="uses" type="number" min={1} max={1000} defaultValue={25} /></Field></div>
      <Submit pending={pending} pendingLabel="Making link…">Make invite link</Submit>
    </form>}
    {error && <Notice>{error}</Notice>}
    {url && <div className="g-invite-result"><p className="text-[15px] font-semibold">Copy this link now. For privacy, it won’t be shown again.</p><div className="flex flex-wrap gap-2"><input aria-label="New invite link" readOnly value={url} onFocus={e => e.target.select()} className="min-w-0 flex-1" /><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); } }}>{copied ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}{copied ? "Copied" : "Copy link"}</Button></div></div>}
    {invitations.length > 0 && <ul>{invitations.map(i => <li key={i.id} className="g-row"><div><Tag>Used {i.usedCount} of {i.maxUses} times</Tag><p className="g-row-sub">Works until {date(i.expiresAt)}</p></div><Button variant="outline" disabled={pending} onClick={() => void stop(i.id)}>Turn off link</Button></li>)}</ul>}
  </section>;
}
