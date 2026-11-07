"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { prepareRecordingUpload, finishRecordingUpload, cancelRecordingUpload } from "@/app/dashboard/live-streaming/upload-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { STREAM_RECORDINGS_BUCKET } from "@/lib/stream/recording-storage";
import { validateRecordingUpload } from "@/lib/stream/recording-upload";

export function UploadRecording() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [pending, startTransition] = useTransition();
  // Keep the completed upload for a finalize retry: never send gigabytes twice.
  const [uploadedId, setUploadedId] = useState<string | null>(null);

  function upload() {
    if (!file) { setError("Choose a video to upload."); return; }
    const invalid = validateRecordingUpload({ title, filename: file.name, size: file.size });
    if (invalid) { setError(invalid); return; }
    setError(null);
    startTransition(async () => {
      let id = uploadedId;
      try {
        if (!id) {
          setStage("Starting upload…");
          const durationSec = await videoDuration(file);
          const prepared = await prepareRecordingUpload({ title, filename: file.name, size: file.size, durationSec });
          if (!prepared.ok) { setError(prepared.error); return; }
          id = prepared.recordingId;
          setStage("Uploading video. Keep this window open…");
          const result = await createClient().storage.from(STREAM_RECORDINGS_BUCKET).uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: "video/mp4", upsert: false });
          if (result.error) {
            await cancelRecordingUpload(id);
            setError("The video couldn't be uploaded. Check your connection and try again. If it keeps happening, contact FaithForm support.");
            return;
          }
          setUploadedId(id);
        }
        setStage("Checking your video…");
        const finished = await finishRecordingUpload(id);
        if (!finished.ok) { setError(finished.error); return; }
        toast.success("Recording uploaded. Review it before publishing.");
        setOpen(false);
        router.push(`/dashboard/live-streaming/recordings/${finished.recordingId}`);
        router.refresh();
      } catch {
        setError("We couldn't finish the upload. Please try again.");
      } finally { setStage(""); }
    });
  }

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[15px] text-muted-foreground">Streamed services and videos you upload.</p>
      <Button onClick={() => { setTitle(""); setFile(null); setError(null); setUploadedId(null); setOpen(true); }}><Upload className="size-4" aria-hidden />Upload recording</Button>
    </div>
    <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <DialogContent aria-labelledby="upload-recording-title" onRequestClose={() => !pending}>
        <DialogHeader><DialogTitle id="upload-recording-title">Upload recording</DialogTitle><DialogDescription>Add an MP4 video, then review it before sharing with your church. Use H.264 video and AAC audio for phone playback. Maximum 5 GB; your church&apos;s upload limit may be lower.</DialogDescription></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); upload(); }} className="flex min-h-0 flex-auto flex-col">
          <div className="flex min-h-0 flex-auto flex-col gap-5 overflow-y-auto p-6">
            <div className="space-y-2"><Label htmlFor="recording-upload-title">Recording title</Label><Input id="recording-upload-title" required maxLength={120} value={title} disabled={pending || Boolean(uploadedId)} onChange={(event) => setTitle(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="recording-upload-file">Video</Label><Input id="recording-upload-file" type="file" accept="video/mp4,.mp4" required disabled={pending || Boolean(uploadedId)} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(null); }} /></div>
            {pending ? <p role="status" className="text-sm text-muted-foreground">{stage}</p> : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter><Button variant="outline" type="button" disabled={pending} onClick={() => setOpen(false)}>Close</Button><Button type="submit" disabled={pending}>{pending ? "Uploading…" : uploadedId ? "Finish upload" : "Upload video"}</Button></DialogFooter>
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
