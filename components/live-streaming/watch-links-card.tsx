"use client";

import { Link2 } from "lucide-react";
import { StreamShareLinksPanel } from "@/components/live-streaming/stream-share-links-panel";
import type { StreamShareLinks } from "@/lib/stream/share-links";

type WatchLinksCardProps = {
  shareLinks: StreamShareLinks;
};

/** Watch page links and the website embed code, for Setup › Advanced. */
export function WatchLinksCard({ shareLinks }: WatchLinksCardProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Link2 className="mt-1 size-5 shrink-0 text-accent" aria-hidden />
        <div className="flex flex-col gap-1">
          <h3 className="font-heading text-lg font-semibold">Watch page and embed code</h3>
          <p className="text-[15px] text-muted-foreground">
            Share your watch page, or put the player on your church website.
          </p>
        </div>
      </div>
      <StreamShareLinksPanel shareLinks={shareLinks} />
    </div>
  );
}
