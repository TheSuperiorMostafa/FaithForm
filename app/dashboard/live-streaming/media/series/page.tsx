import { redirect } from "next/navigation";

/** Series moved under Recordings; old links keep working. */
export default function LegacyMediaSeriesIndexPage() {
  redirect("/dashboard/live-streaming/recordings/series");
}
