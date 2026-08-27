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

  const handleFile = (file: File) => {
    setError(null);
    setNotice(null);

    const formData = new FormData();
    formData.set("file", file);

    startTransition(async () => {
      const result = await uploadCommunicationAttachment(formData);
      if (!result.ok) {
        setError(result.error ?? "That file could not be attached.");
        return;
      }
      setNotice(`${file.name} will go out with the weekly email.`);
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
          sheet, a flyer. Up to {MAX_ATTACHMENTS_PER_CHURCH} files,{" "}
          {Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB each.
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
