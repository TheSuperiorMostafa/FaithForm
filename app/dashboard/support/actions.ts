"use server";

import { revalidatePath } from "next/cache";
import { requireChurchAuth } from "@/lib/auth/church";
import { sendSupportTicketNotification } from "@/lib/email/support-ticket";
import { absoluteAppPath } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function submitSupportTicket(params: {
  subject: string;
  body: string;
}): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();

  const subject = params.subject.trim();
  const body = params.body.trim();

  if (!subject) {
    return { error: "Subject is required." };
  }
  if (subject.length > 200) {
    return { error: "Subject must be 200 characters or fewer." };
  }

  const admin = createAdminClient();
  const { data: ticket, error } = await admin
    .from("support_tickets")
    .insert({
      church_id: auth.churchId,
      submitted_by: auth.userId,
      subject,
      body: body || null,
      priority: "normal",
      status: "open",
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  // The ticket is saved; from here nothing may fail loudly. A church that has
  // asked for help should never be told their request errored because our
  // doorbell did.
  try {
    const [{ data: churchRow }, { data: userData }] = await Promise.all([
      admin
        .from("churches")
        .select("name")
        .eq("id", auth.churchId)
        .maybeSingle(),
      createClient().auth.getUser(),
    ]);

    await sendSupportTicketNotification({
      churchName: (churchRow?.name as string | undefined) ?? "A church",
      subject,
      body: body || null,
      submittedByEmail: userData.user?.email ?? null,
      priority: "normal",
      reviewUrl: absoluteAppPath(`/admin/support/${ticket?.id ?? ""}`),
    });
  } catch (notifyError) {
    console.error("submitSupportTicket notify:", notifyError);
  }

  revalidatePath("/dashboard/support");
  revalidatePath("/admin/support");
  revalidatePath("/admin");
  revalidatePath(`/admin/churches/${auth.churchId}`);

  return {};
}
