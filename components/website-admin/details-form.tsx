"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import {
  saveSiteDetails,
  type SavedRowIds,
  type SiteDetailsInput,
} from "@/app/dashboard/website/actions";
import { recoveryHasStrings, websiteRecoveryKey, type WebsiteRecoveryScope } from "@/components/website-admin/draft-recovery";
import { DraftRecoveryNotice } from "@/components/website-admin/draft-recovery-notice";
import { DesignForm, type DesignFormProps } from "@/components/website-admin/design-form";
import { EditorField as Field } from "@/components/website-admin/editor-field";
import { ImageUploadField } from "@/components/website-admin/image-upload-field";
import { LiveEditsNote } from "@/components/website-admin/live-edits-note";
import { SaveStatus } from "@/components/website-admin/save-status";
import { SitePreview } from "@/components/website-admin/site-preview";
import { useAutosave } from "@/components/website-admin/use-autosave";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DAY_OF_WEEK_LABELS } from "@/types/church-profile";

/**
 * The church facts the website renders, editable without leaving this tab.
 *
 * These are profile fields, not website copy — saving here updates the same
 * records the phone assistant and reports read. That is stated on the page
 * rather than left to be discovered.
 */

type StaffRow = SiteDetailsInput["staff"][number];

function newId() {
  return Math.random().toString(36).slice(2);
}

/** Where the same church details are also edited, so it reads as one set. */
const SHARED_NOTE = "Also shown in Settings → Church info.";

