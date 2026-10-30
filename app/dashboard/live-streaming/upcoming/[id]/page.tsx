import { notFound, redirect } from "next/navigation";
import { UpcomingServiceEditor } from "@/components/live-streaming/upcoming-service-editor";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { getStreamEvent } from "@/lib/stream/events";
import { listMediaSeries } from "@/lib/stream/media-library";
import { createClient } from "@/lib/supabase/server";
import { canAccessFeature, getFeatureAccess } from "@/lib/features/access";
import { getRecordingSettings } from "@/lib/stream/recording-publication";

export const dynamic = "force-dynamic";

export default async function UpcomingServicePage({ params }: { params: Promise<{ id: string }> }) {
  if (await pageFeatureBlocked("live_stream")) return null;
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");
  if (!auth.isAdmin) notFound();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const event = await getStreamEvent(id, createClient());
  if (!event || event.churchId !== auth.churchId || event.status !== "scheduled") notFound();
  const [series, access, settings] = await Promise.all([listMediaSeries(auth.churchId), getFeatureAccess(), getRecordingSettings(auth.churchId)]);
  return <UpcomingServiceEditor event={event} series={series} settings={settings} appEnabled={canAccessFeature(access, "member_app")} timeZone={auth.churchTimezone ?? "America/New_York"} />;
}
