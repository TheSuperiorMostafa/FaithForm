"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ExternalLink, FileText, Link2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  addItemLinkAction,
  confirmItemFileAction,
  createItemFileUploadAction,
  deleteItemFileAction,
  getPlanFileUrlAction,
} from "@/app/dashboard/plans/item-file-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { PlanFile } from "@/lib/service-plans/types";
import { cn } from "@/lib/utils";

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.txt,.mp3,.m4a,application/pdf,image/png,image/jpeg,text/plain,audio/mpeg,audio/mp4";

/** The storage bucket takes these types; browsers name some of them differently. */
function uploadType(file: File): string | null {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "application/pdf";
  if (type === "image/png" || name.endsWith(".png")) return "image/png";
  if (type === "image/jpeg" || /\.jpe?g$/.test(name)) return "image/jpeg";
  if (type === "text/plain" || name.endsWith(".txt")) return "text/plain";
  if (type === "audio/mpeg" || type === "audio/mp3" || name.endsWith(".mp3")) return "audio/mpeg";
  if (type === "audio/mp4" || type === "audio/x-m4a" || type === "audio/m4a" || name.endsWith(".m4a")) return "audio/mp4";
  return null;
}

/** Opens a stored file through a short-lived signed URL; links open as they are. */
export async function openPlanFile(file: PlanFile) {
  if (file.url) {
    window.open(file.url, "_blank", "noopener,noreferrer");
    return;
  }
  // Opened before the request so the browser doesn't treat it as a pop-up.
  const win = window.open("about:blank", "_blank");
  const result = await getPlanFileUrlAction(file.source, file.id);
  if (!result.ok) {
    win?.close();
    toast.error(result.error);
    return;
  }
  if (win) {
    win.opener = null;
    win.location.href = result.url;
  } else {
    window.location.href = result.url;
  }
}

/**
 * Files on one plan item: its own (upload, link, delete) and, for a song, the
 * song's files from the library (opened here, managed on the song's page).
 */
export function ItemFiles({
  itemId,
  songId,
  files,
  onChanged,
}: {
  itemId: string;
  songId: string | null;
  files: PlanFile[];
  onChanged: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [addingLink, startLink] = useTransition();
  const own = files.filter((f) => f.source === "item");
  const fromSong = files.filter((f) => f.source === "song");
  const inputId = `item-file-${itemId}`;

  const upload = async (file: File) => {
    const type = uploadType(file);
    if (!type) return void toast.error("Upload a PDF, a picture (PNG or JPEG), a text file, or MP3 or M4A audio.");
    if (file.size > MAX_BYTES) return void toast.error("That file is larger than 20 MB. Try a smaller copy.");
    setUploading(true);
    try {
      const ticket = await createItemFileUploadAction(itemId, file.name, type);
      if (!ticket.ok) return void toast.error(ticket.error);
      const { error } = await createClient()
        .storage.from("song-files")
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: type, upsert: false });
      if (error) return void toast.error("The upload didn't finish. Check your connection and try again.");
      const saved = await confirmItemFileAction({ itemId, path: ticket.path, fileName: file.name });
      if (!saved.ok) return void toast.error(saved.error);
      toast.success(`Added “${file.name}” to this item.`);
      onChanged();
    } finally {
      setUploading(false);
    }
  };

  const remove = async (file: PlanFile) => {
    const ok = await confirmAction({
      title: `Delete “${file.name}”?`,
      description: file.isFile ? "The file is deleted for good." : "The link is removed from this item.",
      confirmLabel: file.isFile ? "Delete file" : "Remove link",
      destructive: true,
    });
    if (!ok) return;
    const result = await deleteItemFileAction(file.id);
    if (!result.ok) return void toast.error(result.error);
    toast.success(`Deleted “${file.name}”.`);
    onChanged();
  };

  const addLink = (event: React.FormEvent) => {
    event.preventDefault();
    setLinkError(null);
    startLink(async () => {
      const result = await addItemLinkAction(itemId, url, label);
      if (!result.ok) return void setLinkError(result.error);
      setUrl("");
      setLabel("");
      toast.success("Added the link to this item.");
      onChanged();
    });
  };

  const row = (file: PlanFile, removable: boolean) => {
    const Icon = file.isFile ? (file.detail?.startsWith("Chord chart") ? FileText : Paperclip) : Link2;
    return (
      <li key={`${file.source}-${file.id}`} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{file.name}</span>
          {file.detail && <span className="block truncate text-sm text-muted-foreground">{file.detail}</span>}
        </span>
        <Button variant="outline" size="sm" onClick={() => void openPlanFile(file)}>
          <ExternalLink aria-hidden />
          Open
        </Button>
        {removable && (
          <Button variant="ghost" size="sm" onClick={() => void remove(file)} aria-label={`Delete ${file.name}`}>
            <Trash2 aria-hidden />
            Delete
          </Button>
        )}
      </li>
    );
  };

  return (
    <section className="space-y-3" aria-labelledby={`${inputId}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${inputId}-title`} className="text-[15px] font-semibold">
          Files
        </h3>
        <label
          htmlFor={inputId}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
            uploading && "pointer-events-none opacity-50",
          )}
        >
          <Upload aria-hidden />
          {uploading ? "Uploading…" : "Upload a file"}
          <input
            id={inputId}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
      </div>

      {own.length > 0 && <ul className="divide-y divide-border rounded-xl border border-border">{own.map((f) => row(f, true))}</ul>}

      {fromSong.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            From the song library.{" "}
            {songId && (
              <Link href={`/dashboard/plans/songs/${songId}`} className="font-semibold text-primary underline-offset-2 hover:underline dark:text-accent">
                Manage the song’s files
              </Link>
            )}
          </p>
          <ul className="divide-y divide-border rounded-xl border border-border">{fromSong.map((f) => row(f, false))}</ul>
        </div>
      )}

      {own.length === 0 && fromSong.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No files yet. Anyone you share the plan with sees the files here, up to 20 MB each.
        </p>
      )}

      <form onSubmit={addLink} className="space-y-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${inputId}-url`}>Link to a video, recording or chart</Label>
          <Input
            id={`${inputId}-url`}
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            maxLength={2048}
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor={`${inputId}-label`}>Name (optional)</Label>
            <Input id={`${inputId}-label`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Rehearsal track" maxLength={255} />
          </div>
          <Button type="submit" variant="outline" disabled={addingLink || !url.trim()}>
            <Link2 aria-hidden />
            {addingLink ? "Adding…" : "Add link"}
          </Button>
        </div>
        {linkError && (
          <p role="alert" className="text-sm text-destructive">
            {linkError}
          </p>
        )}
      </form>
    </section>
  );
}
