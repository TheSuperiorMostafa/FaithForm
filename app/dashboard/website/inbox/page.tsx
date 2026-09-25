import { redirect } from "next/navigation";

import { SubmissionsInbox } from "@/components/website-admin/submissions-inbox";
import { getChurchAuth } from "@/lib/auth/church";
import { getContactSubmissions } from "@/lib/sites/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * The contact-form inbox. Called "Inbox", not "Messages", so it never clashes
 * with sermons (which many churches call messages).
 *
 * Unlike the other panels this does not require a built site — submissions can
 * exist from a site that was later unpublished, and they should stay readable.
 */
export default async function WebsiteInboxPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const [submissions, church] = await Promise.all([
    getContactSubmissions(auth.churchId),
    createAdminClient()
      .from("churches")
      .select("name")
      .eq("id", auth.churchId)
      .maybeSingle()
      .then(({ data }) => data),
  ]);

  return (
    <SubmissionsInbox
      items={submissions}
      churchName={(church?.name as string | null) ?? null}
    />
  );
}
