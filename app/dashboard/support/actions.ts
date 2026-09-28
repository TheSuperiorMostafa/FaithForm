"use server";

import { revalidatePath } from "next/cache";
import { requireChurchAuth } from "@/lib/auth/church";
import {
  sendSupportTicketAck,
  sendSupportTicketNotification,
} from "@/lib/email/support-ticket";
import { absoluteAppPath } from "@/lib/site-url";
import { SUPPORT_COMMENT_MAX_LENGTH } from "@/lib/support/comments";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toUserError } from "@/lib/errors/user-error";
import {
  SUPPORT_SUBJECT_MAX,
  deriveTicketSubject,
  sanitizeFromPath,
  withFromPath,
} from "@/app/dashboard/support/ticket-helpers";

export async function submitSupportTicket(params: {
  /** Optional: the first line of the message is used when it is empty. */
  subject?: string;
  body: string;
  /** The dashboard page they came from, if known (`?from=`). */
  fromPath?: string | null;
}): Promise<{ error?: string }> {
  const auth = await requireChurchAuth();

  const message = String(params.body ?? "").trim();
  if (!message) {
    return { error: "Write a message so we know how to help." };
  }
  const subject = deriveTicketSubject(String(params.subject ?? ""), message);
  if (subject.length > SUPPORT_SUBJECT_MAX) {
    return { error: `Keep the subject under ${SUPPORT_SUBJECT_MAX} characters.` };
  }
  const body = withFromPath(message, sanitizeFromPath(params.fromPath));

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
    return { error: toUserError(error, "We couldn't send your message.") };
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
  const message = String(params.body ?? "").trim();
  if (!message) return { error: "Write a message before posting." };
  if (message.length > SUPPORT_COMMENT_MAX_LENGTH) {
    return { error: `Keep it under ${SUPPORT_COMMENT_MAX_LENGTH.toLocaleString()} characters.` };
  }

  // The database locks this ticket, verifies its church, posts the reply, and
  // reopens a resolved ticket together. A failed update cannot strand a reply
  // in a closed conversation.
  const { data: subject, error } = await admin.rpc("reply_to_support_ticket", {
    p_ticket_id: params.ticketId,
    p_church_id: auth.churchId,
    p_author_user_id: auth.userId,
    p_author_name: auth.userEmail ?? null,
    p_body: message,
  });
  if (error?.code === "P0002") return { error: "That ticket could not be found." };
  if (error) return { error: toUserError(error, "We couldn't send your reply.") };

  try {
    const { data: churchRow } = await admin
      .from("churches")
      .select("name")
      .eq("id", auth.churchId)
      .maybeSingle();

    await sendSupportTicketNotification({
      churchName: (churchRow?.name as string | undefined) ?? "A church",
      subject: `Reply — ${subject as string}`,
      body: message,
      submittedByEmail: auth.userEmail ?? null,
      priority: "normal",
      reviewUrl: absoluteAppPath(`/admin/support/${params.ticketId}`),
    });
  } catch (notifyError) {
    console.error("replyToSupportTicket notify:", notifyError);
  }

  revalidatePath("/dashboard/support");
  revalidatePath("/admin/support");
  revalidatePath(`/admin/support/${params.ticketId}`);

  return {};
}
