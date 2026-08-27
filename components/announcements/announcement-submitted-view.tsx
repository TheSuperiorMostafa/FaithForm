"use client";

import { Check, ExternalLink, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatDateTimeRange,
  type AnnouncementRow,
} from "@/lib/queries/announcements";

type AnnouncementSubmittedViewProps = {
  announcement: AnnouncementRow;
  eventHtmlLink?: string | null;
};

export function AnnouncementSubmittedView({
  announcement,
  eventHtmlLink,
}: AnnouncementSubmittedViewProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-500/30 dark:bg-green-500/10">
        <Check className="mt-0.5 size-5 shrink-0 text-green-700 dark:text-green-400" />
        <div>
          <p className="font-semibold text-green-800 dark:text-green-300">
            Submitted
          </p>
          <p className="text-sm text-green-700/90 dark:text-green-300/90">
            This announcement was verified and sent. Details below are what was
            saved.
          </p>
        </div>
      </div>

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
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Channels
          </dt>
          <dd className="mt-1 flex flex-wrap gap-2">
            {announcement.push_to_facebook && (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                Facebook
              </span>
            )}
            {announcement.push_to_team && (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                Gmail draft
              </span>
            )}
            {!announcement.push_to_facebook && !announcement.push_to_team && (
              <span className="text-muted-foreground">Saved only</span>
            )}
          </dd>
        </div>
        {announcement.published_at && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Submitted at
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

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {announcement.facebook_post_id && (
          <a
            href={`https://www.facebook.com/${announcement.facebook_post_id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm">
              View on Facebook
            </Button>
          </a>
        )}
        {announcement.push_to_team && (
          <a
            href="https://mail.google.com/mail/u/0/#drafts"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm">
              <Mail className="size-4" />
              Gmail drafts
            </Button>
          </a>
        )}
        {eventHtmlLink && (
          <a href={eventHtmlLink} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm">
              <ExternalLink className="size-4" />
              Google Calendar
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}
