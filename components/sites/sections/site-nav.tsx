import { defineSection } from "@/lib/sites/contract";
import type { SectionComponentProps } from "@/lib/sites/contract";
import { cn } from "@/lib/utils";
import type { NavContent } from "@/types/site";

import { isCurrentSiteLink } from "@/lib/sites/active-link";
import { hasUsableSiteLink } from "@/lib/sites/public-navigation";
import { SiteNavMenu } from "./site-nav-menu";
import { ResilientImage } from "../resilient-image";

function SiteNav({ content, ctx }: SectionComponentProps<NavContent & { homeHref?: string; websitePath?: string; websiteBasePath?: string }>) {
  const links=content.links.filter(hasUsableSiteLink);
  const cta=hasUsableSiteLink(content.cta)?content.cta:null;
  // Website mode uses path links (`/about`); the masthead should take visitors
  // home rather than to a hash on the current page.
  const usesPages = links.some((link) => link.href.startsWith("/"));
  const brandHref = content.homeHref ?? (usesPages ? "/" : `#${ctx.anchor}`);

  const current = (href: string) => isCurrentSiteLink(href, content.websitePath, content.websiteBasePath) ? "page" as const : undefined;
  const ctaVariant = { solid: "site-btn-solid", outline: "site-btn-outline", quiet: "site-btn-quiet" }[cta?.variant ?? "solid"];

  return (
    <nav id={ctx.anchor} className={cn("site-nav", !content.sticky && "site-nav-static")}>
      <div className="site-nav-inner">
        <a href={brandHref} className="site-nav-brand" aria-label={content.title?.trim() || content.logo?.alt?.trim() || "Home"} aria-current={current(brandHref)}>
          {content.logo?.src ? (
            <ResilientImage
              src={content.logo.src}
              alt={content.logo.alt}
              className="site-nav-logo"
              fallback="hide"
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
          {links.map((link) => (
            <a key={link.href + link.label} href={link.href} className="site-link" aria-current={current(link.href)}>
              {link.label}
            </a>
          ))}
          {cta?.label ? (
            <a
              href={cta.href || "#"}
              className={cn("site-btn", ctaVariant)}
              aria-current={current(cta.href)}
              {...(/^https?:\/\//i.test(cta.href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {cta.label}
            </a>
          ) : null}
        </div>

        <SiteNavMenu links={links} cta={cta} websitePath={content.websitePath} websiteBasePath={content.websiteBasePath} />
      </div>
    </nav>
  );
}

export const siteNavSection = defineSection<NavContent>({
  type: "site_nav",
  label: "Menu",
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
        { key: "href", label: "Goes to", type: "url" },
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
