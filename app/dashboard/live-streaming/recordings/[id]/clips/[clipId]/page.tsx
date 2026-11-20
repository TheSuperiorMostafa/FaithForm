import { notFound, redirect } from "next/navigation";

import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { clipHref } from "@/lib/sermon-media/hrefs";

export const dynamic = "force-dynamic";

/** The old per-recording clip editor URL. Old links (and bookmarks) land on the same clip in Recordings > Clips. */
export default async function OldClipEditorPage({ params }: { params: Promise<{ id: string; clipId: string }> }) {
  if (await pageFeatureBlocked("live_stream")) return null;
  const { clipId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(clipId)) notFound();
  redirect(clipHref(clipId));
}
