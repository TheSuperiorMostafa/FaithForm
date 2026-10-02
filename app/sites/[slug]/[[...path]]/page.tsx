import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageRenderer } from "@/components/sites/PageRenderer";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import {
  composeWebsiteSections,
  normalizeSitePath,
  parseSiteLayoutMode,
} from "@/lib/sites/layout-mode";
import { getSiteBundle } from "@/lib/sites/queries";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { resolvePage } from "@/lib/sites/resolve";

type PageProps = {
  params: Promise<{ slug: string; path?: string[] }>;
  searchParams: Promise<{ preview?: string }>;
};

/**
 * The church website.
 *
 * Reachable two ways: rewritten here by middleware from the church's own
 * hostname, and directly at /sites/<slug>/… on the app domain. The second is
 * what makes an unpublished site previewable before it has a domain pointed
 * at it.
 *
 * Landing mode only serves `/` (hash tabs on one scroll). Website mode also
 * serves `/about`, `/visit`, and the other section pages; each subpage pulls
 * nav/footer chrome from the home page at render time.
 */
export const revalidate = 300;

async function loadPage(slug: string, path: string) {
  const home = await getSiteBundle(slug, "/");
  if (!home) return null;

  const layoutMode = parseSiteLayoutMode(home.settings?.layoutMode);

  // Landing sites are one page. A path like /about is not part of that model.
  if (layoutMode === "landing" && path !== "/") {
    return null;
  }

  if (path === "/") {
    return { bundle: home, sections: home.sections, layoutMode };
  }

  const page = await getSiteBundle(slug, path);
  if (!page) return null;

  return {
    bundle: page,
    sections: composeWebsiteSections({
      path,
      homeSections: home.sections,
      pageSections: page.sections,
    }),
    layoutMode,
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, path: pathSegments } = await params;
  const path = normalizeSitePath(pathSegments);
  const loaded = await loadPage(slug, path);
  if (!loaded) return { title: "Not found" };

  const { bundle } = loaded;

  // Matches the page's own check, so a disabled site does not leak the church's
  // name and description through the tab title of a 404.
  if (!(await isChurchFeatureEnabled(bundle.churchId, "website"))) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const title =
    path === "/"
      ? bundle.page.title?.trim() || bundle.profile.name
      : [bundle.page.title?.trim(), bundle.profile.name].filter(Boolean).join(" · ") ||
        bundle.profile.name;
  const description =
    bundle.page.metaDescription?.trim() ||
    bundle.profile.tagline ||
    bundle.profile.description ||
    undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: bundle.profile.coverImageUrl
        ? [bundle.profile.coverImageUrl]
        : undefined,
    },
    // An unpublished site is still reachable at its preview URL, so it has to
    // tell crawlers to stay away rather than relying on obscurity.
    robots: bundle.settings?.isPublished ? undefined : { index: false, follow: false },
  };
}

export default async function ChurchSitePage({ params, searchParams }: PageProps) {
  const [{ slug, path: pathSegments }, query] = await Promise.all([params, searchParams]);
  const path = normalizeSitePath(pathSegments);
  const loaded = await loadPage(slug, path);
  if (!loaded) notFound();

  const { bundle, sections } = loaded;

  // Turning Website off in the control center takes the public site down, not
  // just the church's editor. A feature that is "disabled" while still serving
  // visitors on a custom domain is not disabled, and the control center says
  // it is — so this is where that promise is kept. Preview does not bypass it:
  // an off feature is off for everyone.
  if (!(await isChurchFeatureEnabled(bundle.churchId, "website"))) {
    notFound();
  }

  const isPreview = query.preview === "1";
  if (bundle.page.status !== "published" && !isPreview) {
    notFound();
  }

  // Subpages reuse home's published gate via setPublished (all pages move
  // together), but also refuse a draft subpage when home is live and someone
  // hits a stale path.
  if (path !== "/" && bundle.page.status !== "published" && !isPreview) {
    notFound();
  }

  const page = resolvePage({
    page: bundle.page,
    theme: bundle.theme,
    settings: bundle.settings,
    sections,
    overrides: bundle.overrides,
    profile: bundle.profile,
    registry: SECTION_REGISTRY,
  });

  return <PageRenderer page={page} />;
}
