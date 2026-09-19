"use client";

import { useState, useTransition } from "react";
import { Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { deleteCalendarEvent } from "@/app/dashboard/announcements/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { publishedChannels } from "@/lib/announcements/published-channels";
import type { EventAttendanceSettings } from "@/lib/attendance/v2/event-attendance-types";
import type { CalendarEventPreview } from "@/lib/integrations/types";
import type { AnnouncementRow } from "@/lib/queries/announcements";

type DeleteEventButtonProps = {
  event: CalendarEventPreview;
  /** Present once the event has been published. */
  announcement?: AnnouncementRow | null;
  queuedForWeeklyEmail?: boolean;
  attendance?: EventAttendanceSettings;
  onDeleted: (eventId: string) => void;
};

/**
 * Deletes an event from the church calendar, published or not.
 *
 * The dialog lists everything that goes with it, so nothing disappears from
 * the app or Facebook without the church having read that it would. An event
 * FaithForm cannot delete (a read-only iCloud link, or a repeating iCloud
 * event) opens the same dialog, which says where to delete it instead.
 */
export function DeleteEventButton({
  event,
  announcement,
  queuedForWeeklyEmail = false,
  attendance,
  onDeleted,
}: DeleteEventButtonProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteLivePost, setDeleteLivePost] = useState(true);
  const [pending, startTransition] = useTransition();

  const onApple = event.source === "apple";
  const calendarName = onApple ? "iCloud Calendar" : "Google Calendar";
  const blockedReason = event.readOnly
    ? "This event comes from your iCloud calendar link, so FaithForm can't delete it. Delete it in Apple Calendar and it will disappear here within a few minutes."
    : onApple && event.recurring
      ? "This is a repeating iCloud event. Delete it in Apple Calendar, where you can choose whether it's this date or the whole series."
      : null;

  const channels = announcement
    ? publishedChannels(announcement, { queuedForWeeklyEmail })
    : null;
  const facebook = channels?.facebook;
  const facebookLive = Boolean(facebook?.published && !facebook.scheduledFor);
  const checkInWillStop = Boolean(attendance?.enabled && !attendance.locked);

  const consequences = [
    event.recurring && !onApple
      ? "Only this date is deleted. The rest of the series stays on your calendar."
      : null,
    channels?.app.published ? "It's removed from the FaithForm app." : null,
    facebook?.published && facebook.scheduledFor
      ? "The scheduled Facebook post is cancelled."
      : null,
    queuedForWeeklyEmail || channels?.weeklyEmail.published
      ? "It's taken out of the weekly email."
      : null,
    checkInWillStop ? "Check-in for this event is turned off." : null,
    announcement ? "Its announcement in FaithForm is deleted." : null,
  ].filter((line): line is string => Boolean(line));

  const handleOpenChange = (next: boolean) => {
    if (pending) return;
    setOpen(next);
    if (next) {
      setError(null);
      setDeleteLivePost(true);
    }
  };

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await deleteCalendarEvent({
        eventId: event.googleEventId,
        deleteLiveFacebookPost: facebookLive && deleteLivePost,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setOpen(false);
      toast.success(`Deleted “${event.title}”.`);
      if (result.facebookUrl) {
        toast.warning("The Facebook post is still up.", {
          action: {
            label: "View post",
            onClick: () => window.open(result.facebookUrl, "_blank"),
          },
          duration: 10000,
        });
      }
      for (const warning of result.warnings) {
        toast.error(warning, { duration: 10000 });
      }
      onDeleted(event.googleEventId);
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => handleOpenChange(true)}
      >
        <Trash2 className="size-4" strokeWidth={1.75} />
        Delete event
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {blockedReason ? "Delete this event in Apple Calendar" : "Delete this event?"}
            </DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-foreground">{event.title}</span>
              {blockedReason
                ? " can't be deleted from FaithForm."
                : ` is deleted from ${calendarName}. This can't be undone.`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 px-6 py-5 text-sm">
            {blockedReason ? (
              <p className="text-muted-foreground">{blockedReason}</p>
            ) : (
              <>
                {consequences.length > 0 && (
                  <ul className="flex flex-col gap-2 text-muted-foreground">
                    {consequences.map((line) => (
                      <li key={line} className="flex gap-2">
                        <span aria-hidden className="text-accent">
                          •
                        </span>
                        {line}
                      </li>
                    ))}
                  </ul>
                )}

                {facebookLive && (
                  <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/20 dark:bg-amber-500/10">
                    <label className="flex items-start gap-2 font-medium text-amber-900 dark:text-amber-100">
                      <input
                        type="checkbox"
                        checked={deleteLivePost}
                        onChange={(e) => setDeleteLivePost(e.target.checked)}
                        className="mt-1"
                      />
                      Also delete the Facebook post
                    </label>
                    <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
                      <TriangleAlert
                        className="mt-0.5 size-3.5 shrink-0"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      It&apos;s already live, so people may have seen it.
                      {deleteLivePost
                        ? " Its likes and comments go with it."
                        : " It stays on your Page until you remove it."}
                    </p>
                  </div>
                )}

                {error && (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              {blockedReason ? "Close" : "Cancel"}
            </Button>
            {!blockedReason && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirm}
                disabled={pending}
              >
                {pending ? "Deleting…" : "Delete event"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
