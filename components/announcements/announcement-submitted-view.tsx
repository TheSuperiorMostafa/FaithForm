"use client";

import type { ReactNode } from "react";
import {
  Calendar,
  Check,
  Circle,
  ExternalLink,
  Mail,
  Pencil,
  Share2,
  Smartphone,
} from "lucide-react";

import { TakeDownButton } from "@/components/announcements/published-switch";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ANNOUNCEMENT_STATE_LABEL,
  ANNOUNCEMENT_STATE_TONE,
  announcementState,
  describeWhen,
} from "@/lib/announcements/composer";
import {
  describeAppAudience,
  publishedChannels,
} from "@/lib/announcements/published-channels";
import type { CalendarSource } from "@/lib/integrations/types";
import type { AnnouncementRow } from "@/lib/queries/announcements";
import { cn } from "@/lib/utils";

type AnnouncementSubmittedViewProps = {
  announcement: AnnouncementRow;
  eventHtmlLink?: string | null;
  calendarSource?: CalendarSource;
  /** Put in this week's email from the email card rather than by posting. */
  queuedForWeeklyEmail?: boolean;
  isAdmin?: boolean;
  timeZone?: string | null;
  /** Opens the composer to change it or share it in more places. */
  onChange?: () => void;
  /** Runs once it has been taken down. */
  onTakenDown?: () => void;
};

/** A posted calendar event in the calendar's side panel: where it went, and what to do. */
export function AnnouncementSubmittedView({
  announcement,
  eventHtmlLink,
  calendarSource = "google",
  queuedForWeeklyEmail = false,
  isAdmin = false,
  timeZone,
  onChange,
  onTakenDown,
}: AnnouncementSubmittedViewProps) {
  const channels = publishedChannels(announcement, { queuedForWeeklyEmail });
  const facebook = channels.facebook;
  const state = announcementState(announcement, { queuedForWeeklyEmail });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={ANNOUNCEMENT_STATE_TONE[state]} size="lg">
          {ANNOUNCEMENT_STATE_LABEL[state]}
        </StatusBadge>
        <span className="text-[15px] text-muted-foreground">
          {describeWhen(
            {
              startAt: announcement.start_at,
              endAt: announcement.end_at,
              allDay: Boolean(announcement.all_day),
            },
            timeZone,
          )}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {onChange && (
          <Button type="button" variant="outline" onClick={onChange}>
            <Pencil aria-hidden strokeWidth={1.75} />
            Change
          </Button>
        )}
        {isAdmin && (
          <TakeDownButton
            announcementId={announcement.id}
            title={announcement.title}
            calendarLinked
            facebookIsLive={facebook.published && !facebook.scheduledFor}
            onTakenDown={onTakenDown}
          />
        )}
      </div>

      <section className="flex flex-col gap-2" aria-labelledby={`where-${announcement.id}`}>
        <h3 id={`where-${announcement.id}`} className="text-[15px] font-semibold text-foreground">
          Where it went
        </h3>
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          <ChannelRow
            icon={<Smartphone className="size-4" strokeWidth={1.75} />}
            name="The FaithForm app"
            done={channels.app.published}
            status={describeAppAudience(channels.app.visibility)}
          />
          <ChannelRow
            icon={<Share2 className="size-4" strokeWidth={1.75} />}
            name="Facebook"
            done={facebook.published}
            status={
              !facebook.published
                ? "Not on Facebook"
                : facebook.scheduledFor
                  ? `Scheduled for ${describeWhen(
                      { startAt: facebook.scheduledFor, endAt: null, allDay: false },
                      timeZone,
                    )}`
                  : "Posted on your Page"
            }
            action={facebook.published ? <ExternalAction href={facebook.url} label="View post" /> : null}
          />
          <ChannelRow
            icon={<Mail className="size-4" strokeWidth={1.75} />}
            name="Monday's email"
            done={channels.weeklyEmail.published}
            status={channels.weeklyEmail.published ? "In Monday's email" : "Not in the email"}
          />
          <ChannelRow
            icon={<Calendar className="size-4" strokeWidth={1.75} />}
            name={calendarSource === "apple" ? "iCloud Calendar" : "Google Calendar"}
            done
            status="On your church calendar"
            action={eventHtmlLink ? <ExternalAction href={eventHtmlLink} label="Open" /> : null}
          />
        </ul>
      </section>

      {announcement.body?.trim() && (
        <div>
          <p className="text-[15px] font-semibold text-foreground">Message</p>
          <p className="mt-1 whitespace-pre-wrap text-[15px]">{announcement.body}</p>
        </div>
      )}
    </div>
  );
}

function ChannelRow({
  icon,
  name,
  done,
  status,
  action,
}: {
  icon: ReactNode;
  name: string;
  done: boolean;
  status: string;
  action?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          done
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[15px] font-semibold">
          {name}
          {done ? (
            <Check className="size-4 text-emerald-700 dark:text-emerald-400" aria-label="Shared here" />
          ) : (
            <Circle className="size-3 text-muted-foreground" aria-label="Not shared here" />
          )}
        </span>
        <span className={cn("block text-sm", done ? "text-foreground/80" : "text-muted-foreground")}>
          {status}
        </span>
      </span>
      {action}
    </li>
  );
}

function ExternalAction({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
    >
      {label}
      <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden />
    </a>
  );
}
