import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import { formatLongDate } from "@/lib/sites/format";
import type { EventsListContent } from "@/types/site";

import { SectionHead, SectionShell } from "../primitives";

/**
 * Not part of the Louisville Grace mock. It exists because the announcements
 * table already carries approved, dated events, and because proving a second
 * church can look different needs at least one section the first one omits.
 */
function EventsList({ content, ctx }: SectionComponentProps<EventsListContent>) {
  return (
    <SectionShell surface={content.surface} anchor={ctx.anchor}>
      <SectionHead
        eyebrow={content.eyebrow}
        headline={content.headline}
        link={content.link}
        align={content.align}
      />

      {content.items.length === 0 ? (
        <p className="site-empty">{content.emptyMessage}</p>
      ) : (
        <div>
          {content.items.map((event, index) => (
            <div key={index} className="site-event">
              <div className="site-event-date">{event.date ?? "Upcoming"}</div>
              <div>
                <h3 className="site-event-title">{event.title}</h3>
                {event.location || event.note ? (
                  <p className="site-event-meta">
                    {[event.location, event.note].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

export const eventsListSection = defineSection<EventsListContent>({
  type: "events_list",
  label: "Events",
  fields: [
    { key: "eyebrow", label: "Eyebrow", type: "text" },
    { key: "headline", label: "Headline", type: "headline" },
    {
      key: "emptyMessage",
      label: "Message when nothing is scheduled",
      type: "text",
    },
    {
      key: "items",
      label: "Events",
      type: "list",
      addLabel: "Add event",
      titleKey: "title",
      help: "Left empty, this shows your approved announcements with an upcoming date.",
      itemFields: [
        { key: "title", label: "Title", type: "text" },
        { key: "date", label: "Date", type: "text" },
        { key: "location", label: "Location", type: "text" },
        { key: "note", label: "Note", type: "textarea" },
      ],
    },
  ],
  defaults: {
    eyebrow: null,
    headline: { lead: "What's coming up" },
    link: null,
    items: [],
    emptyMessage: "Nothing on the calendar just yet — check back soon.",
    surface: "canvas",
    align: "split",
  },
  derive: (profile) => {
    if (profile.events.length === 0) return {};

    return {
      items: profile.events.map((event) => ({
        title: event.title,
        date: formatLongDate(event.date),
        location: event.location,
        note: event.note,
      })),
    };
  },
  Component: EventsList,
});
