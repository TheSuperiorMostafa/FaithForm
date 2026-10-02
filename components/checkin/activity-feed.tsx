import { History } from "lucide-react";

import { ACTIVITY_DESCRIPTION, ACTIVITY_TITLE } from "@/components/checkin/copy";
import { EmptyState } from "@/components/ui/empty-state";
import { InitialsAvatar, List, ListRow } from "@/components/ui/list-row";
import { SectionHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  activityActionLabel,
  formatActivityTime,
  type CheckinActivityEvent,
} from "@/lib/checkin/rooms-activity";

/**
 * Today's check-ins and check-outs. Override releases are highlighted so staff
 * notice unusual handovers without leaving the Rooms tab.
 */
export function ActivityFeed({
  events,
  timeZone,
}: {
  events: CheckinActivityEvent[];
  timeZone: string;
}) {
  return (
    <section aria-labelledby="rooms-activity" className="flex w-full flex-col gap-4">
      <SectionHeader
        id="rooms-activity"
        title={ACTIVITY_TITLE}
        description={ACTIVITY_DESCRIPTION}
      />

      {events.length === 0 ? (
        <EmptyState
          compact
          icon={History}
          title="No check-ins yet today"
          description="As children are checked in or picked up, each one appears here with the time and room."
        />
      ) : (
        <List label={ACTIVITY_TITLE}>
          {events.map((event) => {
            const unusual = event.kind === "released_without_code";
            return (
              <ListRow
                key={event.id}
                compact
                className={
                  unusual
                    ? "bg-orange-50/80 ring-1 ring-orange-200 dark:bg-orange-500/10 dark:ring-orange-500/30"
                    : undefined
                }
                leading={<InitialsAvatar name={event.childName} className="size-9 text-sm" />}
                title={event.childName}
                status={
                  <time dateTime={event.at} className="text-sm text-muted-foreground">
                    {formatActivityTime(event.at, timeZone)}
                  </time>
                }
                subtitle={
                  <>
                    <StatusBadge tone={unusual ? "attention" : event.kind === "checked_out" ? "done" : "ready"}>
                      {activityActionLabel(event.kind)}
                    </StatusBadge>
                    <span className="ml-2">{event.roomName}</span>
                    {event.reason ? (
                      <span className="mt-1 block">Reason: &ldquo;{event.reason}&rdquo;</span>
                    ) : null}
                  </>
                }
              />
            );
          })}
        </List>
      )}
    </section>
  );
}
