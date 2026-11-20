"use client";

import { useState, useTransition } from "react";
import { ExternalLink, FileText, Link2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  addAttachmentLinkAction,
  confirmAttachmentAction,
  createAttachmentUploadAction,
  deleteAttachmentAction,
  getAttachmentUrlAction,
} from "@/app/dashboard/plans/songs/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { SongAttachment } from "@/lib/service-plans/songs/types";
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

const KIND_LABELS: Record<SongAttachment["kind"], string> = {
  chart_pdf: "Chord chart PDF",
  audio_link: "Link",
  file: "File",
};

export function SongAttachments({
  arrangementId,
  initial,
}: {
  arrangementId: string;
  initial: SongAttachment[];
}) {
  const [files, setFiles] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [addingLink, startLink] = useTransition();
  const inputId = `song-file-${arrangementId}`;

  const upload = async (file: File) => {
    const type = uploadType(file);
    if (!type) {
      toast.error("Upload a PDF, a picture (PNG or JPEG), a text file, or MP3 or M4A audio.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("That file is larger than 20 MB. Try a smaller copy.");
      return;
    }
    setUploading(true);
    try {
      const ticket = await createAttachmentUploadAction(arrangementId, file.name, type);
      if (!ticket.ok) {
        toast.error(ticket.error);
        return;
      }
      const { error } = await createClient()
        .storage.from("song-files")
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: type, upsert: false });
      if (error) {
        toast.error("The upload didn't finish. Check your connection and try again.");
        return;
      }
      const saved = await confirmAttachmentAction({ arrangementId, path: ticket.path, fileName: file.name });
      if (!saved.ok) {
        toast.error(saved.error);
        return;
      }
      setFiles((list) => [...list, saved.attachment]);
      toast.success(`Added “${saved.attachment.name}” to this arrangement.`);
    } finally {
      setUploading(false);
    }
  };

  const open = async (file: SongAttachment) => {
    // Opened before the request so the browser doesn't treat it as a pop-up.
    const win = window.open("about:blank", "_blank");
    const result = await getAttachmentUrlAction(file.id);
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
  };

  const remove = async (file: SongAttachment) => {
    const ok = await confirmAction({
      title: `Delete “${file.name}”?`,
      description: file.isFile ? "The file is deleted for good." : "The link is removed from this arrangement.",
      confirmLabel: file.isFile ? "Delete file" : "Remove link",
      destructive: true,
    });
    if (!ok) return;
    const result = await deleteAttachmentAction(file.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setFiles((list) => list.filter((f) => f.id !== file.id));
    toast.success(`Deleted “${file.name}”.`);
  };

  const addLink = (event: React.FormEvent) => {
    event.preventDefault();
    setLinkError(null);
    startLink(async () => {
      const result = await addAttachmentLinkAction(arrangementId, url, label);
      if (!result.ok) {
        setLinkError(result.error);
        return;
      }
      setFiles((list) => [...list, result.attachment]);
      setUrl("");
      setLabel("");
      toast.success(`Added the link “${result.attachment.name}”.`);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-heading text-lg font-bold text-foreground">Files and links</h3>
        <label
          htmlFor={inputId}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
            uploading && "pointer-events-none opacity-50",
          )}
        >
          <Upload aria-hidden className="size-5" />
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
      <p className="text-sm text-muted-foreground">Chord chart PDFs, lead sheets and rehearsal tracks, up to 20 MB each.</p>

      {files.length > 0 ? (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {files.map((file) => {
            const Icon = file.isFile ? (file.kind === "chart_pdf" ? FileText : Paperclip) : Link2;
            return (
              <li key={file.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-foreground">{file.name}</p>
                  <p className="text-sm text-muted-foreground">{KIND_LABELS[file.kind]}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {file.url ? (
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<a href={file.url} target="_blank" rel="noopener noreferrer" />}
                    >
                      <ExternalLink aria-hidden />
                      Open
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => void open(file)}>
                      <ExternalLink aria-hidden />
                      Open
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => void remove(file)}>
                    <Trash2 aria-hidden />
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-[15px] text-muted-foreground">
          No files yet. Upload a chord chart PDF or add a link to a recording.
        </p>
      )}

      <form onSubmit={addLink} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor={`${inputId}-url`}>Link to a recording or chart</Label>
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
        <div className="space-y-2">
          <Label htmlFor={`${inputId}-label`}>Name (optional)</Label>
          <Input
            id={`${inputId}-label`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Rehearsal track"
            maxLength={255}
          />
        </div>
        <Button type="submit" variant="outline" disabled={addingLink || !url.trim()}>
          <Link2 aria-hidden className="size-5" />
          {addingLink ? "Adding…" : "Add link"}
        </Button>
        {linkError && (
          <p role="alert" className="text-sm text-destructive sm:col-span-3">
            {linkError}
          </p>
        )}
      </form>
    </div>
  );
}
