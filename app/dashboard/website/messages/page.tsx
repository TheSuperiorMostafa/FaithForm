import { redirect } from "next/navigation";

import { SubmissionsInbox } from "@/components/website-admin/submissions-inbox";
import { getChurchAuth } from "@/lib/auth/church";
import { getContactSubmissions } from "@/lib/sites/queries";

export const dynamic = "force-dynamic";

/**
 * Unlike the other panels this does not require a built site — submissions can
 * exist from a site that was later unpublished, and they should stay readable.
 */
export default async function WebsiteMessagesPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const submissions = await getContactSubmissions(auth.churchId);

  return <SubmissionsInbox items={submissions} />;
}
