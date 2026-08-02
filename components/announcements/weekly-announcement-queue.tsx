"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, ChevronDown, ExternalLink, Mail, X } from "lucide-react";
import { createWeeklyAnnouncementDraftAction } from "@/app/dashboard/announcements/actions";
import { AnnouncementVerifyForm } from "@/components/announcements/announcement-verify-form";
import { UnsubmitAnnouncementButton } from "@/components/announcements/unsubmit-announcement-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { WeeklyQueueItem } from "@/lib/announcements/weekly-email";
import {
  formatDateTimeRange,
  type AnnouncementRow,
} from "@/lib/queries/announcements";
import { cn } from "@/lib/utils";

type WeeklyAnnouncementQueueProps = {
  churchId: string;
  queue: WeeklyQueueItem[];
  published: AnnouncementRow[];
  googleConnected: boolean;
  facebookConnected: boolean;
  weekLabel: string;
  weeklyDraftCreated: boolean;
  isAdmin: boolean;
};

export function WeeklyAnnouncementQueue({
  churchId,
  queue,
  published,
  googleConnected,
  facebookConnected,
  weekLabel,
  weeklyDraftCreated,
  isAdmin,
}: WeeklyAnnouncementQueueProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showPublished, setShowPublished] = useState(false);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const visibleQueue = queue;
  const upcomingQueue = visibleQueue.filter((e) => !e.skippedReason);
  const defaults = { googleConnected, facebookConnected };

  const publishedById = new Map(published.map((item) => [item.id, item]));

  /** A scheduled post whose slot has passed is already public. */
  const isFacebookLive = (item: AnnouncementRow | undefined): boolean => {
    if (!item?.facebook_post_id) return false;
    const scheduled = item.facebook_scheduled_publish_time;
    if (!scheduled) return true;
    return new Date(scheduled).getTime() <= Date.now();
  };

  const handleCreateDraft = (force = false) => {
    setDraftMessage(null);
    setDraftError(null);
    startTransition(async () => {
      const result = await createWeeklyAnnouncementDraftAction({ force });
      if (result.error) {
        setDraftError(result.error);
        return;
      }
      setDraftMessage(
        `Gmail draft created with ${result.eventCount} upcoming event${result.eventCount === 1 ? "" : "s"}.`,
      );
      router.refresh();
    });
  };

  if (!googleConnected) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="size-6 text-accent" strokeWidth={1.75} />
            Connect Google Calendar
          </CardTitle>
          <CardDescription>
            Link Google in Settings to pull this week&apos;s events and create
            Monday Gmail drafts.
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-heading text-lg font-semibold">
              Weekly email queue
            </h2>
            <p className="text-sm text-muted-foreground">
              {weekLabel} — one Gmail draft every Monday. Past events are
              skipped automatically.
            </p>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => handleCreateDraft(false)}
              >
                <Mail className="mr-2 size-4" strokeWidth={1.75} />
                {pending ? "Creating…" : "Create weekly draft"}
              </Button>
              {weeklyDraftCreated && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => handleCreateDraft(true)}
                >
                  Regenerate
                </Button>
              )}
              <a
                href="https://mail.google.com/mail/u/0/#drafts"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button type="button" variant="ghost" size="sm">
                  Open Gmail drafts
                </Button>
              </a>
            </div>
          )}
        </div>

        {weeklyDraftCreated && (
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-300">
            This week&apos;s Gmail draft was already created.
          </p>
        )}
        {draftMessage && (
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-300">
            {draftMessage}
          </p>
        )}
        {draftError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {draftError}
          </p>
        )}

        {visibleQueue.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            No calendar events this week.
          </div>
        ) : (
          visibleQueue.map((event) => {
            const isOpen = expandedId === event.googleEventId;
            const isPast = event.skippedReason === "past";

            return (
              <Card
                key={event.googleEventId}
                className={cn(
                  "transition-shadow hover:shadow-card-hover",
                  isOpen && "ring-2 ring-accent/30",
                  isPast && "opacity-60",
                )}
              >
                <CardHeader className="pb-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">{event.title}</CardTitle>
                        {isPast ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                            Past — skipped
                          </span>
                        ) : event.published ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-500/15 dark:text-green-300">
                            Submitted
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                            Pending
                          </span>
                        )}
                        {!isPast && event.includeInWeeklyEmail && (
                          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                            Weekly email
                          </span>
                        )}
                      </div>
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
                      {isAdmin && event.published && event.announcementId && (
                        <UnsubmitAnnouncementButton
                          announcementId={event.announcementId}
                          title={event.title}
                          facebookIsLive={isFacebookLive(
                            publishedById.get(event.announcementId),
                          )}
                        />
                      )}
                      {!isPast && (
                        <Button
                          type="button"
                          variant={isOpen ? "outline" : "default"}
                          size={isOpen ? "icon" : "sm"}
                          onClick={() =>
                            setExpandedId(isOpen ? null : event.googleEventId)
                          }
                          aria-label={
                            isOpen
                              ? "Close details"
                              : event.published
                                ? "Edit and resubmit"
                                : "Verify and submit"
                          }
                          className={isOpen ? "rounded-full" : undefined}
                        >
                          {isOpen ? (
                            <X className="size-4" strokeWidth={1.75} />
                          ) : event.published ? (
                            "Edit"
                          ) : (
                            "Verify & submit"
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {isOpen && !isPast && (
                  <CardContent className="border-t border-border pt-4">
                    <AnnouncementVerifyForm
                      churchId={churchId}
                      event={event}
                      defaults={defaults}
                      publishedAnnouncementId={event.announcementId}
                      compact
                      onPublished={() => {
                        setExpandedId(null);
                        router.refresh();
                      }}
                    />
                  </CardContent>
                )}
              </Card>
            );
          })
        )}

        {upcomingQueue.length === 0 && visibleQueue.length > 0 && (
          <p className="text-sm text-muted-foreground">
            All remaining events this week are in the past.
          </p>
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
                  <div className="flex flex-wrap items-center gap-2">
                    {item.push_to_team && (
                      <span className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                        Weekly email
                      </span>
                    )}
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
                    {isAdmin && (
                      <UnsubmitAnnouncementButton
                        announcementId={item.id}
                        title={item.title}
                        facebookIsLive={isFacebookLive(item)}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
        </section>
      )}
    </div>
  );
}
