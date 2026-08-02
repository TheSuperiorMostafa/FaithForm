"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import {
  saveSiteDetails,
  type SavedRowIds,
  type SiteDetailsInput,
} from "@/app/dashboard/website/actions";
import { ImageUploadField } from "@/components/website-admin/image-upload-field";
import { SaveStatus } from "@/components/website-admin/save-status";
import { SitePreview } from "@/components/website-admin/site-preview";
import { useAutosave } from "@/components/website-admin/use-autosave";
import { Button } from "@/components/ui/button";
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

type ServiceRow = SiteDetailsInput["serviceTimes"][number];
type StaffRow = SiteDetailsInput["staff"][number];

function newId() {
  return Math.random().toString(36).slice(2);
}

export function DetailsForm({
  initial,
  canEdit,
  previewUrl,
}: {
  initial: SiteDetailsInput;
  canEdit: boolean;
  previewUrl: string;
}) {
  const [form, setForm] = useState<SiteDetailsInput>(initial);
  const [savedAt, setSavedAt] = useState(0);
  const router = useRouter();

  const set = <K extends keyof SiteDetailsInput>(
    key: K,
    value: SiteDetailsInput[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const { status } = useAutosave(
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
    { enabled: canEdit },
  );

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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-muted-foreground">
            Everything your website says about your church, editable here.
            Changes save on their own. These are shared details — changing a
            service time also updates what your phone assistant tells callers.
          </p>
          <SaveStatus status={status} />
        </div>

        <Panel title="Your church">
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
            help="Shown in the header and footer. A square image works best."
            // Never cropped: the site renders logos with object-fit: contain,
            // and trimming a wordmark is worse than letterboxing it.
            aspect="free"
            value={form.logoUrl}
            disabled={!canEdit}
            onChange={(url) => set("logoUrl", url)}
          />
          <ImageUploadField
            label="Cover photo"
            help="The banner across the very top of your page. The photo beside your welcome text is set separately, in Pages → About."
            aspect="banner"
            value={form.coverImageUrl}
            disabled={!canEdit}
            onChange={(url) => set("coverImageUrl", url)}
          />
        </Panel>

        <Panel title="Where to find you">
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
          action={
            canEdit ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
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
              No services yet. Add one and the times strip appears on your site.
            </p>
          ) : (
            times.map((row, i) => (
              <div
                key={row.clientId}
                // Fixed tracks for the day and time so every row lines up,
                // rather than each sizing to its own content.
                className="grid items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_11rem_9rem_auto]"
              >
                <Input
                  placeholder="Sunday Worship"
                  value={row.label}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const next = [...times];
                    next[i] = { ...row, label: e.target.value };
                    set("serviceTimes", next);
                  }}
                />
                <Select
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
                <Input
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
                  size="icon"
                  aria-label={`Remove ${row.label || `service ${i + 1}`}`}
                  disabled={!canEdit}
                  onClick={() =>
                    set(
                      "serviceTimes",
                      times.filter((_, index) => index !== i),
                    )
                  }
                >
                  <Trash2 className="size-4" />
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
                size="sm"
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
              No one added yet. People marked public appear in your team section.
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
                    <Input
                      placeholder="Full name"
                      value={row.fullName}
                      disabled={!canEdit}
                      onChange={(e) => update({ fullName: e.target.value })}
                    />
                    <Input
                      placeholder="Role, e.g. Lead Pastor"
                      value={row.title}
                      disabled={!canEdit}
                      onChange={(e) => update({ title: e.target.value })}
                    />
                  </div>
                  <Textarea
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
                  />
                  <div className="flex items-center justify-between gap-4">
                    <Label className="text-sm font-medium">Show on the website</Label>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={row.isPublic}
                        disabled={!canEdit}
                        onCheckedChange={(checked) => update({ isPublic: checked })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${row.fullName || `person ${i + 1}`}`}
                        disabled={!canEdit}
                        onClick={() =>
                          set(
                            "staff",
                            staff.filter((_, index) => index !== i),
                          )
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </Panel>

        <Panel title="Vision and mission" description="The website shows a shortened version of these.">
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

        {!canEdit ? (
          <p className="text-xs text-muted-foreground">
            Only church admins can change these.
          </p>
        ) : (
          <SaveStatus status={status} />
        )}
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
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-bold">{title}</h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  help,
  required,
  children,
}: {
  label: string;
  help?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-semibold">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {/* Help sits below the control, not between label and control. Above it,
       * a field with help pushes its input down and stops lining up with the
       * field beside it in the same row. */}
      {children}
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}
