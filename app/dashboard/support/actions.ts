"use server";

import { revalidatePath } from "next/cache";
import { requireChurchAuth } from "@/lib/auth/church";
import {
  sendSupportTicketAck,
  sendSupportTicketNotification,
} from "@/lib/email/support-ticket";
import { absoluteAppPath } from "@/lib/site-url";
import { postTicketComment } from "@/lib/support/comments";
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

    const churchName = (churchRow?.name as string | undefined) ?? "A church";
    const submitterEmail = userData.user?.email ?? auth.userEmail ?? null;

    // Both notes go out together: ours so somebody looks, theirs so the
    // request does not disappear into silence.
    await Promise.all([
      sendSupportTicketNotification({
        churchName,
        subject,
        body: body || null,
        submittedByEmail: submitterEmail,
        priority: "normal",
        reviewUrl: absoluteAppPath(`/admin/support/${ticket?.id ?? ""}`),
      }),
      submitterEmail
        ? sendSupportTicketAck({
            to: submitterEmail,
            churchName,
            subject,
            body: body || null,
          })
        : Promise.resolve(false),
    ]);
  } catch (notifyError) {
    console.error("submitSupportTicket notify:", notifyError);
  }

  revalidatePath("/dashboard/support");
  revalidatePath("/admin/support");
  revalidatePath("/admin");
  revalidatePath(`/admin/churches/${auth.churchId}`);

  return {};
}

/**
 * A church answering us on their own ticket.
 *
 * The ticket is re-read here rather than trusted from the form: the id comes
 * from a browser, and the only thing that makes it theirs is the church id on
 * the row matching the one their session resolves to.
 */
export async function replyToSupportTicket(params: {
  ticketId: string;
  body: string;
}): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();
  const admin = createAdminClient();

  const { data: ticket, error } = await admin
    .from("support_tickets")
    .select("id, church_id, subject, status")
    .eq("id", params.ticketId)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!ticket || ticket.church_id !== auth.churchId) {
    return { error: "That ticket could not be found." };
  }

  const posted = await postTicketComment(admin, {
    ticketId: ticket.id as string,
    churchId: auth.churchId,
    authorRole: "church",
    authorUserId: auth.userId,
    authorName: auth.userEmail ?? null,
    body: params.body,
  });

  if (posted.error) return posted;

  // A church replying to a ticket we had closed is reopening it. Leaving it
  // resolved is how a reply goes unread.
  if (ticket.status === "resolved") {
    await admin
      .from("support_tickets")
      .update({ status: "open", updated_at: new Date().toISOString() })
      .eq("id", ticket.id);
  }

  try {
    const { data: churchRow } = await admin
      .from("churches")
      .select("name")
      .eq("id", auth.churchId)
      .maybeSingle();

    await sendSupportTicketNotification({
      churchName: (churchRow?.name as string | undefined) ?? "A church",
      subject: `Reply — ${ticket.subject as string}`,
      body: params.body.trim(),
      submittedByEmail: auth.userEmail ?? null,
      priority: "normal",
      reviewUrl: absoluteAppPath(`/admin/support/${ticket.id as string}`),
    });
  } catch (notifyError) {
    console.error("replyToSupportTicket notify:", notifyError);
  }

  revalidatePath("/dashboard/support");
  revalidatePath("/admin/support");
  revalidatePath(`/admin/support/${params.ticketId}`);

  return {};
}
