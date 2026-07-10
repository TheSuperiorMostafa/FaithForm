"use client";

import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StreamShareLinks } from "@/lib/stream/share-links";

type StreamShareLinksPanelProps = {
  shareLinks: StreamShareLinks;
  compact?: boolean;
};

export function StreamShareLinksPanel({
  shareLinks,
  compact = false,
}: StreamShareLinksPanelProps) {
  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  };

  if (!shareLinks.watchUrl && shareLinks.links.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Add a church URL slug in Settings to get a public watch page.
      </p>
    );
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {shareLinks.links.map((link) => (
        <div key={link.id} className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{link.label}</p>
          <div className="flex gap-2">
            <Input value={link.url} readOnly className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={`Copy ${link.label}`}
              onClick={() => void copy(link.url, link.label)}
            >
              <Copy className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={`Open ${link.label}`}
              onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="size-4" />
            </Button>
          </div>
        </div>
      ))}

      {shareLinks.embedCode ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Website embed code
          </p>
          <div className="flex gap-2">
            <Input
              value={shareLinks.embedCode}
              readOnly
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy embed code"
              onClick={() => void copy(shareLinks.embedCode, "Embed code")}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
