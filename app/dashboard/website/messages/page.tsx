import { redirect } from "next/navigation";

/** The contact inbox moved to /dashboard/website/inbox. Old links still land. */
export default function WebsiteMessagesRedirect() {
  redirect("/dashboard/website/inbox");
}
