"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setPublished } from "@/app/dashboard/website/actions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export function PublishCard({
  initialPublished,
  previewUrl,
  liveUrl,
  canEdit,
}: {
  initialPublished: boolean;
  previewUrl: string;
  liveUrl: string | null;
  canEdit: boolean;
}) {
  const [published, setPublishedState] = useState(initialPublished);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    // Optimistic, reverted on failure — the switch should feel immediate.
    setPublishedState(next);
    startTransition(async () => {
      const result = await setPublished(next);
      if (!result.ok) {
        setPublishedState(!next);
        toast.error(result.error);
        return;
      }
      toast.success(next ? "Your website is live." : "Your website is now private.");
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-lg font-bold">
            {published ? "Live" : "Not published"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {published
              ? "Visitors can find your site and search engines can index it."
              : "Only you can see it, using the preview link below."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">
            {published ? "Published" : "Draft"}
          </span>
          <Switch
            checked={published}
            disabled={!canEdit || pending}
            onCheckedChange={toggle}
            aria-label="Publish website"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <a href={previewUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm">
            Open preview
          </Button>
        </a>
        {published && liveUrl ? (
          <a href={liveUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
              Visit live site
            </Button>
          </a>
        ) : null}
      </div>

      {!canEdit ? (
        <p className="text-xs text-muted-foreground">
          Only church admins can publish or unpublish the website.
        </p>
      ) : null}
    </div>
  );
}
