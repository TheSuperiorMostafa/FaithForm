import { redirect } from "next/navigation";
import { TranscriptLibrary } from "@/components/transcripts/transcript-library";
import { TranscriptsSettingUp } from "@/components/transcripts/transcripts-setting-up";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { getSermonMediaSettings } from "@/lib/sermon-media/access";
import { recordingDateValue } from "@/lib/stream/recording-date";

export const dynamic = "force-dynamic";

export default async function TranscriptsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  if (await pageFeatureBlocked("live_stream")) return null;
  if (await pageFeatureBlocked("sermon_media")) return null;

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const settings = await getSermonMediaSettings(auth.churchId).catch(() => null);
  if (!settings?.enabled) return <TranscriptsSettingUp />;

  const params = await searchParams;
  const rawQ = Array.isArray(params.q) ? params.q[0] : params.q;
  const rawPage = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  const timeZone = auth.churchTimezone || "America/New_York";

  return (
    <TranscriptLibrary
      isAdmin={auth.isAdmin}
      timeZone={timeZone}
      today={recordingDateValue(new Date().toISOString(), timeZone)}
      autoTranscribe={settings.autoTranscribe}
      initialQuery={(rawQ ?? "").trim().slice(0, 80)}
      initialPage={Number.isInteger(rawPage) && rawPage > 1 ? rawPage : 1}
    />
  );
}
