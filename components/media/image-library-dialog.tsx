"use client";

import { useEffect, useState } from "react";
import { Check, ImageOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type LibraryPick = { kind: "library" | "stock"; id: string; url: string };

type LibraryData = {
  library: { id: string; url: string }[];
  stock: { id: string; name: string; url: string }[];
};

/**
 * Pick a picture the church uploaded before, or one of FaithForm's stock
 * pictures. Used by the event picture and by Live artwork, so both offer the
 * same library.
 */
export function ImageLibraryDialog({
  open,
  onOpenChange,
  load,
  onPick,
  initialTab = "library",
  title = "Choose a picture",
  extra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  load: () => Promise<{ ok: true; data: LibraryData } | { ok: false; error: string }>;
  /** Resolve false to keep the dialog open (the pick failed and said why). */
  onPick: (pick: LibraryPick) => Promise<boolean>;
  initialTab?: "library" | "stock";
  title?: string;
  /** Extra choices in the header, e.g. "Apply this image to all sizes". */
  extra?: React.ReactNode;
}) {
  const [tab, setTab] = useState<"library" | "stock">(initialTab);
  const [data, setData] = useState<LibraryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<LibraryPick | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setChosen(null);
    setError(null);
    let active = true;
    void load()
      .then((result) => {
        if (!active) return;
        if (result.ok) setData(result.data);
        else setError(result.error);
      })
      .catch(() => {
        if (active) setError("Your pictures couldn't be loaded. Try again.");
      });
    return () => {
      active = false;
    };
  }, [open, initialTab, load]);

  const items =
    tab === "library"
      ? (data?.library ?? []).map((item) => ({ ...item, name: "" }))
      : (data?.stock ?? []);

  async function confirm() {
    if (!chosen) return;
    setSaving(true);
    try {
      const done = await onPick(chosen);
      if (done) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-w-3xl overflow-hidden" aria-labelledby="image-library-title" onRequestClose={() => !saving}>
        <DialogHeader className="gap-2 pr-16 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="space-y-1.5">
            <DialogTitle id="image-library-title">{title}</DialogTitle>
            <DialogDescription>
              Pictures you uploaded before, or stock pictures from FaithForm.
            </DialogDescription>
          </div>
          {extra && <fieldset disabled={saving} className="shrink-0">{extra}</fieldset>}
        </DialogHeader>
        <div className="flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto p-4 sm:p-6">
          <div role="tablist" aria-label="Where the picture comes from" className="flex flex-wrap gap-2">
            {(["library", "stock"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => {
                  setTab(value);
                  setChosen(null);
                }}
                className={cn(
                  "min-h-11 rounded-full border px-5 text-[15px] font-semibold transition-colors",
                  tab === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground/80 hover:border-accent",
                )}
              >
                {value === "library" ? "Your uploads" : "Stock"}
              </button>
            ))}
          </div>

          {error ? (
            <p role="alert" className="text-[15px] text-destructive">{error}</p>
          ) : !data ? (
            <SkeletonContainer label="pictures">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 8 }, (_, index) => (
                  <Skeleton key={index} className="aspect-video rounded-xl" />
                ))}
              </div>
            </SkeletonContainer>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
              <ImageOff className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-[15px] text-muted-foreground">
                {tab === "library"
                  ? "No uploaded pictures yet. Pictures you upload for events and artwork appear here."
                  : "No stock pictures are available right now."}
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={tab === "library" ? "Your uploads" : "Stock"}>
              {items.map((item) => {
                const selected = chosen?.id === item.id && chosen.kind === tab;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={item.name ? `Use ${item.name}` : "Use this picture"}
                      onClick={() => setChosen({ kind: tab, id: item.id, url: item.url })}
                      className={cn(
                        "group relative block w-full overflow-hidden rounded-xl border-2 bg-muted text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected ? "border-accent" : "border-transparent hover:border-accent/50",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- church and stock storage URLs */}
                      <img src={item.url} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                      {item.name ? (
                        <span className="block truncate px-2 py-1.5 text-sm font-medium">{item.name}</span>
                      ) : null}
                      {selected ? (
                        <Check className="absolute right-2 top-2 size-6 rounded-full bg-accent p-1 text-accent-foreground" aria-hidden />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!chosen || saving} onClick={() => void confirm()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {saving ? "Saving…" : "Use this picture"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
