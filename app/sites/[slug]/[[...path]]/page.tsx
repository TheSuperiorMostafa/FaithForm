import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { headers } from "next/headers";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import { canViewChurchSitePage, churchSiteBasePath, rewriteSiteNavigation } from "@/lib/sites/public-navigation";

import { PageRenderer } from "@/components/sites/PageRenderer";
import { getChurchAuth } from "@/lib/auth/church";
import { isPublicFeatureEnabled } from "@/lib/features/public-access";
import {
  composeWebsiteSections,
  normalizeSitePath,
  parseSiteLayoutMode,
  websiteSupportingPaths,
  websitePageDefForPath,
} from "@/lib/sites/layout-mode";
import { canPreviewDraftSite, isPublicSitePublication } from "@/lib/sites/preview-access";
import { formatCityLine, formatServiceTime } from "@/lib/sites/format";
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
    return { bundle: home, sections: home.sections, layoutMode, homeStatus: home.page.status };
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
    homeStatus: home.page.status,
    sectionPageIds: Object.fromEntries(home.sections.map(section => [section.id, home.page.id])),
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

async function canReadPage(loaded: NonNullable<Awaited<ReturnType<typeof loadPage>>>, previewRequested: boolean) {
  let previewAuthorized = false;
  if (previewRequested) {
    const auth = await getChurchAuth();
    previewAuthorized = canPreviewDraftSite(loaded.bundle.churchId, auth);
  }
  if (!(await siteIsVisible(loaded.bundle, previewRequested))) return false;
  return canViewChurchSitePage({
    previewRequested, previewAuthorized,
    published: loaded.bundle.settings?.isPublished === true,
    homeStatus: loaded.homeStatus, pageStatus: loaded.bundle.page.status,
  });
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug, path: pathSegments } = await params;
  const path = normalizeSitePath(pathSegments);
  const loaded = await loadPage(slug, path);
  if (!loaded) return { title: "Not found" };

  const { bundle } = loaded;
  const query = await searchParams;
  if (!(await canReadPage(loaded, query.preview === "1"))) return { title: "Not found", robots: { index: false, follow: false } };

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
  if (!(await canReadPage(loaded, isPreview))) notFound();

  const page = resolvePage({
    page: bundle.page,
    theme: bundle.theme,
    settings: bundle.settings,
    sections,
    overrides: bundle.overrides,
    profile: bundle.profile,
    registry: SECTION_REGISTRY,
    sectionPageIds: "sectionPageIds" in loaded ? loaded.sectionPageIds : undefined,
  });

  if (loaded.layoutMode === "website") {
    // Resolve each page in its own override context so churches' hand edits
    // survive when that content also supports another page.
    const supporting = await Promise.all(websiteSupportingPaths(path).map(async (relatedPath) => {
      const related = await getSiteBundle(slug, relatedPath);
      if (!related || !(await siteIsVisible(related, isPreview))) return [];
      return resolvePage({
        page: related.page,
        theme: related.theme,
        settings: related.settings,
        sections: related.sections,
        overrides: related.overrides,
        profile: related.profile,
        registry: SECTION_REGISTRY,
      }).sections.filter((section) => section.type === websitePageDefForPath(relatedPath)?.type);
    }));
    const present = new Set(page.sections.map((section) => section.type));
    const extra = supporting.flat().filter((section) => !present.has(section.type));
    const footerIndex = page.sections.findIndex((section) => section.type === "contact_band" || section.type === "footer_map");
    page.sections.splice(footerIndex < 0 ? page.sections.length : footerIndex, 0, ...extra);
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? new URL(getCanonicalSiteUrl()).host;
  const basePath = churchSiteBasePath(slug, host, [
    new URL(getCanonicalSiteUrl()).hostname,
    "faithform.io", "www.faithform.io",
    process.env.NEXT_PUBLIC_SITE_ROOT_HOST ?? "",
    process.env.VERCEL_URL ?? "", process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "",
  ]);
  page.sections = page.sections.map((section) => ({
    ...section,
    content: {
      ...rewriteSiteNavigation(section.content, { slug, basePath, preview: isPreview }) as Record<string, unknown>,
      ...(section.type === "site_nav" ? { homeHref: `${basePath || "/"}${isPreview ? "?preview=1" : ""}` } : {}),
    },
  }));

  return <PageRenderer page={page} website={loaded.layoutMode === "website" ? {
    path,
    basePath,
    churchName: bundle.profile.name,
    coverImageUrl: bundle.profile.coverImageUrl,
    location: [bundle.profile.address, formatCityLine(bundle.profile.city, bundle.profile.state, bundle.profile.zip)].filter(Boolean).join(", "),
    serviceTimes: bundle.profile.serviceTimes.flatMap((time) => {
      const clock = formatServiceTime(time.startTime);
      return clock ? [`${time.label} · ${clock}`] : [];
    }),
    previewSlug: isPreview ? slug : undefined,
  } : undefined} />;
}
