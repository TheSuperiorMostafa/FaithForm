"use client";
import { useState } from "react";
import { Pencil, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import type { StaffGroupType } from "@/lib/groups/staff/groups";
import type { ChurchMessagingSettings } from "@/lib/messaging/settings";
import type { syncHealth } from "@/lib/messaging/moderation";
import { GROUP_TYPE_ICONS } from "@/lib/groups/types";
import * as actions from "@/app/dashboard/groups/actions";
import { Field, Modal, Notice, Pill, Submit, Toggle, useGroupAction } from "./shared";
import { categoryIconLabel } from "./labels";

export function Settings({ settings, types, health, isAdmin }: { settings: ChurchMessagingSettings; types: StaffGroupType[]; health: Awaited<ReturnType<typeof syncHealth>>; isAdmin: boolean }) {
  const { pending, error, run } = useGroupAction(); const [category, setCategory] = useState<StaffGroupType | "new" | null>(null);
  return <div className="g-detail-grid">
    <div className="space-y-6">
      <form className="g-panel space-y-2" aria-labelledby="msg-settings" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => actions.saveMessagingSettings({ messagingEnabled: f.has("messagingEnabled"), dmPolicy: String(f.get("dmPolicy")), allowMemberMedia: f.has("allowMemberMedia"), allowMemberLinks: f.has("allowMemberLinks"), allowGifs: f.has("allowGifs"), profanityFilter: f.has("profanityFilter") }), "Message settings saved for your church."); }}>
        <h2 id="msg-settings">Messages in the app</h2>
        <p className="g-row-sub">These apply to every group. A group can be stricter in its own settings.</p>
        {!isAdmin && <Notice tone="info">Only church admins can change these settings.</Notice>}
        <fieldset disabled={!isAdmin || pending}>
          <Toggle name="messagingEnabled" title="Turn on messages" description="Lets groups talk in the app." checked={settings.messagingEnabled} />
          <div className="my-5"><Field label="Who can send private messages?" hint="People in youth groups can never send or receive private messages."><select name="dmPolicy" defaultValue={settings.dmPolicy}><option value="disabled">No one. Group chats only</option><option value="leaders_only">Leaders can message their group’s members</option><option value="leaders_and_members">Leaders and members can message each other</option><option value="group_members">People who share a group</option><option value="everyone">Anyone in the church</option></select></Field></div>
          <Toggle name="allowMemberMedia" title="Members can share photos and files" checked={settings.allowMemberMedia} />
          <Toggle name="allowMemberLinks" title="Members can share web links" checked={settings.allowMemberLinks} />
          <Toggle name="allowGifs" title="Members can share GIFs" checked={settings.allowGifs} />
          <Toggle name="profanityFilter" title="Hide bad language" description="Blocks common swear words in messages." checked={settings.profanityFilter} />
        </fieldset>
        {error && <Notice>{error}</Notice>}
        {isAdmin && <div className="g-form-actions"><Submit pending={pending}>Save message settings</Submit></div>}
      </form>
      <section className="g-panel space-y-2" aria-labelledby="cat-title">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="cat-title">Kinds of groups</h2><p className="g-row-sub">The choices for “What kind of group?”. They help people find a group in the app.</p></div><Button variant="outline" onClick={() => setCategory("new")}><Plus className="size-5" aria-hidden />Add a kind</Button></div>
        <ul>{types.map(t => <li className="g-row" key={t.id}><div><p className="g-row-title flex flex-wrap items-center gap-2">{t.name} {!t.isActive && <Pill>Hidden</Pill>}</p><p className="g-row-sub">{t.groupCount === 1 ? "1 group" : `${t.groupCount} groups`} · {categoryIconLabel(t.icon)} icon</p></div><Button variant="outline" onClick={() => setCategory(t)}><Pencil className="size-5" aria-hidden />Edit</Button></li>)}</ul>
      </section>
    </div>
    <aside className="space-y-6">
      <section className="g-panel space-y-3"><ShieldCheck className="size-7 text-accent" aria-hidden /><h2>Safety is built in</h2><p className="g-row-sub">People can report messages and block others in the app. Reports come to the Safety page, and every action your team takes is recorded.</p></section>
      <section className="g-panel space-y-3" aria-labelledby="health-title"><h2 id="health-title">Is chat up to date?</h2><p className="g-row-sub">{health.failed || health.delayed ? `${health.failed} ${health.failed === 1 ? "change hasn’t" : "changes haven’t"} reached the app yet, and ${health.delayed} ${health.delayed === 1 ? "is" : "are"} slower than usual.` : "Yes. Every change has reached the app."}</p>{health.failed > 0 && isAdmin && <Button variant="outline" disabled={pending} onClick={() => run(() => actions.retrySync(), "Trying those changes again.")}><RotateCcw className="size-5" aria-hidden />Try again</Button>}</section>
    </aside>
    {category && <Modal open onClose={() => setCategory(null)} title={category === "new" ? "Add a kind of group" : `Edit “${category.name}”`}><CategoryForm category={category} close={() => setCategory(null)} /></Modal>}
  </div>;
}

function CategoryForm({ category, close }: { category: StaffGroupType | "new"; close: () => void }) {
  const { pending, error, run } = useGroupAction(); const current = category === "new" ? null : category;
  async function remove() {
    if (!current) return;
    const ok = await confirmAction({ title: `Delete “${current.name}”?`, description: "It will no longer be offered when someone creates a group. No groups use it right now.", confirmLabel: "Delete this kind", destructive: true });
    if (ok) run(() => actions.deleteCategory(current.id), `“${current.name}” deleted.`, close);
  }
  return <form className="space-y-5" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const name = String(f.get("name")).trim(); run(() => actions.saveCategory(current?.id ?? null, { name, icon: String(f.get("icon")), isActive: f.has("active") }), `“${name}” saved.`, close); }}>
    <Field label="Name"><input autoFocus required name="name" maxLength={60} defaultValue={current?.name} placeholder="e.g. Life groups" /></Field>
    <Field label="Icon in the app"><select name="icon" defaultValue={current?.icon ?? "users"}>{GROUP_TYPE_ICONS.map(icon => <option key={icon} value={icon}>{categoryIconLabel(icon)}</option>)}</select></Field>
    <Toggle name="active" title="Offer this for new groups" checked={current?.isActive ?? true} />
    {error && <Notice>{error}</Notice>}
    <div className="g-form-actions">{current?.groupCount === 0 && <Button type="button" variant="destructive" disabled={pending} onClick={() => void remove()} className="sm:mr-auto"><Trash2 className="size-5" aria-hidden />Delete</Button>}<Submit pending={pending}>{current ? "Save changes" : "Add this kind"}</Submit></div>
  </form>;
}
