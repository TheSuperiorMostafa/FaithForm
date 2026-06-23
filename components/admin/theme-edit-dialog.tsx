"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateSlideTheme } from "@/app/admin/theme-actions";
import { TagEditor } from "@/components/admin/tag-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminSlideThemeRow } from "@/lib/queries/admin-themes";
import type { ThemeTaxonomy } from "@/lib/sermon-builder/theme-taxonomy";
import { normalizeCategory } from "@/lib/sermon-builder/theme-taxonomy";
import { getCategoryLabel } from "@/lib/sermon-builder/themes";

type ThemeEditDialogProps = {
  theme: AdminSlideThemeRow | null;
  taxonomy: ThemeTaxonomy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ThemeEditDialog({
  theme,
  taxonomy,
  open,
  onOpenChange,
}: ThemeEditDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [seasonalTags, setSeasonalTags] = useState<string[]>([]);
  const [symbolTags, setSymbolTags] = useState<string[]>([]);
  const [visualStyles, setVisualStyles] = useState<string[]>([]);

  useEffect(() => {
    if (!theme) return;
    setName(theme.name);
    setCategory(theme.category);
    setTags(theme.tags);
    setSeasonalTags(theme.seasonalTags);
    setSymbolTags(theme.symbolTags);
    setVisualStyles(theme.visualStyle);
  }, [theme]);

  function handleSave() {
    if (!theme) return;

    startTransition(async () => {
      const result = await updateSlideTheme({
        id: theme.id,
        name,
        category,
        tags,
        seasonalTags,
        symbolTags,
        visualStyles,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Theme updated");
      onOpenChange(false);
      router.refresh();
    });
  }

  const normalizedCategoryPreview = normalizeCategory(category);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit theme</DialogTitle>
          <DialogDescription>
            {theme
              ? `Update display name and taxonomy for ${theme.id}.`
              : "Select a theme to edit."}
          </DialogDescription>
        </DialogHeader>

        {theme && (
          <div className="max-h-[min(70vh,640px)] space-y-4 overflow-y-auto px-6 py-2">
            <div className="space-y-2">
              <Label htmlFor="theme-name">Name</Label>
              <Input
                id="theme-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="theme-category">Category</Label>
              <Input
                id="theme-category"
                list="theme-category-options"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="e.g. contemporary, easter, nature"
              />
              <datalist id="theme-category-options">
                {taxonomy.categories.map((item) => (
                  <option key={item} value={item}>
                    {getCategoryLabel(item)}
                  </option>
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Pick an existing category or type a new one. New categories
                appear in the sermon builder category filter.
                {normalizedCategoryPreview && normalizedCategoryPreview !== category
                  ? ` Will save as "${normalizedCategoryPreview}".`
                  : null}
              </p>
            </div>

            <TagEditor
              id="theme-tags"
              label="Tags"
              value={tags}
              onChange={setTags}
              suggestions={taxonomy.tags}
              placeholder="e.g. photo, golden, scripture"
            />

            <TagEditor
              id="theme-seasonal-tags"
              label="Seasonal tags"
              value={seasonalTags}
              onChange={setSeasonalTags}
              suggestions={taxonomy.seasonalTags}
              placeholder="e.g. advent, christmas, easter"
            />

            <TagEditor
              id="theme-symbol-tags"
              label="Symbol tags"
              value={symbolTags}
              onChange={setSymbolTags}
              suggestions={taxonomy.symbolTags}
              placeholder="e.g. cross, candles, light"
            />

            <TagEditor
              id="theme-visual-style"
              label="Visual style"
              value={visualStyles}
              onChange={setVisualStyles}
              suggestions={taxonomy.visualStyles}
              placeholder="e.g. photographic, minimal"
            />
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={pending || !theme}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
