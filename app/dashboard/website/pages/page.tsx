import { redirect } from "next/navigation";

import { EmptySite } from "@/components/website-admin/empty-site";
import { PagesWorkspace } from "@/components/website-admin/pages-workspace";
import type { EditableSection } from "@/components/website-admin/section-list";
import { getChurchAuth } from "@/lib/auth/church";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import {
  normalizeSitePath,
  parseSiteLayoutMode,
  websitePageDefForPath,
} from "@/lib/sites/layout-mode";
import { isPublicSitePublication } from "@/lib/sites/preview-access";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { getWebsiteForChurch } from "@/lib/sites/queries";
import { resolvePage } from "@/lib/sites/resolve";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

function pageTabLabel(path: string, title: string | null): string {
  if (path === "/") return "Home";
  const def = websitePageDefForPath(path);
  if (def) return def.navLabel;
  return title?.trim() || path.replace(/^\//, "") || "Page";
}

/**
 * Website → Pages. `?edit=banner` opens the banner section's editor straight
 * away (the Overview's "Change banner photo" button); `?edit=<section id>`
 * opens any other. `?path=/about` selects that page in website mode.
 */
export default async function WebsitePagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await pageFeatureBlocked("website")) return null;

  const params = await searchParams;
  const edit = Array.isArray(params.edit) ? params.edit[0] : params.edit;
  const pathParam = Array.isArray(params.path) ? params.path[0] : params.path;

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const homeSite = await getWebsiteForChurch(auth.churchId, "/");
  if (!homeSite) return <EmptySite />;

  const layoutMode = parseSiteLayoutMode(homeSite.settings?.layoutMode);
  const requestedPath = normalizeSitePath(pathParam ?? "/");
  const currentPath =
    layoutMode === "website" &&
    homeSite.pages.some((p) => p.path === requestedPath)
      ? requestedPath
      : "/";

  const site =
    currentPath === "/"
      ? homeSite
      : (await getWebsiteForChurch(auth.churchId, currentPath)) ?? homeSite;

  // Resolve with hidden sections included, so a church can find and re-enable
  // something it turned off. The public renderer filters them; this must not.
  const resolved = resolvePage({
    page: site.page,
    theme: site.theme,
    settings: site.settings,
    sections: site.sections.map((s) => ({ ...s, isVisible: true })),
    overrides: site.overrides,
    profile: site.profile,
    registry: SECTION_REGISTRY,
  });

  const contentById = new Map(
    resolved.sections.map((section) => [section.ctx.id, section.content]),
  );
  const overriddenIds = new Set(
    site.overrides
      .filter((o) => o.scope === "section" && o.sectionId)
      .map((o) => o.sectionId as string),
  );

  const sections: EditableSection[] = site.sections
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((row) => {
      const master = SECTION_REGISTRY[row.type];
      const content = contentById.get(row.id);
      if (!master || !content) return [];

      return [
        {
          id: row.id,
          type: row.type,
          label: master.label ?? row.type,
          isVisible: row.isVisible,
          hasOverride: overriddenIds.has(row.id),
          content,
          // No descriptor means FaithForm manages the section (text blocks).
          fields: master.fields ?? null,
        },
      ];
    });

  // Link picker targets: hashes on a landing page, real paths in website mode.
  // Built from every known page/section so a menu on Home can still point at
  // About even though that section no longer lives on Home.
  const linkTargets =
    layoutMode === "website"
      ? homeSite.pages.flatMap((page) => {
          if (page.path === "/") {
            return [{ value: "/", label: "Home" }];
          }
          return [
            {
              value: page.path,
              label: pageTabLabel(page.path, page.title),
            },
          ];
        })
      : resolved.sections.flatMap((section) => {
          const row = site.sections.find((s) => s.id === section.ctx.id);
          const master = row ? SECTION_REGISTRY[row.type] : undefined;
          if (!row || !master || row.type === "site_nav") return [];
          const title =
            sections.find((s) => s.id === row.id)?.label ?? master.label ?? row.type;
          const hidden = row.isVisible ? "" : " (hidden)";
          return [{ value: `#${section.ctx.anchor}`, label: `${title}${hidden}` }];
        });

  const openId =
    edit === "banner"
      ? (sections.find((s) => s.type === "hero")?.id ?? null)
      : (sections.find((s) => s.id === edit)?.id ?? null);

  const previewPath = currentPath === "/" ? "" : currentPath;
  const previewUrl = `${getCanonicalSiteUrl()}/sites/${site.slug}${previewPath}?preview=1`;

  const pageTabs =
    layoutMode === "website"
      ? homeSite.pages.map((page) => ({
          path: page.path,
          label: pageTabLabel(page.path, page.title),
        }))
      : [];

  return (
    <PagesWorkspace
      sections={sections}
      canEdit={auth.isAdmin}
      isLive={isPublicSitePublication(site.page.status, site.settings?.isPublished)}
      initialOpenId={openId}
      linkTargets={linkTargets}
      previewUrl={previewUrl}
      pages={pageTabs}
      currentPath={currentPath}
    />
  );
}
