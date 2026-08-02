import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageRenderer } from "@/components/sites/PageRenderer";
import { getSiteBundle } from "@/lib/sites/queries";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { resolvePage } from "@/lib/sites/resolve";

type PageProps = {
  params: { slug: string };
  searchParams?: { preview?: string };
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
  const bundle = await getSiteBundle(params.slug);
  if (!bundle) return { title: "Not found" };

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
  const bundle = await getSiteBundle(params.slug);
  if (!bundle) notFound();

  const isPreview = searchParams?.preview === "1";
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
