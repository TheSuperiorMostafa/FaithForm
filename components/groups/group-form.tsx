"use client";
import { ImageCropper } from "@/components/website-admin/image-cropper";
import { downscaleForUpload, UPLOAD_BUDGET_BYTES } from "@/lib/sites/downscale-image";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Plus, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { cn } from "@/lib/utils";
import type { StaffGroupDetail, StaffGroupType } from "@/lib/groups/staff/groups";
import { createGroupWithPeople, saveGroup, uploadCover, removeCover } from "@/app/dashboard/groups/actions";
import { base, Field, GroupAvatar, Modal, Notice, Submit, Toggle, useGroupAction } from "./shared";
import { capacityProblem, categoryImpliesYouth, createdMessage, ENROLLMENT_LABELS, NEW_GROUP_DEFAULTS, peopleCount, VISIBILITY_LABELS } from "./labels";
import { PeopleChooser, usePeopleDirectory } from "./people-picker";

type Campus = { id: string; name: string };
type GroupValues = Record<string, unknown>;

/** Reads every group setting from a form. Unset fields fall back to the server's defaults. */
function readGroupValues(form: HTMLFormElement): GroupValues {
  const f = new FormData(form);
  const str = (k: string, fallback = "") => { const v = f.get(k); return v === null ? fallback : String(v); };
  const opt = (k: string) => str(k).trim() || null;
  return {
    name: str("name"),
    description: opt("description"),
    typeId: opt("typeId"),
    campusId: opt("campusId"),
    visibility: str("visibility", NEW_GROUP_DEFAULTS.visibility),
    enrollment: str("enrollment", NEW_GROUP_DEFAULTS.enrollment),
    capacity: opt("capacity") ? Number(str("capacity")) : null,
    locationName: opt("locationName"),
    locationAddress: opt("locationAddress"),
    locationVisibility: str("locationVisibility", NEW_GROUP_DEFAULTS.locationVisibility),
    onlineMeetingUrl: opt("onlineMeetingUrl"),
    chatEnabled: f.has("chatEnabled"),
    chatPosting: str("chatPosting", NEW_GROUP_DEFAULTS.chatPosting),
    allowMemberMedia: f.has("allowMemberMedia"),
    allowMemberLinks: f.has("allowMemberLinks"),
    memberListVisibility: str("memberListVisibility", NEW_GROUP_DEFAULTS.memberListVisibility),
    safetyProfile: str("safetyProfile", NEW_GROUP_DEFAULTS.safetyProfile),
    defaultNotificationLevel: str("defaultNotificationLevel", NEW_GROUP_DEFAULTS.defaultNotificationLevel),
  };
}

/* ------------------------------------------------------------------------ */
/* Shared field groups: the same controls in "More options" and in Settings */
/* ------------------------------------------------------------------------ */

type Group = StaffGroupDetail["group"] | undefined;

