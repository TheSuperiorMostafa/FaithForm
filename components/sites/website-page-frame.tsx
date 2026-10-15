import { sitePathForHref } from "@/lib/sites/active-link";
import React from "react";
import type { ResolvedPage } from "@/lib/sites/contract";
import { websitePageDefForPath, websitePageDefForType } from "@/lib/sites/layout-mode";
import type { SiteLink } from "@/types/site";

const PAGE_COPY: Record<string, { title: string; description: string }> = {
  "/about": { title: "Get to know us", description: "Discover our story and the community you'll find here." },
  "/vision": { title: "Vision", description: "Our mission, our hopes, and the faith we share." },
  "/staff": { title: "Our staff", description: "Get to know the people who lead and care for our church." },
  "/programs": { title: "Programs", description: "Explore ways to connect, grow, and serve together." },
  "/visit": { title: "Plan your visit", description: "Find a service time and everything you need to plan your first visit." },
  "/sermons": { title: "Sermons", description: "Listen, reflect, and keep growing wherever you are." },
  "/give": { title: "Give", description: "Take part in the work and life of our church." },
  "/events": { title: "Events", description: "See what's coming up and find your next opportunity to connect." },
};

export type WebsitePageFrame = {
  path: string;
  churchName: string;
  coverImageUrl: string | null;
  previewSlug?: string;
  /** App-host church path; empty for a custom church domain. */
  basePath?: string;
  location?: string;
  serviceTimes?: string[];
};

export function WebsitePageIntro({ website, page }: { website: WebsitePageFrame; page: ResolvedPage }) {
  const copy = PAGE_COPY[website.path];
  if (!copy) return null;
  const basePath = website.basePath ?? (website.previewSlug ? `/sites/${encodeURIComponent(website.previewSlug)}` : "");
  const homeHref = `${basePath || "/"}${website.previewSlug ? "?preview=1" : ""}`;
  const seen = new Set<string>();
  const contents = page.sections.flatMap((section) => {
    const def = websitePageDefForType(section.type);
    if (!def || !section.ctx.anchor || seen.has(section.ctx.anchor)) return [];
    seen.add(section.ctx.anchor);
    return [{ label: def.title, href: `#${section.ctx.anchor}` }];
  });
  return (
    <header className="site-section site-surface-canvas site-page-intro" data-page={website.path}>
      <div>
        <a className="site-link site-page-breadcrumb" href={homeHref}>Home</a>
        <div className="site-eyebrow">{website.churchName} · {websitePageDefForPath(website.path)?.title}</div>
        <h1 className="site-display site-display-lg">{copy.title}</h1>
        <p className="site-page-intro-copy">{copy.description}</p>
        {contents.length >= 3 ? (
          <nav className="site-page-contents" aria-label="On this page">
            <span className="site-page-contents-label">On this page</span>
            {contents.map((item) => <a key={item.href} href={item.href} className="site-page-contents-link">{item.label} <span aria-hidden>↓</span></a>)}
          </nav>
        ) : null}
      </div>
      {website.path === "/visit" && website.location ? (
        <aside className="site-page-visit-details" aria-label="At a glance">
          <div className="site-eyebrow">Find us</div>
          <h2 className="site-display site-display-md">Our location</h2>
          {website.location ? <p>{website.location}</p> : null}
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(website.location)}`} className="site-btn site-btn-solid" target="_blank" rel="noopener noreferrer">Get directions <span aria-hidden>↗</span></a>
        </aside>
      ) : website.path === "/about" && website.coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- church-supplied photo
        <img src={website.coverImageUrl} alt="" className="site-page-intro-photo" />
      ) : null}
    </header>
  );
}

export function WebsitePageExplore({ page, website }: { page: ResolvedPage; website: WebsitePageFrame }) {
  // Navigation and the footer already provide the full menu. Keep these
  // orientation cards on Home so task pages lead straight to their purpose.
  if (website.path !== "/") return null;
  const nav = page.sections.find((section) => section.type === "site_nav")?.content;
  const links = [...(Array.isArray(nav?.links) ? nav.links as SiteLink[] : [])];
  const cta = nav?.cta as SiteLink | null | undefined;
  if (cta) links.push(cta);
  const prefix = website.basePath ?? (website.previewSlug ? `/sites/${encodeURIComponent(website.previewSlug)}` : "");
  const seen = new Set<string>();
  const preferredPaths = ["/visit", "/programs", "/sermons", "/about", "/events"];
  const cards = links.flatMap((link) => {
    const path = sitePathForHref(link.href, prefix);
    if (!path || path === website.path || !PAGE_COPY[path] || seen.has(path)) return [];
    seen.add(path);
    return [{ ...link, path, description: PAGE_COPY[path].description }];
  }).filter((card) => preferredPaths.includes(card.path))
    .sort((a, b) => preferredPaths.indexOf(a.path) - preferredPaths.indexOf(b.path))
    .slice(0, 3);
  if (!cards.length) return null;
  return (
    <section className="site-section site-surface-canvas-alt site-page-explore" aria-label="Explore our church">
      <div className="site-eyebrow">Keep exploring</div>
      <h2 className="site-display site-display-md">A place to begin</h2>
      <div className="site-page-cards">
        {cards.map((card) => (
          <a key={card.href} href={card.href} className="site-page-card">
            <h3>{card.label}</h3>
            <p>{card.description}</p>
            <span>Explore {card.label.toLowerCase()} <span aria-hidden>→</span></span>
          </a>
        ))}
      </div>
    </section>
  );
}
