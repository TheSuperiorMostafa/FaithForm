"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Loader2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toUserError, UserFacingError } from "@/lib/errors/user-error";
import type { RecordingDownloadPlan } from "@/lib/stream/recording-download";
import { cn } from "@/lib/utils";

type PreparedFile = { url: string; release: () => Promise<void>; saving: boolean };
type ReadyDownload = { url: string; filename: string };

export function RecordingDownloadButton({ recordingId, title, className }: {
  recordingId: string;
  title: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState<ReadyDownload | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const prepared = useRef<PreparedFile | null>(null);

  const releasePrepared = useCallback(() => {
    const file = prepared.current;
    prepared.current = null;
    if (!file) return;
    const release = () => { URL.revokeObjectURL(file.url); void file.release(); };
    // A browser may still be copying a large disk-backed Blob after Save.
    // Cancellation before handoff can release it immediately.
    if (file.saving) setTimeout(release, 5 * 60_000);
    else release();
  }, []);

  useEffect(() => () => {
    operation.current?.abort();
    releasePrepared();
  }, [releasePrepared]);

  const changeOpen = (next: boolean) => {
    if (!next) {
      operation.current?.abort();
      operation.current = null;
      releasePrepared();
    }
    setOpen(next);
  };

  const prepare = async () => {
    if (operation.current) return;
    releasePrepared();
    const controller = new AbortController();
    operation.current = controller;
    setOpen(true);
    setProgress(0);
    setReady(null);
    setSaving(false);
    setError("");
    try {
      const response = await fetch(`/api/stream/recordings/${encodeURIComponent(recordingId)}/download`, {
        signal: controller.signal, credentials: "same-origin", cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new UserFacingError(response.status === 401
          ? "Your sign-in has ended. Sign in again, then try downloading this recording."
          : typeof data.error === "string" ? data.error : "We couldn't prepare this download. Please try again.");
      }
      const plan = data as RecordingDownloadPlan;
      if (typeof plan.filename !== "string") throw new Error("Invalid download plan");
      if (controller.signal.aborted) return;
      if (plan.kind === "file") {
        const url = new URL(plan.url);
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid download address");
        setReady({ url: url.href, filename: plan.filename });
      } else if (plan.kind === "segments") {
        const playlist = new URL(plan.playlistUrl, window.location.origin);
        if (playlist.origin !== window.location.origin ||
            !playlist.pathname.startsWith(`/api/stream/recordings/${encodeURIComponent(recordingId)}/`)) {
          throw new Error("Invalid recording address");
        }
        const { prepareRecordingDownload } = await import("@/lib/stream/download-recording");
        const result = await prepareRecordingDownload({
          playlistUrl: playlist.href, totalBytes: plan.totalBytes, assetBytes: plan.assetBytes, signal: controller.signal,
          onProgress: fraction => {
            if (!controller.signal.aborted) setProgress(Math.min(100, Math.max(0, Math.round(fraction * 100))));
          },
        });
        if (controller.signal.aborted) { await result.release(); return; }
        const url = URL.createObjectURL(result.file);
        prepared.current = { url, release: result.release, saving: false };
        setReady({ url, filename: plan.filename });
      } else throw new Error("Unknown recording type");
      setProgress(100);
    } catch (cause) {
      if (!controller.signal.aborted) setError(toUserError(cause, "We couldn't prepare this recording for download."));
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  };

  return (
    <>
      <Button type="button" variant="outline" className={className}
        aria-label={`Download recording: ${title}`} onClick={() => { void prepare(); }}>
        <Download className="size-4" aria-hidden />Download recording
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        {/* No `flex` here: the dialog primitive shows itself with `open:flex`.
            An unconditional `flex` overrides a closed <dialog>'s display:none,
            so every row's closed dialog was painted on the page, unclosable. */}
        <DialogContent aria-labelledby={`download-title-${recordingId}`} className="max-w-lg overflow-hidden">
          <DialogHeader className="pr-16">
            <DialogTitle id={`download-title-${recordingId}`}>Download recording</DialogTitle>
            <DialogDescription>Save the full recording, including any parts hidden by trimming.</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto p-6">
            <p className="break-words text-base font-semibold">{title}</p>
            <div className="flex min-h-28 flex-col justify-center gap-3">
              {error ? <p role="alert" className="text-[15px] text-destructive">{error}</p> : <>
                <p role="status" className="flex items-center gap-2 text-[15px]">
                  {ready ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden /> : <Loader2 className="size-5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />}
                  {saving ? "Your browser is saving the recording." : ready ? "Your recording is ready to save." : `Preparing your download… ${progress}%`}
                </p>
                <div role="progressbar" aria-label="Preparing download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}
                  className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} />
                </div>
                {ready ? <p className="break-all text-sm text-muted-foreground">{ready.filename}</p>
                  : <p className="text-sm text-muted-foreground">You can cancel and try again at any time.</p>}
              </>}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => changeOpen(false)}>{ready || error ? "Close" : "Cancel"}</Button>
            {error ? <Button type="button" onClick={() => { void prepare(); }}>Try again</Button> : ready ? (
              <a href={ready.url} download={ready.filename} className={cn(buttonVariants(), "gap-2")}
                onClick={() => { if (prepared.current) prepared.current.saving = true; setSaving(true); }}>
                <Download className="size-4" aria-hidden />Save recording
              </a>
            ) : <Button type="button" disabled>Save recording</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
