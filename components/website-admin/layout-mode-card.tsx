"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setLayoutMode } from "@/app/dashboard/website/actions";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { SiteLayoutMode } from "@/lib/sites/layout-mode";

const OPTIONS = [
  { value: "landing" as const, label: "One long page" },
  { value: "website" as const, label: "Separate pages" },
];

/**
 * Landing (everything on one scroll) vs Website (About, Visit, … each have
 * their own address). Lives on Overview so churches see it next to publish.
 */
export function LayoutModeCard({
  initialMode,
  canEdit,
}: {
  initialMode: SiteLayoutMode;
  canEdit: boolean;
}) {
  const [mode, setMode] = useState<SiteLayoutMode>(initialMode);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function choose(next: SiteLayoutMode) {
    if (next === mode || pending) return;

    if (next === "website") {
      const ok = await confirmAction({
        title: "Use separate pages?",
        description:
          "About, Visit, Give, and your other sections will each get their own page. Your home page will stay short — welcome, service times, and ways to reach you. Menu links will go to those pages instead of scrolling.",
        confirmLabel: "Use separate pages",
      });
      if (!ok) return;
    } else {
      const ok = await confirmAction({
        title: "Use one long page?",
        description:
          "Everything will live on a single page again, and the menu will scroll to each section. Separate page addresses like /about will stop working.",
        confirmLabel: "Use one long page",
      });
      if (!ok) return;
    }

    startTransition(async () => {
      const result = await setLayoutMode(next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setMode(next);
      toast.success(
        next === "website"
          ? "Your website now uses separate pages for each section."
          : "Your website is one long page again.",
      );
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="space-y-1.5">
        <h2 className="font-heading text-lg font-bold">How your site is laid out</h2>
        <p className="text-[15px] text-muted-foreground">
          {mode === "website"
            ? "Visitors open a short home page, then use the menu to open About, Visit, and other pages."
            : "Visitors see everything on one page. The menu scrolls them to each section."}
        </p>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Website layout"
            value={mode}
            options={OPTIONS}
            onChange={(value) => void choose(value)}
          />
          {pending ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
        </div>
      ) : (
        <p className="text-[15px] font-medium">
          {mode === "website" ? "Separate pages for each section" : "One long page"}
        </p>
      )}

      {!canEdit ? (
        <p className="text-sm text-muted-foreground">
          Only church admins can change how the website is laid out.
        </p>
      ) : null}
    </section>
  );
}
