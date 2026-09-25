import { redirect } from "next/navigation";

/** "Everything" is the All view of Recordings now. */
export default function LegacyAllMediaPage() {
  redirect("/dashboard/live-streaming/recordings");
}
