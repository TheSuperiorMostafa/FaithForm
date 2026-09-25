"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarDays, Loader2, Plus, Repeat, X } from "lucide-react";

import {
  cancelScheduledStream,
  createScheduledStream,
} from "@/app/dashboard/live-streaming/actions";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/ui/page-header";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { StreamEvent } from "@/lib/stream/events";
import { formatServiceTime } from "@/lib/stream/format";
import { serviceStatusLabel } from "@/lib/stream/user-errors";
import { cn } from "@/lib/utils";

type ScheduleCardProps = {
  isAdmin: boolean;
  events: StreamEvent[];
  youtubeConnected: boolean;
  facebookConnected: boolean;
  timeZone: string;
};

const CONNECTED_ACCOUNTS_HREF = "/dashboard/settings?tab=accounts";

const SERVICE_TONE: Record<string, StatusTone> = {
  scheduled: "working",
  live: "live",
  ended: "neutral",
  cancelled: "neutral",
};

/**
 * Upcoming services: plan the next service (and every week after it), and
 * see what's coming. Scheduling is optional — Go live works without it — so
 * the form stays closed until someone asks for it.
 */
export function ScheduleCard({
  isAdmin,
  events,
  youtubeConnected,
  facebookConnected,
  timeZone,
}: ScheduleCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);

  const upcoming = events
    .filter((event) => event.status === "scheduled" || event.status === "live")
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const past = events.filter((event) => event.status === "ended" || event.status === "cancelled");

  const handleCreate = (form: HTMLFormElement) => {
    const formData = new FormData(form);
    // The browser knows which time zone "10:00" was typed in; the server
    // doesn't. Send an exact moment instead of a wall-clock string.
    const raw = formData.get("starts_at")?.toString() ?? "";
    const parsed = raw ? new Date(raw) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) formData.set("starts_at", parsed.toISOString());
    const title = formData.get("title")?.toString().trim() || "The service";

    startTransition(async () => {
      const result = await createScheduledStream(formData);
      if (!result.ok) {
        toast.error(result.error ?? "We couldn't schedule that service. Please try again.");
        return;
      }
      toast.success(`${title} is scheduled.`);
      form.reset();
      setFormOpen(false);
      router.refresh();
    });
  };

  const handleCancel = async (event: StreamEvent) => {
    const ok = await confirmAction({
      title: `Cancel “${event.title}”?`,
      description: `It comes off your schedule and your watch page for ${formatServiceTime(event.startsAt, timeZone)}. You can schedule it again later.`,
      confirmLabel: "Cancel service",
      cancelLabel: "Keep it",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await cancelScheduledStream(event.id);
      if (!result.ok) {
        toast.error(result.error ?? "We couldn't cancel that service. Please try again.");
        return;
      }
      toast.success(`${event.title} is cancelled.`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Upcoming services"
        description="Schedule a service so Go live is ready with its name, and your watch page shows a countdown."
        action={
          isAdmin && !formOpen ? (
            <Button size="lg" onClick={() => setFormOpen(true)} className="gap-2">
              <Plus className="size-5" aria-hidden />
              Schedule a service
            </Button>
          ) : null
        }
      />

      {isAdmin && formOpen ? (
        <form
          encType="multipart/form-data"
          onSubmit={(event) => {
            event.preventDefault();
            handleCreate(event.currentTarget);
          }}
          className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-heading text-xl font-bold">Schedule a service</h3>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="event-title">Service name</Label>
              <Input id="event-title" name="title" defaultValue="Sunday Service" required maxLength={120} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="event-starts">Date and start time</Label>
              <Input id="event-starts" name="starts_at" type="datetime-local" required />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <CheckRow name="recurrence_weekly" defaultChecked label="Repeat every week" />
            <CheckRow
              name="syndicate_youtube"
              defaultChecked={youtubeConnected}
              disabled={!youtubeConnected}
              label="Also show on YouTube"
              hint={youtubeConnected ? undefined : "Connect YouTube first"}
            />
            <CheckRow
              name="syndicate_facebook"
              defaultChecked={facebookConnected}
              disabled={!facebookConnected}
              label="Also show on Facebook"
              hint={facebookConnected ? undefined : "Connect Facebook first"}
            />
            {!youtubeConnected || !facebookConnected ? (
              <Link
                href={CONNECTED_ACCOUNTS_HREF}
                className="w-fit py-2 text-[15px] font-medium text-primary underline underline-offset-4 dark:text-accent"
              >
                Connect YouTube or Facebook in Settings
              </Link>
            ) : null}
          </div>

          <AdvancedSection title="More options" description="Countdown, live chat and pre-recorded video">
            <div className="flex flex-col gap-1">
              <CheckRow
                name="countdown_enabled"
                defaultChecked
                label="Show a countdown on your watch page"
              />
              <CheckRow name="chat_enabled" label="Turn on live chat" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="simulated-video">Play a pre-recorded video instead (optional)</Label>
              <Input
                id="simulated-video"
                name="simulated_video"
                type="file"
                accept="video/mp4,video/quicktime,video/*"
                className="h-auto py-2"
              />
              <p className="text-sm text-muted-foreground">
                Upload a recorded service and FaithForm plays it as a live service at the start time. No camera or
                streaming software needed.
              </p>
            </div>
          </AdvancedSection>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : null}
              Schedule service
            </Button>
            <Button type="button" variant="ghost" size="lg" disabled={pending} onClick={() => setFormOpen(false)}>
              Close
            </Button>
          </div>
        </form>
      ) : null}

      {upcoming.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          compact
          title="No services scheduled"
          description="You don't need a schedule to go live. Schedule one if you'd like a countdown on your watch page."
        />
      ) : (
        <ServiceList events={upcoming} timeZone={timeZone} isAdmin={isAdmin} pending={pending} onCancel={handleCancel} />
      )}

      {past.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="font-heading text-lg font-bold">Recent</h3>
          <ServiceList events={past} timeZone={timeZone} isAdmin={false} pending={pending} onCancel={handleCancel} />
        </div>
      ) : null}
    </div>
  );
}

