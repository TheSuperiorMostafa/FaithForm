"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarEventPreview } from "@/lib/integrations/types";
import { fromDatetimeLocalValue } from "@/lib/utils/announcement-placeholders";

type CreateEventDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Day the calendar is focused on; used to prefill the date. */
  defaultDate: Date;
  onCreated: (event: CalendarEventPreview) => void;
};

/** Build a `datetime-local` value from a date at a given local hour. */
function datetimeLocalAt(date: Date, hour: number): string {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CreateEventDialog({
  open,
  onOpenChange,
  defaultDate,
  onCreated,
}: CreateEventDialogProps) {
  const [title, setTitle] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setStartAt(datetimeLocalAt(defaultDate, 9));
      setEndAt(datetimeLocalAt(defaultDate, 10));
      setLocation("");
      setDescription("");
      setError(null);
      setNeedsReconnect(false);
    }
  }, [open, defaultDate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsReconnect(false);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Give the event a title.");
      return;
    }
    const startIso = fromDatetimeLocalValue(startAt);
    if (!startIso) {
      setError("Choose a start date and time.");
      return;
    }
    const endIso = fromDatetimeLocalValue(endAt);
    if (endIso && new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      setError("The end time must be after the start time.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/announcements/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          location: location.trim() || undefined,
          startAt: startIso,
          endAt: endIso,
          description: description.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.reconnect) setNeedsReconnect(true);
        throw new Error(data?.error ?? "Failed to create the event.");
      }
      onCreated(data.event as CalendarEventPreview);
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create the event.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,760px)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New calendar event</DialogTitle>
          <DialogDescription>
            Add an event to your Google Calendar. It appears here instantly,
            ready to verify and announce.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          <div className="space-y-2">
            <Label htmlFor="event-title">Event title</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sunday Worship Service"
              autoFocus
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="event-start">Starts</Label>
              <Input
                id="event-start"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-end">Ends</Label>
              <Input
                id="event-end"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-location">Location</Label>
            <Input
              id="event-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Main Sanctuary"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-description">Description</Label>
            <Textarea
              id="event-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details saved to the calendar event."
            />
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
              {needsReconnect && (
                <>
                  {" "}
                  <Link
                    href="/dashboard/settings"
                    className="font-semibold underline underline-offset-2"
                  >
                    Reconnect Google
                  </Link>
                </>
              )}
            </p>
          )}

          <DialogFooter className="-mx-6 -mb-5 mt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Adding…
                </>
              ) : (
                <>
                  <CalendarPlus className="size-4" strokeWidth={1.75} />
                  Add to calendar
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
