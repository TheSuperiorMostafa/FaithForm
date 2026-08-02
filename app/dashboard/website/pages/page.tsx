import { redirect } from "next/navigation";

import { EmptySite } from "@/components/website-admin/empty-site";
import {
  SectionList,
  type EditableSection,
} from "@/components/website-admin/section-list";
import { getChurchAuth } from "@/lib/auth/church";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { getWebsiteForChurch } from "@/lib/sites/queries";
import { resolvePage } from "@/lib/sites/resolve";

export const dynamic = "force-dynamic";

export default async function WebsitePagesPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const site = await getWebsiteForChurch(auth.churchId);
  if (!site) return <EmptySite />;

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
          // No descriptor means the section is agency-managed (custom blocks).
          fields: master.fields ?? null,
        },
      ];
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Reorder sections, hide the ones you don&apos;t need, and edit the words
        on each. Changes go live as soon as you save.
      </p>

      {sections.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          This page has no sections yet.
        </p>
      ) : (
        <SectionList sections={sections} canEdit={auth.isAdmin} />
      )}
    </div>
  );
}
