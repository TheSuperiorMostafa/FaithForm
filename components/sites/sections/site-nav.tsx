import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import { cn } from "@/lib/utils";
import type { NavContent } from "@/types/site";

import { Action } from "../primitives";

function SiteNav({ content, ctx }: SectionComponentProps<NavContent>) {
  return (
    <nav id={ctx.anchor} className={cn("site-nav", !content.sticky && "site-nav-static")}>
      <div className="site-nav-inner">
        <a href={`#${ctx.anchor}`} className="site-nav-brand">
          {content.logo?.src ? (
            // eslint-disable-next-line @next/next/no-img-element -- church-supplied URL
            <img
              src={content.logo.src}
              alt={content.logo.alt}
              className="site-nav-logo"
            />
          ) : null}
          <div>
            <div className="site-nav-title">{content.title}</div>
            {content.subtitle ? (
              <div className="site-nav-sub">{content.subtitle}</div>
            ) : null}
          </div>
        </a>

        <div className="site-nav-links">
          {content.links.map((link) => (
            <a key={link.href + link.label} href={link.href} className="site-link">
              {link.label}
            </a>
          ))}
          <Action action={content.cta} />
        </div>
      </div>
    </nav>
  );
}

export const siteNavSection = defineSection<NavContent>({
  type: "site_nav",
  label: "Navigation",
  fields: [
    {
      key: "title",
      label: "Site name",
      type: "text",
      help: "Defaults to your church name. Set it here if the masthead should read differently.",
    },
    { key: "subtitle", label: "Sub-line", type: "text" },
    {
      key: "links",
      label: "Menu links",
      type: "list",
      addLabel: "Add link",
      titleKey: "label",
      itemFields: [
        { key: "label", label: "Label", type: "text" },
        { key: "href", label: "Link", type: "url", help: "Use #about to jump to a section." },
      ],
    },
    {
      key: "cta",
      label: "Button",
      type: "group",
      fields: [
        { key: "label", label: "Label", type: "text" },
        { key: "href", label: "Link", type: "url" },
      ],
    },
  ],
  defaults: {
    logo: null,
    title: "",
    subtitle: null,
    links: [],
    cta: null,
    sticky: true,
  },
  derive: (profile) => ({
    title: profile.name,
    subtitle: profile.denomination,
    logo: profile.logoUrl ? { src: profile.logoUrl, alt: profile.name } : null,
  }),
  Component: SiteNav,
});
