import { notFound, redirect } from "next/navigation";

import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

/** Clips moved to their own section. Old links (and bookmarks) land on the same clip there. */
export default async function OldClipEditorPage({ params }: { params: Promise<{ id: string; clipId: string }> }) {
  if (await pageFeatureBlocked("live_stream")) return null;
  const { clipId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(clipId)) notFound();
  redirect(`/dashboard/clips/${clipId}`);
}
