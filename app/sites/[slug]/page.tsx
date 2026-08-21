import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageRenderer } from "@/components/sites/PageRenderer";
import { isChurchFeatureEnabled } from "@/lib/features/access";
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
 * makes an unpublished site previewable before it has a domain pointed at it.
 */
export const revalidate = 300;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getSiteBundle(slug);
  if (!bundle) return { title: "Not found" };

  // Matches the page's own check, so a disabled site does not leak the church's
  // name and description through the tab title of a 404.
  if (!(await isChurchFeatureEnabled(bundle.churchId, "website"))) {
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
    // An unpublished site is still reachable at its preview URL, so it has to
    // tell crawlers to stay away rather than relying on obscurity.
    robots: bundle.settings?.isPublished ? undefined : { index: false, follow: false },
  };
}

export default async function ChurchSitePage({ params, searchParams }: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const bundle = await getSiteBundle(slug);
  if (!bundle) notFound();

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
