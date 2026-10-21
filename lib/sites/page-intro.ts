import type { SectionField } from "@/lib/sites/contract";
import type { SiteImage } from "@/types/site";

export const WEBSITE_PAGE_COPY: Record<string, { title: string; description: string }> = {
  "/about": { title: "Get to know us", description: "Discover our story and the community you'll find here." },
  "/vision": { title: "Vision", description: "Our mission, our hopes, and the faith we share." },
  "/staff": { title: "Our staff", description: "Get to know the people who lead and care for our church." },
  "/programs": { title: "Programs", description: "Explore ways to connect, grow, and serve together." },
  "/visit": { title: "Plan your visit", description: "Find a service time and everything you need to plan your first visit." },
  "/sermons": { title: "Sermons", description: "Listen, reflect, and keep growing wherever you are." },
  "/give": { title: "Give", description: "Take part in the work and life of our church." },
  "/events": { title: "Events", description: "See what's coming up and find your next opportunity to connect." },
};

export type WebsitePageIntroContent = { title: string; description: string; image?: SiteImage };

export function websitePageIntroDefaults(path: string, coverImageUrl: string | null): WebsitePageIntroContent | null {
  const copy = WEBSITE_PAGE_COPY[path];
  return copy ? {
    ...copy,
    ...(path === "/about" ? { image: { src: coverImageUrl, alt: "" } } : {}),
  } : null;
}

export function websitePageIntroField(path: string): SectionField {
  return {
    key: "pageIntro", label: "Top of this page", type: "group",
    help: "The heading and introduction above this page's content.",
    fields: [
      { key: "title", label: "Page heading", type: "text" },
      { key: "description", label: "Page introduction", type: "textarea" },
      ...(path === "/about" ? [{ key: "image", label: "Page cover photo", type: "image" as const, aspect: "feature" as const }] : []),
    ],
  };
}
