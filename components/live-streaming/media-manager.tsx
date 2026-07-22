"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Film, Upload } from "lucide-react";
import {
  publishRecording,
  updateRecordingTrim,
} from "@/app/dashboard/media/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StreamRecording } from "@/lib/stream/recordings";

type MediaManagerProps = {
  recordings: StreamRecording[];
  isAdmin: boolean;
};

export function MediaManager({ recordings, isAdmin }: MediaManagerProps) {
  const [pending, startTransition] = useTransition();

  const handlePublish = (recordingId: string, title: string) => {
    startTransition(async () => {
      const result = await publishRecording(recordingId, title);
      if (!result.ok) {
        toast.error(result.error ?? "Could not publish.");
        return;
      }
      toast.success(result.message ?? "Published.");
    });
  };

  const handleTrim = (
    recordingId: string,
    trimStart: string,
    trimEnd: string,
  ) => {
    startTransition(async () => {
      const result = await updateRecordingTrim(
        recordingId,
        Number(trimStart) || 0,
        trimEnd ? Number(trimEnd) : null,
      );
      if (!result.ok) {
        toast.error(result.error ?? "Could not save trim.");
        return;
      }
      toast.success("Trim saved.");
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Recordings from live streams. Trim and publish on-demand videos.
      </p>

      {recordings.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No recordings yet. They appear here after a live broadcast ends.
          </CardContent>
        </Card>
      ) : (
        recordings.map((recording) => (
          <Card key={recording.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Film className="size-4 text-accent" />
                {recording.title ?? "Service recording"}
              </CardTitle>
              <CardDescription>
                {new Date(recording.createdAt).toLocaleString()} ·{" "}
                {recording.status}
                {recording.durationSec
                  ? ` · ${Math.round(recording.durationSec / 60)} min`
                  : ""}
              </CardDescription>
            </CardHeader>
            {isAdmin ? (
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`trim-start-${recording.id}`}>
                      Trim start (sec)
                    </Label>
                    <Input
                      id={`trim-start-${recording.id}`}
                      type="number"
                      min={0}
                      defaultValue={recording.trimStartSec}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`trim-end-${recording.id}`}>
                      Trim end (sec)
                    </Label>
                    <Input
                      id={`trim-end-${recording.id}`}
                      type="number"
                      min={0}
                      defaultValue={recording.trimEndSec ?? ""}
                      placeholder="End of file"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      const start = (
                        document.getElementById(
                          `trim-start-${recording.id}`,
                        ) as HTMLInputElement
                      ).value;
                      const end = (
                        document.getElementById(
                          `trim-end-${recording.id}`,
                        ) as HTMLInputElement
                      ).value;
                      handleTrim(recording.id, start, end);
                    }}
                  >
                    Save trim
                  </Button>
                  {recording.status !== "published" ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      className="gap-2"
                      onClick={() =>
                        handlePublish(
                          recording.id,
                          recording.title ?? "Service recording",
                        )
                      }
                    >
                      <Upload className="size-4" />
                      Publish
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            ) : null}
          </Card>
        ))
      )}
    </div>
  );
}
