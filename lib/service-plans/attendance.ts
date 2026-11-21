import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { renderEmail } from "@/lib/email/layout";
import { resolveFromAddress } from "@/lib/email/sender";
import { isChurchFeatureEmailEnabled } from "@/lib/features/access";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { answerHeadline, answerSmsBody, type AnswerAlert } from "@/lib/service-plans/alerts";
import type { ShareRow } from "@/lib/service-plans/share";
import { formatPlanDate } from "@/lib/service-plans/timing";
import type { Plan } from "@/lib/service-plans/types";
import { getChurchSmsSender } from "@/lib/sms/church-sender";
import { sendSms } from "@/lib/sms/send-sms";
import { absoluteAppPath } from "@/lib/site-url";

/**
 * "I'll be there" / "Can't make it" from a personal share link.
 *
 * The share page has already checked the token. The answer is recorded for the
 * share's own person (the database function reads it from the share row, so
 * nothing the visitor sends can name someone else), copied onto their team
 * rows, and staff on the service type's alert list are told when it changed.
 */

export type Answer = "confirmed" | "declined";

/** Records the answer; returns the one before it (null on the first answer). */
export async function recordAnswer(admin: SupabaseClient, share: ShareRow, status: Answer): Promise<Answer | null> {
  const { data, error } = await admin.rpc("service_plan_record_attendance", {
    p_church_id: share.church_id,
    p_share_id: share.id,
    p_status: status,
  });
  if (error) throw error;
  return data === "confirmed" || data === "declined" ? data : null;
}

/**
 * Tells every email and mobile number on the service type's alert list. Never
 * throws: the answer is saved already, and a missed alert must not turn into
 * an error for the person who answered. Capped per link so a hand flipping
 * between the two buttons cannot flood staff phones.
 */
export async function notifyAnswer(input: {
  admin: SupabaseClient;
  share: ShareRow;
  plan: Plan;
  churchName: string;
  status: Answer;
  previous: Answer | null;
}): Promise<void> {
  const { admin, share, plan } = input;
  try {
    const [type, person] = await Promise.all([
      admin
        .from("service_types")
        .select("response_notify_emails, response_notify_phones")
        .eq("church_id", share.church_id)
        .eq("id", plan.serviceTypeId)
        .maybeSingle(),
      share.person_id
        ? admin
            .from("members")
            .select("first_name, last_name")
            .eq("church_id", share.church_id)
            .eq("id", share.person_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (type.error) throw type.error;
    const emails = ((type.data?.response_notify_emails as string[] | null) ?? []).slice(0, 10);
    const phones = ((type.data?.response_notify_phones as string[] | null) ?? []).slice(0, 10);
    if (!emails.length && !phones.length) return;

    const limit = await checkRateLimit(`service-plan-answer-alert:${share.id}`, { limit: 6, windowMs: 60 * 60 * 1000 });
    if (!limit.ok) {
      console.warn(`[FaithForm] service plan answer alert skipped (${limit.reason})`);
      return;
    }

    const personName =
      [person.data?.first_name, person.data?.last_name].filter(Boolean).join(" ").trim() || "Someone";
    const alert: AnswerAlert = {
      churchName: input.churchName,
      personName,
      status: input.status,
      previous: input.previous,
      serviceTypeName: plan.serviceTypeName,
      when: plan.date ? formatPlanDate(plan.date) : "the service",
    };

    await Promise.all([
      emails.length ? emailAlert(share.church_id, emails, alert, plan) : null,
      phones.length ? textAlert(admin, share.church_id, phones, alert) : null,
    ]);
  } catch (error) {
    console.error("[FaithForm] service plan answer alert:", error instanceof Error ? error.message : error);
  }
}

async function emailAlert(churchId: string, to: string[], alert: AnswerAlert, plan: Plan): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[FaithForm] Service plan answer alert (no RESEND_API_KEY): not sent");
    return;
  }
  if (!(await isChurchFeatureEmailEnabled(churchId, "service_plans"))) return;
  const headline = answerHeadline(alert);
  const subject = `${headline}: ${alert.serviceTypeName}, ${alert.when}`;
  const content = renderEmail({
    title: subject,
    preheader: `${headline} on ${alert.when}.`,
    heading: headline,
    blocks: [
      {
        kind: "paragraph",
        text:
          alert.status === "confirmed"
            ? `${alert.personName} said they’ll be there for ${alert.serviceTypeName} on ${alert.when}.`
            : `${alert.personName} said they can’t make it to ${alert.serviceTypeName} on ${alert.when}.`,
      },
      ...(alert.previous && alert.previous !== alert.status
        ? [{ kind: "muted" as const, text: "They changed their earlier answer." }]
        : []),
      {
        kind: "button",
        label: "Open the plan",
        url: absoluteAppPath(`/dashboard/plans/${plan.serviceTypeId}/${plan.id}`),
      },
    ],
    permissionNote: `You are getting this because you are on the answer alerts for ${alert.serviceTypeName} at ${alert.churchName}. Change them in Service Plans, under the service type’s Settings.`,
  });
  const resend = new Resend(apiKey);
  // One message each, so the people on the list don't see each other's addresses.
  await Promise.all(
    to.map(async (address) => {
      try {
        const { error } = await resend.emails.send({
          from: `${alert.churchName} via FaithForm <${resolveFromAddress()}>`,
          to: address,
          subject,
          html: content.html,
          text: content.text,
        });
        if (error) console.error("[FaithForm] Resend error (service plan answer alert):", error.message);
      } catch (e) {
        console.error("[FaithForm] service plan answer alert email:", e instanceof Error ? e.message : e);
      }
    }),
  );
}

async function textAlert(admin: SupabaseClient, churchId: string, to: string[], alert: AnswerAlert): Promise<void> {
  const sender = await getChurchSmsSender(churchId, admin);
  if (!sender) {
    console.warn("[FaithForm] service plan answer alert: no texting number for this church");
    return;
  }
  const body = answerSmsBody(alert);
  await Promise.all(
    to.map(async (phone) => {
      const result = await sendSms(sender, phone, body);
      if (!result.ok) console.error("[FaithForm] service plan answer alert text failed");
    }),
  );
}
