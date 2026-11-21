import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import { cn } from "@/lib/utils";
import type { HeroContent } from "@/types/site";

import { Action, Eyebrow, Headline, Media, surfaceClass } from "../primitives";
import { drawableSocials, socialLinks, SocialLinks } from "./contact-band";

function Hero({ content, ctx }: SectionComponentProps<HeroContent>) {
  const socials = drawableSocials(content.socials);
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

        {content.body || content.actions.length > 0 || socials.length > 0 ? (
          <div className="site-hero-foot">
            {content.body ? <p className="site-lede">{content.body}</p> : null}
            {content.actions.length > 0 ? (
              <div className="site-hero-actions">
                {content.actions.map((action) => (
                  <Action key={action.label + action.href} action={action} />
                ))}
              </div>
            ) : null}
            {/* Hidden by default; formats that want them in the banner show them. */}
            {socials.length > 0 ? (
              <SocialLinks links={socials} className="site-hero-socials" linkClassName="site-hero-social" />
            ) : null}
          </div>
        ) : null}
      </div>

      {/* The hero photo is the page's largest contentful paint — never lazy. */}
      <Media image={content.image} className="site-hero-media" priority />
    </header>
  );
}

export const heroSection = defineSection<HeroContent>({
  type: "hero",
  label: "Banner",
  // Photo above the button list, for the same reason as About: last place in a
  // form that ends in an expandable list is where a field goes to be missed.
  fields: [
    { key: "eyebrow", label: "Small heading above", type: "text", help: "A short line shown above the headline." },
    { key: "headline", label: "Headline", type: "headline" },
    { key: "body", label: "Intro paragraph", type: "textarea" },
    {
      key: "image",
      label: "Banner photo",
      type: "image",
      aspect: "banner",
      help: "Starts as your cover photo. A photo you choose here changes only your website; the app keeps its cover photo.",
    },
    {
      key: "actions",
      label: "Buttons",
      type: "list",
      addLabel: "Add button",
      titleKey: "label",
      itemFields: [
        { key: "label", label: "Label", type: "text" },
        { key: "href", label: "Link", type: "url" },
        {
          key: "variant",
          label: "Style",
          type: "select",
          options: [
            { value: "solid", label: "Solid" },
            { value: "outline", label: "Outline" },
          ],
        },
      ],
    },
  ],
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
  derive: (profile) => {
    const socials = socialLinks(profile);
    return {
    ...(profile.tagline ? { eyebrow: profile.tagline.toUpperCase() } : {}),
    headline: { lead: `Welcome to ${profile.name}.` },
    ...(profile.description ? { body: profile.description } : {}),
    ...(profile.coverImageUrl
      ? { image: { src: profile.coverImageUrl, alt: profile.name } }
      : {}),
    ...(socials.length > 0 ? { socials } : {}),
    };
  },
  Component: Hero,
});
