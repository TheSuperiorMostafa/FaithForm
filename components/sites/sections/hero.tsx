import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import { cn } from "@/lib/utils";
import type { HeroContent } from "@/types/site";

import { Action, Eyebrow, Headline, Media, surfaceClass } from "../primitives";

function Hero({ content, ctx }: SectionComponentProps<HeroContent>) {
  return (
    <header id={ctx.anchor} className={cn("site-hero", surfaceClass(content.surface))}>
      <div
        className={cn(
          "site-hero-body",
          content.align === "center" && "site-hero-center",
        )}
      >
        <Eyebrow>{content.eyebrow}</Eyebrow>
        <Headline as="h1" headline={content.headline} className="site-display-xl" />

        {content.body || content.actions.length > 0 ? (
          <div className="site-hero-foot">
            {content.body ? <p className="site-lede">{content.body}</p> : null}
            {content.actions.length > 0 ? (
              <div className="site-hero-actions">
                {content.actions.map((action) => (
                  <Action key={action.label + action.href} action={action} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <Media image={content.image} className="site-hero-media" />
    </header>
  );
}

export const heroSection = defineSection<HeroContent>({
  type: "hero",
  defaults: {
    eyebrow: null,
    headline: { lead: "Welcome home." },
    body: null,
    actions: [],
    image: null,
    surface: "ink",
    align: "split",
  },
  // The hook line is bespoke copy that lives in the page config; what the
  // profile can honestly fill is the supporting material around it.
  derive: (profile) => ({
    ...(profile.tagline ? { eyebrow: profile.tagline.toUpperCase() } : {}),
    headline: { lead: `Welcome to ${profile.name}.` },
    ...(profile.description ? { body: profile.description } : {}),
    ...(profile.coverImageUrl
      ? { image: { src: profile.coverImageUrl, alt: profile.name } }
      : {}),
  }),
  Component: Hero,
});
