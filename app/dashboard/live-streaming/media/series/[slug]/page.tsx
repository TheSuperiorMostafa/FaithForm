import { redirect } from "next/navigation";

/** Series moved under Recordings; old links keep working. */
export default async function LegacyMediaSeriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/dashboard/live-streaming/recordings/series/${encodeURIComponent(slug)}`);
}
