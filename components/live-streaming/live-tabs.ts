import type { SectionLinkTab } from "@/components/dashboard/section-link-tabs";

export const LIVE_PAGE_TITLE = "Live";
export const LIVE_PAGE_DESCRIPTION =
  "Stream your service, then share the recording in the FaithForm app.";

/**
 * Four tabs, in the order a church meets them. The old "Library" tab is part
 * of Recordings now (its series shelves are the "Series" filter), and the
 * schedule has its own "Upcoming" tab instead of sitting under Go live.
 */
export const LIVE_TABS: SectionLinkTab[] = [
  { label: "Go live", href: "/dashboard/live-streaming", match: "exact" },
  { label: "Recordings", href: "/dashboard/live-streaming/recordings", match: "prefix" },
  { label: "Upcoming", href: "/dashboard/live-streaming/upcoming", match: "prefix" },
  { label: "Setup", href: "/dashboard/live-streaming/setup", match: "prefix" },
];
