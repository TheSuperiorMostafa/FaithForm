"use server";

import { revalidatePath } from "next/cache";
import { requireChurchAuth } from "@/lib/auth/church";
import { createAdminClient } from "@/lib/supabase/admin";

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
  const { error } = await admin.from("support_tickets").insert({
    church_id: auth.churchId,
    submitted_by: auth.userId,
    subject,
    body: body || null,
    priority: "normal",
    status: "open",
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/support");
  revalidatePath("/admin/support");
  revalidatePath("/admin");
  revalidatePath(`/admin/churches/${auth.churchId}`);

  return {};
}
