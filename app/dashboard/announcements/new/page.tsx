import { redirect } from "next/navigation";

export default function NewAnnouncementPage() {
  redirect("/dashboard/announcements");
}
