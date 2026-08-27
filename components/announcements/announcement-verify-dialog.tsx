"use client";

import { AnnouncementVerifyForm } from "@/components/announcements/announcement-verify-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CalendarEventPreview } from "@/lib/integrations/types";
import { formatDateTimeRange } from "@/lib/queries/announcements";

type IntegrationDefaults = {
  googleConnected: boolean;
  facebookConnected: boolean;
};

type AnnouncementVerifyDialogProps = {
  churchId: string;
  event: CalendarEventPreview | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults: IntegrationDefaults;
  onPublished?: (googleEventId: string, announcementId?: string) => void;
};

export function AnnouncementVerifyDialog({
  churchId,
  event,
  open,
  onOpenChange,
  defaults,
  onPublished,
}: AnnouncementVerifyDialogProps) {
  if (!event) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,720px)] max-w-lg overflow-y-auto p-0">
        <DialogHeader>
          <DialogTitle>Verify & submit</DialogTitle>
          <DialogDescription>
            {formatDateTimeRange(event.startAt, event.endAt, null, event.allDay)}
            {event.location ? ` · ${event.location}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-6">
          <AnnouncementVerifyForm
            churchId={churchId}
            event={event}
            defaults={defaults}
            compact
            onPublished={() => {
              onPublished?.(event.googleEventId);
              onOpenChange(false);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
