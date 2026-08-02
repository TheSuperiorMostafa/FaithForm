import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import { formatDayAndTime } from "@/lib/sites/format";
import type { ProgramsGridContent } from "@/types/site";

import { SectionHead, SectionShell, gridStyle } from "../primitives";

function ProgramsGrid({ content, ctx }: SectionComponentProps<ProgramsGridContent>) {
  if (content.items.length === 0) return null;

  return (
    <SectionShell surface={content.surface} anchor={ctx.anchor}>
      <SectionHead
        eyebrow={content.eyebrow}
        headline={content.headline}
        link={content.link}
        align={content.align}
      />
      <div
        className="site-grid"
        style={gridStyle(content.columns, content.items.length)}
      >
        {content.items.map((item, index) => (
          <article key={index} className="site-card">
            <div className="site-card-top">
              <div className="site-badge">{item.badge}</div>
              <div className="site-card-when">{item.when}</div>
            </div>
            <h3 className="site-card-title">{item.title}</h3>
            <p className="site-card-body">{item.body}</p>
          </article>
        ))}
      </div>
    </SectionShell>
  );
}

export const programsGridSection = defineSection<ProgramsGridContent>({
  type: "programs_grid",
  defaults: {
    eyebrow: null,
    headline: { lead: "Find your people" },
    link: null,
    items: [],
    columns: 3,
    surface: "ink",
    align: "split",
  },
  // A weekly gathering is already in the profile as a service time; anything
  // richer (kids, students, small groups) is copy that belongs in the config.
  derive: (profile) => {
    if (profile.serviceTimes.length === 0) return {};

    return {
      items: profile.serviceTimes.map((time) => ({
        badge: time.label.trim().charAt(0).toUpperCase() || "•",
        when: formatDayAndTime(time.dayOfWeek, time.startTime),
        title: time.label,
        body: time.notes ?? "",
      })),
    };
  },
  Component: ProgramsGrid,
});
