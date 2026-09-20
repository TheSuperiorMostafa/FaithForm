"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, Plus, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StaffMemberRow, StaffRequestRow, listStaffBans, listStaffInvitations } from "@/lib/groups/staff/people";
import type { GroupRole } from "@/lib/groups/types";
import * as actions from "@/app/dashboard/groups/actions";
import { Avatar, base, date, Empty, Field, Modal, Notice, PageHeading, Pill, Submit, useGroupAction } from "./shared";

export function Requests({ requests, embedded = false }: { requests: StaffRequestRow[]; embedded?: boolean }) {
  const { pending, error, run } = useGroupAction();
  return <>{!embedded && <PageHeading title="A place to belong." description="Welcome the people who are ready to take their next step." />}{error && <Notice>{error}</Notice>}{!requests.length ? <Empty title="Everyone’s been welcomed" description="New requests to join your groups will appear here. You’re all caught up." /> : <div className="g-panel">{requests.map(r => <div className="g-row" key={r.requestId}><div className="flex min-w-0 flex-1 gap-3"><Avatar name={r.name} /><div><div className="g-row-title">{r.name}</div><p className="g-row-sub">Wants to join <Link className="underline underline-offset-2" href={`${base}/${r.groupId}`}>{r.groupName}</Link> · {date(r.requestedAt)}</p>{r.message && <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">“{r.message}”</p>}</div></div><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => actions.decideRequest(r.groupId, r.requestId, "decline"), "Request declined")}>Decline</Button><Button size="sm" disabled={pending} onClick={() => run(() => actions.decideRequest(r.groupId, r.requestId, "approve"), "Member welcomed to the group")}><Check className="size-4" />Approve</Button></div></div>)}</div>}</>;
}
export function Members({ groupId, members, archived, bans }: { groupId: string; members: StaffMemberRow[]; archived: boolean; bans: Awaited<ReturnType<typeof listStaffBans>> }) {
  const [search, setSearch] = useState(""); const [adding, setAdding] = useState(false); const [removing, setRemoving] = useState<StaffMemberRow | null>(null);
  const { pending, error, run } = useGroupAction();
  const filtered = members.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  return <><div className="g-toolbar"><label className="g-search"><Search /><span className="sr-only">Search members</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find someone in this group…" /></label>{!archived && <Button onClick={() => setAdding(true)}><UserPlus className="size-4" />Add people</Button>}</div>{error && <Notice>{error}</Notice>}{filtered.length ? <div className="g-panel overflow-x-auto"><table className="g-table"><thead><tr><th>Person</th><th>Role</th><th>Recent attendance</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map(m => <tr key={m.membershipId}><td><div className="flex items-center gap-3"><Avatar name={m.name} /><div><div className="g-row-title">{m.name}</div><p className="g-row-sub">Joined {date(m.joinedAt)}{!m.hasApp && " · Not on the app yet"}</p></div></div></td><td><select aria-label={`Role for ${m.name}`} value={m.role} disabled={pending || archived} onChange={e => run(() => actions.memberRole(groupId, m.membershipId, e.target.value as GroupRole), "Role updated")}><option value="member">Member</option><option value="leader">Leader</option><option value="manager">Manager</option></select></td><td className="whitespace-nowrap text-muted-foreground">{m.recentGatherings ? `${m.attendedRecent} of ${m.recentGatherings} gatherings` : "No attendance yet"}</td><td><Button size="sm" variant="ghost" disabled={pending || archived} onClick={() => setRemoving(m)}>Remove</Button></td></tr>)}</tbody></table></div> : <Empty icon={search ? "search" : "groups"} title={search ? "No matching members" : "Your people will be here"} description={search ? "Try searching for a different name." : "Add people from your church directory or share an invitation link."} />}
    {!!bans.length && <details className="g-panel mt-6"><summary className="cursor-pointer text-sm font-semibold">Removed and banned ({bans.length})</summary>{bans.map(b => <div key={b.banId} className="g-row"><div><p className="g-row-title">{b.name}</p><p className="g-row-sub">{b.reason ?? "Cannot rejoin this group"}</p></div><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => actions.liftBan(groupId, b.banId), "Ban lifted")}>Allow to rejoin</Button></div>)}</details>}
    <Modal title="Add people" description="Choose someone from your church’s People directory." open={adding} onClose={() => setAdding(false)}>{adding && <AddPeople groupId={groupId} close={() => setAdding(false)} />}</Modal>
    <Modal title={`Remove ${removing?.name ?? "member"}?`} description="They will lose access to this group and its conversation." open={!!removing} onClose={() => setRemoving(null)}>{removing && <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => actions.removeMember(groupId, removing.membershipId, f.has("ban"), String(f.get("reason") ?? "")), "Member removed", () => setRemoving(null)); }}><Field label="Reason (optional)"><textarea name="reason" maxLength={500} rows={3} /></Field><label className="mt-5 flex gap-3 text-sm"><input type="checkbox" name="ban" />Prevent this person from rejoining</label>{error && <Notice>{error}</Notice>}<div className="g-form-actions"><Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button><Button type="submit" variant="destructive" disabled={pending}>Remove member</Button></div></form>}</Modal>
  </>;
}
function AddPeople({ groupId, close }: { groupId: string; close: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ memberId: string; name: string; hasApp: boolean }[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [role, setRole] = useState<GroupRole>("member");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchVersion = useRef(0);
  const { pending, error, run } = useGroupAction();

  useEffect(() => {
    const version = ++searchVersion.current;
    let active = true;
    const needle = query.trim();
    setResults(null);
    setSearchError(null);
    setSearching(!!needle);
    if (!needle) return;

    const timer = setTimeout(async () => {
      try {
        const result = await actions.findPeople(groupId, needle);
        if (!active || version !== searchVersion.current) return;
        if (result.ok) setResults(result.data);
        else setSearchError(result.error);
      } catch {
        if (active && version === searchVersion.current) {
          setSearchError("We couldn’t search your people. Try changing the name to search again.");
        }
      } finally {
        if (active && version === searchVersion.current) setSearching(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [groupId, query]);

  return <div className="space-y-5">
    <Field label="Search your people" hint="Results appear as you type.">
      <input
        name="query"
        type="search"
        autoFocus
        autoComplete="off"
        maxLength={80}
        placeholder="First or last name"
        value={query}
        onChange={e => {
          // Invalidate in-flight results immediately, before the next effect runs.
          searchVersion.current += 1;
          setQuery(e.target.value);
          setResults(null);
          setSearchError(null);
          setSearching(!!e.target.value.trim());
        }}
      />
    </Field>
    <div role="status" className="text-sm text-muted-foreground">
      {searching ? "Searching…" : !query.trim() ? "Start typing a name to find people." : results ? results.length ? `${results.length} ${results.length === 1 ? "person found" : "people found"}.` : "No matching people outside this group. Try another name." : null}
    </div>
    {!!results?.length && <div className="max-h-64 overflow-y-auto">{results.map(p => <label key={p.memberId} className="g-row cursor-pointer"><span className="flex items-center gap-3"><Avatar name={p.name} /><span><strong className="g-row-title">{p.name}</strong><span className="block text-xs text-muted-foreground">{p.hasApp ? "Has the FaithForm app" : "Invite them to download the app"}</span></span></span><input type="checkbox" checked={selected.includes(p.memberId)} onChange={e => setSelected(s => e.target.checked ? [...s, p.memberId] : s.filter(id => id !== p.memberId))} /></label>)}</div>}
    {searchError && <Notice>{searchError}</Notice>}
    <Field label="Add as"><select value={role} onChange={e => setRole(e.target.value as GroupRole)}><option value="member">Member</option><option value="leader">Leader</option><option value="manager">Manager</option></select></Field>
    {error && <Notice>{error}</Notice>}
    <Button disabled={pending || selected.length === 0} onClick={() => run(() => actions.addMembers(groupId, selected, role), "People added", close)}><Plus className="size-4" />Add {selected.length || ""} {selected.length === 1 ? "person" : "people"}</Button>
  </div>;
}
export function Invitations({ groupId, invitations, archived }: { groupId: string; invitations: Awaited<ReturnType<typeof listStaffInvitations>>; archived: boolean }) {
  const { pending, error, run } = useGroupAction(); const [url, setUrl] = useState<string | null>(null); const [copied, setCopied] = useState(false);
  return <div className="g-panel"><div className="g-panel-head"><div><h2>Invite someone in</h2><p className="g-row-sub">Create a link to share wherever you connect.</p></div><Link2 className="size-5 text-muted-foreground" /></div>{!archived && <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => actions.createInvitation(groupId, Number(f.get("uses")), Number(f.get("days"))), "Invitation created", data => { setUrl(data.url); setCopied(false); }); }}><div className="g-form-grid"><Field label="Expires after"><select name="days"><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></Field><Field label="Number of uses"><input name="uses" type="number" min={1} max={1000} defaultValue={25} /></Field></div><div className="mt-4"><Submit pending={pending}>Create invitation link</Submit></div></form>}{error && <Notice>{error}</Notice>}{url && <div className="mt-5 rounded-xl bg-muted p-4"><p className="mb-2 text-xs text-muted-foreground">Copy this link now. For privacy, it won’t be shown again.</p><div className="flex gap-2"><input aria-label="New invitation link" readOnly value={url} onFocus={e => e.target.select()} /><Button aria-label="Copy invitation link" variant="outline" size="icon" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); } }}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</Button></div>{copied && <p role="status" className="mt-2 text-xs">Link copied</p>}</div>}{invitations.map(i => <div key={i.id} className="g-row"><div><Pill>{i.usedCount} / {i.maxUses} uses</Pill><p className="g-row-sub">Expires {date(i.expiresAt)}</p></div><Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => actions.revokeInvitation(groupId, i.id), "Invitation revoked", () => setUrl(null))}>Revoke link</Button></div>)}</div>;
}
