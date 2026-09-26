import { redirect } from "next/navigation";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

/** Series moved under Recordings; old links keep working. */
export default async function LegacyMediaSeriesPage({ params }: { params: Promise<{ slug: string }> }) {
  if (await pageFeatureBlocked("live_stream")) return null;

  const { slug } = await params;
  redirect(`/dashboard/live-streaming/recordings/series/${encodeURIComponent(slug)}`);
}
