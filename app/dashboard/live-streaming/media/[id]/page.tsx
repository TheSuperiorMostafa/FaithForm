import { redirect } from "next/navigation";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

/**
 * A recording has one page: the review screen, where it is watched, edited,
 * trimmed and published. The library's links still arrive here, and are sent
 * on.
 */
export default async function MediaItemPage({ params }: { params: Promise<{ id: string }> }) {
  if (await pageFeatureBlocked("live_stream")) return null;

  const { id } = await params;
  redirect(`/dashboard/live-streaming/recordings/${encodeURIComponent(id)}`);
}