function ServiceList({
  events,
  timeZone,
  isAdmin,
  pending,
  onCancel,
}: {
  events: StreamEvent[];
  timeZone: string;
  isAdmin: boolean;
  pending: boolean;
  onCancel: (event: StreamEvent) => void;
}) {
  return (
    <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex min-h-[72px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-4">
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
            >
              <CalendarDays className="size-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{event.title}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-[15px] text-muted-foreground">
                {formatServiceTime(event.startsAt, timeZone)}
                {event.recurrenceRule === "weekly" ? (
                  <span className="inline-flex items-center gap-1">
                    <Repeat className="size-3.5" aria-hidden /> Every week
                  </span>
                ) : null}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <StatusBadge tone={SERVICE_TONE[event.status] ?? "neutral"}>{serviceStatusLabel(event.status)}</StatusBadge>
            {isAdmin && event.status === "scheduled" ? (
              <Button type="button" variant="outline" disabled={pending} onClick={() => onCancel(event)} className="gap-2">
                <X className="size-4" aria-hidden />
                Cancel service
              </Button>
            ) : null}
            {event.status === "live" ? (
              <Link href="/dashboard/live-streaming" className={cn(buttonVariants({ variant: "outline" }))}>
                Go to Live
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function CheckRow({
  name,
  label,
  hint,
  defaultChecked,
  disabled,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 text-[15px]",
        disabled && "cursor-default opacity-60",
      )}
    >
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="size-5 rounded border-border accent-primary"
      />
      <span>
        {label}
        {hint ? <span className="ml-2 text-sm text-muted-foreground">({hint})</span> : null}
      </span>
    </label>
  );
}
