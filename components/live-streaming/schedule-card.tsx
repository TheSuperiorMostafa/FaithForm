"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarDays, Loader2, Pencil, Plus, Repeat, X } from "lucide-react";

import {
  cancelScheduledStream,
  createScheduledStream,
  updateScheduledStream,
} from "@/app/dashboard/live-streaming/actions";
import { RECENT_SERVICES_LIMIT } from "@/components/live-streaming/live-tabs";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { StreamEvent } from "@/lib/stream/events";
import { formatServiceTime } from "@/lib/stream/format";
import { churchServiceStartIso } from "@/lib/stream/schedule-time";
import { serviceStatusLabel } from "@/lib/stream/user-errors";
import { cn } from "@/lib/utils";
import { downscaleForUpload, UPLOAD_BUDGET_BYTES } from "@/lib/sites/downscale-image";

type ScheduleCardProps = {
  isAdmin: boolean;
  events: StreamEvent[];
  series: { id: string; name: string }[];
  youtubeConnected: boolean;
  facebookConnected: boolean;
  timeZone: string;
  /** Show every past service instead of the last few (`?recent=all`). */
  showAllRecent?: boolean;
};

const CONNECTED_ACCOUNTS_HREF = "/dashboard/settings?tab=accounts";
const UPCOMING_HREF = "/dashboard/live-streaming/upcoming";

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
  series,
  youtubeConnected,
  facebookConnected,
  timeZone,
  showAllRecent = false,
}: ScheduleCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StreamEvent | null>(null);

  const upcoming = events
    .filter((event) => event.status === "scheduled" || event.status === "live")
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const past = events
    .filter((event) => event.status === "ended" || event.status === "cancelled")
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const hasMoreRecent = past.length > RECENT_SERVICES_LIMIT;
  const recent = showAllRecent ? past : past.slice(0, RECENT_SERVICES_LIMIT);

  const handleCreate = (form: HTMLFormElement) => {
    const formData = new FormData(form);
    // Services are church events. Interpret the entered wall-clock time in
    // the church's zone, even when an admin's computer is somewhere else.
    const raw = formData.get("starts_at")?.toString() ?? "";
    const startsAt = churchServiceStartIso(raw, timeZone);
    if (!startsAt) {
      toast.error("Choose a valid date and time on your church's clock.");
      return;
    }
    formData.set("starts_at", startsAt);
    const title = formData.get("title")?.toString().trim() || "The service";

    startTransition(async () => {
      const imageError = await prepareServiceArtwork(formData);
      if (imageError) { toast.error(imageError); return; }
      try {
        const result = await createScheduledStream(formData);
        if (!result.ok) {
          toast.error(result.error ?? "We couldn't schedule that service. Please try again.");
          return;
        }
        toast.success(`${title} is scheduled.`);
        form.reset();
        setFormOpen(false);
        router.refresh();
      } catch {
        toast.error("We couldn't schedule that service. Your work is still here. Please try again.");
      }
    });
  };

  const handleUpdate = (form: HTMLFormElement) => {
    const formData = new FormData(form);
    const title = formData.get("title")?.toString().trim() || "The service";
    startTransition(async () => {
      try {
        const imageError = await prepareServiceArtwork(formData);
        if (imageError) { toast.error(imageError); return; }
        const result = await updateScheduledStream(formData);
        if (!result.ok) {
          toast.error(result.error ?? "We couldn't update that service. Please try again.");
          return;
        }
        toast.success(`Changes to “${title}” saved.`);
        setEditing(null);
        router.refresh();
      } catch {
        toast.error("We couldn't save those details. Your work is still here. Please try again.");
      }
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
        description="Plan the title, artwork and series before your service. They carry over to its recording."
        action={
          isAdmin && !formOpen && !editing ? (
            <Button size="lg" onClick={() => { setEditing(null); setFormOpen(true); }} className="gap-2">
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
          <ServiceDetailsFields series={series} disabled={pending} />
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="event-starts">Date and start time</Label>
              <Input id="event-starts" name="starts_at" type="datetime-local" required />
              <p className="text-sm text-muted-foreground">
                Enter the start time in your church&apos;s time zone.
              </p>
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

      {isAdmin && editing ? (
        <form
          key={editing.id}
          encType="multipart/form-data"
          onSubmit={(event) => { event.preventDefault(); handleUpdate(event.currentTarget); }}
          className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none"
          aria-label="Edit service"
        >
          <h3 className="font-heading text-xl font-bold">Edit service</h3>
          <p className="text-[15px] text-muted-foreground">{formatServiceTime(editing.startsAt, timeZone)}. Changes apply to this service and its recording.</p>
          <input type="hidden" name="event_id" value={editing.id} />
          <ServiceDetailsFields series={series} event={editing} disabled={pending} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={pending}>{pending ? "Saving…" : "Save service details"}</Button>
            <Button type="button" variant="ghost" size="lg" disabled={pending} onClick={() => setEditing(null)}>Cancel</Button>
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
        <ServiceList series={series} events={upcoming} timeZone={timeZone} isAdmin={isAdmin} pending={pending} onCancel={handleCancel} onEdit={(event) => { setFormOpen(false); setEditing(event); }} />
      )}

      {past.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="font-heading text-lg font-bold">Recent</h3>
          <ServiceList series={series} events={recent} timeZone={timeZone} isAdmin={false} pending={pending} onCancel={handleCancel} onEdit={(event) => { setFormOpen(false); setEditing(event); }} />
          {hasMoreRecent && showAllRecent ? (
            <Link
              href={UPCOMING_HREF}
              scroll={false}
              className={cn(buttonVariants({ variant: "outline" }), "w-fit")}
            >
              Show only the last {RECENT_SERVICES_LIMIT}
            </Link>
          ) : hasMoreRecent ? (
            <Link
              href={`${UPCOMING_HREF}?recent=all`}
              scroll={false}
              className={cn(buttonVariants({ variant: "outline" }), "w-fit")}
            >
              View all past services
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ServiceList({
  events,
  series,
  timeZone,
  isAdmin,
  pending,
  onCancel,
  onEdit,
}: {
  events: StreamEvent[];
  series: { id: string; name: string }[];
  timeZone: string;
  isAdmin: boolean;
  pending: boolean;
  onCancel: (event: StreamEvent) => void;
  onEdit: (event: StreamEvent) => void;
}) {
  return (
    <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex min-h-[72px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
        >
          <div className="flex min-w-0 items-center gap-4">
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
            >
              {event.artworkUrl ? <Image src={event.artworkUrl} alt="" width={44} height={44} unoptimized className="size-11 rounded-xl object-cover" /> : <CalendarDays className="size-5" strokeWidth={1.75} />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{event.title}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-[15px] text-muted-foreground">
                {formatServiceTime(event.startsAt, timeZone)}
                {event.seriesId && series.find(item => item.id === event.seriesId) ? <span>· {series.find(item => item.id === event.seriesId)?.name}</span> : null}
                {event.recurrenceRule === "weekly" ? (
                  <span className="inline-flex items-center gap-1">
                    <Repeat className="size-3.5" aria-hidden /> Every week
                  </span>
                ) : null}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <StatusBadge tone={SERVICE_TONE[event.status] ?? "neutral"}>{serviceStatusLabel(event.status)}</StatusBadge>
            {isAdmin && event.status === "scheduled" ? (
              <>
              <Button type="button" variant="outline" disabled={pending} onClick={() => onEdit(event)} className="gap-2">
                <Pencil className="size-4" aria-hidden />
                Edit service
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => onCancel(event)} className="gap-2">
                <X className="size-4" aria-hidden />
                Cancel service
              </Button>
              </>
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

/** The same saved details are used by the service's recording. */
function ServiceDetailsFields({ series, event, disabled }: {
  series: { id: string; name: string }[];
  event?: StreamEvent;
  disabled: boolean;
}) {
  const [seriesId, setSeriesId] = useState(event?.seriesId ?? "");
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-5">
      <legend className="sr-only">Service details</legend>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-title">Title</Label>
          <Input id="event-title" name="title" defaultValue={event?.title ?? "Sunday Service"} required maxLength={120} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-series">Series (optional)</Label>
          <Select id="event-series" name="series_id" value={seriesId} onChange={event => setSeriesId(event.target.value)}>
            <option value="">No series</option>
            {series.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            <option value="__new__">New series…</option>
          </Select>
          {seriesId === "__new__" ? <Input name="new_series_name" aria-label="New series name" placeholder="Series name" required maxLength={120} /> : null}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="event-artwork">Artwork (optional)</Label>
        {event?.artworkUrl ? <Image src={event.artworkUrl} alt="Current service artwork" width={240} height={135} unoptimized className="h-auto max-h-40 w-fit max-w-full rounded-xl object-contain" /> : null}
        <Input id="event-artwork" name="artwork" type="file" accept="image/jpeg,image/png,image/webp" className="h-auto py-2" />
        <p className="text-[15px] text-muted-foreground">Choose a JPG, PNG or WebP. Leave this empty to keep the current artwork or use the series artwork.</p>
        {event?.artworkUrl ? <CheckRow name="remove_artwork" label="Remove current artwork (use series artwork if available)" /> : null}
      </div>
    </fieldset>
  );
}

async function prepareServiceArtwork(form: FormData): Promise<string | null> {
  const file = form.get("artwork");
  if (!(file instanceof File) || file.size === 0) return null;
  try {
    const ready = await downscaleForUpload(file);
    if (ready.size > UPLOAD_BUDGET_BYTES) return "That photo is too large to upload. Save it as a JPG and try again.";
    form.set("artwork", ready);
    return null;
  } catch {
    return "That photo couldn't be opened. Choose a JPG, PNG or WebP and try again.";
  }
}