export function DetailsForm({
  initial,
  recoveryScope,
  canEdit,
  previewUrl,
  isLive,
  design,
}: {
  initial: SiteDetailsInput;
  recoveryScope: WebsiteRecoveryScope;
  canEdit: boolean;
  previewUrl: string;
  isLive: boolean;
  /** Theme and colours, rendered as the "Look" part of this page. */
  design?: DesignFormProps;
}) {
  const [form, setForm] = useState<SiteDetailsInput>(initial);
  const editorMounted = useRef(true);
  useEffect(() => {
    editorMounted.current = true;
    return () => { editorMounted.current = false; };
  }, []);
  const [savedAt, setSavedAt] = useState(0);
  const router = useRouter();
  const [view, setView] = useState<DetailsView>("details");
  // Old /design links and bookmarks arrive as #look.
  useEffect(() => {
    if (window.location.hash === "#look") setView("look");
  }, []);

  const set = <K extends keyof SiteDetailsInput>(
    key: K,
    value: SiteDetailsInput[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const { status, saveNow, recovery, recoveryWarning, restoreRecovered, discardRecovered, backupDraft } = useAutosave(
    form,
    async (value) => {
      const result = await saveSiteDetails(value);
      if (result.ok) {
        adoptIds(result.serviceTimes, result.staff);
        // Refresh the preview and the server-rendered copy of this form.
        setSavedAt(Date.now());
        router.refresh();
      }
      return result;
    },
    {
      enabled: canEdit,
      recoveryKey: canEdit ? websiteRecoveryKey(recoveryScope, "details") : undefined,
      validateRecovery: isRecoveredDetails,
    },
  );

  useEffect(() => {
    if (status.kind === "error") toast.error(`Your church details have not saved. ${status.message}`);
  }, [status]);

  /**
   * Take on the ids the database assigned to rows this form created.
   *
   * Only when something actually changed: writing state unconditionally would
   * make the form look edited again, autosave once more, and never settle.
   */
  function adoptIds(times: SavedRowIds, people: SavedRowIds) {
    setForm((current) => {
      const timeId = new Map(times.map((r) => [r.clientId, r.id]));
      const staffId = new Map(people.map((r) => [r.clientId, r.id]));

      let changed = false;
      const nextTimes = current.serviceTimes.map((row) => {
        const id = timeId.get(row.clientId);
        if (!id || row.id === id) return row;
        changed = true;
        return { ...row, id };
      });
      const nextStaff = current.staff.map((row) => {
        const id = staffId.get(row.clientId);
        if (!id || row.id === id) return row;
        changed = true;
        return { ...row, id };
      });

      return changed
        ? { ...current, serviceTimes: nextTimes, staff: nextStaff }
        : current;
    });
  }

  const times = form.serviceTimes ?? [];
  const staff = form.staff ?? [];

  async function removeService(index: number) {
    const row = times[index];
    const name = row?.label.trim() || "this service";
    const ok = await confirmAction({
      title: `Remove ${name}?`,
      description: `This also removes ${name} from attendance and from what your phone assistant tells callers. Services already recorded stay in your history.`,
      confirmLabel: "Remove service",
      destructive: true,
    });
    if (!ok) return;
    setForm(current => ({
      ...current,
      serviceTimes: current.serviceTimes.filter(item => item.clientId !== row.clientId),
    }));
  }

  async function removePerson(index: number) {
    const row = staff[index];
    const name = row?.fullName.trim() || "this person";
    const ok = await confirmAction({
      title: `Remove ${name}?`,
      description: `${name} will be taken off your website's team section and your church details, including what your phone assistant knows about your staff.`,
      confirmLabel: "Remove person",
      destructive: true,
    });
    if (!ok) return;
    setForm(current => ({
      ...current,
      staff: current.staff.filter(item => item.clientId !== row.clientId),
    }));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
      <div className="flex min-w-0 flex-col gap-6">
        <LiveEditsNote isLive={isLive} />

        {design ? (
          <SegmentedControl
            label="Show"
            value={view}
            options={VIEW_OPTIONS}
            onChange={setView}
            className="shadow-card dark:shadow-none"
          />
        ) : null}

        {/* Hidden rather than unmounted, so switching never loses an edit. */}
        <div className={view === "details" ? "flex min-w-0 flex-col gap-6" : "hidden"}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h2 className="font-heading text-xl font-bold">Details</h2>
              <p className="max-w-xl text-[15px] text-muted-foreground">
                What your website says about your church. These details are
                shared: changing a service time also updates the app, attendance,
                and what your phone assistant tells callers.
              </p>
            </div>
            {canEdit ? <SaveStatus status={status} onRetry={() => void saveNow()} /> : null}
          </div>

          <DraftRecoveryNotice available={Boolean(recovery)} warning={recoveryWarning} onRestore={() => {
            const restored = restoreRecovered();
            if (restored) setForm(restored);
          }} onDiscard={discardRecovered} />
          <fieldset disabled={Boolean(recovery)} className="flex min-w-0 flex-col gap-6">

          <Panel title="Your church" description={SHARED_NOTE}>
            <Field label="Church name" required>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Denomination or sub-line" help="Shown under your name in the header.">
              <Input
                value={form.denomination}
                onChange={(e) => set("denomination", e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <ImageUploadField
              label="Logo"
              help="Shown in the header and footer, and as your church's picture in the app. Also in Settings → Church info."
              // One logo feeds the site and the apps, and the apps show it
              // square, so it is framed here rather than centre-cropped there.
              aspect="logo"
              value={form.logoUrl}
              disabled={!canEdit}
              onChange={(url) => set("logoUrl", url)}
              onRecoverUpload={url => { if (!editorMounted.current) backupDraft(current => ({ ...current, logoUrl: url })); }}
            />
            <ImageUploadField
              label="Cover photo"
              help="Your banner photo, and the top of your church's page in the app. Changing it here changes both. Also in Settings → Church info."
              // Shared with the apps, so it is framed at their shape rather than
              // as the hero strip — the same cover crop on every surface.
              aspect="cover"
              value={form.coverImageUrl}
              disabled={!canEdit}
              onChange={(url) => set("coverImageUrl", url)}
              onRecoverUpload={url => { if (!editorMounted.current) backupDraft(current => ({ ...current, coverImageUrl: url })); }}
            />
          </Panel>

          <Panel title="Where to find you" description={SHARED_NOTE}>
            <Field label="Street address">
              <Input
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="City">
                <Input value={form.city} onChange={(e) => set("city", e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="State">
                <Input value={form.state} onChange={(e) => set("state", e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="ZIP">
                <Input value={form.zip} onChange={(e) => set("zip", e.target.value)} disabled={!canEdit} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label="Email" help="Where contact-form messages are sent.">
                <Input value={form.email} onChange={(e) => set("email", e.target.value)} disabled={!canEdit} />
              </Field>
            </div>
          </Panel>

          <Panel
            title="Service times"
            description={SHARED_NOTE}
            action={
              canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    set("serviceTimes", [
                      ...times,
                      { clientId: newId(), label: "", dayOfWeek: 0, startTime: "10:00" },
                    ])
                  }
                >
                  <Plus className="mr-1 size-4" /> Add service
                </Button>
              ) : null
            }
          >
            {times.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No services yet. Add one, then turn on Service times strip in Pages when hidden.
              </p>
            ) : (
              times.map((row, i) => (
                <div
                  key={row.clientId}
                  // Fixed tracks for the day and time so every row lines up,
                  // rather than each sizing to its own content.
                  className="grid items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_11rem_9rem_auto]"
                >
                  <Label htmlFor={`service-${row.clientId}-label`} className="sr-only">Service name</Label>
                  <Input
                    id={`service-${row.clientId}-label`}
                    placeholder="Sunday Worship"
                    value={row.label}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const next = [...times];
                      next[i] = { ...row, label: e.target.value };
                      set("serviceTimes", next);
                    }}
                  />
                  <Label htmlFor={`service-${row.clientId}-day`} className="sr-only">Day for {row.label || `service ${i + 1}`}</Label>
                  <Select
                    id={`service-${row.clientId}-day`}
                    value={row.dayOfWeek}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const next = [...times];
                      next[i] = { ...row, dayOfWeek: Number(e.target.value) };
                      set("serviceTimes", next);
                    }}
                  >
                    {DAY_OF_WEEK_LABELS.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </Select>
                  <Label htmlFor={`service-${row.clientId}-time`} className="sr-only">Start time for {row.label || `service ${i + 1}`}</Label>
                  <Input
                    id={`service-${row.clientId}-time`}
                    type="time"
                    value={row.startTime}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const next = [...times];
                      next[i] = { ...row, startTime: e.target.value };
                      set("serviceTimes", next);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove ${row.label || `service ${i + 1}`}`}
                    disabled={!canEdit}
                    onClick={() => void removeService(i)}
                  >
                    <Trash2 className="size-4" aria-hidden /> Remove
                  </Button>
                </div>
              ))
            )}
          </Panel>

          <Panel
            title="Your team"
            action={
              canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    set("staff", [
                      ...staff,
                      { clientId: newId(), fullName: "", title: "", bio: "", photoUrl: "", isPublic: true },
                    ])
                  }
                >
                  <Plus className="mr-1 size-4" /> Add person
                </Button>
              ) : null
            }
          >
            {staff.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No one added yet. Add public people here, then turn on Our team in Pages when hidden.
              </p>
            ) : (
              staff.map((row, i) => {
                const update = (patch: Partial<StaffRow>) => {
                  const next = [...staff];
                  next[i] = { ...row, ...patch };
                  set("staff", next);
                };

                return (
                  <div
                    key={row.clientId}
                    className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Label htmlFor={`staff-${row.clientId}-name`} className="sr-only">Name for team member {i + 1}</Label>
                      <Input
                        id={`staff-${row.clientId}-name`}
                        placeholder="Full name"
                        value={row.fullName}
                        disabled={!canEdit}
                        onChange={(e) => update({ fullName: e.target.value })}
                      />
                      <Label htmlFor={`staff-${row.clientId}-role`} className="sr-only">Role for {row.fullName || `team member ${i + 1}`}</Label>
                      <Input
                        id={`staff-${row.clientId}-role`}
                        placeholder="Role, e.g. Lead Pastor"
                        value={row.title}
                        disabled={!canEdit}
                        onChange={(e) => update({ title: e.target.value })}
                      />
                    </div>
                    <Label htmlFor={`staff-${row.clientId}-bio`} className="sr-only">Biography for {row.fullName || `team member ${i + 1}`}</Label>
                    <Textarea
                      id={`staff-${row.clientId}-bio`}
                      rows={2}
                      placeholder="A sentence about them"
                      value={row.bio}
                      disabled={!canEdit}
                      onChange={(e) => update({ bio: e.target.value })}
                    />
                    <ImageUploadField
                      label="Photo"
                      aspect="portrait"
                      value={row.photoUrl}
                      disabled={!canEdit}
                      onChange={(url) => update({ photoUrl: url })}
                      onRecoverUpload={url => {
                        if (editorMounted.current) return;
                        backupDraft(current => ({ ...current, staff: current.staff.map(person => person.clientId === row.clientId ? { ...person, photoUrl: url } : person) }));
                      }}
                    />
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor={`staff-${row.clientId}-public`} className="text-[15px] font-medium">Show on the website</Label>
                      <div className="flex items-center gap-2">
                        <Switch
                          id={`staff-${row.clientId}-public`}
                          aria-label={`Show ${row.fullName || `team member ${i + 1}`} on the website`}
                          checked={row.isPublic}
                          disabled={!canEdit}
                          onCheckedChange={(checked) => update({ isPublic: checked })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={`Remove ${row.fullName || `person ${i + 1}`}`}
                          disabled={!canEdit}
                          onClick={() => void removePerson(i)}
                        >
                          <Trash2 className="size-4" aria-hidden /> Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </Panel>

          <Panel title="Vision and mission" description="Used when this section has no saved wording. Show or hide the section in Pages.">
            <Field label="Vision statement">
              <Textarea
                rows={3}
                value={form.visionStatement}
                disabled={!canEdit}
                onChange={(e) => set("visionStatement", e.target.value)}
              />
            </Field>
            <Field label="Mission statement">
              <Textarea
                rows={3}
                value={form.missionStatement}
                disabled={!canEdit}
                onChange={(e) => set("missionStatement", e.target.value)}
              />
            </Field>
          </Panel>

          </fieldset>

          {!canEdit ? (
            <p className="text-sm text-muted-foreground">
              Only church admins can change these.
            </p>
          ) : (
            <SaveStatus status={status} onRetry={() => void saveNow()} />
          )}
        </div>

        {design ? (
          <div className={view === "look" ? undefined : "hidden"}>
            <DesignForm
              {...design}
              recoveryScope={recoveryScope}
              canEdit={canEdit}
              isLive={isLive}
              onSaved={() => { setSavedAt(Date.now()); router.refresh(); }}
            />
          </div>
        ) : null}
      </div>

      <SitePreview previewUrl={previewUrl} refreshToken={savedAt} sticky />
    </div>
  );
}

function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-bold">{title}</h2>
          {description ? (
            <p className="text-[15px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
type DetailsView = "details" | "look";

/** Details or Look, one at a time, so the look is one tap away instead of a long scroll. */
const VIEW_OPTIONS: { value: DetailsView; label: string }[] = [
  { value: "details", label: "Details" },
  { value: "look", label: "Look" },
];

function isRecoveredDetails(value: unknown): value is SiteDetailsInput {
  if (!recoveryHasStrings(value, ["name", "denomination", "logoUrl", "coverImageUrl", "address", "city", "state", "zip", "phone", "email", "googleMapsUrl", "missionStatement", "visionStatement"])) return false;
  if (!Array.isArray(value.serviceTimes) || !Array.isArray(value.staff)) return false;
  return value.serviceTimes.every(row => recoveryHasStrings(row, ["clientId", "label", "startTime"]) && typeof row.dayOfWeek === "number" && (row.id === undefined || typeof row.id === "string"))
    && value.staff.every(row => recoveryHasStrings(row, ["clientId", "fullName", "title", "bio", "photoUrl"]) && typeof row.isPublic === "boolean" && (row.id === undefined || typeof row.id === "string"));
}
