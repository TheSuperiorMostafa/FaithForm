"use client";

import Link from "next/link";
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
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied.`);
    } catch {
      toast.error("Your browser didn't allow copying. Select the text and copy it instead.");
    }
  };

  if (!shareLinks.watchUrl && shareLinks.links.length === 0) {
    return (
      <p className="text-[15px] text-muted-foreground">
        Your church needs a web address before it gets a public watch page.{" "}
        <Link href="/dashboard/settings" className="font-medium text-primary underline underline-offset-4 dark:text-accent">
          Set one in Settings
        </Link>
        .
      </p>
    );
  }

  return (
    <div className={compact ? "flex flex-col gap-3" : "flex flex-col gap-4"}>
      {shareLinks.links.map((link) => (
        <div key={link.id} className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-muted-foreground">{link.label}</p>
          <div className="flex gap-2">
            <Input value={link.url} readOnly className="min-w-0 font-mono text-sm" aria-label={link.label} />
            <Button
              type="button"
              variant="outline"
              className="shrink-0 gap-2"
              onClick={() => void copy(link.url, link.label)}
            >
              <Copy className="size-4" aria-hidden />
              Copy
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="shrink-0 gap-2"
              onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="size-4" aria-hidden />
              Open
            </Button>
          </div>
        </div>
      ))}

      {shareLinks.embedCode ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-muted-foreground">Website embed code</p>
          <div className="flex gap-2">
            <Input
              value={shareLinks.embedCode}
              readOnly
              className="min-w-0 font-mono text-sm"
              aria-label="Website embed code"
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0 gap-2"
              onClick={() => void copy(shareLinks.embedCode, "Embed code")}
            >
              <Copy className="size-4" aria-hidden />
              Copy
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
