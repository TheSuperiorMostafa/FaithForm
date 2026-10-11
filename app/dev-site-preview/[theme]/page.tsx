import { notFound } from "next/navigation";

import { PageRenderer } from "@/components/sites/PageRenderer";
import { DEV_PREVIEW_PROFILE } from "@/lib/sites/dev-preview-profile";
import { buildSections } from "@/lib/sites/generate";
import { composeWebsiteSections, normalizeSitePath, websitePageDefForType, websiteSupportingPaths } from "@/lib/sites/layout-mode";
import { formatCityLine, formatServiceTime } from "@/lib/sites/format";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { resolvePage } from "@/lib/sites/resolve";
import { CODE_SITE_THEMES } from "@/lib/sites/themes";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ theme: string }>;
  searchParams: Promise<{ path?: string; mode?: string }>;
};

/**
 * Development only: a church site in any format, built from code, with no
 * database. `/dev-site-preview/wood` draws the sample church in Wood exactly the
 * way `/sites/<slug>` would, so a format can be designed before its migration
 * has been applied anywhere. Production returns 404.
 */
export default async function DevSitePreviewPage({ params, searchParams }: PageProps) {
  if (process.env.NODE_ENV === "production") notFound();

  const { theme: key } = await params;
  const theme = CODE_SITE_THEMES[key];
  if (!theme) notFound();

  const query = await searchParams;
  const website = query.mode === "website";
  const path = normalizeSitePath(query.path);
  const generated = buildSections(DEV_PREVIEW_PROFILE, null, website ? "website" : "landing");
  const allSections = generated.sections.map((section, index) => ({
    id: `dev-preview-${index}`, type: section.type, sortOrder: (index + 1) * 10,
    isVisible: section.isVisible, props: section.props,
  }));
  const sectionPaths = new Set([path, ...websiteSupportingPaths(path)]);
  const sections = website ? composeWebsiteSections({
    path,
    homeSections: allSections,
    pageSections: allSections.filter((section) => {
      const def = websitePageDefForType(section.type);
      return def ? sectionPaths.has(def.path) : path === "/";
    }),
  }) : allSections;
  const page = resolvePage({
    page: {
      id: "dev-preview-page",
      path,
      title: generated.title,
      metaDescription: generated.metaDescription,
      status: "published",
    },
    theme,
    settings: null,
    sections,
    overrides: [],
    profile: DEV_PREVIEW_PROFILE,
    registry: SECTION_REGISTRY,
  });

  return <PageRenderer page={page} website={website ? {
    path, churchName: DEV_PREVIEW_PROFILE.name, coverImageUrl: DEV_PREVIEW_PROFILE.coverImageUrl,
    location: [DEV_PREVIEW_PROFILE.address, formatCityLine(DEV_PREVIEW_PROFILE.city, DEV_PREVIEW_PROFILE.state, DEV_PREVIEW_PROFILE.zip)].filter(Boolean).join(", "),
    serviceTimes: DEV_PREVIEW_PROFILE.serviceTimes.flatMap((time) => {
      const clock = formatServiceTime(time.startTime);
      return clock ? [`${time.label} · ${clock}`] : [];
    }),
  } : undefined} />;
}
