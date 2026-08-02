import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import { formatCityLine, formatServiceTime } from "@/lib/sites/format";
import { cn } from "@/lib/utils";
import type { ServiceTimesCell, ServiceTimesContent } from "@/types/site";

import { gridStyle, surfaceClass } from "../primitives";

/**
 * The times strip. Kept separate from the hero rather than nested inside it, so
 * either can be reordered on its own. When both carry the same surface they
 * share a background and this section's top rule reads as the divider -- which
 * is exactly how the mock looks, with no adjacency logic anywhere.
 */
function ServiceTimes({ content, ctx }: SectionComponentProps<ServiceTimesContent>) {
  if (content.items.length === 0) return null;

  return (
    <section
      id={ctx.anchor}
      className={cn("site-strip", surfaceClass(content.surface))}
      style={gridStyle(content.columns, content.items.length)}
    >
      {content.items.map((cell, index) => (
        <div key={`${cell.label}-${index}`} className="site-strip-cell">
          <div className="site-strip-label">{cell.label}</div>
          {cell.value ? <div className="site-strip-value">{cell.value}</div> : null}
          {cell.lines?.length ? (
            <div className="site-strip-lines">
              {cell.lines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}

export const serviceTimesSection = defineSection<ServiceTimesContent>({
  type: "service_times",
  defaults: {
    items: [],
    columns: 4,
    surface: "ink",
  },
  derive: (profile) => {
    const items: ServiceTimesCell[] = profile.serviceTimes
      .map((time) => ({
        label: time.label,
        value: formatServiceTime(time.startTime),
      }))
      .filter((cell) => Boolean(cell.value));

    const cityLine = formatCityLine(profile.city, profile.state, profile.zip);
    if (profile.address || cityLine) {
      items.push({
        label: "Find us",
        lines: [profile.address, cityLine].filter((line): line is string =>
          Boolean(line),
        ),
      });
    }

    if (items.length === 0) return {};

    // Column count follows the data, so a church with two services never gets
    // a hanging empty cell. A page config can still override it.
    return { items, columns: items.length };
  },
  Component: ServiceTimes,
});
