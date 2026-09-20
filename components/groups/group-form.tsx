"use client";
import { ImageCropper } from "@/components/website-admin/image-cropper";
import { downscaleForUpload, UPLOAD_BUDGET_BYTES } from "@/lib/sites/downscale-image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StaffGroupDetail, StaffGroupType } from "@/lib/groups/staff/groups";
import { saveGroup, uploadCover, removeCover } from "@/app/dashboard/groups/actions";
import { base, Field, GroupAvatar, Modal, Notice, Submit, Toggle, useGroupAction } from "./shared";

type Props = { types: StaffGroupType[]; campuses: { id: string; name: string }[]; detail?: StaffGroupDetail };
export function GroupFormButton(props: Props) {
  const [open, setOpen] = useState(false);
  return <><Button onClick={() => setOpen(true)} variant={props.detail ? "outline" : "default"}>{!props.detail && <Plus className="size-4" />}{props.detail ? "Edit group" : "Create group"}</Button><Modal title={props.detail ? "Edit group" : "Make room for connection"} description="Start with the essentials. You can add people and plan gatherings next." open={open} onClose={() => setOpen(false)} wide>{open && <GroupForm {...props} close={() => setOpen(false)} />}</Modal></>;
}
export function GroupForm({ types, campuses, detail, close }: Props & { close?: () => void }) {
  const group = detail?.group;
  const { run, pending, error } = useGroupAction();
  const router = useRouter();
  return <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const str = (k: string) => String(f.get(k) ?? ""); const opt = (k: string) => str(k) || null;
    run(() => saveGroup(group?.id ?? null, { name: str("name"), description: opt("description"), typeId: opt("typeId"), campusId: opt("campusId"), visibility: str("visibility"), enrollment: str("enrollment"), capacity: opt("capacity") ? Number(str("capacity")) : null, locationName: opt("locationName"), locationAddress: opt("locationAddress"), locationVisibility: str("locationVisibility"), onlineMeetingUrl: opt("onlineMeetingUrl"), chatEnabled: f.has("chatEnabled"), chatPosting: str("chatPosting"), allowMemberMedia: f.has("allowMemberMedia"), allowMemberLinks: f.has("allowMemberLinks"), memberListVisibility: str("memberListVisibility"), safetyProfile: str("safetyProfile"), defaultNotificationLevel: str("defaultNotificationLevel") }, group?.version ?? 0), group ? "Group updated" : "Your group is ready", data => { close?.(); router.push(`${base}/${data.id}`); }); }} className="space-y-5">
    <fieldset disabled={pending} className="space-y-5">
      <Field label="Group name"><input autoFocus name="name" required maxLength={80} defaultValue={group?.name} placeholder="e.g. Thursday Table" /></Field>
      <Field label="About this group" hint="Help someone picture themselves here. Who is it for, and what will you do together?"><textarea name="description" rows={3} maxLength={4000} defaultValue={group?.description ?? ""} placeholder="A welcoming place to share a meal, grow in faith, and build friendships." /></Field>
      <div className="g-form-grid"><Field label="Category"><select name="typeId" defaultValue={group?.type_id ?? ""}><option value="">Choose a category</option>{types.filter(t => t.isActive || t.id === group?.type_id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field><Field label="Campus"><select name="campusId" defaultValue={group?.campus_id ?? ""}><option value="">All campuses</option>{campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div>
      <div className="g-form-grid"><Field label="Who can find it?"><select name="visibility" defaultValue={group?.visibility ?? "public"}><option value="public">Everyone in the church</option><option value="unlisted">People with a link</option><option value="private">Group members only</option></select></Field><Field label="How do people join?"><select name="enrollment" defaultValue={group?.enrollment ?? "open"}><option value="open">Join right away</option><option value="approval_required">Ask to join</option><option value="invitation_only">Invitation only</option><option value="closed">Not accepting members</option></select></Field></div>
      <div className="g-form-grid"><Field label="Group size" hint="Leave empty for unlimited members."><input type="number" name="capacity" min={1} max={5000} defaultValue={group?.capacity ?? ""} placeholder="No limit" /></Field><Field label="Safety profile" hint="Youth group members cannot send or receive direct messages."><select name="safetyProfile" defaultValue={group?.safety_profile ?? "standard"}><option value="standard">Standard</option><option value="youth">Youth group</option></select></Field></div>
      <details className="rounded-xl border border-border p-4" open={!!group}><summary className="cursor-pointer text-sm font-semibold">Meeting place & privacy</summary><div className="mt-5 space-y-4"><Field label="Location name"><input name="locationName" defaultValue={group?.location_name ?? ""} maxLength={200} placeholder="e.g. Church café" /></Field><Field label="Address"><input name="locationAddress" defaultValue={group?.location_address ?? ""} maxLength={500} /></Field><Field label="Who can see the address?"><select name="locationVisibility" defaultValue={group?.location_visibility ?? "members"}><option value="members">Members only (recommended for homes)</option><option value="public">Everyone who can see the group</option></select></Field><Field label="Online meeting link"><input type="url" name="onlineMeetingUrl" placeholder="https://" defaultValue={group?.online_meeting_url ?? ""} /></Field></div></details>
      <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-semibold">Conversation settings</summary><div className="mt-3 space-y-4"><Toggle name="chatEnabled" title="Group chat" description="Give members a place to stay connected between gatherings." checked={group?.chat_enabled ?? true} /><Field label="Who can post?"><select name="chatPosting" defaultValue={group?.chat_posting ?? "everyone"}><option value="everyone">Everyone in the group</option><option value="leaders">Leaders only</option></select></Field><Toggle name="allowMemberMedia" title="Allow photos and files" checked={group?.allow_member_media ?? true} /><Toggle name="allowMemberLinks" title="Allow links" checked={group?.allow_member_links ?? true} /><Field label="Member list"><select name="memberListVisibility" defaultValue={group?.member_list_visibility ?? "members"}><option value="members">Visible to members</option><option value="leaders">Visible to leaders only</option></select></Field><Field label="Default notifications"><select name="defaultNotificationLevel" defaultValue={group?.default_notification_level ?? "all"}><option value="all">All messages</option><option value="mentions">Mentions only</option></select></Field></div></details>
    </fieldset>
    {error && <Notice>{error}</Notice>}<div className="g-form-actions">{close && <Button variant="ghost" onClick={close} disabled={pending}>Cancel</Button>}<Submit pending={pending}>{group ? "Save group" : "Create group"}</Submit></div>
  </form>;
}
/**
 * A group's photo is a square logo, not a banner.
 *
 * The phones render it at 1:1 in every place a group appears — the list row,
 * the conversation title, the group header — so the dashboard crops to the
 * same square and previews it at those sizes. A church choosing the photo can
 * see what the apps will show before it saves.
 */
export function GroupPhotoEditor({ detail }: { detail: StaffGroupDetail }) {
  const { pending, error, run } = useGroupAction();
  const [photo, setPhoto] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const { name, cover_image_url: url, id } = detail.group;
  const busy = pending || preparing;

  // Shared by the file input and the drop target: a photo straight off a
  // phone is far over the Server Action body limit, so it is shrunk here
  // before the cropper ever sees it.
  async function choose(file: File | null | undefined) {
    if (!file) return;
    setPreparing(true); setPhotoError(null);
    try {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("unsupported");
      if (file.size > 12 * 1024 * 1024) throw new Error("too large");
      const prepared = await downscaleForUpload(file);
      if (prepared.size > UPLOAD_BUDGET_BYTES) throw new Error("still too large");
      setPhoto(prepared);
    } catch { setPhotoError("That photo could not be prepared. Choose a JPG, PNG or WebP under 12 MB."); }
    finally { setPreparing(false); }
  }

  return <section className="g-panel" id="photo">
    <h3>Group photo</h3>
    <p className="g-row-sub">One square photo, shown everywhere this group appears — here, in the iPhone app, and on Android. Position it once and every screen shows the same crop.</p>
    <div className="g-photo-editor">
      <GroupAvatar name={name} url={url} size={148} className="g-photo-hero" />
      <div className="min-w-0 flex-1">
        <label className={cn("g-dropzone", dragging && "is-dragging")}
          onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) void choose(e.dataTransfer.files?.[0]); }}>
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void choose(file); }} />
          <span className="g-dropzone-icon"><ImagePlus className="size-5" strokeWidth={1.6} /></span>
          <strong>{url ? "Drag a new photo here, or browse" : "Drag a photo here, or browse"}</strong>
          <small>JPG, PNG or WebP, up to 12 MB. You will position it in a square frame next.</small>
        </label>
        <div className="g-photo-actions">
          <p className="g-row-sub" role="status">{preparing ? "Preparing your photo…" : pending ? "Saving your photo…" : url ? "This photo is live on every device." : "No photo yet — members see your group’s initials."}</p>
          {url && <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => removeCover(id), "Photo removed")}><Trash2 className="size-4" />Remove</Button>}
        </div>
      </div>
    </div>
    <div className="g-photo-sizes">
      <span>Where it appears</span>
      {[["Groups list", 56], ["Conversations", 40], ["Chat title", 28]].map(([caption, size]) => <div key={caption}><GroupAvatar name={name} url={url} size={size as number} /><small>{caption}</small></div>)}
    </div>
    {(error || photoError) && <Notice>{error || photoError}</Notice>}
    {photo && <ImageCropper file={photo} shape={{ label: "Group photo", hint: "A square, 1:1 — the shape the apps show.", ratio: 1 }} onCancel={() => setPhoto(null)} onConfirm={crop => {
      const data = new FormData(); data.set("cover", photo); data.set("crop", JSON.stringify(crop)); setPhoto(null);
      run(() => uploadCover(id, data), "Group photo updated");
    }} />}
  </section>;
}
