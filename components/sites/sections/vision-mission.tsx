import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import type { VisionMissionContent } from "@/types/site";

import { SectionHead, SectionShell, gridStyle } from "../primitives";

function VisionMission({ content, ctx }: SectionComponentProps<VisionMissionContent>) {
  if (content.cards.length === 0) return null;

  return (
    <SectionShell surface={content.surface} anchor={ctx.anchor}>
      <SectionHead
        eyebrow={content.eyebrow}
        headline={content.headline}
        align={content.align}
      />
      <div className="site-grid" style={gridStyle(2, content.cards.length)}>
        {content.cards.map((card, index) => (
          <article key={index} className="site-card site-card-lg">
            <div className="site-badge">{card.badge}</div>
            <h3 className="site-card-title">{card.title}</h3>
            <p className="site-card-body">{card.body}</p>
          </article>
        ))}
      </div>
    </SectionShell>
  );
}

export const visionMissionSection = defineSection<VisionMissionContent>({
  type: "vision_mission",
  defaults: {
    eyebrow: null,
    headline: { lead: "Our vision & mission" },
    cards: [],
    surface: "ink",
    align: "center",
  },
  derive: (profile) => {
    const cards: VisionMissionContent["cards"] = [];

    if (profile.visionStatement) {
      cards.push({ badge: "V", title: "Our Vision", body: profile.visionStatement });
    }
    if (profile.missionStatement) {
      cards.push({ badge: "M", title: "Our Mission", body: profile.missionStatement });
    }

    return cards.length > 0 ? { cards } : {};
  },
  Component: VisionMission,
});
