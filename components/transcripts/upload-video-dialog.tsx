"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { cancelRecordingUpload, finishRecordingUpload, prepareRecordingUpload } from "@/app/dashboard/live-streaming/upload-actions";
import { RecordingUploadProgress, type RecordingUploadPhase } from "@/components/live-streaming/recordings/recording-upload-progress";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isRecordingServiceDate } from "@/lib/stream/recording-date";
import { describeRecordingUploadError, MIN_RECORDING_OPTIMIZE_BYTES, validateRecordingUpload } from "@/lib/stream/recording-upload";
import { uploadRecordingWithProgress, type RecordingTransferProgress } from "@/lib/stream/upload-recording-browser";

/**
 * Upload a video of a service from the Transcripts section. Same signed
 * upload, size/length checks and optional in-browser compression as the
 * Recordings tab; on success the dialog closes and the video joins the list,
 * where FaithForm transcribes it once it is ready.
 *
 * Safari: the dialog is capped by the viewport, the form keeps the
 * min-h-0/flex-auto chain, the body is the scroll owner and the footer stays
 * visible.
 */
export function UploadVideoDialog({
  open,
  onOpenChange,
  defaultServiceDate,
  autoTranscribe,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Today in the church's time zone, as yyyy-mm-dd. */
  defaultServiceDate: string;
  autoTranscribe: boolean;
  onUploaded: (recordingId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [serviceDate, setServiceDate] = useState(defaultServiceDate);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<RecordingUploadPhase | null>(null);
  const [transfer, setTransfer] = useState<RecordingTransferProgress>({ loaded: 0, total: 0 });
  const [optimization, setOptimization] = useState<number | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const optimizationRef = useRef<AbortController | null>(null);
  const uploadInFlight = useRef(false);
  const [pending, startTransition] = useTransition();
  // Keep the finished transfer for a retry of the last step: never send gigabytes twice.
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);

  // A fresh form each time the dialog opens.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTitle("");
      setServiceDate(defaultServiceDate);
      setFile(null);
      setError(null);
      setPhase(null);
      setUploadedId(null);
    }
  }

  function upload() {
    if (uploadInFlight.current) return;
    if (!file) {
      setError("Choose a video to upload.");
      return;
    }
    if (!isRecordingServiceDate(serviceDate)) {
      setError("Choose the date of the service.");
      return;
    }
    const invalid = validateRecordingUpload({ title, filename: file.name, size: file.size });
    if (invalid) {
      setError(invalid);
      return;
    }
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
              // Making it smaller is optional: the original can still be uploaded.
            } finally {
              optimizationRef.current = null;
              setOptimizing(false);
            }
          }
          setPhase("preparing");
          const prepared = await prepareRecordingUpload({ title, filename: file.name, size: video.size, durationSec, serviceDate });
          if (!prepared.ok) {
            setError(prepared.error);
            return;
          }
          id = prepared.recordingId;
          setPhase("uploading");
          setTransfer({ loaded: 0, total: video.size });
          if (video.type !== "video/mp4") video = video.slice(0, video.size, "video/mp4");
          const result = await uploadRecordingWithProgress({
            path: prepared.path,
            token: prepared.token,
            video,
            onProgress: setTransfer,
          });
          if (result.error) {
            await cancelRecordingUpload(id);
            const { error: uploadError } = result;
            setError(
              describeRecordingUploadError(
                "statusCode" in uploadError ? { status: uploadError.status, statusCode: uploadError.statusCode } : {},
              ),
            );
            return;
          }
          setUploadedId(id);
        }
        setPhase("checking");
        const finished = await finishRecordingUpload(id);
        if (!finished.ok) {
          setError(finished.error);
          return;
        }
        const name = title.trim();
        toast.success(
          autoTranscribe
            ? `“${name}” is uploaded. FaithForm will transcribe it as soon as the video is ready.`
            : `“${name}” is uploaded. Press Transcribe on it once the video is ready.`,
        );
        setPhase(null);
        onOpenChange(false);
        onUploaded(finished.recordingId);
      } catch {
        setError("We couldn't finish the upload. Please try again.");
      } finally {
        try {
          await releaseVideo?.();
        } finally {
          uploadInFlight.current = false;
        }
      }
    });
  }

  const locked = pending || Boolean(uploadedId);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent aria-labelledby="upload-video-title" aria-describedby="upload-video-description" onRequestClose={() => !pending}>
        <DialogHeader>
          <DialogTitle id="upload-video-title">Upload a video</DialogTitle>
          <DialogDescription id="upload-video-description">
            A recording of a service or sermon. FaithForm writes out every word so you can make a lesson and clips from it.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            upload();
          }}
          className="flex min-h-0 flex-auto flex-col"
          aria-busy={pending}
        >
          <div className="flex min-h-0 flex-auto flex-col gap-5 overflow-y-auto p-6">
            <div className="space-y-2">
              <Label htmlFor="upload-video-name">Title</Label>
              <Input
                id="upload-video-name"
                required
                maxLength={120}
                value={title}
                disabled={locked}
                placeholder="For example: Sunday Service – Hope in Hard Times"
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload-video-date">Service date</Label>
              <DatePicker
                id="upload-video-date"
                required
                value={serviceDate}
                disabled={locked}
                onChange={setServiceDate}
                aria-describedby="upload-video-date-hint"
              />
              <p id="upload-video-date-hint" className="text-sm text-muted-foreground">
                The day the service happened.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload-video-file">Video</Label>
              <Input
                id="upload-video-file"
                type="file"
                accept="video/mp4,.mp4"
                required
                disabled={locked}
                aria-describedby="upload-video-file-hint"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setError(null);
                  setPhase(null);
                }}
              />
              <p id="upload-video-file-hint" className="text-sm text-muted-foreground">
                An MP4 file, up to 5 GB and 12 hours long.
              </p>
            </div>
            {phase && file ? (
              <RecordingUploadProgress
                phase={phase}
                filename={file.name}
                loaded={transfer.loaded}
                total={transfer.total}
                originalBytes={file.size}
                optimization={optimization}
                error={error}
              >
                {optimizing ? (
                  <Button
                    className="mt-3"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      optimizationRef.current?.abort();
                      setOptimizing(false);
                    }}
                  >
                    Use original video
                  </Button>
                ) : null}
              </RecordingUploadProgress>
            ) : null}
            {error && !phase ? (
              <p role="alert" className="text-[15px] text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" disabled={pending} onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? phase === "checking"
                  ? "Checking video…"
                  : phase === "uploading"
                    ? "Uploading…"
                    : "Preparing…"
                : uploadedId
                  ? "Finish upload"
                  : "Upload video"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reads only the local file's metadata; releases the file URL on every path. */
function videoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Video metadata unavailable"));
    }, 15000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      if (Number.isFinite(duration)) resolve(duration);
      else reject(new Error("Video metadata unavailable"));
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Video metadata unavailable"));
    };
    video.src = url;
  });
}
