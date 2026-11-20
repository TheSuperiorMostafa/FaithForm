import { notFound, redirect } from "next/navigation";

import { clipHref } from "@/lib/sermon-media/hrefs";

export const dynamic = "force-dynamic";

/** Old clip links land on the same clip in Live > Recordings > Clips. */
export default async function OldClipPage({ params }: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(clipId)) notFound();
  redirect(clipHref(clipId));
}
