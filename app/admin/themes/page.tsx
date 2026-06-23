import { PageHeader } from "@/components/admin/page-header";
import { ThemesTable } from "@/components/admin/themes-table";
import {
  getAdminSlideThemes,
  getThemeTaxonomy,
} from "@/lib/queries/admin-themes";
import { buildThemeTaxonomy } from "@/lib/sermon-builder/theme-taxonomy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminThemesPage() {
  const themes = await getAdminSlideThemes();
  const taxonomy = themes.length > 0 ? buildThemeTaxonomy(themes) : await getThemeTaxonomy();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Slide themes"
        description="Rename themes and organize taxonomy for the Simple Sermon Builder library."
      />

      <p className="text-sm text-muted-foreground">
        {themes.length} active themes. Changes appear in the sermon builder search
        and filters after save.
      </p>

      <ThemesTable themes={themes} taxonomy={taxonomy} />
    </div>
  );
}
