"use client";

import { useRef, useState, useTransition } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";

import {
  removeCommunicationAttachment,
  uploadCommunicationAttachment,
} from "@/app/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Only church admins can change what the weekly email carries.
        </CardContent>
      </Card>
    );
  }

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
      } catch {
        setError(
          "That file could not be sent to the server. Check your connection and try again.",
        );
      }
    });
  };

  const handleRemove = (attachment: CommunicationAttachment) => {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await removeCommunicationAttachment(attachment.id);
      if (!result.ok) {
        setError(result.error ?? "That attachment could not be removed.");
        return;
      }
      setNotice(`${attachment.fileName} removed.`);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Files in the weekly email</CardTitle>
        <p className="text-sm text-muted-foreground">
          Anything here is attached to every Monday draft — a bulletin, a sign-up
          sheet, a flyer. Up to {MAX_ATTACHMENTS_PER_CHURCH} files, {MAX_MB}MB
          each; photos larger than that are shrunk to fit.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {attachments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No files attached. The weekly email goes out as text only.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
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
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatSize(attachment.sizeBytes)}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => handleRemove(attachment)}
                  aria-label={`Remove ${attachment.fileName}`}
                >
                  <Trash2 className="size-4" strokeWidth={1.75} />
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
            <Upload className="mr-2 size-4" strokeWidth={1.75} />
            {pending ? "Working…" : "Add a file"}
          </Button>
          {full && (
            <p className="text-xs text-muted-foreground">
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
