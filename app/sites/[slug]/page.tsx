import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PageRenderer } from "@/components/sites/PageRenderer";
import { getChurchAuth } from "@/lib/auth/church";
import { isPublicFeatureEnabled } from "@/lib/features/public-access";
import { canPreviewDraftSite, isPublicSitePublication } from "@/lib/sites/preview-access";
import { getSiteBundle } from "@/lib/sites/queries";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { resolvePage } from "@/lib/sites/resolve";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
};

/**
 * The church website.
 *
 * Reachable two ways: rewritten here by middleware from the church's own
 * hostname, and directly at /sites/<slug> on the app domain. The second is what
 * gives church staff a preview before it has a domain pointed at it.
 */
// Draft authorization and unpublishing must be checked on every request.
// A shared five-minute page cache could serve one staff preview to the public
// or keep a taken-down site visible after its church withdraws it.
export const dynamic = "force-dynamic";

// Metadata and the page render in one request. Share the bundle and its access
// decision so a public hit does not double every database read.
const readSite = cache(getSiteBundle);

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
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const bundle = await readSite(slug);
  if (!bundle) return { title: "Not found" };

  // Match the page guard so draft content cannot leak through titles, previews,
  // or Open Graph metadata when a visitor adds ?preview=1.
  if (!(await siteIsVisible(bundle, query.preview === "1"))) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const title = bundle.page.title?.trim() || bundle.profile.name;
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
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const bundle = await readSite(slug);
  if (!bundle) notFound();

  if (!(await siteIsVisible(bundle, query.preview === "1"))) notFound();

  const page = resolvePage({
    page: bundle.page,
    theme: bundle.theme,
    settings: bundle.settings,
    sections: bundle.sections,
    overrides: bundle.overrides,
    profile: bundle.profile,
    registry: SECTION_REGISTRY,
  });

  return <PageRenderer page={page} />;
}
