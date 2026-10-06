import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PageRenderer } from "@/components/sites/PageRenderer";
import { getChurchAuth } from "@/lib/auth/church";
import { isPublicFeatureEnabled } from "@/lib/features/public-access";
import {
  composeWebsiteSections,
  normalizeSitePath,
  parseSiteLayoutMode,
  rewritePreviewLinks,
} from "@/lib/sites/layout-mode";
import { canPreviewDraftSite, isPublicSitePublication } from "@/lib/sites/preview-access";
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
 * what gives church staff a preview before it has a domain pointed at it.
 *
 * Landing mode only serves `/` (hash tabs on one scroll). Website mode also
 * serves `/about`, `/visit`, and the other section pages; each subpage pulls
 * nav/footer chrome from the home page at render time.
 */
// Draft authorization and unpublishing must be checked on every request.
// A shared five-minute page cache could serve one staff preview to the public
// or keep a taken-down site visible after its church withdraws it.
export const dynamic = "force-dynamic";

const loadPage = cache(async function loadPage(slug: string, path: string) {
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
});

const siteIsVisible = cache(async function siteIsVisible(
  bundle: NonNullable<Awaited<ReturnType<typeof getSiteBundle>>>,
  previewRequested: boolean,
): Promise<boolean> {
  if (!(await isPublicFeatureEnabled(bundle.churchId, "website"))) return false;
  if (isPublicSitePublication(bundle.page.status, bundle.settings?.isPublished)) return true;
  if (!previewRequested) return false;
  return canPreviewDraftSite(bundle.churchId, await getChurchAuth());
});

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ slug, path: pathSegments }, query] = await Promise.all([params, searchParams]);
  const path = normalizeSitePath(pathSegments);
  const loaded = await loadPage(slug, path);
  if (!loaded) return { title: "Not found" };

  const { bundle } = loaded;

  // Match the page guard so draft content cannot leak through titles, previews,
  // or Open Graph metadata when a visitor adds ?preview=1.
  if (!(await siteIsVisible(bundle, query.preview === "1"))) {
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
    robots:
      query.preview === "1" ||
      !isPublicSitePublication(bundle.page.status, bundle.settings?.isPublished)
        ? { index: false, follow: false }
        : undefined,
  };
}

export default async function ChurchSitePage({ params, searchParams }: PageProps) {
  const [{ slug, path: pathSegments }, query] = await Promise.all([params, searchParams]);
  const path = normalizeSitePath(pathSegments);
  const loaded = await loadPage(slug, path);
  if (!loaded) notFound();

  const { bundle, sections } = loaded;
  const isPreview = query.preview === "1";

  if (!(await siteIsVisible(bundle, query.preview === "1"))) notFound();

  const page = resolvePage({
    page: bundle.page,
    theme: bundle.theme,
    settings: bundle.settings,
    sections,
    overrides: bundle.overrides,
    profile: bundle.profile,
    registry: SECTION_REGISTRY,
  });

  if (isPreview) {
    page.sections = page.sections.map((section) => ({
      ...section,
      content: {
        ...rewritePreviewLinks(section.content, slug) as Record<string, unknown>,
        ...(section.type === "site_nav" ? { homeHref: `/sites/${encodeURIComponent(slug)}?preview=1` } : {}),
      },
    }));
  }

  return <PageRenderer page={page} website={loaded.layoutMode === "website" ? {
    path,
    churchName: bundle.profile.name,
    coverImageUrl: bundle.profile.coverImageUrl,
    previewSlug: isPreview ? slug : undefined,
  } : undefined} />;
}
