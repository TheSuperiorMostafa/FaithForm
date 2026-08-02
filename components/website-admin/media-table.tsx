"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteMedia, saveMedia } from "@/app/dashboard/website/actions";
import { ImageUploadField } from "@/components/website-admin/image-upload-field";
import { Button } from "@/components/ui/button";
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

  function save() {
    if (!draft) return;
    startTransition(async () => {
      const result = await saveMedia(draft);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Message saved.");
      setDraft(null);
    });
  }

  function remove(row: SiteMediaRow) {
    startTransition(async () => {
      const result = await deleteMedia(row.id);
      result.ok
        ? toast.success("Message removed.")
        : toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          What shows in the Sermons section of your website.
        </p>
        <Button
          type="button"
          size="sm"
          disabled={!canEdit}
          onClick={() => setDraft(emptyDraft())}
        >
          <Plus className="mr-1 size-4" /> Add message
        </Button>
      </div>

      {draft ? (
        <div className="rounded-2xl border border-accent/40 bg-card p-5 shadow-card">
          <h2 className="font-heading text-lg font-bold">
            {draft.id ? "Edit message" : "New message"}
          </h2>

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
            <Label htmlFor="media-published" className="text-sm font-semibold">
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

          <div className="mt-5 flex gap-2">
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save message"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No messages yet. Add one and it appears on your website straight away.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-card"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-heading text-base font-bold">
                    {row.title}
                  </span>
                  {!row.isPublished ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Hidden
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {[row.series, row.speaker, row.publishedAt]
                    .filter(Boolean)
                    .join(" · ") || "No details"}
                </p>
              </div>

              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${row.title}`}
                  disabled={!canEdit || pending}
                  onClick={() => setDraft(toDraft(row))}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${row.title}`}
                  disabled={!canEdit || pending}
                  onClick={() => remove(row)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
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
      <Label className="text-sm font-semibold">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
      {children}
    </div>
  );
}
