"use client";

import React, { type ReactNode, useEffect, useRef } from "react";
import { Check, CircleAlert, CloudUpload, FileVideo, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type RecordingUploadPhase = "preparing" | "optimizing" | "uploading" | "checking";

export function formatUploadBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${Math.round(bytes)} bytes`;
}

export function RecordingUploadProgress({ phase, filename, loaded, total, originalBytes, optimization, error, children }: {
  phase: RecordingUploadPhase;
  filename: string;
  loaded: number;
  total: number;
  originalBytes: number;
  optimization: number | null;
  error: string | null;
  children?: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.scrollIntoView({ block: "start", behavior: "auto" }); }, []);
  const step = phase === "checking" ? 2 : phase === "uploading" ? 1 : 0;
  const transferred = phase === "checking" ? total : Math.min(total, Math.max(0, loaded));
  const uploadPercent = total > 0 ? Math.min(100, Math.floor(transferred / total * 100)) : 0;
  const percent = phase === "optimizing" && optimization !== null ? Math.floor(optimization * 100) : step > 0 ? uploadPercent : null;
  const title = error && step === 0 ? "Video needs attention" : error && phase === "uploading" ? "Upload interrupted"
    : phase === "checking" ? "Video uploaded"
      : phase === "uploading" ? "Uploading your recording"
        : phase === "optimizing" ? "Preparing a smaller video" : "Getting your video ready";
  const detail = error && step === 0 ? "Choose another MP4 video, then try again." : phase === "checking" ? error ? "Choose Finish upload to try the check again." : "Checking playback before opening your review."
    : phase === "uploading" ? error ? "Check your connection, then choose Upload video to try again." : uploadPercent === 100 ? "Upload sent. Waiting for confirmation…" : "Keep this window open until your recording is ready to review."
      : phase === "optimizing" ? "Optimizing the video before the upload starts." : "Reading the video and preparing your upload.";
  const stateText = error ? "Needs attention" : phase === "checking" ? "Checking video" : phase === "uploading" ? "Uploading video" : "Preparing video";

  // The constrained dialog body must scroll this card, never compress it.
  return <section ref={panel} aria-label="Recording upload progress" className="shrink-0 overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/10 via-card to-card shadow-sm">
    <div className="space-y-5 p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/15 text-primary dark:text-accent"><FileVideo className="size-5" aria-hidden /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary dark:text-accent">{stateText}</p>
          <p className="mt-1 break-words text-sm text-muted-foreground">{filename}</p>
        </div>
      </div>
      <div>
        <div className="mb-3 flex items-end justify-between gap-3">
          <p role="status" className="text-base font-semibold">{title}</p>
          {percent !== null ? <p aria-hidden className="shrink-0 font-heading text-3xl font-bold tabular-nums tracking-tight text-primary dark:text-accent">{percent}<span className="ml-0.5 text-base">%</span></p> : error ? <CircleAlert className="size-5 shrink-0 text-destructive" aria-hidden /> : <Loader2 className="size-5 shrink-0 animate-spin motion-reduce:animate-none text-primary dark:text-accent" aria-hidden />}
        </div>
        {percent !== null ? <div role="progressbar" aria-label={phase === "optimizing" ? "Video preparation" : "Video upload"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
          aria-valuetext={phase === "optimizing" ? `${percent}% prepared` : `${percent}% uploaded, ${formatUploadBytes(transferred)} of ${formatUploadBytes(total)}`}
          className="h-3 overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border/50">
          <div style={{ width: `${percent}%` }} className={cn("h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-300 ease-out motion-reduce:transition-none", error && "from-destructive to-destructive")} />
        </div> : null}
        {step > 0 ? <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm tabular-nums">
          <span className="font-medium">{formatUploadBytes(transferred)} uploaded</span>
          <span className="text-muted-foreground">{formatUploadBytes(Math.max(0, total - transferred))} remaining</span>
        </div> : null}
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{detail}</p>
        {step > 0 && total < originalBytes * 0.9 ? <p className="mt-1 text-sm text-muted-foreground">Smaller upload · original video {formatUploadBytes(originalBytes)}</p> : null}
      </div>
      <ol aria-label="Upload stages" className="grid grid-cols-3 gap-2 border-t border-border/70 pt-4">
        {["Prepare", "Upload", "Check"].map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} className={cn("flex min-w-0 flex-col items-center gap-1.5 text-center text-sm sm:flex-row sm:gap-2 sm:text-left", index > step ? "text-muted-foreground" : "font-semibold text-foreground")}>
          <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs", index < step ? "border-accent/40 bg-accent/20 text-primary dark:text-accent" : index === step ? "border-primary bg-primary text-primary-foreground dark:border-accent dark:bg-accent dark:text-accent-foreground" : "border-border bg-background")}>
            {index < step ? <Check className="size-3.5" aria-hidden /> : index === 1 && step === 1 ? <CloudUpload className="size-3.5" aria-hidden /> : <span aria-hidden>{index + 1}</span>}
          </span><span>{label}</span>
        </li>)}
      </ol>
      {children}
      {error ? <p role="alert" className="text-sm leading-relaxed text-destructive">{error}</p> : null}
    </div>
  </section>;
}
