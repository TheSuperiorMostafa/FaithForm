"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteMedia, saveMedia } from "@/app/dashboard/website/actions";
import { recoveryHasStrings, websiteRecoveryKey, type WebsiteRecoveryScope } from "@/components/website-admin/draft-recovery";
import { DraftRecoveryNotice } from "@/components/website-admin/draft-recovery-notice";
import type { SaveResult } from "@/components/website-admin/autosave-queue";
import { flushWebsiteEdits, registerWebsiteEditor, type Editor } from "@/components/website-admin/editor-save-guard";
import { EditorField as Field } from "@/components/website-admin/editor-field";
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
  recoveryScope,
  canEdit,
  isLive = true,
}: {
  items: SiteMediaRow[];
  recoveryScope: WebsiteRecoveryScope;
  canEdit: boolean;
  isLive?: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const editorMounted = useRef(true);
  useEffect(() => {
    editorMounted.current = true;
    return () => { editorMounted.current = false; };
  }, []);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const creating = useRef<{ promise: Promise<SaveResult>; resolve: (result: SaveResult) => void } | null>(null);
  const manualEditor = useRef<Editor>({
    get hasUnsavedChanges() {
      const current = draftRef.current;
      return Boolean(creating.current || (current && !current.id && [current.title, current.series, current.speaker, current.publishedAt, current.videoUrl, current.thumbnailUrl].some(value => value.trim())));
    },
    flush: () => creating.current?.promise ?? Promise.resolve({ ok: false, error: "Choose Add sermon to keep this new sermon, or Cancel to discard it." }),
  });
  useEffect(() => registerWebsiteEditor(manualEditor.current), []);

  const editingExisting = Boolean(draft?.id);

  // Only an existing sermon autosaves. A new one is created by pressing the
  // button: writing rows for a half-typed title would leave a trail of empty
  // sermons behind every abandoned attempt.
  const { status, saveNow, adoptSaved, recovery, recoveryWarning, restoreRecovered, discardRecovered, backupDraft } = useAutosave(
    draft,
    async (value) => (value ? saveMedia(value) : { ok: true as const }),
    {
      enabled: canEdit && editingExisting,
      recoveryKey: canEdit ? websiteRecoveryKey(recoveryScope, "sermon-editor") : undefined,
      validateRecovery: isRecoveredSermon,
      autosaveRecovered: value => Boolean(canEdit && value?.id),
      backupWhenDisabled: value => Boolean(canEdit && value && !value.id),
    },
  );

  function create() {
    if (!draft || creating.current) return;
    let resolve!: (result: SaveResult) => void;
    const promise = new Promise<SaveResult>(done => { resolve = done; });
    creating.current = { promise, resolve };
    startTransition(async () => {
      let outcome: SaveResult = { ok: false, error: "The sermon has not been added. Try again." };
      try {
        // A thumbnail upload must finish before capturing the new sermon.
        // Exclude this manual-create form so it does not wait for itself.
        if (!(await flushWebsiteEdits(manualEditor.current))) return;
        const current = draftRef.current;
        if (!current) return;
        const result = await saveMedia(current);
        if (!result.ok) {
          toast.error(result.error);
          outcome = result;
          return;
        }
        toast.success(`“${current.title.trim()}” added to your website's sermons.`);
        adoptSaved(null);
        flushSync(() => setDraft(null));
        router.refresh();
        outcome = { ok: true };
      } catch (cause) {
        console.error("[website] Sermon creation failed:", cause);
        toast.error("We couldn’t confirm that the sermon was added. Refresh to check the list before adding it again.");
      } finally {
        creating.current?.resolve(outcome);
        creating.current = null;
      }
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
      try {
        if (!(await flushWebsiteEdits())) return;
        const result = await deleteMedia(row.id);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        if (draft?.id === row.id) setDraft(null);
        toast.success(`“${row.title}” deleted from your website.`);
        router.refresh();
      } catch (cause) {
        console.error("[website] Sermon deletion failed:", cause);
        toast.error("We couldn’t confirm that the sermon was deleted. Refresh to check its status, then try again.");
      }
    });
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <SectionHeader
        title="Sermons"
        description="Choose the sermons visitors can see when your website is live."
        action={
          canEdit ? (
            <Button type="button" size="lg" disabled={pending || Boolean(recovery)} onClick={async () => {
              if (await flushWebsiteEdits()) {
                const next = emptyDraft();
                adoptSaved(next);
                setDraft(next);
              }
            }}>
              <Plus className="size-5" aria-hidden /> Add sermon
            </Button>
          ) : null
        }
      />

      <DraftRecoveryNotice available={Boolean(recovery)} autosaves={Boolean(recovery?.value?.id)} warning={recoveryWarning} onRestore={() => {
        const restored = restoreRecovered();
        if (restored) setDraft(restored);
      }} onDiscard={discardRecovered} />

      {draft ? (
        <fieldset disabled={!canEdit || pending || Boolean(recovery)} className="rounded-2xl border border-accent/40 bg-card p-6 shadow-card">
          <h3 className="font-heading text-lg font-bold">
            {draft.id ? "Edit sermon" : "New sermon"}
          </h3>
          {draft.id ? (
            <p className="mt-1 text-[15px] text-muted-foreground">
              Changes save on their own and show on your website straight away.
            </p>
          ) : <p className="mt-1 text-[15px] text-muted-foreground">Choose Add sermon to keep this new sermon, or Cancel to discard it.</p>}

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
              onRecoverUpload={url => { if (!editorMounted.current) backupDraft(current => current && current.id === draft.id ? { ...current, thumbnailUrl: url } : current); }}
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
                  onClick={async () => { if (await flushWebsiteEdits()) setDraft(null); }}
                >
                  Done
                </Button>
                <SaveStatus status={status} onRetry={() => void saveNow()} />
              </>
            ) : (
              <>
                <Button type="button" onClick={create} disabled={pending}>
                  {pending ? "Adding…" : "Add sermon"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { adoptSaved(null); setDraft(null); }}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
        </fieldset>
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
                    {row.isPublished ? isLive ? "On your website" : "Ready to publish" : "Hidden"}
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
                    disabled={pending || Boolean(recovery)}
                    onClick={async () => {
                      if (await flushWebsiteEdits()) {
                        const next = toDraft(row);
                        adoptSaved(next);
                        setDraft(next);
                      }
                    }}
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
function isRecoveredSermon(value: unknown): value is Draft {
  return recoveryHasStrings(value, ["title", "series", "speaker", "publishedAt", "videoUrl", "thumbnailUrl"]) && typeof value.isPublished === "boolean" && (value.id === undefined || typeof value.id === "string");
}
