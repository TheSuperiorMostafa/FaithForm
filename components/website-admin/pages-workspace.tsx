"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  SectionList,
  type EditableSection,
} from "@/components/website-admin/section-list";
import { SitePreview } from "@/components/website-admin/site-preview";

/**
 * Editor and live preview side by side.
 *
 * A save updates the server data, so the preview iframe is reloaded *and* the
 * route is refreshed — otherwise the section list would keep rendering the
 * pre-save content it was given on the server.
 */
export function PagesWorkspace({
  sections,
  canEdit,
  previewUrl,
}: {
  sections: EditableSection[];
  canEdit: boolean;
  previewUrl: string;
}) {
  const [savedAt, setSavedAt] = useState(0);
  const router = useRouter();

  function onSaved() {
    setSavedAt(Date.now());
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
      <div className="flex min-w-0 flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Reorder sections, hide the ones you don&apos;t need, and edit the words
          on each. Changes show in the preview as soon as you save.
        </p>

        {sections.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            This page has no sections yet.
          </p>
        ) : (
          <SectionList sections={sections} canEdit={canEdit} onSaved={onSaved} />
        )}
      </div>

      <SitePreview previewUrl={previewUrl} refreshToken={savedAt} sticky />
    </div>
  );
}
