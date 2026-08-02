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
  label: "Sermons",
  // The messages themselves are managed in Website → Sermons rather than here,
  // so this only exposes the framing copy around the feed.
  fields: [
    { key: "eyebrow", label: "Eyebrow", type: "text" },
    { key: "headline", label: "Headline", type: "headline" },
    {
      key: "link",
      label: "Header link",
      type: "group",
      fields: [
        { key: "label", label: "Label", type: "text" },
        { key: "href", label: "Link", type: "url" },
      ],
    },
    {
      key: "emptyMessage",
      label: "Message when there are no sermons",
      type: "text",
    },
  ],
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
