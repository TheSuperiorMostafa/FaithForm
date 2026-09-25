"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { LiveEditsNote } from "@/components/website-admin/live-edits-note";
import type { LinkTarget } from "@/components/website-admin/section-fields-form";
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
  isLive,
  initialOpenId = null,
  linkTargets = [],
  previewUrl,
}: {
  sections: EditableSection[];
  canEdit: boolean;
  isLive: boolean;
  initialOpenId?: string | null;
  linkTargets?: LinkTarget[];
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
        <LiveEditsNote isLive={isLive} />

        <p className="text-[15px] text-muted-foreground">
          Each block below is one part of your home page, top to bottom. Choose
          Edit to change its words and photos, move it up or down, or switch it
          off to hide it. The preview updates after each change saves.
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
