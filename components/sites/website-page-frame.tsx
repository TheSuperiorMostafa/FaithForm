import type { ResolvedPage } from "@/lib/sites/contract";
import { websitePageDefForPath } from "@/lib/sites/layout-mode";
import type { SiteLink } from "@/types/site";

const PAGE_COPY: Record<string, { title: string; description: string }> = {
  "/about": { title: "Get to know us", description: "Discover our story and the community you'll find here." },
  "/vision": { title: "What guides us", description: "Our mission, our hopes, and the faith we share." },
  "/staff": { title: "Meet our people", description: "Get to know the people who lead and care for our church." },
  "/programs": { title: "Find your place", description: "Explore ways to connect, grow, and serve together." },
  "/visit": { title: "You're welcome here", description: "Find a service time and everything you need to plan your first visit." },
  "/sermons": { title: "A message for your week", description: "Listen, reflect, and keep growing wherever you are." },
  "/give": { title: "Generosity with purpose", description: "Take part in the work and life of our church." },
  "/events": { title: "Life together", description: "See what's coming up and find your next opportunity to connect." },
};

export type WebsitePageFrame = {
  path: string;
  churchName: string;
  coverImageUrl: string | null;
  previewSlug?: string;
};

export function WebsitePageIntro({ website }: { website: WebsitePageFrame }) {
  const copy = PAGE_COPY[website.path];
  if (!copy) return null;
  const homeHref = website.previewSlug ? `/sites/${encodeURIComponent(website.previewSlug)}?preview=1` : "/";
  return (
    <header className="site-section site-surface-canvas site-page-intro">
      <div>
        <a className="site-link site-page-breadcrumb" href={homeHref}>Home</a>
        <div className="site-eyebrow">{website.churchName} · {websitePageDefForPath(website.path)?.title}</div>
        <h1 className="site-display site-display-lg">{copy.title}</h1>
        <p className="site-page-intro-copy">{copy.description}</p>
      </div>
      {website.coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- church-supplied photo
        <img src={website.coverImageUrl} alt="" className="site-page-intro-photo" />
      ) : null}
    </header>
  );
}

export function WebsitePageExplore({ page, website }: { page: ResolvedPage; website: WebsitePageFrame }) {
  const nav = page.sections.find((section) => section.type === "site_nav")?.content;
  const links = [...(Array.isArray(nav?.links) ? nav.links as SiteLink[] : [])];
  const cta = nav?.cta as SiteLink | null | undefined;
  if (cta) links.push(cta);
  const prefix = website.previewSlug ? `/sites/${encodeURIComponent(website.previewSlug)}` : "";
  const seen = new Set<string>();
  const cards = links.flatMap((link) => {
    const hrefPath = link.href.split(/[?#]/)[0];
    const path = prefix && hrefPath.startsWith(`${prefix}/`) ? hrefPath.slice(prefix.length) : hrefPath;
    if (path === website.path || !PAGE_COPY[path] || seen.has(path)) return [];
    seen.add(path);
    return [{ ...link, description: PAGE_COPY[path].description }];
  });
  if (!cards.length) return null;
  return (
    <section className="site-section site-surface-canvas-alt site-page-explore" aria-label="Explore our church">
      <div className="site-eyebrow">Keep exploring</div>
      <h2 className="site-display site-display-md">{website.path === "/" ? "A place to begin" : "Your next step"}</h2>
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
