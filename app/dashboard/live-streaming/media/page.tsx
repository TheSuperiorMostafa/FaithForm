import { redirect } from "next/navigation";

/** The old Library tab is the Series view of Recordings now. */
export default function LegacyMediaLibraryPage() {
  redirect("/dashboard/live-streaming/recordings?show=series");
}
