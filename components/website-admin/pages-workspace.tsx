"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { LiveEditsNote } from "@/components/website-admin/live-edits-note";
import type { LinkTarget } from "@/components/website-admin/section-fields-form";
import {
  SectionList,
  type EditableSection,
} from "@/components/website-admin/section-list";
import { SitePreview } from "@/components/website-admin/site-preview";
import { cn } from "@/lib/utils";

export type PageTab = {
  path: string;
  label: string;
};

/**
 * Editor and live preview side by side.
 *
 * A save updates the server data, so the preview iframe is reloaded *and* the
 * route is refreshed — otherwise the section list would keep rendering the
 * pre-save content it was given on the server.
 *
 * In website mode, `pages` lists Home plus each section page so churches edit
 * one page at a time without leaving the Pages tab.
 */
export function PagesWorkspace({
  sections,
  canEdit,
  isLive,
  initialOpenId = null,
  linkTargets = [],
  previewUrl,
  pages = [],
  currentPath = "/",
}: {
  sections: EditableSection[];
  canEdit: boolean;
  isLive: boolean;
  initialOpenId?: string | null;
  linkTargets?: LinkTarget[];
  previewUrl: string;
  pages?: PageTab[];
  currentPath?: string;
}) {
  const [savedAt, setSavedAt] = useState(0);
  const router = useRouter();

  function onSaved() {
    setSavedAt(Date.now());
    router.refresh();
  }

  const isWebsite = pages.length > 1;
  const pageLabel =
    pages.find((p) => p.path === currentPath)?.label ??
    (currentPath === "/" ? "Home" : currentPath);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
      <div className="flex min-w-0 flex-col gap-4">
        <LiveEditsNote isLive={isLive} />

        {isWebsite ? (
          <nav
            aria-label="Website pages"
            className="flex flex-wrap gap-2"
          >
            {pages.map((page) => {
              const selected = page.path === currentPath;
              const href =
                page.path === "/"
                  ? "/dashboard/website/pages"
                  : `/dashboard/website/pages?path=${encodeURIComponent(page.path)}`;
              return (
                <Link
                  key={page.path}
                  href={href}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-xl border px-4 text-[15px] font-semibold transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {page.label}
                </Link>
              );
            })}
          </nav>
        ) : null}

        <p className="text-[15px] text-muted-foreground">
          {isWebsite
            ? currentPath === "/"
              ? "Your home page welcomes visitors with service times and a guide to your other pages. Use the buttons above to edit About, Visit, and other pages."
              : `Editing the ${pageLabel} page. Changes here only affect this page.`
            : "Each block below is one part of your home page, top to bottom. Choose Edit to change its words and photos, move it up or down, or switch it off to hide it. The preview updates after each change saves."}
        </p>

        {sections.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-[15px] text-muted-foreground">
            This page has no sections yet.
          </p>
        ) : (
          <SectionList
            sections={sections}
            canEdit={canEdit}
            isLive={isLive}
            initialOpenId={initialOpenId}
            linkTargets={linkTargets}
            onSaved={onSaved}
          />
        )}
      </div>

      <SitePreview previewUrl={previewUrl} refreshToken={savedAt} sticky />
    </div>
  );
}
