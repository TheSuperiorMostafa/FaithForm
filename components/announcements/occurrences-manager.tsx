"use client";

import { useState, useEffect } from "react";
import { Calendar, Edit2, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import {
  listAnnouncementOccurrences,
  cancelRecurringOccurrence,
} from "@/app/dashboard/announcements/recurring-actions";

type Occurrence = {
  id: string;
  occurrence_date: string;
  start_at: string;
  end_at: string | null;
  override_title: string | null;
  override_description: string | null;
  override_location: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
};

export function OccurrencesManager({ announcementId, title }: { announcementId: string; title: string }) {
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadOccurrences();
  }, [announcementId]);

  async function loadOccurrences() {
    setLoading(true);
    const result = await listAnnouncementOccurrences(announcementId);
    if (result.ok) {
      setOccurrences(result.data);
    } else {
      toast.error(result.error);
    }
    setLoading(false);
  }

  async function handleCancel(occurrenceId: string, date: string) {
    const confirmed = await confirmAction({
      title: "Cancel this occurrence?",
      description: `This will cancel the ${title} event on ${new Date(date).toLocaleDateString()}. You can optionally add a reason.`,
      confirmLabel: "Cancel occurrence",
      variant: "destructive",
    });

    if (!confirmed) return;

    setBusy(true);
    const result = await cancelRecurringOccurrence(occurrenceId, null);
    setBusy(false);

    if (result.ok) {
      toast.success("Occurrence cancelled");
      await loadOccurrences();
    } else {
      toast.error(result.error);
    }
  }

  const futureOccurrences = occurrences.filter(o => new Date(o.occurrence_date) >= new Date());
  const pastOccurrences = occurrences.filter(o => new Date(o.occurrence_date) < new Date());

  if (loading) {
    return (
      <div className="rounded-xl border border-border p-6">
        <div className="flex items-center gap-3">
          <Calendar className="size-5 text-muted-foreground" />
          <div className="h-5 w-32 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (occurrences.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center justify-between border-b border-border p-5">
        <div className="flex items-center gap-3">
          <Calendar className="size-5 text-muted-foreground" />
          <h3 className="text-[17px] font-semibold">Recurring Occurrences</h3>
          <span className="text-[15px] text-muted-foreground">
            {futureOccurrences.length} upcoming
          </span>
        </div>
        {pastOccurrences.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                <ChevronUp className="size-4" />
                <span className="ml-1.5">Hide past</span>
              </>
            ) : (
              <>
                <ChevronDown className="size-4" />
                <span className="ml-1.5">Show {pastOccurrences.length} past</span>
              </>
            )}
          </Button>
        )}
      </div>

      <div className="divide-y divide-border">
        {futureOccurrences.map((occurrence) => (
          <OccurrenceRow
            key={occurrence.id}
            occurrence={occurrence}
            onCancel={() => handleCancel(occurrence.id, occurrence.occurrence_date)}
            busy={busy}
          />
        ))}
        {expanded && pastOccurrences.map((occurrence) => (
          <OccurrenceRow
            key={occurrence.id}
            occurrence={occurrence}
            onCancel={() => handleCancel(occurrence.id, occurrence.occurrence_date)}
            busy={busy}
            isPast
          />
        ))}
      </div>
    </div>
  );
}

function OccurrenceRow({
  occurrence,
  onCancel,
  busy,
  isPast = false,
}: {
  occurrence: Occurrence;
  onCancel: () => void;
  busy: boolean;
  isPast?: boolean;
}) {
  const date = new Date(occurrence.occurrence_date);
  const isCancelled = occurrence.cancelled_at !== null;

  return (
    <div className={`flex items-center justify-between p-4 ${isPast ? "opacity-50" : ""}`}>
      <div className="flex-1">
        <div className="flex items-center gap-3">
          <time className="text-[15px] font-medium">
            {date.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </time>
          {occurrence.override_title && (
            <span className="text-[13px] text-muted-foreground">
              (Modified)
            </span>
          )}
          {isCancelled && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-0.5 text-[13px] font-medium text-destructive">
              <XCircle className="size-3.5" />
              Cancelled
            </span>
          )}
        </div>
        {occurrence.cancel_reason && (
          <p className="mt-1 text-[13px] text-muted-foreground">
            {occurrence.cancel_reason}
          </p>
        )}
        {occurrence.override_location && (
          <p className="mt-1 text-[13px] text-muted-foreground">
            📍 {occurrence.override_location}
          </p>
        )}
      </div>

      {!isCancelled && !isPast && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            title="Edit this occurrence"
          >
            <Edit2 className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onCancel}
            title="Cancel this occurrence"
          >
            <XCircle className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
