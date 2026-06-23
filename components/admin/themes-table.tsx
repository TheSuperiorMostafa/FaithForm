"use client";

import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { ThemeEditDialog } from "@/components/admin/theme-edit-dialog";
import { getCategoryLabel } from "@/lib/sermon-builder/themes";
import type { AdminSlideThemeRow } from "@/lib/queries/admin-themes";
import type { ThemeTaxonomy } from "@/lib/sermon-builder/theme-taxonomy";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ThemesTableProps = {
  themes: AdminSlideThemeRow[];
  taxonomy: ThemeTaxonomy;
};

function ThemeThumbnail({ theme }: { theme: AdminSlideThemeRow }) {
  const style =
    theme.backgroundType === "image" && theme.imageUrl
      ? {
          backgroundImage: `url(${theme.imageUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }
      : { background: theme.bgCss };

  return (
    <div
      className={cn(
        "size-14 shrink-0 overflow-hidden rounded-lg border border-border",
        theme.backgroundType === "image" && "bg-muted",
      )}
      style={style}
      aria-hidden
    />
  );
}

function TagChips({ tags, limit = 4 }: { tags: string[]; limit?: number }) {
  const visible = tags.slice(0, limit);
  const remaining = tags.length - visible.length;

  if (tags.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground"
        >
          {tag}
        </span>
      ))}
      {remaining > 0 && (
        <span className="text-[11px] text-muted-foreground">+{remaining}</span>
      )}
    </div>
  );
}

export function ThemesTable({ themes, taxonomy }: ThemesTableProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [editingTheme, setEditingTheme] = useState<AdminSlideThemeRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return themes.filter((theme) => {
      if (category !== "all" && theme.category !== category) return false;
      if (!normalized) return true;

      const haystack = [
        theme.id,
        theme.name,
        theme.category,
        ...theme.tags,
        ...theme.seasonalTags,
        ...theme.symbolTags,
        ...theme.visualStyle,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalized);
    });
  }, [category, query, themes]);

  function openEditor(theme: AdminSlideThemeRow) {
    setEditingTheme(theme);
    setDialogOpen(true);
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[1fr_200px]">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, id, or tag…"
          />
          <Select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {taxonomy.categories.map((item) => (
              <option key={item} value={item}>
                {getCategoryLabel(item)} ({themes.filter((t) => t.category === item).length})
              </option>
            ))}
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-primary font-heading text-[13px] uppercase tracking-wide text-primary-foreground dark:bg-secondary dark:text-secondary-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Preview</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Tags</th>
                <th className="px-4 py-3 text-left">Seasonal</th>
                <th className="px-4 py-3 text-left">Style</th>
                <th className="px-4 py-3 text-left">Edit</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((theme) => (
                <tr key={theme.id} className="even:bg-background/60 hover:bg-accent/10">
                  <td className="px-4 py-3">
                    <ThemeThumbnail theme={theme} />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{theme.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{theme.id}</p>
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">
                    {getCategoryLabel(theme.category)}
                  </td>
                  <td className="px-4 py-3">
                    <TagChips tags={theme.tags} />
                  </td>
                  <td className="px-4 py-3">
                    <TagChips tags={theme.seasonalTags} limit={2} />
                  </td>
                  <td className="px-4 py-3">
                    <TagChips tags={theme.visualStyle} limit={2} />
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEditor(theme)}
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No themes match the current search.
          </div>
        )}
      </Card>

      <ThemeEditDialog
        theme={editingTheme}
        taxonomy={taxonomy}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
