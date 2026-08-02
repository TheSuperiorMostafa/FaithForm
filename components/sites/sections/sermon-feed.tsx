import { defineSection } from "@/lib/sites/contract";
import type { SermonFeedContent } from "@/types/site";

import { SermonFeedView } from "./sermon-feed-view";

/**
 * Server-side master definition. The interactive view is a separate client
 * module: the registry has to read `.type` and `.defaults` off this object, and
 * anything exported from a "use client" file is a reference proxy on the server
 * that throws the moment it is dotted into.
 */
export const sermonFeedSection = defineSection<SermonFeedContent>({
  type: "sermon_feed",
  defaults: {
    eyebrow: null,
    headline: { lead: "Latest messages" },
    link: null,
    items: [],
    emptyMessage: "Messages will appear here once the first one is published.",
    surface: "ink",
    align: "split",
  },
  derive: (profile) => (profile.media.length > 0 ? { items: profile.media } : {}),
  Component: SermonFeedView,
});
