import { AlertTriangle } from "lucide-react";

import {
  capacityAlertMessage,
  unusualActivityMessage,
  type RoomAlert,
} from "@/lib/checkin/rooms-activity";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

/**
 * Soundless in-dashboard banners: rooms at/over capacity, and no-code releases
 * today. Volunteers see these at the top of Rooms before the roster.
 */
export function RoomAlerts({ alerts }: { alerts: RoomAlert[] }) {
  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      {alerts.map((alert) => {
        const key =
          alert.kind === "released_without_code"
            ? "released_without_code"
            : `${alert.kind}:${alert.locationId}`;
        const message =
          alert.kind === "released_without_code"
            ? unusualActivityMessage(alert)
            : capacityAlertMessage(alert);
        const badge =
          alert.kind === "over"
            ? "Over capacity"
            : alert.kind === "full"
              ? "Full"
              : "Needs attention";

        return (
          <div
            key={key}
            role={alert.kind === "released_without_code" || alert.kind === "over" ? "alert" : undefined}
            className={cn(
              "flex flex-wrap items-start gap-3 rounded-2xl border px-4 py-3",
              alert.kind === "released_without_code" || alert.kind === "over"
                ? "border-orange-200 bg-orange-50 dark:border-orange-500/30 dark:bg-orange-500/10"
                : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
            )}
          >
            <AlertTriangle
              aria-hidden
              className="mt-0.5 size-5 shrink-0 text-orange-700 dark:text-orange-300"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <StatusBadge tone="attention">{badge}</StatusBadge>
              <p className="text-[15px] font-semibold text-foreground">{message}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
