"use client";

import type { ReactNode } from "react";
import {
  Calendar,
  Check,
  Circle,
  ExternalLink,
  Mail,
  Plus,
  Share2,
  Smartphone,
} from "lucide-react";
import { UnsubmitAnnouncementButton } from "@/components/announcements/unsubmit-announcement-button";
import { Button } from "@/components/ui/button";
import {
  describeAppAudience,
  hasUnpublishedChannel,
  publishedChannels,
} from "@/lib/announcements/published-channels";
import type { CalendarSource } from "@/lib/integrations/types";
import {
  formatDateTimeRange,
  type AnnouncementRow,
} from "@/lib/queries/announcements";
import { cn } from "@/lib/utils";

type AnnouncementSubmittedViewProps = {
  announcement: AnnouncementRow;
  eventHtmlLink?: string | null;
  calendarSource?: CalendarSource;
  /** Put in this week's email from the weekly queue rather than by publishing. */
  queuedForWeeklyEmail?: boolean;
  isAdmin?: boolean;
  /** Opens the form for publishing it to the places it is not in yet. */
  onPublishMore?: () => void;
};

export function AnnouncementSubmittedView({
  announcement,
  eventHtmlLink,
  calendarSource = "google",
  queuedForWeeklyEmail = false,
  isAdmin = false,
  onPublishMore,
}: AnnouncementSubmittedViewProps) {
  const channels = publishedChannels(announcement, { queuedForWeeklyEmail });
  const facebook = channels.facebook;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-500/30 dark:bg-green-500/10">
        <Check className="mt-0.5 size-5 shrink-0 text-green-700 dark:text-green-400" />
        <div>
          <p className="font-semibold text-green-800 dark:text-green-300">
            Published
          </p>
          <p className="text-sm text-green-700/90 dark:text-green-300/90">
            This event was verified and sent to the places below.
          </p>
        </div>
      </div>

      <section className="flex flex-col gap-2" aria-labelledby={`where-${announcement.id}`}>
        <h3
          id={`where-${announcement.id}`}
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Where it&apos;s published
        </h3>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          <ChannelRow
            icon={<Smartphone className="size-4" strokeWidth={1.75} />}
            name="FaithForm app"
            published={channels.app.published}
            status={describeAppAudience(channels.app.visibility)}
          />
          <ChannelRow
            icon={<Share2 className="size-4" strokeWidth={1.75} />}
            name="Facebook"
            published={facebook.published}
            status={
              !facebook.published
                ? "Not posted"
                : facebook.scheduledFor
                  ? `Scheduled for ${formatPostTime(facebook.scheduledFor)}`
                  : "Posted to your Page"
            }
            action={
              facebook.published ? (
                <ExternalAction href={facebook.url} label="View post" />
              ) : null
            }
          />
          <ChannelRow
            icon={<Mail className="size-4" strokeWidth={1.75} />}
            name="Weekly email"
            published={channels.weeklyEmail.published}
            status={
              channels.weeklyEmail.published
                ? "Included in the Monday email"
                : "Not in the weekly email"
            }
          />
          <ChannelRow
            icon={<Calendar className="size-4" strokeWidth={1.75} />}
            name={calendarSource === "apple" ? "iCloud Calendar" : "Google Calendar"}
            published
            status="On your church calendar"
            action={
              eventHtmlLink ? (
                <ExternalAction href={eventHtmlLink} label="Open" />
              ) : null
            }
          />
        </ul>
        {onPublishMore && hasUnpublishedChannel(channels) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={onPublishMore}
          >
            <Plus className="size-4" strokeWidth={1.75} />
            Publish somewhere else
          </Button>
        )}
      </section>

      <dl className="grid gap-4 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Title
          </dt>
          <dd className="mt-1 text-base font-semibold">{announcement.title}</dd>
        </div>
        {announcement.event_location && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Where
            </dt>
            <dd className="mt-1">{announcement.event_location}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            When
          </dt>
          <dd className="mt-1 text-base">
            {formatDateTimeRange(
              announcement.start_at,
              announcement.end_at,
              null,
              announcement.all_day,
            )}
          </dd>
        </div>
        {announcement.body?.trim() && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Notes
            </dt>
            <dd className="mt-1 whitespace-pre-wrap">{announcement.body}</dd>
          </div>
        )}
        {announcement.published_at && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Published at
            </dt>
            <dd className="mt-1">
              {new Date(announcement.published_at).toLocaleString()}
            </dd>
          </div>
        )}
        {announcement.last_publish_error && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Publish note
            </dt>
            <dd className="mt-1 text-amber-800 dark:text-amber-200">
              {announcement.last_publish_error}
            </dd>
          </div>
        )}
      </dl>

      {isAdmin && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <UnsubmitAnnouncementButton
            announcementId={announcement.id}
            title={announcement.title}
            facebookIsLive={facebook.published && !facebook.scheduledFor}
          />
        </div>
      )}
    </div>
  );
}

function ChannelRow({
  icon,
  name,
  published,
  status,
  action,
}: {
  icon: ReactNode;
  name: string;
  published: boolean;
  status: string;
  action?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          published
            ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {name}
          {published ? (
            <Check className="size-3.5 text-green-700 dark:text-green-400" aria-label="Published" />
          ) : (
            <Circle className="size-3 text-muted-foreground" aria-label="Not published" />
          )}
        </span>
        <span
          className={cn(
            "block text-xs",
            published ? "text-foreground/80" : "text-muted-foreground",
          )}
        >
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
      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      {label}
      <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
    </a>
  );
}

function formatPostTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
