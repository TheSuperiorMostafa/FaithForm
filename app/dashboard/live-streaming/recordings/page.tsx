import { redirect } from "next/navigation";

import { AutoRefresh } from "@/components/live-streaming/recordings/auto-refresh";
import { RecordingLibrary } from "@/components/live-streaming/recordings/recording-library";
import { getChurchAuth } from "@/lib/auth/church";
import { listStaffRecordings } from "@/lib/stream/recording-publication";

export const dynamic = "force-dynamic";

export default async function RecordingsPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const recordings = await listStaffRecordings(auth.churchId, { limit: 60 });
  const stillChanging = recordings.some(
    (recording) => recording.phase.phase === "preparing" || recording.phase.phase === "recording",
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-xl font-bold">Recordings</h2>
        <p className="text-sm text-muted-foreground">
          Every livestream is recorded automatically. Review a recording, then publish it to the Faithful app and your website.
        </p>
      </div>
      <AutoRefresh active={stillChanging} />
      <RecordingLibrary recordings={recordings} timeZone={auth.churchTimezone ?? "America/New_York"} />
    </div>
  );
}
