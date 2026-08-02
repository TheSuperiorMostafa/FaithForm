"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar, ChevronDown, ExternalLink, Mail, X } from "lucide-react";
import { AnnouncementVerifyForm } from "@/components/announcements/announcement-verify-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatDateTimeRange,
  type AnnouncementRow,
  type CalendarQueueItem,
} from "@/lib/queries/announcements";
import { cn } from "@/lib/utils";

type AnnouncementCalendarQueueProps = {
  churchId: string;
  queue: CalendarQueueItem[];
  published: AnnouncementRow[];
  googleConnected: boolean;
  facebookConnected: boolean;
};

export function AnnouncementCalendarQueue({
  churchId,
  queue,
  published,
  googleConnected,
  facebookConnected,
}: AnnouncementCalendarQueueProps) {
  const [expandedId, setExpandedId] = useState<string | null>(
    queue.length === 1 ? queue[0]?.googleEventId ?? null : null,
  );
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [showPublished, setShowPublished] = useState(false);

  const visibleQueue = queue.filter((e) => !hiddenIds.has(e.googleEventId));
  const defaults = { googleConnected, facebookConnected };

  if (!googleConnected) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="size-6 text-accent" strokeWidth={1.75} />
            Connect Google Calendar
          </CardTitle>
          <CardDescription>
            Link Google in Settings to pull this week&apos;s events and prefill
            title, time, and location.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard/settings?tab=integrations">
            <Button>Go to Settings</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">This week from Google Calendar</h2>
          <p className="text-sm text-muted-foreground">
            Review prefilled details, then verify and submit in one step.
          </p>
        </div>

        {visibleQueue.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            All upcoming calendar events are submitted. Check back when new events
            are added.
          </div>
        ) : (
          visibleQueue.map((event) => {
            const isOpen = expandedId === event.googleEventId;
            return (
              <Card
                key={event.googleEventId}
                className={cn(
                  "transition-shadow hover:shadow-card-hover",
                  isOpen && "ring-2 ring-accent/30",
                )}
              >
                <CardHeader className="pb-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base">{event.title}</CardTitle>
                      <CardDescription className="mt-1">
                        {event.location && (
                          <span className="block">{event.location}</span>
                        )}
                        <span>
                          {formatDateTimeRange(event.startAt, event.endAt)}
                        </span>
                      </CardDescription>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {event.htmlLink && (
                        <a
                          href={event.htmlLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Open in Google Calendar"
                        >
                          <ExternalLink className="size-4" strokeWidth={1.75} />
                        </a>
                      )}
                      <Button
                        type="button"
                        variant={isOpen ? "outline" : "default"}
                        size={isOpen ? "icon" : "sm"}
                        onClick={() =>
                          setExpandedId(isOpen ? null : event.googleEventId)
                        }
                        aria-label={isOpen ? "Close details" : "Verify and submit"}
                        className={isOpen ? "rounded-full" : undefined}
                      >
                        {isOpen ? (
                          <X className="size-4" strokeWidth={1.75} />
                        ) : (
                          "Verify & submit"
                        )}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {isOpen && (
                  <CardContent className="border-t border-border pt-4">
                    <AnnouncementVerifyForm
                      churchId={churchId}
                      event={event}
                      defaults={defaults}
                      compact
                      onPublished={() => {
                        setHiddenIds((prev) => {
                          const next = new Set(prev);
                          next.add(event.googleEventId);
                          return next;
                        });
                        setExpandedId(null);
                      }}
                    />
                  </CardContent>
                )}
              </Card>
            );
          })
        )}
      </section>

      {published.length > 0 && (
        <section className="flex flex-col gap-3">
          <button
            type="button"
            className="flex items-center gap-2 text-left font-heading text-lg font-semibold hover:text-accent"
            onClick={() => setShowPublished((v) => !v)}
          >
            <ChevronDown
              className={cn(
                "size-5 transition-transform",
                showPublished && "rotate-180",
              )}
            />
            Submitted ({published.length})
          </button>
          {showPublished &&
            published.map((item) => (
              <Card key={item.id}>
                <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDateTimeRange(item.start_at, item.end_at)}
                    </p>
                    {item.last_publish_error && (
                      <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                        {item.last_publish_error}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.facebook_post_id && (
                      <a
                        href={`https://www.facebook.com/${item.facebook_post_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="outline" size="sm">
                          View on Facebook
                        </Button>
                      </a>
                    )}
                    <a
                      href="https://mail.google.com/mail/u/0/#drafts"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm">
                        <Mail className="size-4" strokeWidth={1.75} />
                        Gmail drafts
                      </Button>
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))}
        </section>
      )}
    </div>
  );
}
