"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { prepareRecordingUpload, finishRecordingUpload, cancelRecordingUpload } from "@/app/dashboard/live-streaming/upload-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeRecordingUploadError, MIN_RECORDING_OPTIMIZE_BYTES, validateRecordingUpload } from "@/lib/stream/recording-upload";
import { uploadRecordingWithProgress, type RecordingTransferProgress } from "@/lib/stream/upload-recording-browser";
import { RecordingUploadProgress, type RecordingUploadPhase } from "@/components/live-streaming/recordings/recording-upload-progress";

export function UploadRecording() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<RecordingUploadPhase | null>(null);
  const [transfer, setTransfer] = useState<RecordingTransferProgress>({ loaded: 0, total: 0 });
  const [optimization, setOptimization] = useState<number | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const optimizationRef = useRef<AbortController | null>(null);
  const uploadInFlight = useRef(false);
  const [pending, startTransition] = useTransition();
  // Keep the completed upload for a finalize retry: never send gigabytes twice.
  const [uploadedId, setUploadedId] = useState<string | null>(null);

  function upload() {
    if (uploadInFlight.current) return;
    if (!file) { setError("Choose a video to upload."); return; }
    const invalid = validateRecordingUpload({ title, filename: file.name, size: file.size });
    if (invalid) { setError(invalid); return; }
    uploadInFlight.current = true;
    setError(null);
    startTransition(async () => {
      let id = uploadedId;
      let releaseVideo: (() => Promise<void>) | undefined;
      try {
        if (!id) {
          setPhase("preparing");
          setTransfer({ loaded: 0, total: file.size });
          setOptimization(null);
          const durationSec = await videoDuration(file).catch(() => null);
          if (durationSec === null) {
            setError("We couldn't read this video. Export it as an MP4 with H.264 video and AAC audio, then try again.");
            return;
          }
          let video: Blob = file;
          if (file.size >= MIN_RECORDING_OPTIMIZE_BYTES && typeof VideoEncoder !== "undefined") {
            const controller = new AbortController();
            optimizationRef.current = controller;
            setOptimizing(true);
            setPhase("optimizing");
            try {
              const { optimizeRecording } = await import("@/lib/stream/optimize-recording");
              const optimized = await optimizeRecording(file, durationSec, controller.signal, (fraction) => {
                setOptimization(Math.max(0, Math.min(1, fraction)));
              });
              if (optimized) {
                video = optimized.file;
                releaseVideo = optimized.release;
              }
            } catch {
              // Compression is optional. A device or module loading failure
              // still allows the original recording to be uploaded.
            } finally {
              optimizationRef.current = null;
              setOptimizing(false);
            }
          }
          setPhase("preparing");
          const prepared = await prepareRecordingUpload({ title, filename: file.name, size: video.size, durationSec });
          if (!prepared.ok) { setError(prepared.error); return; }
          id = prepared.recordingId;
          setPhase("uploading");
          setTransfer({ loaded: 0, total: video.size });
          if (video.type !== "video/mp4") video = video.slice(0, video.size, "video/mp4");
          const result = await uploadRecordingWithProgress({
            path: prepared.path, token: prepared.token, video, onProgress: setTransfer,
          });
          if (result.error) {
            await cancelRecordingUpload(id);
            const { error } = result;
            setError(describeRecordingUploadError(
              "statusCode" in error ? { status: error.status, statusCode: error.statusCode } : {},
            ));
            return;
          }
          setUploadedId(id);
        }
        setPhase("checking");
        const finished = await finishRecordingUpload(id);
        if (!finished.ok) { setError(finished.error); return; }
        toast.success("Recording uploaded. Review it before publishing.");
        setOpen(false);
        setPhase(null);
        router.push(`/dashboard/live-streaming/recordings/${finished.recordingId}`);
        router.refresh();
      } catch {
        setError("We couldn't finish the upload. Please try again.");
      } finally {
        try { await releaseVideo?.(); } finally {
          uploadInFlight.current = false;
        }
      }
    });
  }

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[15px] text-muted-foreground">Streamed services and videos you upload.</p>
      <Button onClick={() => { setTitle(""); setFile(null); setError(null); setPhase(null); setUploadedId(null); setOpen(true); }}><Upload className="size-4" aria-hidden />Upload recording</Button>
    </div>
    <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <DialogContent aria-labelledby="upload-recording-title" onRequestClose={() => !pending}>
        <DialogHeader>
          <DialogTitle id="upload-recording-title">Upload recording</DialogTitle>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); upload(); }} className="flex min-h-0 flex-auto flex-col" aria-busy={pending}>
          <div className="flex min-h-0 flex-auto flex-col gap-5 overflow-y-auto p-6">
            <div className="space-y-2"><Label htmlFor="recording-upload-title">Recording title</Label><Input id="recording-upload-title" required maxLength={120} value={title} disabled={pending || Boolean(uploadedId)} onChange={(event) => setTitle(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="recording-upload-file">Video</Label><Input id="recording-upload-file" type="file" accept="video/mp4,.mp4" required disabled={pending || Boolean(uploadedId)} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(null); setPhase(null); }} /></div>
            {phase && file ? (
              <RecordingUploadProgress phase={phase} filename={file.name} loaded={transfer.loaded} total={transfer.total}
                originalBytes={file.size} optimization={optimization} error={error}>
                {optimizing && (
                  <Button className="mt-3" type="button" variant="outline" onClick={() => {
                    optimizationRef.current?.abort();
                    setOptimizing(false);
                  }}>
                    Use original video
                  </Button>
                )}
              </RecordingUploadProgress>
            ) : null}
            {error && !phase ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter><Button variant="outline" type="button" disabled={pending} onClick={() => setOpen(false)}>Close</Button><Button type="submit" disabled={pending}>{pending ? phase === "checking" ? "Checking video…" : phase === "uploading" ? "Uploading…" : "Preparing…" : uploadedId ? "Finish upload" : "Upload video"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}

/** Read only the local container metadata; release the file URL on every path. */
function videoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = () => { clearTimeout(timer); video.onloadedmetadata = null; video.onerror = null; video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Video metadata unavailable")); }, 15000);
    video.preload = "metadata";
    video.onloadedmetadata = () => { const duration = video.duration; cleanup(); if (Number.isFinite(duration)) resolve(duration); else reject(new Error("Video metadata unavailable")); };
    video.onerror = () => { cleanup(); reject(new Error("Video metadata unavailable")); };
    video.src = url;
  });
}
