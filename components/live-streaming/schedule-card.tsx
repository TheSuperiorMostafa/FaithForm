"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Calendar, Plus } from "lucide-react";
import {
  cancelScheduledStream,
  createScheduledStream,
} from "@/app/dashboard/live-streaming/actions";
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
import type { StreamEvent } from "@/lib/stream/events";

type ScheduleCardProps = {
  isAdmin: boolean;
  events: StreamEvent[];
  youtubeConnected: boolean;
  facebookConnected: boolean;
};

export function ScheduleCard({
  isAdmin,
  events,
  youtubeConnected,
  facebookConnected,
}: ScheduleCardProps) {
  const [pending, startTransition] = useTransition();

  const handleCreate = (formData: FormData) => {
    startTransition(async () => {
      const result = await createScheduledStream(formData);
      if (!result.ok) {
        toast.error(result.error ?? "Could not schedule stream.");
        return;
      }
      toast.success("Service scheduled.");
    });
  };

  const handleCancel = (eventId: string) => {
    startTransition(async () => {
      const result = await cancelScheduledStream(eventId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not cancel.");
        return;
      }
      toast.success("Scheduled stream cancelled.");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar className="size-4 text-accent" aria-hidden />
          Schedule
        </CardTitle>
        <CardDescription>
          Plan recurring Sunday services. Go Live provisions platforms when the
          broadcast starts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin ? (
          <form
            encType="multipart/form-data"
            onSubmit={(event) => {
              event.preventDefault();
              handleCreate(new FormData(event.currentTarget));
            }}
            className="space-y-3 rounded-xl border border-border p-4"
          >
            <div className="space-y-2">
              <Label htmlFor="event-title">Title</Label>
              <Input
                id="event-title"
                name="title"
                defaultValue="Sunday Morning Worship"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-starts">Next service</Label>
              <Input
                id="event-starts"
                name="starts_at"
                type="datetime-local"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="simulated-video">Simulated live video (optional)</Label>
              <Input
                id="simulated-video"
                name="simulated_video"
                type="file"
                accept="video/mp4,video/quicktime,video/*"
              />
              <p className="text-xs text-muted-foreground">
                Upload a pre-recorded service to play out as a scheduled live
                broadcast (no encoder required).
              </p>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="recurrence_weekly"
                  defaultChecked
                  className="rounded border-border"
                />
                Repeat weekly
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="syndicate_youtube"
                  defaultChecked={youtubeConnected}
                  disabled={!youtubeConnected}
                  className="rounded border-border"
                />
                YouTube
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="syndicate_facebook"
                  defaultChecked={facebookConnected}
                  disabled={!facebookConnected}
                  className="rounded border-border"
                />
                Facebook
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="countdown_enabled"
                  defaultChecked
                  className="rounded border-border"
                />
                Countdown
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="chat_enabled"
                  className="rounded border-border"
                />
                Chat
              </label>
            </div>
            <Button type="submit" size="sm" disabled={pending} className="gap-2">
              <Plus className="size-4" />
              Schedule service
            </Button>
          </form>
        ) : null}

        <div className="space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scheduled services yet.</p>
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium">{event.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(event.startsAt).toLocaleString()} · {event.status}
                    {event.recurrenceRule === "weekly" ? " · Weekly" : ""}
                  </p>
                </div>
                {isAdmin && event.status === "scheduled" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => handleCancel(event.id)}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
