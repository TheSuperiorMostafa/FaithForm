import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getChurchAuth } from "@/lib/auth/church";
import { canAccessFeature, getFeatureAccess } from "@/lib/features/access";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import { availableWebsitePaths, canViewChurchSitePage, churchSiteBasePath, filterUnavailableSiteLinks, rewriteSiteNavigation } from "@/lib/sites/public-navigation";

import { PageRenderer } from "@/components/sites/PageRenderer";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import {
  composeWebsiteSections,
  normalizeSitePath,
  parseSiteLayoutMode,
  websiteSupportingPaths,
  websitePageDefForPath,
} from "@/lib/sites/layout-mode";
import { formatCityLine, formatServiceTime } from "@/lib/sites/format";
import { getSiteBundle, getSiteNavigationPages } from "@/lib/sites/queries";
import { canPreviewDraftSite } from "@/lib/sites/preview-access";
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
export const dynamic = "force-dynamic";

async function loadPage(slug: string, path: string) {
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
  const primaryType = websitePageDefForPath(path)?.type;
  if (primaryType && !page.sections.some(section => section.type === primaryType && section.isVisible)) return null;

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
}

async function canReadPage(loaded: NonNullable<Awaited<ReturnType<typeof loadPage>>>, previewRequested: boolean) {
  let previewAuthorized = false;
  if (previewRequested) {
    const auth = await getChurchAuth();
    previewAuthorized = canPreviewDraftSite(loaded.bundle.churchId, auth) && canAccessFeature(await getFeatureAccess(), "website");
  }
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
    robots: query.preview === "1" || !bundle.settings?.isPublished ? { index: false, follow: false } : undefined,
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
      if (!related || (related.page.status !== "published" && !isPreview)) return [];
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
  const availablePaths = loaded.layoutMode === "website"
    ? availableWebsitePaths(await getSiteNavigationPages(bundle.churchId), isPreview)
    : undefined;
  const availableAnchors = loaded.layoutMode === "landing"
    ? page.sections.flatMap(section => [section.ctx.anchor,
        ...(section.type === "visit_cta" && (section.content.form as { enabled?: boolean } | undefined)?.enabled ? [`${section.ctx.anchor}-form`] : []),
      ])
    : undefined;
  page.sections = page.sections.map((section) => ({
    ...section,
    content: {
      ...rewriteSiteNavigation(filterUnavailableSiteLinks(section.content, { slug, availablePaths, availableAnchors }), { slug, basePath, preview: isPreview }) as Record<string, unknown>,
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
