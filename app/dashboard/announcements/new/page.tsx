import { redirect } from "next/navigation";

/** Old "new announcement" links open the composer on the Announcements page. */
export default function NewAnnouncementPage() {
  redirect("/dashboard/announcements?compose=1");
}
