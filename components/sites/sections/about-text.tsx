import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import { cn } from "@/lib/utils";
import type { AboutTextContent } from "@/types/site";

import { Eyebrow, Headline, Media, SectionShell } from "../primitives";

function AboutText({ content, ctx }: SectionComponentProps<AboutTextContent>) {
  const centered = content.align === "center";

  const copy = (
    <div>
      <Eyebrow>{content.eyebrow}</Eyebrow>
      <Headline headline={content.headline} className="site-display-md" />
      {content.body.map((paragraph, index) => (
        <p key={index} className="site-about-body">
          {paragraph}
        </p>
      ))}
      {content.stats.length > 0 ? (
        <div className="site-stats">
          {content.stats.map((stat, index) => (
            <div key={index}>
              <div className="site-stat-value">{stat.value}</div>
              <div className="site-stat-label">{stat.label}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  if (centered || !content.image) {
    return (
      <SectionShell
        surface={content.surface}
        anchor={ctx.anchor}
        className={cn(centered && "site-head-center")}
      >
        {copy}
        <Media image={content.image} className="site-figure" />
      </SectionShell>
    );
  }

  return (
    <SectionShell surface={content.surface} anchor={ctx.anchor}>
      <div className="site-split" style={{ "--site-split": ".95fr 1.05fr" } as React.CSSProperties}>
        {copy}
        <Media image={content.image} className="site-figure" />
      </div>
    </SectionShell>
  );
}

export const aboutTextSection = defineSection<AboutTextContent>({
  type: "about_text",
  label: "About",
  fields: [
    { key: "eyebrow", label: "Eyebrow", type: "text" },
    { key: "headline", label: "Headline", type: "headline" },
    { key: "body", label: "Paragraphs", type: "paragraphs" },
    {
      key: "stats",
      label: "Numbers",
      type: "list",
      addLabel: "Add number",
      titleKey: "value",
      itemFields: [
        { key: "value", label: "Number", type: "text", help: "e.g. 70+" },
        { key: "label", label: "Caption", type: "text" },
      ],
    },
    { key: "image", label: "Image", type: "image" },
  ],
  defaults: {
    eyebrow: null,
    headline: { lead: "About us" },
    body: [],
    stats: [],
    image: null,
    surface: "canvas",
    align: "split",
  },
  derive: (profile) => ({
    ...(profile.description ? { body: [profile.description] } : {}),
    ...(profile.coverImageUrl
      ? { image: { src: profile.coverImageUrl, alt: profile.name } }
      : {}),
  }),
  Component: AboutText,
});
