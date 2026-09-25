"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteMedia, saveMedia } from "@/app/dashboard/website/actions";
import { ImageUploadField } from "@/components/website-admin/image-upload-field";
import { SaveStatus } from "@/components/website-admin/save-status";
import { useAutosave } from "@/components/website-admin/use-autosave";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { SectionHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SiteMediaRow } from "@/lib/sites/queries";

type Draft = {
  id?: string;
  title: string;
  series: string;
  speaker: string;
  publishedAt: string;
  videoUrl: string;
  thumbnailUrl: string;
  isPublished: boolean;
};

function emptyDraft(): Draft {
  return {
    title: "",
    series: "",
    speaker: "",
    publishedAt: "",
    videoUrl: "",
    thumbnailUrl: "",
    isPublished: true,
  };
}

function toDraft(row: SiteMediaRow): Draft {
  return {
    id: row.id,
    title: row.title,
    series: row.series ?? "",
    speaker: row.speaker ?? "",
    publishedAt: row.publishedAt ?? "",
    videoUrl: row.videoUrl ?? "",
    thumbnailUrl: row.thumbnailUrl ?? "",
    isPublished: row.isPublished,
  };
}

export function MediaTable({
  items,
  canEdit,
}: {
  items: SiteMediaRow[];
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const editingExisting = Boolean(draft?.id);

  // Only an existing sermon autosaves. A new one is created by pressing the
  // button: writing rows for a half-typed title would leave a trail of empty
  // sermons behind every abandoned attempt.
  const { status } = useAutosave(
    draft,
    async (value) => (value ? saveMedia(value) : { ok: true as const }),
    { enabled: canEdit && editingExisting },
  );

  function create() {
    if (!draft) return;
    startTransition(async () => {
      const result = await saveMedia(draft);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`“${draft.title.trim()}” added to your website's sermons.`);
      setDraft(null);
      router.refresh();
    });
  }

  async function remove(row: SiteMediaRow) {
    const ok = await confirmAction({
      title: `Delete “${row.title}”?`,
      description:
        "It disappears from the Sermons section of your website straight away. This can't be undone. To keep it but hide it, edit it and switch off “Show on the website” instead.",
      confirmLabel: "Delete sermon",
      destructive: true,
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await deleteMedia(row.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (draft?.id === row.id) setDraft(null);
      toast.success(`“${row.title}” deleted from your website.`);
      router.refresh();
    });
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <SectionHeader
        title="Sermons"
        description="The sermons listed in the Sermons section of your website. New ones show up straight away."
        action={
          canEdit ? (
            <Button type="button" size="lg" onClick={() => setDraft(emptyDraft())}>
              <Plus className="size-5" aria-hidden /> Add sermon
            </Button>
          ) : null
        }
      />

      {draft ? (
        <div className="rounded-2xl border border-accent/40 bg-card p-6 shadow-card">
          <h3 className="font-heading text-lg font-bold">
            {draft.id ? "Edit sermon" : "New sermon"}
          </h3>
          {draft.id ? (
            <p className="mt-1 text-[15px] text-muted-foreground">
              Changes save on their own and show on your website straight away.
            </p>
          ) : null}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Title" required>
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </Field>
            <Field label="Series">
              <Input
                value={draft.series}
                onChange={(e) => setDraft({ ...draft, series: e.target.value })}
              />
            </Field>
            <Field label="Speaker">
              <Input
                value={draft.speaker}
                onChange={(e) => setDraft({ ...draft, speaker: e.target.value })}
              />
            </Field>
            <Field label="Date preached">
              <Input
                type="date"
                value={draft.publishedAt}
                onChange={(e) =>
                  setDraft({ ...draft, publishedAt: e.target.value })
                }
              />
            </Field>
            <Field label="Video link" help="YouTube, Vimeo, or a direct file.">
              <Input
                value={draft.videoUrl}
                onChange={(e) => setDraft({ ...draft, videoUrl: e.target.value })}
              />
            </Field>
            <ImageUploadField
              label="Thumbnail"
              help="Shown in the sermon list and behind the play button. Optional."
              aspect="video"
              value={draft.thumbnailUrl}
              onChange={(url) => setDraft({ ...draft, thumbnailUrl: url })}
            />
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
            <Label htmlFor="media-published" className="text-[15px] font-semibold">
              Show on the website
            </Label>
            <Switch
              id="media-published"
              checked={draft.isPublished}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, isPublished: checked })
              }
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {editingExisting ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDraft(null)}
                >
                  Done
                </Button>
                <SaveStatus status={status} />
              </>
            ) : (
              <>
                <Button type="button" onClick={create} disabled={pending}>
                  {pending ? "Adding…" : "Add sermon"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
          <p className="font-heading text-lg font-bold">No sermons yet</p>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Add one and it appears on your website straight away.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-card">
          {items.map((row) => (
            <li
              key={row.id}
              className="flex min-h-[72px] flex-wrap items-center gap-3 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-heading text-base font-bold">
                    {row.title}
                  </span>
                  <StatusBadge tone={row.isPublished ? "done" : "neutral"}>
                    {row.isPublished ? "On your website" : "Hidden"}
                  </StatusBadge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {[row.series, row.speaker, row.publishedAt]
                    .filter(Boolean)
                    .join(" · ") || "No details"}
                </p>
              </div>

              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Edit ${row.title}`}
                    disabled={pending}
                    onClick={() => setDraft(toDraft(row))}
                  >
                    <Pencil className="size-4" aria-hidden /> Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    aria-label={`Delete ${row.title}`}
                    disabled={pending}
                    onClick={() => void remove(row)}
                  >
                    <Trash2 className="size-4" aria-hidden /> Delete
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
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
      <Label className="text-[15px] font-semibold">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {/* Below the control, so a field with help still lines up with one
       * without it when they share a row. */}
      {children}
      {help ? <p className="text-sm text-muted-foreground">{help}</p> : null}
    </div>
  );
}
