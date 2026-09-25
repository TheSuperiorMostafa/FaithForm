"use client";

import { useRef, useState, useTransition } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";

import {
  removeCommunicationAttachment,
  uploadCommunicationAttachment,
} from "@/app/dashboard/settings/actions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENTS_PER_CHURCH,
  MAX_ATTACHMENT_BYTES,
  type CommunicationAttachment,
} from "@/lib/announcements/attachments";
import { downscaleForUpload } from "@/lib/sites/downscale-image";

const MAX_MB = Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024));

/** Photos can be shrunk to fit; a PDF cannot, so it is refused with a reason. */
function isShrinkableImage(file: File): boolean {
  return /^image\/(jpeg|png|webp)$/i.test(file.type);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CommunicationAttachmentsForm({
  attachments,
  isAdmin,
}: {
  attachments: CommunicationAttachment[];
  isAdmin: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!isAdmin) return null;

  const full = attachments.length >= MAX_ATTACHMENTS_PER_CHURCH;

  const handleFile = (picked: File) => {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const file = isShrinkableImage(picked)
        ? await downscaleForUpload(picked)
        : picked;

      // Checked here, before the request leaves. Past this size the framework
      // refuses the body before the action runs, and what came back was a
      // crash rather than a sentence.
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(
          `${picked.name} is ${(file.size / (1024 * 1024)).toFixed(1)}MB; the weekly email can carry files up to ${MAX_MB}MB each. Compress it or attach a smaller file.`,
        );
        return;
      }

      const formData = new FormData();
      formData.set("file", file);

      try {
        const result = await uploadCommunicationAttachment(formData);
        if (!result.ok) {
          setError(result.error ?? "That file could not be attached.");
          return;
        }
        setNotice(`${picked.name} will go out with the weekly email.`);
        toast.success(`${picked.name} added to the weekly email.`);
      } catch {
        setError(
          "That file could not be sent to the server. Check your connection and try again.",
        );
      }
    });
  };

  const handleRemove = async (attachment: CommunicationAttachment) => {
    const ok = await confirmAction({
      title: `Remove ${attachment.fileName}?`,
      description:
        "It stops going out with the weekly email, and the file is deleted from FaithForm. You would need to add it again to use it.",
      confirmLabel: "Remove file",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    setNotice(null);

    startTransition(async () => {
      try {
        const result = await removeCommunicationAttachment(attachment.id);
        if (!result.ok) {
          setError(result.error ?? "That file could not be removed.");
          return;
        }
        setNotice(`${attachment.fileName} removed from the weekly email.`);
        toast.success(`${attachment.fileName} removed from the weekly email.`);
      } catch {
        setError("That file could not be removed. Please try again.");
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Files in the weekly email</CardTitle>
        <CardDescription className="text-[15px]">
          Anything here is attached to every Monday draft, like a bulletin, a sign-up sheet or a
          flyer. Up to {MAX_ATTACHMENTS_PER_CHURCH} files, {MAX_MB}MB each. Big photos are shrunk
          to fit.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {attachments.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-5 text-[15px] text-muted-foreground">
            No files yet. The weekly email goes out with just the text.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Paperclip
                    className="size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {attachment.fileName}
                    </p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {formatSize(attachment.sizeBytes)}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => handleRemove(attachment)}
                  aria-label={`Remove ${attachment.fileName}`}
                >
                  <Trash2 aria-hidden />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={ALLOWED_ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`).join(",")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            // Clear the picker so choosing the same file twice still fires.
            e.target.value = "";
          }}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={pending || full}
            onClick={() => inputRef.current?.click()}
          >
            <Upload aria-hidden />
            {pending ? "Working…" : "Add a file"}
          </Button>
          {full && (
            <p className="text-sm text-muted-foreground">
              Remove a file to add another.
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="text-sm text-green-700 dark:text-green-300" role="status">
            {notice}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