function AboutFields({ group, campuses }: { group: Group; campuses: Campus[] }) {
  return <>
    <Field label="About this group (optional)" hint="Who is it for, and what do you do together? People see this in the app."><textarea name="description" rows={3} maxLength={4000} defaultValue={group?.description ?? ""} placeholder="A welcoming place to share a meal and read the Bible together." /></Field>
    {campuses.length > 0 && <Field label="Campus"><select name="campusId" defaultValue={group?.campus_id ?? ""}><option value="">All campuses</option>{campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
  </>;
}
function JoiningFields({ group }: { group: Group }) {
  return <div className="g-form-grid">
    <Field label="Who can find it?"><select name="visibility" defaultValue={group?.visibility ?? NEW_GROUP_DEFAULTS.visibility}>{Object.entries(VISIBILITY_LABELS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Field>
    <Field label="How do people join?"><select name="enrollment" defaultValue={group?.enrollment ?? NEW_GROUP_DEFAULTS.enrollment}>{Object.entries(ENROLLMENT_LABELS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Field>
    <Field label="Most people allowed (optional)" hint="Leave empty for no limit."><input type="number" name="capacity" min={1} max={5000} defaultValue={group?.capacity ?? ""} placeholder="No limit" /></Field>
  </div>;
}
function PlaceFields({ group }: { group: Group }) {
  return <>
    <div className="g-form-grid">
      <Field label="Where it meets (optional)"><input name="locationName" defaultValue={group?.location_name ?? ""} maxLength={200} placeholder="e.g. Church café" /></Field>
      <Field label="Address (optional)"><input name="locationAddress" defaultValue={group?.location_address ?? ""} maxLength={500} /></Field>
    </div>
    <Field label="Who can see the address?"><select name="locationVisibility" defaultValue={group?.location_visibility ?? NEW_GROUP_DEFAULTS.locationVisibility}><option value="members">Group members only (best for homes)</option><option value="public">Everyone who can see the group</option></select></Field>
    <Field label="Online meeting link (optional)" hint="Starts with https://"><input type="url" name="onlineMeetingUrl" placeholder="https://" defaultValue={group?.online_meeting_url ?? ""} /></Field>
  </>;
}
function ChatFields({ group }: { group: Group }) {
  return <>
    <Toggle name="chatEnabled" title="Group chat" description="A place in the app for members to talk between meetings." checked={group?.chat_enabled ?? NEW_GROUP_DEFAULTS.chatEnabled} />
    <Toggle name="allowMemberMedia" title="Members can share photos and files" checked={group?.allow_member_media ?? NEW_GROUP_DEFAULTS.allowMemberMedia} />
    <Toggle name="allowMemberLinks" title="Members can share web links" checked={group?.allow_member_links ?? NEW_GROUP_DEFAULTS.allowMemberLinks} />
    <div className="g-form-grid">
      <Field label="Who can write in the chat?"><select name="chatPosting" defaultValue={group?.chat_posting ?? NEW_GROUP_DEFAULTS.chatPosting}><option value="everyone">Everyone in the group</option><option value="leaders">Leaders only</option></select></Field>
      <Field label="Who can see the member list?"><select name="memberListVisibility" defaultValue={group?.member_list_visibility ?? NEW_GROUP_DEFAULTS.memberListVisibility}><option value="members">Everyone in the group</option><option value="leaders">Leaders only</option></select></Field>
      <Field label="New members are notified about"><select name="defaultNotificationLevel" defaultValue={group?.default_notification_level ?? NEW_GROUP_DEFAULTS.defaultNotificationLevel}><option value="all">Every message</option><option value="mentions">Only messages that mention them</option></select></Field>
    </div>
  </>;
}
const YOUTH_HINT = "Youth protections: members can't send or receive private messages. Use this for any group with people under 18.";
function SafetySelect(props: { value: string; onChange: (v: "standard" | "youth") => void } | { name: string; defaultValue: string }) {
  const options = <><option value="standard">Off: an adult group</option><option value="youth">On: a group with people under 18</option></>;
  return <Field label="Youth protections" hint={YOUTH_HINT}>
    {"onChange" in props
      ? <select value={props.value} onChange={e => props.onChange(e.target.value as "standard" | "youth")}>{options}</select>
      : <select name={props.name} defaultValue={props.defaultValue}>{options}</select>}
  </Field>;
}

/* ------------------------------------------------------------------------ */
/* Create: Name → Who's in it? → Create group                               */
/* ------------------------------------------------------------------------ */

export function CreateGroupButton({ types, campuses, label = "Create group" }: { types: StaffGroupType[]; campuses: Campus[]; label?: string }) {
  const [open, setOpen] = useState(false);
  return <><Button size="lg" onClick={() => setOpen(true)}><Plus className="size-5" aria-hidden />{label}</Button>{open && <CreateGroupDialog types={types} campuses={campuses} close={() => setOpen(false)} />}</>;
}

const ADVANCED_FIELDS = new Set(["description", "campusId", "visibility", "enrollment", "capacity", "locationName", "locationAddress", "locationVisibility", "onlineMeetingUrl", "chatPosting", "memberListVisibility", "defaultNotificationLevel", "safetyProfile"]);

function CreateGroupDialog({ types, campuses, close }: { types: StaffGroupType[]; campuses: Campus[]; close: () => void }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState("");
  const [safety, setSafety] = useState<"standard" | "youth" | "">("standard");
  const [chosen, setChosen] = useState<string[]>([]);
  const [leaders, setLeaders] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [openAdvanced, setOpenAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const { directory, retry } = usePeopleDirectory(null);

  const available = types.filter(t => t.isActive);
  const chosenType = available.find(t => t.id === typeId) ?? null;
  const askYouth = categoryImpliesYouth(chosenType?.name);
  const tooMany = capacityProblem(capacity, 0, chosen.length);

  function chooseType(id: string) {
    setTouched(true);
    setTypeId(id);
    const next = available.find(t => t.id === id);
    // A youth-sounding category asks the question plainly, with no answer
    // chosen for them. Moving away from it goes back to the usual default.
    if (categoryImpliesYouth(next?.name)) setSafety("");
    else if (safety === "") setSafety("standard");
  }

  function next() {
    setError(null);
    if (!form.current?.reportValidity()) return;
    const raw = new FormData(form.current).get("capacity");
    setCapacity(raw ? Number(raw) : null);
    setStep(2);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step === 1) { next(); return; }
    if (!form.current || tooMany) return;
    const values = readGroupValues(form.current);
    setError(null);
    start(async () => {
      try {
        const result = await createGroupWithPeople(values, chosen, leaders);
        if (!result.ok) {
          setError(result.error);
          if (result.field && (result.field === "name" || result.field === "typeId" || ADVANCED_FIELDS.has(result.field))) {
            setStep(1);
            if (ADVANCED_FIELDS.has(result.field)) setOpenAdvanced(true);
          }
          return;
        }
        const groupName = String(values.name).trim();
        toast.success(createdMessage(groupName, result.data.added));
        if (result.data.addError) toast.error(result.data.addError, { duration: 12_000 });
        close();
        router.push(`${base}/${result.data.id}/members`);
        router.refresh();
      } catch {
        setError("We couldn’t reach FaithForm, so the group wasn’t created. Check your connection and try again.");
      }
    });
  }

  const trimmed = name.trim();
  return <Modal open wide onClose={close} dirty={touched || chosen.length > 0}
    title={step === 1 ? "Create a group" : `Who’s in ${trimmed}?`}
    description={step === 1 ? "Step 1 of 2: give it a name." : "Step 2 of 2: choose its people. You can add more later."}>
    <form ref={form} onSubmit={submit} onInput={() => setTouched(true)} className="space-y-6" noValidate={step === 2}
      // Enter in the people search must never create the group by accident.
      onKeyDown={e => { if (step === 2 && e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
      <fieldset disabled={pending} className="space-y-6" hidden={step !== 1}>
        <Field label="Group name"><input autoFocus name="name" required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Choir, Tuesday Bible Study" /></Field>

        {available.length > 0 && <fieldset className="space-y-3">
          <legend className="g-legend">What kind of group? <span>(optional)</span></legend>
          <input type="hidden" name="typeId" value={typeId} />
          <div className="flex flex-wrap gap-2">
            {available.map(t => <button type="button" key={t.id} aria-pressed={typeId === t.id} onClick={() => chooseType(typeId === t.id ? "" : t.id)} className={cn("g-chip", typeId === t.id && "is-on")}>{t.name}</button>)}
          </div>
        </fieldset>}

        <input type="hidden" name="safetyProfile" value={safety || "standard"} />
        {askYouth && <fieldset className="g-question">
          <legend className="g-legend"><ShieldCheck className="size-5" aria-hidden />Is this group for people under 18?</legend>
          <p className="text-[15px] text-muted-foreground">If yes, members can’t send or receive private messages. Leaders and the group chat still work.</p>
          <label className={cn("g-choice", safety === "youth" && "is-on")}><input type="radio" name="youthAnswer" required checked={safety === "youth"} onChange={() => setSafety("youth")} /><span><strong>Yes, turn on youth protections</strong><small>Recommended for children and teenagers.</small></span></label>
          <label className={cn("g-choice", safety === "standard" && "is-on")}><input type="radio" name="youthAnswer" required checked={safety === "standard"} onChange={() => setSafety("standard")} /><span><strong>No, it’s for adults</strong><small>For example, the youth leaders’ team.</small></span></label>
        </fieldset>}

        <AdvancedSection description="About, campus, who can join, size, meeting place, chat and youth protections. You can change all of this later in the group’s settings." forceOpen={openAdvanced}>
          <AboutFields group={undefined} campuses={campuses} />
          <JoiningFields group={undefined} />
          <PlaceFields group={undefined} />
          <ChatFields group={undefined} />
          {!askYouth && <SafetySelect value={safety || "standard"} onChange={v => { setTouched(true); setSafety(v); }} />}
        </AdvancedSection>
      </fieldset>

      {step === 2 && <div className="space-y-5">
        <PeopleChooser directory={directory} retry={retry} autoFocus label="Find people to add" value={chosen} onChange={ids => { setChosen(ids); setError(null); }} leaders={leaders} onLeadersChange={setLeaders} />
        <p className="text-[15px] text-muted-foreground" role="status">{chosen.length ? `${peopleCount(chosen.length)} chosen${leaders.length ? `, ${leaders.length} ${leaders.length === 1 ? "leader" : "leaders"}` : ""}.` : "No one chosen yet. You can also create the group now and add people later."}</p>
        {tooMany && <Notice>{tooMany}</Notice>}
      </div>}

      {error && <Notice>{error}</Notice>}

      <div className="g-form-actions">
        {step === 1
          ? <><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button type="submit">Next: add people<ArrowRight className="size-5" aria-hidden /></Button></>
          : <><Button type="button" variant="outline" disabled={pending} onClick={() => { setError(null); setStep(1); }}><ArrowLeft className="size-5" aria-hidden />Back</Button>
              <Button type="submit" disabled={pending || Boolean(tooMany)}>{pending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <UsersRound className="size-5" aria-hidden />}{pending ? "Creating…" : "Create group"}</Button></>}
      </div>
    </form>
  </Modal>;
}

/* ------------------------------------------------------------------------ */
/* Edit: every setting, in the group's Settings tab                         */
/* ------------------------------------------------------------------------ */

/** Warns before leaving the page with unsaved changes. */
function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

export function GroupForm({ types, campuses, detail }: { types: StaffGroupType[]; campuses: Campus[]; detail: StaffGroupDetail }) {
  const group = detail.group;
  const { run, pending, error } = useGroupAction();
  const [dirty, setDirty] = useState(false);
  useLeaveGuard(dirty);
  return <form onInput={() => setDirty(true)} onChange={() => setDirty(true)} onSubmit={e => { e.preventDefault(); const values = readGroupValues(e.currentTarget);
    run(() => saveGroup(group.id, values, group.version ?? 0), `${String(values.name).trim()} settings saved.`, () => setDirty(false)); }} className="space-y-8">
    <fieldset disabled={pending} className="space-y-8">
      <section className="g-panel space-y-5" aria-labelledby="gs-basics">
        <h2 id="gs-basics">The basics</h2>
        <Field label="Group name"><input name="name" required maxLength={80} defaultValue={group.name} /></Field>
        <Field label="What kind of group?"><select name="typeId" defaultValue={group.type_id ?? ""}><option value="">No category</option>{types.filter(t => t.isActive || t.id === group.type_id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <AboutFields group={group} campuses={campuses} />
      </section>
      <section className="g-panel space-y-5" aria-labelledby="gs-join">
        <h2 id="gs-join">Finding and joining</h2>
        <JoiningFields group={group} />
      </section>
      <section className="g-panel space-y-5" aria-labelledby="gs-place">
        <h2 id="gs-place">Where it meets</h2>
        <PlaceFields group={group} />
      </section>
      <section className="g-panel space-y-2" aria-labelledby="gs-chat">
        <h2 id="gs-chat">Group chat</h2>
        <ChatFields group={group} />
      </section>
      <section className="g-panel space-y-5" aria-labelledby="gs-safety">
        <h2 id="gs-safety">Safety</h2>
        <SafetySelect name="safetyProfile" defaultValue={group.safety_profile ?? "standard"} />
      </section>
    </fieldset>
    {error && <Notice>{error}</Notice>}
    <div className="g-save-bar">
      <p className="text-[15px] text-muted-foreground" role="status">{dirty ? "You have changes that aren’t saved yet." : "All changes saved."}</p>
      <Submit pending={pending}>Save group settings</Submit>
    </div>
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
    } catch { setPhotoError("That photo couldn’t be used. Choose a JPG, PNG or WebP photo under 12 MB."); }
    finally { setPreparing(false); }
  }

  return <section className="g-panel" id="photo" aria-labelledby="gs-photo">
    <h2 id="gs-photo">Group photo</h2>
    <p className="g-row-sub">One square photo, shown everywhere this group appears: here and in the app on iPhone and Android.</p>
    <div className="g-photo-editor">
      <GroupAvatar name={name} url={url} size={148} className="g-photo-hero" />
      <div className="min-w-0 flex-1">
        <label className={cn("g-dropzone", dragging && "is-dragging")}
          onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) void choose(e.dataTransfer.files?.[0]); }}>
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void choose(file); }} />
          <span className="g-dropzone-icon"><ImagePlus className="size-6" strokeWidth={1.6} aria-hidden /></span>
          <strong>{url ? "Choose a new photo" : "Choose a photo"}</strong>
          <small>Or drag one here. JPG, PNG or WebP, up to 12 MB. You’ll fit it into a square next.</small>
        </label>
        <div className="g-photo-actions">
          <p className="g-row-sub" role="status">{preparing ? "Getting your photo ready…" : pending ? "Saving your photo…" : url ? "This photo shows in the app now." : "No photo yet. People see the group’s initials instead."}</p>
          {url && <Button variant="outline" disabled={busy} onClick={() => run(() => removeCover(id), `Photo removed from ${name}.`)}><Trash2 className="size-5" aria-hidden />Remove photo</Button>}
        </div>
      </div>
    </div>
    <div className="g-photo-sizes">
      <span>How it looks</span>
      {[["Groups list", 56], ["Messages", 40], ["Chat title", 28]].map(([caption, size]) => <div key={caption}><GroupAvatar name={name} url={url} size={size as number} /><small>{caption}</small></div>)}
    </div>
    {(error || photoError) && <Notice>{error || photoError}</Notice>}
    {photo && <ImageCropper file={photo} shape={{ label: "Group photo", hint: "A square, like the app shows.", ratio: 1 }} onCancel={() => setPhoto(null)} onConfirm={crop => {
      const data = new FormData(); data.set("cover", photo); data.set("crop", JSON.stringify(crop)); setPhoto(null);
      run(() => uploadCover(id, data), `New photo saved for ${name}.`);
    }} />}
  </section>;
}
