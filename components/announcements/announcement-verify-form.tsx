"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Calendar, ChevronDown, ChevronUp } from "lucide-react";
import { publishAnnouncement } from "@/app/dashboard/announcements/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarQueueItem } from "@/lib/queries/announcements";
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/lib/utils/announcement-placeholders";

type IntegrationDefaults = {
  googleConnected: boolean;
  facebookConnected: boolean;
};

type AnnouncementVerifyFormProps = {
  churchId: string;
  event: CalendarQueueItem;
  defaults: IntegrationDefaults;
  onPublished?: () => void;
  compact?: boolean;
};

export function AnnouncementVerifyForm({
  churchId,
  event,
  defaults,
  onPublished,
  compact = false,
}: AnnouncementVerifyFormProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  const [title, setTitle] = useState(event.title);
  const [location, setLocation] = useState(event.location);
  const [startAt, setStartAt] = useState(toDatetimeLocalValue(event.startAt));
  const [endAt, setEndAt] = useState(
    event.endAt ? toDatetimeLocalValue(event.endAt) : "",
  );
  const [notes, setNotes] = useState("");
  const [pushToFacebook, setPushToFacebook] = useState(false);
  const [pushToApp, setPushToApp] = useState(false);
  const [pushToTeam, setPushToTeam] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const startIso = fromDatetimeLocalValue(startAt);
    if (!startIso) {
      setError("Start time is required");
      return;
    }
    const endIso = endAt ? fromDatetimeLocalValue(endAt) : null;

    const formData = new FormData();
    formData.set("church_id", churchId);
    formData.set("title", title.trim());
    formData.set("location", location.trim());
    formData.set("start_at", startIso);
    if (endIso) formData.set("end_at", endIso);
    formData.set("notes", notes);
    formData.set("google_event_id", event.googleEventId);
    formData.set("google_calendar_id", event.calendarId);
    formData.set("push_to_facebook", pushToFacebook ? "true" : "false");
    formData.set("push_to_app", pushToApp ? "true" : "false");
    formData.set("push_to_team", pushToTeam ? "true" : "false");
    formData.set("original_title", event.title);
    formData.set("original_location", event.location);
    formData.set("original_start_at", event.startAt);
    formData.set("original_end_at", event.endAt ?? "");

    startTransition(async () => {
      const result = await publishAnnouncement(formData);
      if (!result.ok) {
        setError(result.errors.join(" "));
        return;
      }

      const parts: string[] = ["Submitted!"];
      if (result.facebookScheduledAt) {
        parts.push(
          `Facebook post scheduled for ${new Date(result.facebookScheduledAt).toLocaleString()}.`,
        );
      } else if (result.facebookUrl) {
        parts.push("Posted to Facebook.");
      }
      if (result.gmailDraftUrl) parts.push("Gmail draft created.");
      if (result.errors.length > 0) {
        parts.push(result.errors.join(" "));
      }
      setSuccess(parts.join(" "));
      onPublished?.();
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={compact ? "flex flex-col gap-4" : "flex flex-col gap-5"}
    >
      {!compact && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/10 px-3 py-2 text-sm font-medium text-muted-foreground">
          <Calendar className="size-4 shrink-0 text-accent" strokeWidth={1.75} />
          Prefilled from Google Calendar
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor={`title-${event.googleEventId}`}>Title</Label>
        <Input
          id={`title-${event.googleEventId}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`where-${event.googleEventId}`}>Where</Label>
        <Input
          id={`where-${event.googleEventId}`}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>When</Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <Input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              required
              aria-label="Start"
              className="w-full"
            />
            <span className="mt-1 block text-xs text-muted-foreground">Start</span>
          </div>
          <ArrowRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
          <div className="min-w-0 flex-1">
            <Input
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              aria-label="End"
              className="w-full"
            />
            <span className="mt-1 block text-xs text-muted-foreground">End</span>
          </div>
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        <ToggleRow
          id={`fb-${event.googleEventId}`}
          label="Shared to FB?"
          checked={pushToFacebook}
          onCheckedChange={setPushToFacebook}
          disabled={!defaults.facebookConnected}
          hint={
            defaults.facebookConnected
              ? "Posts a generated graphic; schedules for event start when more than 10 minutes away"
              : "Connect Facebook in Settings"
          }
        />
        <ToggleRow
          id={`app-${event.googleEventId}`}
          label="Updated on App?"
          checked={pushToApp}
          onCheckedChange={setPushToApp}
        />
        <ToggleRow
          id={`team-${event.googleEventId}`}
          label="Add to Bulletin Board?"
          checked={pushToTeam}
          onCheckedChange={setPushToTeam}
        />
      </ul>

      <button
        type="button"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setShowNotes((v) => !v)}
      >
        {showNotes ? (
          <ChevronUp className="size-4" strokeWidth={1.75} />
        ) : (
          <ChevronDown className="size-4" strokeWidth={1.75} />
        )}
        Add details (optional)
      </button>
      {showNotes && (
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Extra notes for email or Facebook…"
          rows={3}
        />
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-lg border border-green-200 bg-green-100 px-3 py-2 text-sm font-semibold text-green-700 dark:border-green-500/20 dark:bg-green-500/15 dark:text-green-300" role="status">
          {success}
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Submitting…" : "Verify & submit"}
      </Button>
    </form>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="flex items-baseline gap-2 font-semibold">
          <span aria-hidden className="text-accent">
            •
          </span>
          <span>{label}</span>
        </Label>
        {hint && (
          <p className="mt-0.5 pl-4 text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </li>
  );
}
