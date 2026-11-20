import { redirect } from "next/navigation";

import { CLIPS_HREF } from "@/lib/sermon-media/hrefs";

export const dynamic = "force-dynamic";

const VIEWS = new Set(["review", "scheduled", "posted", "skipped"]);

/** Clips moved into Live > Recordings > Clips. Keeps the tab (`?view=`) of an old link. */
export default async function OldClipsPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const raw = (await searchParams).view;
  const view = Array.isArray(raw) ? raw[0] : raw;
  redirect(view && VIEWS.has(view) && view !== "review" ? `${CLIPS_HREF}?view=${view}` : CLIPS_HREF);
}
