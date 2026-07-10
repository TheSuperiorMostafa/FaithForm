"use client";

import { Link2 } from "lucide-react";
import { StreamShareLinksPanel } from "@/components/live-streaming/stream-share-links-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { StreamShareLinks } from "@/lib/stream/share-links";

type WatchLinksCardProps = {
  shareLinks: StreamShareLinks;
};

export function WatchLinksCard({ shareLinks }: WatchLinksCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4 text-accent" aria-hidden />
          Watch page and embed
        </CardTitle>
        <CardDescription>
          Share your FaithForm watch page or embed on your church website.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <StreamShareLinksPanel shareLinks={shareLinks} />
      </CardContent>
    </Card>
  );
}
