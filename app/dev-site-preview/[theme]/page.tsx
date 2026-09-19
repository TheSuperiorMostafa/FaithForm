import { notFound } from "next/navigation";

import { PageRenderer } from "@/components/sites/PageRenderer";
import { DEV_PREVIEW_PROFILE } from "@/lib/sites/dev-preview-profile";
import { buildSections } from "@/lib/sites/generate";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { resolvePage } from "@/lib/sites/resolve";
import { CODE_SITE_THEMES } from "@/lib/sites/themes";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ theme: string }>;
};

/**
 * Development only: a church site in any format, built from code, with no
 * database. `/dev-site-preview/wood` draws the sample church in Wood exactly the
 * way `/sites/<slug>` would, so a format can be designed before its migration
 * has been applied anywhere. Production returns 404.
 */
export default async function DevSitePreviewPage({ params }: PageProps) {
  if (process.env.NODE_ENV === "production") notFound();

  const { theme: key } = await params;
  const theme = CODE_SITE_THEMES[key];
  if (!theme) notFound();

  const generated = buildSections(DEV_PREVIEW_PROFILE, null);
  const page = resolvePage({
    page: {
      id: "dev-preview-page",
      path: "/",
      title: generated.title,
      metaDescription: generated.metaDescription,
      status: "published",
    },
    theme,
    settings: null,
    sections: generated.sections.map((section, index) => ({
      id: `dev-preview-${index}`,
      type: section.type,
      sortOrder: (index + 1) * 10,
      isVisible: section.isVisible,
      props: section.props,
    })),
    overrides: [],
    profile: DEV_PREVIEW_PROFILE,
    registry: SECTION_REGISTRY,
  });

  return <PageRenderer page={page} />;
}
